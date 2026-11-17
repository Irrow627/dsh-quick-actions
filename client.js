/**
 * Browser half of the `快捷操作` (quick actions) bundle.
 *
 * Three 28px icon-only controls at the right end of the conversation header's
 * utility row — immediately before the per-session "…" menu and the far-right
 * corner seat that holds the right sidebar's own "打开侧边栏" / "Open sidebar"
 * button:
 *
 *   [打开文件夹] [打开终端] [用 VS Code 打开]
 *
 * The header "…" menu ("更多操作" / "More actions") gains one row,
 * **快捷操作设置 / Quick action settings**, placed just above the shipped feedback
 * row, which opens a centred settings dialog listing every action with a drag
 * handle for its position and a switch for its visibility. Both the order and
 * the switches are stored in this page's `localStorage`, so they survive
 * reloads and restarts.
 *
 * - Folder and VS Code open the Session's workspace folder through this
 *   bundle's host routes (see `index.js`), which launch with the host's
 *   Electron flags removed.
 * - Terminal is pure sidebar orchestration: with a terminal tab already open it
 *   expands the column and brings that tab forward; otherwise it opens a
 *   terminal tab exactly as the sidebar's own "new terminal" card does, which
 *   is also what creates the shell.
 *
 * Copy: the VS Code action reuses the shipped `open-in-app` dictionary; the
 * remaining labels live in this bundle's own namespace and are translated in
 * every locale the host ships.
 */

window.__ModuleLoader__.load({
  id: 'dsh-quick-actions',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const { useCallback, useEffect, useRef, useState } = React;
    const h = React.createElement;

    /** Shipped dictionary consulted for the VS Code action. */
    const NS = 'open-in-app';
    /** This bundle's own dictionary. */
    const OWN_NS = 'quick-actions';
    /** Routes served by this bundle's host half (document-relative). */
    const APPS_ROUTE = 'quick-actions/apps';
    const OPEN_ROUTE = 'quick-actions/open';
    /** Where the header order and switches live. */
    const STORAGE_KEY = 'dsh.quick-actions.preferences';
    /** The actions this plugin offers, in default order. */
    const ACTION_IDS = ['folder', 'terminal', 'vscode'];

    const zh = {
      'folder.open': '打开文件夹',
      'terminal.open': '打开终端',
      'settings.title': '快捷操作设置',
      'settings.hint': '拖动交换位置，拖到上下边缘可插入',
      'settings.handle': '拖动排序',
      'settings.close': '关闭',
    };
    const en = {
      'folder.open': 'Open folder',
      'terminal.open': 'Open terminal',
      'settings.title': 'Quick action settings',
      'settings.hint': 'Drag to swap positions; drop on a row edge to insert',
      'settings.handle': 'Drag to reorder',
      'settings.close': 'Close',
    };
    const ja = {
      'folder.open': 'フォルダーを開く',
      'terminal.open': 'ターミナルを開く',
      'settings.title': 'クイック操作の設定',
      'settings.hint': 'ドラッグで入れ替え、上下の端にドロップで挿入',
      'settings.handle': 'ドラッグして並べ替え',
      'settings.close': '閉じる',
    };
    const es = {
      'folder.open': 'Abrir carpeta',
      'terminal.open': 'Abrir terminal',
      'settings.title': 'Ajustes de acciones rápidas',
      'settings.hint': 'Arrastra para intercambiar; suelta en el borde para insertar',
      'settings.handle': 'Arrastrar para ordenar',
      'settings.close': 'Cerrar',
    };
    const fr = {
      'folder.open': 'Ouvrir le dossier',
      'terminal.open': 'Ouvrir le terminal',
      'settings.title': 'Réglages des actions rapides',
      'settings.hint': 'Glissez pour échanger ; déposez sur le bord pour insérer',
      'settings.handle': 'Glisser pour réordonner',
      'settings.close': 'Fermer',
    };
    const de = {
      'folder.open': 'Ordner öffnen',
      'terminal.open': 'Terminal öffnen',
      'settings.title': 'Schnellaktionen-Einstellungen',
      'settings.hint': 'Ziehen tauscht Positionen, Ablegen am Rand fügt ein',
      'settings.handle': 'Zum Sortieren ziehen',
      'settings.close': 'Schließen',
    };
    const ru = {
      'folder.open': 'Открыть папку',
      'terminal.open': 'Открыть терминал',
      'settings.title': 'Настройки быстрых действий',
      'settings.hint': 'Перетащите, чтобы поменять местами; на краю — чтобы вставить',
      'settings.handle': 'Перетащите для сортировки',
      'settings.close': 'Закрыть',
    };
    const pt = {
      'folder.open': 'Abrir pasta',
      'terminal.open': 'Abrir terminal',
      'settings.title': 'Configurações de ações rápidas',
      'settings.hint': 'Arraste para trocar; solte na borda para inserir',
      'settings.handle': 'Arrastar para reordenar',
      'settings.close': 'Fechar',
    };

    /** Component-local styles; rendered as an element so unmounting removes them. */
    const CSS = `
.dsh-quick-actions {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
}
/* The same 28px round target as the header's other icon buttons. */
.dsh-quick-actions__button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  cursor: pointer;
}
.dsh-quick-actions__button svg {
  flex: none;
  width: 16px;
  height: 16px;
}
@media (hover: hover) {
  .dsh-quick-actions__button:hover:not([aria-disabled='true']) {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
    color: var(--dsw-alias-label-secondary);
  }
}
.dsh-quick-actions__button:focus-visible {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-secondary);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
}
.dsh-quick-actions__button[aria-disabled='true'] {
  cursor: progress;
  opacity: 0.55;
}
.dsh-quick-actions__button[data-phase='failed'] {
  color: var(--dsw-alias-state-error-primary);
  opacity: 1;
}
.dsh-quick-actions__status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}


/* The settings dialog: a centred card over a scrim. The frame overlay is
   click-through, so both layers opt back into pointer events. */
.dsh-quick-actions__backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  pointer-events: auto;
  background: color-mix(in srgb, black 35%, transparent);
}
.dsh-quick-actions__panel {
  box-sizing: border-box;
  width: min(420px, 100%);
  max-height: min(560px, calc(100vh - 48px));
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-prominent, 0 18px 48px color-mix(in srgb, black 30%, transparent));
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  pointer-events: auto;
}
.dsh-quick-actions__panel:focus-visible {
  outline: none;
}
.dsh-quick-actions__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 0 8px;
}
.dsh-quick-actions__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
}
.dsh-quick-actions__close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
@media (hover: hover) {
  .dsh-quick-actions__close:hover {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
    color: var(--dsw-alias-label-primary);
  }
}
.dsh-quick-actions__close:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
}
.dsh-quick-actions__hint {
  margin: 0 0 6px;
  padding: 0 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}
.dsh-quick-actions__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-quick-actions__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
}
@media (hover: hover) {
  .dsh-quick-actions__row:hover {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  }
}
/* Drop zones: the middle swaps the two rows, the upper and lower bands insert. */
.dsh-quick-actions__row[data-drop='swap'] {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary);
}
.dsh-quick-actions__row[data-drop='before'] {
  box-shadow: inset 0 2px 0 0 var(--dsw-alias-brand-primary);
}
.dsh-quick-actions__row[data-drop='after'] {
  box-shadow: inset 0 -2px 0 0 var(--dsw-alias-brand-primary);
}
.dsh-quick-actions__row[data-drag] {
  opacity: 0.6;
}
.dsh-quick-actions__handle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: grab;
  touch-action: none;
}
.dsh-quick-actions__handle:active {
  cursor: grabbing;
}
@media (hover: hover) {
  .dsh-quick-actions__handle:hover {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
    color: var(--dsw-alias-label-primary);
  }
}
.dsh-quick-actions__handle:focus-visible {
  outline: none;
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
}
.dsh-quick-actions__glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-quick-actions__glyph svg {
  width: 16px;
  height: 16px;
}
.dsh-quick-actions__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-quick-actions__row[data-off] .dsh-quick-actions__glyph,
.dsh-quick-actions__row[data-off] .dsh-quick-actions__name {
  opacity: 0.5;
}
.dsh-quick-actions__switch {
  position: relative;
  flex: none;
  width: 32px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: var(--dsw-alias-border-l2);
  cursor: pointer;
  transition: background 120ms ease;
}
.dsh-quick-actions__switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base);
  transition: transform 120ms ease;
}
.dsh-quick-actions__switch[aria-checked='true'] {
  background: var(--dsw-alias-brand-primary);
}
.dsh-quick-actions__switch[aria-checked='true']::after {
  transform: translateX(14px);
}
.dsh-quick-actions__switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
}
`;

    /* ---------------------------------------------------------------- model */

    /**
     * Cross-instance state. A Client plugin can be re-applied inside one page
     * (bundle reload, plugin toggle, `dsh.client` graph change) while already
     * mounted components keep rendering from the previous evaluation. Module
     * scope would then split into two copies — the mounted component would
     * subscribe to one and the menu row's handler would write the other, so a
     * click would update nothing on screen. Keeping the store on `window` keeps
     * every evaluation of this module in one conversation.
     */
    const shared = window.__dshQuickActions ?? (window.__dshQuickActions = {
      catalog: undefined,
      catalogValue: undefined,
      preferences: undefined,
      preferenceListeners: new Set(),
      settingsOpen: false,
      settingsListeners: new Set(),
    });
    const catalogValue = () => shared.catalogValue;

    /**
     * Read this bundle's host catalog once per page: which launchers are
     * installed. A failed read yields no launchers, which renders no controls
     * rather than controls that cannot work.
     * @returns the catalog ids the host can launch.
     */
    function loadCatalog() {
      shared.catalog ??= fetch(APPS_ROUTE, { headers: { accept: 'application/json' } })
        .then((response) => {
          if (!response.ok) {
            console.warn(`quick-actions: application catalog answered HTTP ${response.status}`);
            return { apps: [] };
          }
          return response.json();
        })
        .then((payload) => {
          const list = Array.isArray(payload && payload.apps)
            ? payload.apps.filter((id) => typeof id === 'string')
            : [];
          shared.catalogValue = list;
          return list;
        })
        .catch((error) => {
          console.warn('quick-actions: could not read the application catalog', error);
          return [];
        });
      return shared.catalog;
    }

    /**
     * Coerce stored preferences into the complete shape this plugin expects:
     * every known action exactly once, in the stored order, enabled by default.
     * @param value - parsed storage value, possibly stale or partial.
     * @returns `{ order, enabled }`.
     */
    function normalizePreferences(value) {
      const stored = value !== null && typeof value === 'object' ? value : {};
      const source = Array.isArray(stored.order) ? stored.order : [];
      const order = [];
      for (const id of source) {
        if (ACTION_IDS.includes(id) && !order.includes(id)) order.push(id);
      }
      for (const id of ACTION_IDS) {
        if (!order.includes(id)) order.push(id);
      }
      const enabled = {};
      for (const id of ACTION_IDS) {
        enabled[id] = !(stored.enabled !== null && typeof stored.enabled === 'object' && stored.enabled[id] === false);
      }
      return { order, enabled };
    }

    if (shared.preferences === undefined) {
      shared.preferences = (() => {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          return normalizePreferences(raw === null ? undefined : JSON.parse(raw));
        } catch {
          return normalizePreferences(undefined);
        }
      })();
    }

    /** Subscribe to preference changes; returns the unsubscribe. */
    function subscribePreferences(listener) {
      shared.preferenceListeners.add(listener);
      return () => { shared.preferenceListeners.delete(listener); };
    }

    /**
     * Replace the preferences, persist them, and notify every mounted reader.
     * @param next - complete `{ order, enabled }` value.
     */
    function setPreferences(next) {
      shared.preferences = normalizePreferences(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shared.preferences));
      } catch {
        // A full or blocked storage keeps the in-memory value for this page.
      }
      for (const listener of [...shared.preferenceListeners]) listener();
    }

    /** Read the current preferences and re-render on every change. */
    function usePreferences() {
      const [value, setValue] = useState(shared.preferences);
      useEffect(() => subscribePreferences(() => { setValue(shared.preferences); }), []);
      return value;
    }

    /** Open the settings dialog. */
    function openSettings() {
      if (shared.settingsOpen) return;
      shared.settingsOpen = true;
      for (const listener of [...shared.settingsListeners]) listener();
    }

    /** Close the settings dialog. */
    function closeSettings() {
      if (!shared.settingsOpen) return;
      shared.settingsOpen = false;
      for (const listener of [...shared.settingsListeners]) listener();
    }

    /** Read the dialog state and re-render on change. */
    function useSettingsOpen() {
      const [value, setValue] = useState(shared.settingsOpen);
      useEffect(() => {
        const listener = () => { setValue(shared.settingsOpen); };
        shared.settingsListeners.add(listener);
        return () => { shared.settingsListeners.delete(listener); };
      }, []);
      return value;
    }

    /**
     * One launch request against the host router.
     * @param body - `{ app, path }` naming an application and a directory.
     * @returns a promise settled when the host started the launcher.
     */
    function openRequest(body) {
      return fetch(OPEN_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => {
        if (!response.ok) throw new Error(`quick-actions refused the launch: HTTP ${response.status}`);
      });
    }

    /**
     * Shared launch state for one button.
     * @param app - catalog id this button launches, or null while unknown.
     * @param folder - current workspace folder, or undefined.
     * @returns idle/busy/failed phase, the run callback, and a failure reset.
     */
    function useLaunch(app, folder) {
      const [phase, setPhase] = useState('idle');
      const run = useCallback(() => {
        if (phase === 'busy' || typeof app !== 'string' || !folder) return;
        setPhase('busy');
        openRequest({ app, path: folder })
          .then(() => { setPhase('idle') })
          .catch((error) => {
            console.warn('quick-actions: launch failed', error);
            setPhase('failed');
          });
      }, [app, folder, phase]);
      const reset = useCallback(() => {
        setPhase((current) => (current === 'failed' ? 'idle' : current));
      }, []);
      return { phase, run, reset };
    }

    /* --------------------------------------------------------------- glyphs */

    /** The Visual Studio Code mark (Simple Icons, CC0 1.0), as one currentColor path. */
    const VSCODE_MARK = 'M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z';

    const svg = (attrs, children) => h('svg', {
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: 'false',
      ...attrs,
    }, children);

    /** A folder outline. */
    function FolderGlyph() {
      return svg(null, h('path', {
        d: 'M1.9 12.1V4.5a1.1 1.1 0 0 1 1.1-1.1h2.6l1.5 1.8h5a1.1 1.1 0 0 1 1.1 1.1v5.8a1.1 1.1 0 0 1-1.1 1.1H3a1.1 1.1 0 0 1-1.1-1.1z',
      }));
    }

    /** A terminal window: a rounded frame, a prompt chevron, and a caret line. */
    function TerminalGlyph() {
      return svg(null, [
        h('rect', { key: 'frame', x: 1.7, y: 2.9, width: 12.6, height: 10.2, rx: 1.8 }),
        h('path', { key: 'prompt', d: 'M4.6 6.3 6.7 8l-2.1 1.7' }),
        h('path', { key: 'caret', d: 'M8.7 9.7h3' }),
      ]);
    }

    /** The VS Code mark as a monochrome glyph. */
    function VSCodeGlyph() {
      return h('svg', {
        viewBox: '0 0 24 24',
        fill: 'currentColor',
        'aria-hidden': true,
        focusable: 'false',
      }, h('path', { d: VSCODE_MARK }));
    }

    /** A six-dot drag handle. */
    function DragGlyph() {
      const dots = [[6, 4.2], [10, 4.2], [6, 8], [10, 8], [6, 11.8], [10, 11.8]];
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'currentColor',
        'aria-hidden': true,
        focusable: 'false',
      }, dots.map(([cx, cy], index) => h('circle', { key: index, cx, cy, r: 1.2 })));
    }

    /** Two sliders, for the settings menu row. */
    function SettingsGlyph() {
      return svg(null, [
        h('path', { key: 'top', d: 'M2.6 5h10.8' }),
        h('circle', { key: 'top-knob', cx: 6, cy: 5, r: 2, fill: 'currentColor', stroke: 'none' }),
        h('path', { key: 'bottom', d: 'M2.6 11h10.8' }),
        h('circle', { key: 'bottom-knob', cx: 10.4, cy: 11, r: 2, fill: 'currentColor', stroke: 'none' }),
      ]);
    }

    /** A close cross. */
    function CloseGlyph() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        'aria-hidden': true,
        focusable: 'false',
      }, [
        h('path', { key: 'a', d: 'M4.5 4.5l7 7' }),
        h('path', { key: 'b', d: 'M11.5 4.5l-7 7' }),
      ]);
    }

    /* ------------------------------------------------------------ component */

    /**
     * One rounded header button.
     * @param props - the action id, tooltip/accessible name, phase, handlers, glyph.
     * @returns the button.
     */
    function HeaderButton({ name, title, phase, onRun, onReset, glyph }) {
      return h('button', {
        type: 'button',
        className: 'dsh-quick-actions__button',
        title,
        'aria-label': title,
        'aria-disabled': phase === 'busy' ? 'true' : undefined,
        'data-quick-action': name,
        'data-phase': phase,
        onClick: onRun,
        onPointerEnter: onReset,
        onFocus: onReset,
      }, glyph);
    }

    /**
     * The header cluster: every enabled, currently available action in the
     * user's order.
     * @param props - Session seats, dictionaries, launch catalog and terminal action.
     * @returns the control cluster, or nothing when no action is available.
     */
    function QuickActions(props) {
      const { sessionId, useSessions, t, tOwn, openTerminal, hasTerminal } = props;
      const folder = useSessions((state) => (sessionId === undefined ? undefined : state.byId[sessionId]?.cwd));
      const [apps, setApps] = useState(() => catalogValue());
      const prefs = usePreferences();
      const dialogOpen = useSettingsOpen();

      useEffect(() => {
        if (apps !== undefined) return undefined;
        let live = true;
        loadCatalog().then((value) => { if (live) setApps(value); });
        return () => { live = false; };
      }, [apps]);

      const vscodeApp = !folder || !Array.isArray(apps)
        ? null
        : apps.includes('vscode') ? 'vscode' : apps.includes('vscodeinsiders') ? 'vscodeinsiders' : null;
      // `filemanager` is the host's platform-neutral id: Explorer on Windows,
      // Finder on macOS, xdg-open on Linux.
      const folderApp = !folder || !Array.isArray(apps) || !apps.includes('filemanager') ? null : 'filemanager';
      const vscode = useLaunch(vscodeApp, folder);
      const fileManager = useLaunch(folderApp, folder);
      // The dialog is portalled to the document body from this always-mounted
      // header seat: that escapes the header's size container and keeps the
      // dialog available even when every action is switched off.
      const dialog = dialogOpen ? createPortal(h(SettingsDialog, { t, tOwn }), document.body) : null;

      // Nothing to show until the host answered which launchers exist.
      if (!Array.isArray(apps)) return dialog;

      const failure = t('path.openError');
      const vscodeName = vscodeApp === 'vscodeinsiders' ? t('app.vscodeinsiders') : t('app.vscode');
      const available = {
        folder: folderApp === null ? null : {
          title: fileManager.phase === 'failed' ? failure : `${tOwn('folder.open')} — ${folder}`,
          phase: fileManager.phase,
          onRun: fileManager.run,
          onReset: fileManager.reset,
          glyph: h(FolderGlyph, null),
        },
        terminal: hasTerminal() ? {
          title: tOwn('terminal.open'),
          phase: 'idle',
          onRun: () => { openTerminal(sessionId); },
          onReset: undefined,
          glyph: h(TerminalGlyph, null),
        } : null,
        vscode: vscodeApp === null ? null : {
          title: vscode.phase === 'failed' ? failure : `${t('open.title', { app: vscodeName })} — ${folder}`,
          phase: vscode.phase,
          onRun: vscode.run,
          onReset: vscode.reset,
          glyph: h(VSCodeGlyph, null),
        },
      };

      const buttons = prefs.order
        .filter((id) => prefs.enabled[id] !== false && available[id] !== null)
        .map((id) => h(HeaderButton, { key: id, name: id, ...available[id] }));
      if (buttons.length === 0) return dialog;

      const status = vscode.phase === 'busy' ? t('shortcut.busy')
        : vscode.phase === 'failed' || fileManager.phase === 'failed' ? failure
          : '';

      const cluster = h(
        'div',
        { className: 'dsh-quick-actions' },
        h('style', null, CSS),
        buttons,
        h('span', { className: 'dsh-quick-actions__status', role: 'status' }, status),
      );
      return h(React.Fragment, null, cluster, dialog);
    }

    /**
     * Settings dialog: every action once, with a drag handle for its position
     * and a switch for its visibility. Mounted by the header cluster through a
     * portal, so it is open whenever it is rendered.
     * @param props - localized copy for both dictionaries.
     * @returns the dialog.
     */
    function SettingsDialog(props) {
      const { t, tOwn } = props;
      const prefs = usePreferences();
      const panel = useRef(null);
      const dragFromHandle = useRef(false);
      const [dragId, setDragId] = useState(undefined);
      // The row under the pointer and which zone it is over: the middle swaps
      // the two rows, the edges insert before or after that row.
      const [drop, setDrop] = useState(undefined);

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          closeSettings();
        };
        document.addEventListener('keydown', onKeyDown);
        const frame = requestAnimationFrame(() => { panel.current?.focus(); });
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          cancelAnimationFrame(frame);
        };
      }, []);

      const names = {
        folder: tOwn('folder.open'),
        terminal: tOwn('terminal.open'),
        vscode: t('open.title', { app: t('app.vscode') }),
      };
      const glyphs = {
        folder: h(FolderGlyph, null),
        terminal: h(TerminalGlyph, null),
        vscode: h(VSCodeGlyph, null),
      };

      /** Exchange the positions of two actions (a drop on a row's middle). */
      const swap = (from, to) => {
        const order = [...prefs.order];
        const fromIndex = order.indexOf(from);
        const toIndex = order.indexOf(to);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        order[fromIndex] = to;
        order[toIndex] = from;
        setPreferences({ ...prefs, order });
      };
      /** Move one action next to another (a drop on a row's upper/lower edge). */
      const insertAt = (from, to, before) => {
        const order = prefs.order.filter((id) => id !== from);
        const at = order.indexOf(to);
        if (at < 0) return;
        order.splice(before ? at : at + 1, 0, from);
        setPreferences({ ...prefs, order });
      };
      /** Keyboard reordering: one step up or down. */
      const nudge = (id, delta) => {
        const from = prefs.order.indexOf(id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= prefs.order.length) return;
        const order = [...prefs.order];
        order.splice(from, 1);
        order.splice(to, 0, id);
        setPreferences({ ...prefs, order });
      };
      const toggle = (id) => {
        setPreferences({ ...prefs, enabled: { ...prefs.enabled, [id]: prefs.enabled[id] === false } });
      };

      const rows = prefs.order.map((id) => {
        const enabled = prefs.enabled[id] !== false;
        return h('li', {
          key: id,
          className: 'dsh-quick-actions__row',
          draggable: true,
          'data-drag': dragId === id ? '' : undefined,
          'data-drop': drop !== undefined && drop.id === id && dragId !== id ? drop.zone : undefined,
          'data-off': enabled ? undefined : '',
          onPointerDown: (event) => {
            // Only a gesture that starts on the handle may start a drag.
            dragFromHandle.current = typeof event.target?.closest === 'function'
              && event.target.closest('[data-quick-action-handle]') !== null;
          },
          onDragStart: (event) => {
            if (!dragFromHandle.current || !event.dataTransfer) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', id);
            setDragId(id);
          },
          onDragEnd: () => {
            dragFromHandle.current = false;
            setDragId(undefined);
            setDrop(undefined);
          },
          onDragOver: (event) => {
            if (dragId === undefined) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            // The middle of a row swaps the two rows; its upper and lower
            // bands insert before or after it instead.
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = rect.height === 0 ? 0.5 : (event.clientY - rect.top) / rect.height;
            const zone = ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'swap';
            if (drop === undefined || drop.id !== id || drop.zone !== zone) setDrop({ id, zone });
          },
          onDragLeave: (event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            if (drop !== undefined && drop.id === id) setDrop(undefined);
          },
          onDrop: (event) => {
            event.preventDefault();
            const from = dragId ?? event.dataTransfer?.getData('text/plain');
            const zone = drop !== undefined && drop.id === id ? drop.zone : 'swap';
            if (typeof from === 'string' && from !== '' && from !== id) {
              if (zone === 'swap') swap(from, id);
              else insertAt(from, id, zone === 'before');
            }
            dragFromHandle.current = false;
            setDragId(undefined);
            setDrop(undefined);
          },
        }, [
          h('button', {
            key: 'handle',
            type: 'button',
            className: 'dsh-quick-actions__handle',
            'data-quick-action-handle': id,
            title: tOwn('settings.handle'),
            'aria-label': `${tOwn('settings.handle')}: ${names[id]}`,
            onKeyDown: (event) => {
              if (!event.altKey) return;
              if (event.key === 'ArrowUp') { event.preventDefault(); nudge(id, -1); }
              else if (event.key === 'ArrowDown') { event.preventDefault(); nudge(id, 1); }
            },
          }, h(DragGlyph, null)),
          h('span', { key: 'glyph', className: 'dsh-quick-actions__glyph' }, glyphs[id]),
          h('span', { key: 'name', className: 'dsh-quick-actions__name' }, names[id]),
          h('button', {
            key: 'switch',
            type: 'button',
            role: 'switch',
            className: 'dsh-quick-actions__switch',
            'aria-checked': enabled,
            'aria-label': names[id],
            'data-quick-action-switch': id,
            onClick: () => { toggle(id); },
          }),
        ]);
      });

      return h('div', {
        key: 'backdrop',
        className: 'dsh-quick-actions__backdrop',
        onPointerDown: (event) => {
          if (event.target === event.currentTarget) closeSettings();
        },
      }, [
        h('style', { key: 'style' }, CSS),
        h('div', {
          key: 'panel',
          className: 'dsh-quick-actions__panel',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': tOwn('settings.title'),
          tabIndex: -1,
          ref: panel,
        }, [
          h('div', { key: 'header', className: 'dsh-quick-actions__header' }, [
            h('span', { key: 'title', className: 'dsh-quick-actions__title' }, tOwn('settings.title')),
            h('button', {
              key: 'close',
              type: 'button',
              className: 'dsh-quick-actions__close',
              'aria-label': tOwn('settings.close'),
              title: tOwn('settings.close'),
              onClick: closeSettings,
            }, h(CloseGlyph, null)),
          ]),
          h('p', { key: 'hint', className: 'dsh-quick-actions__hint' }, tOwn('settings.hint')),
          h('ul', { key: 'list', className: 'dsh-quick-actions__list' }, rows),
        ]),
      ]);
    }

    return {
      inject: ['slots', 'locale', 'contextMenus', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(OWN_NS, { zh, en, ja, es, fr, de, ru, pt }), 'quick-actions: copy');

        /**
         * Open a terminal for one Session, or bring the open one forward.
         * Mirrors the sidebar's own terminal card: the card replaces the guide
         * tab and opening a terminal tab is what starts the shell (the tab body
         * creates the process), so an existing terminal tab means "reveal".
         * @param sessionId - Session whose terminal should be shown.
         */
        const openTerminal = (sessionId) => {
          const right = ctx.sidebarRight;
          try {
            const tabs = right.tabsIn(sessionId);
            const terminals = tabs.filter((tab) => tab.kind === 'terminal');
            if (terminals.length > 0) {
              const active = right.active();
              const shown = active === undefined
                ? undefined
                : terminals.find((tab) => tab.id === active.id);
              if (shown === undefined) {
                // Focus the terminal tab first so the expansion lands on it
                // instead of whichever tab the docked pane had active.
                right.focus(terminals[terminals.length - 1].id);
              }
              if (!right.isExpanded()) right.toggleExpanded();
              return;
            }
            const guide = tabs.find((tab) => tab.kind === 'guide');
            right.openTabIn(sessionId, 'terminal', guide === undefined ? {} : { replaceTab: guide.id });
            // The replaced guide closes once it has led somewhere, as it does
            // for the sidebar's own card.
            if (guide !== undefined) right.closeIn(sessionId, guide.id);
          } catch (error) {
            console.warn('quick-actions: opening the terminal failed', error);
          }
        };

        // Two seats, one cluster: the header utilities while a Session shows
        // conversation chrome, and the blank-Session hero row (which replaces
        // that whole header row until the first message). They are mutually
        // exclusive, because the hero only renders while the header chrome is
        // hidden.
        const seat = () => ({
          id: 'quick-actions',
          order: 100,
          locale: NS,
          inject: () => ({
            tOwn: ctx.locale.bind(OWN_NS),
            openTerminal,
            hasTerminal: () => {
              // A missing registry (sidebar feature absent) is "no terminal
              // button", not a crashed slot entry.
              try {
                return ctx.sidebarRightTabs.get('terminal') !== undefined;
              } catch {
                return false;
              }
            },
          }),
        });
        for (const name of ['conversation.session.header.utilities', 'conversation.hero.options']) {
          ctx.effect(() => ctx.slots.inject(name, () => ctx.slots.register({ ...seat(), name }, QuickActions)),
            `quick-actions: ${name}`);
        }

        // The settings row in the header's "更多操作" menu: order 550 sits
        // between "打开方式" (500) and the shipped feedback row (600, which
        // carries its own separator).
        ctx.effect(() => ctx.contextMenus.register({
          id: 'quick-actions.settings',
          target: 'sessionHeader',
          order: 550,
          observe: () => [ctx.locale],
          resolve: () => [{
            id: 'quickActions.settings',
            label: ctx.locale.bind(OWN_NS)('settings.title'),
            icon: { key: 'quick-actions.settings' },
            run: () => { openSettings(); },
          }],
        }), 'quick-actions: settings menu row');

        ctx.effect(() => ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({
          name: 'contextMenu.icon',
          key: 'quick-actions.settings',
        }, SettingsGlyph)), 'quick-actions: settings icon');
      },
    };
  },
});
