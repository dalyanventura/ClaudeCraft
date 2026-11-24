// ClaudeCraft — processus principal Electron.
// Fenêtre superposée au jeu qui héberge des terminaux exécutant le CLI Claude Code.
// Réduite, elle devient un petit bouton flottant cliquable en jeu.
const { app, BrowserWindow, globalShortcut, ipcMain, dialog, clipboard, screen, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('@lydell/node-pty');
const config = require('./config');
const { resolveClaude, writeHookSettings, removeHookSettings } = require('./claude');
const { listSessions } = require('./sessions');
const { startHookServer } = require('./hookServer');

app.setName('ClaudeCraft');
app.setPath('userData', path.join(app.getPath('appData'), 'ClaudeCraft'));

// Migration : reprend les réglages de l'ancien nom de l'application ("Claude Companion").
(function migrateSettings() {
  const dst = path.join(app.getPath('userData'), 'config.json');
  const src = path.join(app.getPath('appData'), 'Claude Companion', 'config.json');
  try {
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  } catch { /* pas de migration possible : réglages par défaut */ }
})();

// Journal des erreurs : %APPDATA%\ClaudeCraft\claudecraft.log
function logError(label, err) {
  const line = `[${new Date().toISOString()}] ${label}: ${err && err.stack ? err.stack : err}\n`;
  console.error(line);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'claudecraft.log'), line);
  } catch { /* ignoré */ }
}
process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));

// Appels Win32 (fenêtre active, ordre d'empilement). Repli sur Electron si indisponible.
let native = null;
try {
  native = require('./foreground');
} catch (e) {
  logError('module Win32 indisponible (repli sur Electron)', e);
}

// Permet de jouer le signal sonore sans interaction préalable avec la page.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;            // fenêtre principale
let bubble = null;         // bouton flottant (fenêtre réduite)
let hook = null;
let nextTabId = 1;
let lastExternal = 'game'; // dernière application active hors de l'overlay : 'game' | 'other'
let fgHwnd = 0;            // HWND de cette application
const tabs = new Map();    // tabId -> { proc, settingsPath, state, sessionId, cwd }

// ---------------------------------------------------------------- fenêtres

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1100, Math.round(workArea.width * 0.6));
  const height = Math.min(700, Math.round(workArea.height * 0.65));
  return { width, height, x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + 40 };
}

function onSomeDisplay(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width - 30 && b.x + (b.width || 60) > w.x + 30 && b.y >= w.y - 10 && b.y < w.y + w.height - 30);
}

function createWindow() {
  const cfg = config.get();
  const bounds = cfg.bounds && cfg.bounds.width && onSomeDisplay(cfg.bounds) ? cfg.bounds : defaultBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 520,
    minHeight: 300,
    frame: false,
    show: false,
    skipTaskbar: true,   // accessible uniquement par le bouton flottant ou le raccourci
    backgroundColor: '#15110c',
    title: 'ClaudeCraft',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // le son doit jouer même fenêtre réduite
    },
  });
  // Ni barre des tâches ni Alt+Tab : impossible de l'amener devant une autre application.
  if (native) {
    try { native.setToolWindow(native.hwndOf(win)); } catch (e) { logError('fenêtre outil', e); }
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', showOverlay);

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) config.set({ bounds: win.getBounds() });
    }, 400);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  // Réduction par Windows (ex. Win+D) : on bascule aussi sur le bouton flottant.
  win.on('minimize', (e) => { e.preventDefault(); collapseToBubble(); });
  win.on('close', (e) => {
    // Fermer = réduire en bouton, sauf si on quitte réellement l'application.
    if (!app.isQuitting) {
      e.preventDefault();
      collapseToBubble();
    }
  });
}

function defaultBubblePos() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + Math.round(workArea.width / 2) - 60, y: workArea.y + 6 };
}

function createBubble() {
  const saved = config.get().bubblePos;
  const pos = saved && onSomeDisplay(saved) ? saved : defaultBubblePos();
  bubble = new BrowserWindow({
    width: 120, height: 40, x: pos.x, y: pos.y,
    frame: false,
    transparent: true,
    resizable: true,    // nécessaire pour ajuster la taille au contenu…
    thickFrame: false,  // …sans bordure de redimensionnement
    focusable: false,   // ne vole jamais le clavier au jeu
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  bubble.loadFile(path.join(__dirname, 'renderer', 'bubble.html'));
  // Le bouton est toujours affiché, que la fenêtre principale soit ouverte ou réduite.
  bubble.webContents.on('did-finish-load', () => {
    if (!bubble.isVisible()) bubble.showInactive();
    applyPresence();
    updateBubble();
  });
}

/** Ouvre la fenêtre principale (depuis le bouton flottant ou le raccourci). */
function showOverlay() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!overlayAllowed()) {
    // Hors de WoW : la fenêtre est marquée "ouverte" mais reste invisible ;
    // elle apparaîtra quand vous reviendrez dans le jeu.
    if (!win.isVisible()) win.showInactive();
    applyPresence();
    return;
  }
  win.show();
  applyPresence();
  win.focus();
  // L'activation de la fenêtre la fait passer devant tout : on remet le bouton au-dessus.
  if (bubble && bubble.isVisible()) {
    try {
      if (native) native.setTopmost(native.hwndOf(bubble));
      else bubble.moveTop();
    } catch (e) { logError('ordre du bouton', e); }
  }
  win.webContents.send('overlay:shown');
}

/** Réduit la fenêtre principale : il ne reste que le bouton flottant. */
function collapseToBubble() {
  if (!win) return;
  if (bubble && !bubble.isDestroyed() && !bubble.isVisible()) bubble.showInactive();
  if (win.isVisible()) win.hide();
  applyPresence();
}

/** Clic sur le bouton flottant : ouvre la fenêtre, ou la réduit si elle est déjà ouverte. */
function bubbleToggle() {
  if (!win || !overlayAllowed()) return;
  if (win.isVisible()) collapseToBubble();
  else showOverlay();
}

function toggleOverlay() {
  if (!win) return;
  if (!overlayAllowed()) return; // raccourci sans effet hors de WoW
  if (win.isVisible() && win.isFocused()) collapseToBubble();
  else showOverlay();
}

function registerHotkey(accel) {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(accel, toggleOverlay);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- overlay réservé à WoW
// En mode 'wow', la fenêtre et le bouton ne sont visibles que si WoW est la dernière
// application active (ou si vous êtes dans l'overlay en venant de WoW). Ailleurs
// (Steam, Discord…), ils deviennent instantanément invisibles et transparents aux
// clics : rien ne s'affiche, même en cliquant à leur emplacement ou avec le raccourci.
// Les fenêtres ne sont jamais fermées/rouvertes, ce qui évite toute latence.

function classifyForeground(fg) {
  if (!fg) return null;
  if (fg.pid === process.pid) return 'self';
  const games = (config.get().gameProcesses || []).map((s) => s.toLowerCase());
  return games.includes(fg.name) ? 'game' : 'other';
}

function overlayAllowed() {
  return config.get().overlayMode !== 'wow' || lastExternal === 'game';
}

function applyPresence() {
  const present = overlayAllowed();
  // Le bouton est traité en dernier pour rester au-dessus de la fenêtre principale.
  for (const w of [win, bubble]) {
    if (!w || w.isDestroyed() || !w.isVisible()) continue;
    try {
      w.setOpacity(present ? (w === win ? config.get().opacity : 1) : 0);
      w.setIgnoreMouseEvents(!present);
      if (native) {
        const h = native.hwndOf(w);
        if (present) native.setTopmost(h);
        else native.placeBehind(h, fgHwnd);
      } else {
        w.setAlwaysOnTop(present, 'screen-saver');
      }
    } catch (e) {
      logError('affichage des fenêtres', e);
    }
  }
}

function startForegroundWatch() {
  if (!native) return;
  setInterval(() => {
    let fg;
    try { fg = native.getForeground(); } catch { return; }
    const ctx = classifyForeground(fg);
    // Nos propres fenêtres (overlay, dialogues) ne changent rien : on garde
    // la décision prise pour la dernière application extérieure.
    if (!ctx || ctx === 'self') return;
    const changed = ctx !== lastExternal || (ctx === 'other' && fg.hwnd !== fgHwnd);
    lastExternal = ctx;
    fgHwnd = fg.hwnd;
    if (changed) applyPresence();
  }, 100);
}

// ---------------------------------------------------------------- état des onglets

function counts() {
  const c = { working: 0, waiting: 0, attention: 0 };
  for (const t of tabs.values()) if (t.state in c) c[t.state]++;
  return c;
}

function updateBubble() {
  if (!bubble || bubble.isDestroyed()) return;
  bubble.webContents.send('indicator:update', counts());
}

function setTabState(tabId, state, sound = null, extra = {}) {
  const t = tabs.get(tabId);
  if (!t) return;
  t.state = state;
  Object.assign(t, extra);
  send('tab:state', { tabId, state, sound, sessionId: t.sessionId || null });
  updateBubble();
}

function onHookEvent(tabId, event, payload) {
  const t = tabs.get(tabId);
  if (!t) return;
  switch (event) {
    case 'session-start':
      setTabState(tabId, t.state || 'idle', null, { sessionId: payload.session_id || t.sessionId });
      break;
    case 'working':
      setTabState(tabId, 'working');
      break;
    case 'stop':
      setTabState(tabId, 'waiting', 'done');
      break;
    case 'notification': {
      const type = payload.notification_type || '';
      const msg = String(payload.message || '');
      const idle = type === 'idle_prompt' || /waiting for your input/i.test(msg);
      if (idle) {
        // Rappel d'inactivité : déjà signalé par le hook Stop, on ne rejoue pas le son.
        if (t.state !== 'waiting') setTabState(tabId, 'waiting', 'done');
      } else {
        // Demande de permission ou question de Claude.
        setTabState(tabId, 'attention', 'attention', { lastMessage: msg });
      }
      break;
    }
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------------------------------------------------------- terminaux

function cleanEnv() {
  const env = { ...process.env, COLORTERM: 'truecolor' };
  // Si l'overlay est lancé depuis une session Claude Code, ne pas transmettre
  // les variables qui feraient croire au CLI qu'il est imbriqué.
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ELECTRON_RUN_AS_NODE' || k === 'CC_DEV_SCRIPT') delete env[k];
  }
  return env;
}

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;

function spawnClaude({ cwd, args = [], cols = 120, rows = 30 }) {
  if (!cwd || !fs.existsSync(cwd)) return { error: `Dossier introuvable : ${cwd}` };
  const claude = resolveClaude(config.get().claudePath);
  if (!claude) {
    return { error: "Claude Code (CLI) introuvable. Installez-le (voir README) ou indiquez 'claudePath' dans config.json." };
  }
  const tabId = nextTabId++;
  const settingsPath = writeHookSettings(path.join(app.getPath('userData'), 'hooks'), tabId, hook.port, hook.token);
  const fullArgs = ['--settings', settingsPath, ...args];

  let file = claude.path;
  let argv = fullArgs;
  if (/\.(cmd|bat)$/i.test(file)) {
    // Les scripts .cmd (installation npm) doivent passer par cmd.exe.
    argv = `/d /s /c "${[quote(claude.path), ...fullArgs.map(quote)].join(' ')}"`;
    file = process.env.ComSpec || 'cmd.exe';
  }

  let proc;
  try {
    proc = pty.spawn(file, argv, { name: 'xterm-256color', cols, rows, cwd, env: cleanEnv(), useConpty: true });
  } catch (e) {
    removeHookSettings(settingsPath);
    return { error: `Impossible de lancer Claude : ${e.message}` };
  }

  const sessionId = args[0] === '--resume' ? args[1] : null;
  tabs.set(tabId, { proc, settingsPath, state: 'idle', sessionId, cwd });
  proc.onData((data) => send('pty:data', { tabId, data }));
  proc.onExit(({ exitCode }) => {
    const t = tabs.get(tabId);
    if (t) removeHookSettings(t.settingsPath);
    tabs.delete(tabId);
    send('pty:exit', { tabId, exitCode });
    updateBubble();
  });
  return { tabId, claudeSource: claude.source };
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('sessions:list', () => listSessions());
  ipcMain.handle('pty:spawn', (_e, opts) => spawnClaude(opts || {}));
  ipcMain.on('pty:write', (_e, { tabId, data }) => {
    const t = tabs.get(tabId);
    if (!t) return;
    t.proc.write(data);
    // Réponse à une demande de permission => Claude se remet au travail.
    if (t.state === 'attention') setTabState(tabId, 'working');
  });
  ipcMain.on('pty:resize', (_e, { tabId, cols, rows }) => {
    const t = tabs.get(tabId);
    if (t && cols > 0 && rows > 0) {
      try { t.proc.resize(cols, rows); } catch { /* processus déjà terminé */ }
    }
  });
  ipcMain.on('pty:kill', (_e, tabId) => {
    const t = tabs.get(tabId);
    if (t) {
      try { t.proc.kill(); } catch { /* déjà terminé */ }
    }
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choisir le dossier du projet',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('project:create', (_e, name) => {
    const safe = String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '');
    if (!safe) return { error: 'Nom de projet invalide.' };
    const dir = path.join(config.get().projectsDir, safe);
    if (fs.existsSync(dir)) return { error: `Le dossier existe déjà : ${dir}` };
    fs.mkdirSync(dir, { recursive: true });
    return { dir };
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text)));

  ipcMain.handle('config:get', () => ({
    ...config.get(),
    windowsBuild: Number(os.release().split('.')[2]) || 0,
    claude: resolveClaude(config.get().claudePath),
  }));
  ipcMain.handle('config:set', (_e, patch) => {
    const allowed = ['opacity', 'sound', 'volume', 'hotkey', 'sidebarCollapsed', 'overlayMode'];
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
    if ('opacity' in clean) {
      clean.opacity = Math.min(1, Math.max(0.4, Number(clean.opacity) || 1));
    }
    if ('overlayMode' in clean && !['wow', 'always'].includes(clean.overlayMode)) delete clean.overlayMode;
    if ('hotkey' in clean) {
      const prev = config.get().hotkey;
      if (!registerHotkey(clean.hotkey)) {
        registerHotkey(prev);
        return { error: `Raccourci invalide ou déjà utilisé : ${clean.hotkey}`, config: config.get() };
      }
    }
    const cfg = config.set(clean);
    applyPresence();
    return { config: cfg };
  });

  // Bouton flottant : déplacement à la souris, taille ajustée à son contenu, clic = ouvrir.
  ipcMain.on('bubble:move', (_e, { dx, dy }) => {
    if (!bubble) return;
    const [x, y] = bubble.getPosition();
    bubble.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on('bubble:dragEnd', () => {
    if (!bubble) return;
    const [x, y] = bubble.getPosition();
    config.set({ bubblePos: { x, y } });
  });
  ipcMain.on('bubble:size', (_e, { width, height }) => {
    if (!bubble) return;
    const w = Math.max(40, Math.min(600, Math.ceil(width)));
    const h = Math.max(30, Math.min(120, Math.ceil(height)));
    const [cw, ch] = bubble.getSize();
    if (cw !== w || ch !== h) bubble.setSize(w, h);
  });

  ipcMain.on('overlay:hide', collapseToBubble);
  ipcMain.on('overlay:show', showOverlay);
  ipcMain.on('overlay:toggle', bubbleToggle);
  ipcMain.on('shell:openFolder', (_e, p) => { if (p && fs.existsSync(p)) shell.openPath(p); });
  ipcMain.on('app:quit', () => { app.isQuitting = true; app.quit(); });
}

// ---------------------------------------------------------------- outil de développement
// CC_DEV_SCRIPT=<fichier.js> : script de test exécuté dans le processus principal,
// avec accès à { win, bubble, send, snapshot(nom), run(jsDansLaPage), wait(ms), tabs,
// state(), showOverlay, collapseToBubble }.
function runDevScript(file) {
  const snapshot = async (name, target = win) => {
    const img = await target.webContents.capturePage();
    const out = path.join(path.dirname(file), `${name}.png`);
    fs.writeFileSync(out, img.toPNG());
    return out;
  };
  const run = (js, target = win) => target.webContents.executeJavaScript(js);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = () => ({
    lastExternal,
    winOpacity: win.getOpacity(),
    bubbleOpacity: bubble ? bubble.getOpacity() : null,
    overlayVisible: win.isVisible(),
    bubbleVisible: bubble ? bubble.isVisible() : false,
    bubbleBounds: bubble ? bubble.getBounds() : null,
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      await require(path.resolve(file))({
        win, bubble, send, snapshot, run, wait, tabs, state, showOverlay, collapseToBubble,
      });
    } catch (e) {
      logError('dev-script', e);
    }
  });
}

// ---------------------------------------------------------------- cycle de vie

app.on('second-instance', showOverlay);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  hook = await startHookServer(onHookEvent);
  registerIpc();
  createWindow();
  createBubble();
  startForegroundWatch();
  const cfg = config.get();
  if (process.env.CC_DEV_SCRIPT) runDevScript(process.env.CC_DEV_SCRIPT);
  if (!registerHotkey(cfg.hotkey)) {
    win.webContents.once('did-finish-load', () =>
      send('app:warning', `Le raccourci ${cfg.hotkey} n'a pas pu être enregistré (déjà utilisé ?).`));
  }
});

app.on('before-quit', () => { app.isQuitting = true; });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const t of tabs.values()) {
    try { t.proc.kill(); } catch { /* ignoré */ }
    removeHookSettings(t.settingsPath);
  }
  if (hook) hook.server.close();
});

app.on('window-all-closed', () => app.quit());
