# Quick Actions / 快捷操作

[简体中文](README.md) · **English**

Three icon-only quick actions for the current session's workspace folder, in the conversation header (and in the new-session row while a session has no messages yet), plus a small settings dialog for their order and visibility.

```
[Open folder]  [Open terminal]  [Open in VS Code]
```

- **Open folder** — opens the workspace folder in the platform file manager (File Explorer, Finder, or `xdg-open`).
- **Open terminal** — exactly the sidebar's own terminal behaviour: a terminal tab that is already open is brought forward (expanding the right sidebar when collapsed) instead of creating another one; otherwise a terminal tab is opened, which is what starts the shell.
- **Open in VS Code** — opens the workspace folder in VS Code or VS Code Insiders.

## Where the buttons are

| State | Seat |
|---|---|
| Session with messages | right end of `conversation.session.header.utilities`, next to the header's `…` and the right sidebar's own "Open sidebar" button |
| New session, no messages yet (the header row is replaced by the hero) | right end of the hero's workspace/preset row (`conversation.hero.options`) |

Only actions the host can prove are installed get an icon; the terminal icon also requires the sidebar's `terminal` tab type to be registered.

## Settings

The header's **More actions** menu gains one row, **Quick action settings**, placed between "Open with" (order 500) and the shipped feedback row (order 600). It opens a centred dialog listing every action with:

- a **drag handle**: drop it on another row's middle to **swap** the two rows, or on that row's upper/lower edge to **insert** before/after it (`Alt+↑` / `Alt+↓` steps a focused handle one place);
- the action's icon and name;
- a **switch** that shows or hides that action.

Order and switches are stored in the page's `localStorage` under `dsh.quick-actions.preferences`; they are per browser origin, so they do not travel between machines.

## Platforms

| | Editor resolution | File manager | Notes |
|---|---|---|---|
| **Windows** | standard install paths → the installer's `App Paths` registry value → the executable beside the `code` CLI on `PATH` | `%SystemRoot%\explorer.exe` | `explorer.exe`'s exit code is ignored: it reports a nonzero status after handing the folder to the running shell |
| **macOS** | `/Applications` or `~/Applications` bundle via `open -a`, else the `code` CLI on `PATH` | `open <dir>` (Finder) | |
| **Linux** | `code` CLI on `PATH`, then known install paths (`/usr/share/code`, `/snap/bin`, …) | `xdg-open`, only with a display server | |

Under SSH the plugin offers no actions at all: the window would open on the remote host, not in front of the person who clicked.

## Install

This package is a DSH **bundle**: a plain npm package whose `package.json` declares `dsh.bundle` and `dsh.client`. It has no build step, so every install route below runs only prebuilt files.

```
# local checkout or a copied directory (pnpm links it; keep the directory)
dsh plugin --profile desktop add ./dsh-quick-actions

# packed tarball (copied into the profile)
pnpm pack && dsh plugin --profile desktop add ./dsh-quick-actions-1.0.0.tgz

# git (pin the commit; no build scripts, so no allowBuilds prompt)
dsh plugin --profile desktop add github:<owner>/dsh-quick-actions#<sha>

# registry
dsh plugin add @<scope>/dsh-quick-actions
```

In the Desktop app, **Plugins → Add plugin** installs a local directory instead of a CLI command.

Requirements:

- `engines.dsh` is `>=0.2.2-rc.3 <0.3.0`; an incompatible DSH refuses the install (and refuses to boot the profile with it).
- The composition must provide `webServer`, `connection`, and `subprocess` on the Host, and `slots`, `locale`, `contextMenus`, `sidebarRight`, `sidebarRightTabs` on the Client — all part of the standard Web/Desktop profiles.
- The copy used by the VS Code action comes from the shipped `open-in-app` dictionary; the terminal action needs the sidebar terminal feature.

## Why it launches applications itself

This Desktop build runs its Harness host as an Electron "node" child, so `ELECTRON_RUN_AS_NODE=1` sits in the host process environment and every child it spawns inherits it. An Electron application that starts with that variable runs in Node mode and exits immediately, which is why the stock `open-in-app` launcher cannot open VS Code from this host. The Host half of this bundle owns the launches it needs and clears the Electron flags first; it also scrubs credential-shaped variables and `DSH_*` before spawning, and runs the child detached with no inherited stdio.

## Routes

```
GET  /quick-actions/apps  -> { apps: ('vscode'|'vscodeinsiders'|'filemanager')[] }
POST /quick-actions/open  -> { app, path } -> { ok: true }
```

Both are fenced by the composition's `connection` service, and the POST body is validated before anything is spawned: `application/json`, a 64 KiB cap, a known app id, and an absolute directory that exists.

## Development

Plain JavaScript, no build step.

- `index.js` — Host half: platform resolution, the detached launcher, the routes.
- `client.js` — Client half: the button cluster, the settings dialog, the terminal action, and the preferences store.
- `locale/*.json` — Plugin Manager title and description.
- `icon.svg` — bundle icon.

State that must survive a page's client-plugin reload lives on `window.__dshQuickActions`, because a Client plugin can be re-applied in one page while already-mounted components keep rendering; a module-scoped store would split into two copies and a click handled by the new copy would never reach the mounted one.

## License

MIT (see [LICENSE](LICENSE)). The Visual Studio Code name and logo are Microsoft trademarks; the VS Code glyph comes from the [Simple Icons](https://simpleicons.org/) set (CC0 1.0) and is used only to name the application the button launches.
