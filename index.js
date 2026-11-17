/**
 * Host half of the `快捷操作` (Quick Actions) bundle.
 *
 * The Desktop build runs its Harness host as an Electron "node" child, so
 * `ELECTRON_RUN_AS_NODE=1` sits in the host's own environment and every child
 * it spawns inherits it. An Electron application that starts with that variable
 * runs in Node mode and exits at once, which is why the stock `open-in-app`
 * launcher cannot open VS Code from this host. The launcher here therefore
 * clears the Electron flags, and it carries the small amount of per-platform
 * application discovery the two routes need.
 *
 *   GET  /quick-actions/apps  -> { apps: ('vscode'|'vscodeinsiders'|'filemanager')[] }
 *   POST /quick-actions/open  -> { app, path } -> { ok: true }
 *
 * Per platform:
 * - Windows: VS Code from the standard install paths, the installer's
 *   `App Paths` value, or the executable beside the `code` CLI on PATH. The
 *   file manager is `%SystemRoot%\explorer.exe`; its exit code is ignored,
 *   because `explorer.exe <dir>` reports a nonzero status after handing the
 *   folder to the already-running shell.
 * - macOS: `open -a <bundle>` for a bundle under `/Applications` or
 *   `~/Applications`, else the `code` CLI. Finder through `open <dir>`.
 * - Linux: the `code` CLI from PATH, then known install locations; the file
 *   manager through `xdg-open`, and only when a display server is present.
 * - Over SSH nothing is offered: the window would open on the remote machine,
 *   not in front of the person who clicked.
 *
 * Both routes are fenced by the composition's `connection` service (the same
 * check the shipped routes use), and the POST body is validated before anything
 * is spawned: `application/json`, a 64 KiB cap, a known app id, and an absolute
 * directory that exists.
 */
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir, platform as osPlatform } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Cordis function-plugin name. */
export const name = 'quick-actions'

/** The route carrier, the trust fence, and the PATH resolver. */
export const inject = ['webServer', 'connection', 'subprocess']

/** Browser-facing routes. */
const APPS_PATH = '/quick-actions/apps'
const OPEN_PATH = '/quick-actions/open'

/** Request bodies are a few bytes of JSON; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024
/** Early-failure watch window per launch: still running afterwards counts as launched. */
const WATCH_MS = 1500
/** Per-command deadline for the registry probe. */
const PROBE_TIMEOUT_MS = 10_000

/** Application ids offered to the browser, in menu order. */
const APP_IDS = ['vscode', 'vscodeinsiders', 'filemanager']

/** Windows: executable name, install directory, and CLI name per editor id. */
const WINDOWS_APPS = {
  vscode: { exe: 'Code.exe', directory: 'Microsoft VS Code', cli: 'code' },
  vscodeinsiders: { exe: 'Code - Insiders.exe', directory: 'Microsoft VS Code Insiders', cli: 'code-insiders' },
}

/** macOS: application bundle name and CLI name per editor id. */
const MAC_APPS = {
  vscode: { bundle: 'Visual Studio Code.app', cli: 'code' },
  vscodeinsiders: { bundle: 'Visual Studio Code - Insiders.app', cli: 'code-insiders' },
}

/** Linux: CLI name and known binaries per editor id. */
const LINUX_APPS = {
  vscode: {
    cli: 'code',
    files: ['/usr/share/code/code', '/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code', '/opt/stable/code'],
  },
  vscodeinsiders: {
    cli: 'code-insiders',
    files: ['/usr/share/code-insiders/code-insiders', '/usr/bin/code-insiders', '/usr/local/bin/code-insiders', '/snap/bin/code-insiders'],
  },
}

/**
 * One resolved launcher: the argv that precedes the folder is `prefix`, so a
 * launch is `command ...prefix <directory>`.
 * @typedef {{ command: string, prefix: readonly string[], ignoreExitCode?: boolean }} Launcher
 */

/** App-id to resolved launcher (or null), reused per host process. */
const launchers = new Map()

/** JSON response (no-store: availability and launch outcomes are live facts). */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** The composition's connection service; the browser-side package owns its full type. */
function connectionOf(ctx) {
  return Reflect.get(ctx, 'connection')
}

/** Answer an untrusted/unauthenticated request; true when it was rejected. */
function rejected(ctx, req, res) {
  const connection = connectionOf(ctx)
  if (typeof connection?.requestRejection !== 'function') {
    sendJson(res, 503, { code: 'unavailable', message: 'the connection trust fence is not mounted' })
    return true
  }
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/** Whether a path exists as a regular file. */
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    // Swallows ENOENT/EACCES: an unproven candidate is not a launcher.
    return false
  }
}

/** Whether a path exists as a directory. */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    // Swallows ENOENT/EACCES: both mean there is no directory to open.
    return false
  }
}

/** Run one bounded host command and return its stdout, or null on any failure. */
function runBounded(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      out += chunk
      if (out.length > 100_000) {
        child.kill()
        finish(null)
      }
    })
    child.on('error', () => { finish(null) })
    child.on('exit', (code) => { finish(code === 0 ? out : null) })
  })
}

/**
 * Ask the composition's subprocess capability where a PATH name lives.
 * @param ctx - plugin context.
 * @param command - bare command name.
 * @returns the absolute path, or null when it is not on PATH.
 */
async function pathOf(ctx, command) {
  const subprocess = Reflect.get(ctx, 'subprocess')
  if (typeof subprocess?.resolveExecutable !== 'function') return null
  try {
    const found = await subprocess.resolveExecutable(command)
    return typeof found === 'string' && found !== '' ? found : null
  } catch {
    // Swallows a missing PATH name.
    return null
  }
}

/** Whether this host runs under SSH, where a launched window would be remote. */
function underSsh() {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY)
}

/** Whether a Linux host has a display server for GUI applications. */
function hasDisplay() {
  const display = process.env.DISPLAY
  const wayland = process.env.WAYLAND_DISPLAY
  return Boolean((typeof display === 'string' && display !== '') || (typeof wayland === 'string' && wayland !== ''))
}

/**
 * Candidate standard install locations for one editor on Windows.
 * @param app - Windows app facts.
 * @returns absolute executable paths, most specific first.
 */
function windowsCandidates(app) {
  const roots = [
    process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ]
  return roots.filter((root) => typeof root === 'string').map((root) => join(root, app.directory, app.exe))
}

/**
 * Read the `App Paths` registration the installer writes, which is how a
 * non-standard install directory (another drive, a portable layout) is found.
 * @param app - Windows app facts.
 * @returns the registered executable when it still exists on disk.
 */
async function windowsAppPaths(app) {
  const keys = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${app.exe}`,
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${app.exe}`,
  ]
  for (const key of keys) {
    const dump = await runBounded('reg.exe', ['query', key, '/ve'], PROBE_TIMEOUT_MS)
    if (dump === null) continue
    for (const line of dump.split(/\r?\n/)) {
      // The default value's name is localized ("(Default)", "(默认)"), so the
      // type token is what identifies the row.
      const match = /^\s+(?:\([^)]*\)|@)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line)
      if (match === null) continue
      const value = match[1].replace(/^"|"$/g, '').trim()
      if (await isFile(value)) return value
    }
  }
  return null
}

/** Resolve one editor on Windows. */
async function resolveWindows(ctx, id) {
  const app = WINDOWS_APPS[id]
  if (app === undefined) return null
  for (const candidate of windowsCandidates(app)) {
    if (await isFile(candidate)) return { command: candidate, prefix: [] }
  }
  const registered = await windowsAppPaths(app)
  if (registered !== null) return { command: registered, prefix: [] }
  // A CLI install puts `<install>\bin\code.cmd` beside the executable.
  const cli = await pathOf(ctx, app.cli)
  if (cli !== null) {
    const sibling = join(cli, '..', '..', app.exe)
    if (await isFile(sibling)) return { command: sibling, prefix: [] }
  }
  return null
}

/** Resolve one editor on macOS. */
async function resolveMac(ctx, id) {
  const app = MAC_APPS[id]
  if (app === undefined) return null
  const open = await isFile('/usr/bin/open') ? '/usr/bin/open' : await pathOf(ctx, 'open')
  const roots = ['/Applications', join(homedir(), 'Applications')]
  for (const root of roots) {
    const candidate = join(root, app.bundle)
    if (open !== null && await isDirectory(candidate)) {
      return { command: open, prefix: ['-a', candidate] }
    }
  }
  const cli = await pathOf(ctx, app.cli)
  return cli === null ? null : { command: cli, prefix: [] }
}

/** Resolve one editor on Linux. */
async function resolveLinux(ctx, id) {
  const app = LINUX_APPS[id]
  if (app === undefined) return null
  const cli = await pathOf(ctx, app.cli)
  if (cli !== null) return { command: cli, prefix: [] }
  for (const candidate of app.files) {
    if (await isFile(candidate)) return { command: candidate, prefix: [] }
  }
  return null
}

/** Resolve the platform's file manager. */
async function resolveFileManager(ctx) {
  const platform = osPlatform()
  if (platform === 'win32') {
    const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
    const executable = join(root, 'explorer.exe')
    // `explorer.exe <dir>` hands the folder over and often reports a nonzero
    // exit, so its status never decides the outcome.
    return await isFile(executable) ? { command: executable, prefix: [], ignoreExitCode: true } : null
  }
  if (platform === 'darwin') {
    const open = await isFile('/usr/bin/open') ? '/usr/bin/open' : await pathOf(ctx, 'open')
    return open === null ? null : { command: open, prefix: [] }
  }
  if (platform === 'linux') {
    if (!hasDisplay()) return null
    const xdg = await pathOf(ctx, 'xdg-open') ?? (await isFile('/usr/bin/xdg-open') ? '/usr/bin/xdg-open' : null)
    return xdg === null ? null : { command: xdg, prefix: [] }
  }
  return null
}

/**
 * Resolve one application on this host.
 * @param ctx - plugin context.
 * @param id - application id.
 * @returns the launcher, or null when it is not installed here.
 */
async function resolveLauncher(ctx, id) {
  if (underSsh()) return null
  if (id === 'filemanager') return resolveFileManager(ctx)
  const platform = osPlatform()
  if (platform === 'win32') return resolveWindows(ctx, id)
  if (platform === 'darwin') return resolveMac(ctx, id)
  if (platform === 'linux') return resolveLinux(ctx, id)
  return null
}

/**
 * Every application installed on this host, cached for the process life.
 * @param ctx - plugin context.
 * @returns application ids in menu order.
 */
async function installedApps(ctx) {
  const found = []
  for (const id of APP_IDS) {
    if (!launchers.has(id)) launchers.set(id, await resolveLauncher(ctx, id))
    if (launchers.get(id) !== null && launchers.get(id) !== undefined) found.push(id)
  }
  return found
}

/**
 * The environment a launched application starts from: the host's own, minus
 * credential-shaped names (the harness must not leak its keys into a stranger's
 * process), minus `DSH_*`, and minus the Electron flags that would make an
 * Electron target run as Node instead of opening its window.
 * @returns a fresh environment object.
 */
function launchEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/KEY|PASSWORD|SECRET|TOKEN/i.test(key)) continue
    if (key.toUpperCase().startsWith('DSH_')) continue
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_NO_ATTACH_CONSOLE') continue
    env[key] = value
  }
  return env
}

/**
 * Launch one application on a directory, detached from this host: the child
 * holds no stdio pipe and outlives it. Success is decoupled from process exit,
 * because a launcher may stay in the foreground for its window's lifetime.
 * @param launcher - resolved command and argv prefix.
 * @param directory - absolute workspace directory.
 * @returns 'launched' when the window opened, 'failed' on an early failure.
 */
function launch(launcher, directory) {
  return new Promise((resolve) => {
    let settled = false
    let watch
    let child
    const settle = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(watch)
      child.unref()
      resolve(outcome)
    }
    try {
      child = spawn(launcher.command, [...launcher.prefix, directory], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        env: launchEnvironment(),
      })
    } catch {
      resolve('failed')
      return
    }
    watch = setTimeout(() => { settle('launched') }, WATCH_MS)
    child.on('error', () => { settle('failed') })
    child.on('exit', (code) => {
      settle(code === 0 || launcher.ignoreExitCode === true ? 'launched' : 'failed')
    })
  })
}

/** Read the request body under the size cap; null when it exceeds it. */
function readBoundedBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    req.on('end', () => { resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8')) })
    req.on('error', () => { resolve(null) })
  })
}

/** Answer one launch request. */
async function handleOpen(ctx, req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('allow', 'POST')
    res.end()
    return
  }
  const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
  if (essence !== 'application/json') {
    sendJson(res, 415, { code: 'unsupported-media-type', message: 'content-type must be application/json' })
    return
  }
  const text = await readBoundedBody(req)
  if (text === null) {
    sendJson(res, 413, { code: 'payload-too-large', message: 'request body is too large' })
    return
  }
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  if (body === null || typeof body !== 'object'
    || typeof body.app !== 'string' || typeof body.path !== 'string') {
    sendJson(res, 400, { code: 'bad-request', message: 'request body must be JSON with string "app" and "path"' })
    return
  }
  if (!APP_IDS.includes(body.app)) {
    sendJson(res, 400, { code: 'bad-request', message: `unknown app: ${body.app}` })
    return
  }
  if (body.path === '' || !isAbsolute(body.path)) {
    sendJson(res, 400, { code: 'bad-request', message: 'path must be an absolute directory path' })
    return
  }
  if (!await isDirectory(body.path)) {
    sendJson(res, 404, { code: 'not-found', message: `directory does not exist: ${body.path}` })
    return
  }
  // Resolve on demand so an installation performed after this host started is
  // picked up; a remembered launcher that has since disappeared is re-resolved.
  let launcher = launchers.get(body.app)
  if (launcher === null || launcher === undefined || !await isFile(launcher.command)) {
    launcher = await resolveLauncher(ctx, body.app)
    launchers.set(body.app, launcher)
  }
  if (launcher === null) {
    sendJson(res, 404, { code: 'not-found', message: `${body.app} is not installed for this host` })
    return
  }
  const outcome = await launch(launcher, body.path)
  if (outcome === 'launched') sendJson(res, 200, { ok: true })
  else sendJson(res, 502, { code: 'launch-failed', message: `failed to launch ${launcher.command}` })
}

/**
 * Register the two routes the browser half uses.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: APPS_PATH,
    handler: (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('allow', 'GET')
        res.end()
        return
      }
      installedApps(ctx).then(
        (apps) => { sendJson(res, 200, { apps }) },
        () => { sendJson(res, 500, { code: 'resolution-failed', message: 'could not resolve installed applications' }) },
      )
    },
  }), `quick-actions: GET ${APPS_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_PATH,
    handler: (req, res) => {
      if (rejected(ctx, req, res)) return
      handleOpen(ctx, req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { code: 'internal', message: 'launch request failed' })
        else res.end()
      })
    },
  }), `quick-actions: POST ${OPEN_PATH}`)
}
