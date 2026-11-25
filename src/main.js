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
const { listSessions, sessionPaths } = require('./sessions');
const { startHookServer } = require('./hookServer');
const logic = require('./logic');

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
const lastByMonitor = new Map(); // écran (HMONITOR) -> dernière application active sur cet écran
let overlayWanted = false; // la fenêtre principale est-elle "ouverte" (choix de l'utilisateur) ?
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
  // Réduction par Windows (Win+D, retour du jeu au premier plan…) : ce n'est pas un choix
  // de l'utilisateur, la fenêtre reste "ouverte" et réapparaît dès que l'overlay est autorisé.
  win.on('minimize', () => { setTimeout(applyPresence, 250); });
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
  overlayWanted = true;
  if (win.isMinimized()) win.restore();
  if (!presentFor(win)) {
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
  overlayWanted = false;
  if (bubble && !bubble.isDestroyed() && !bubble.isVisible()) bubble.showInactive();
  if (win.isVisible()) win.hide();
  applyPresence();
}

/** Clic sur le bouton flottant : ouvre la fenêtre, ou la réduit si elle est déjà ouverte. */
function bubbleToggle() {
  if (!win || !presentFor(bubble)) return;
  if (overlayWanted && win.isVisible() && !win.isMinimized()) collapseToBubble();
  else showOverlay();
}

function toggleOverlay() {
  if (!win) return;
  if (!presentFor(win)) return; // raccourci sans effet hors de WoW
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
  return logic.classifyForeground(fg, process.pid, config.get().gameProcesses || []);
}

// Avec plusieurs écrans, la décision est prise écran par écran : cliquer sur une
// application du deuxième écran ne masque pas l'overlay posé sur l'écran de WoW.
function monitorOfWindow(w) {
  if (!native || !w || w.isDestroyed()) return 0;
  try { return native.monitorOf(native.hwndOf(w)); } catch { return 0; }
}

/** L'overlay peut-il être visible pour cette fenêtre (selon l'écran où elle se trouve) ? */
function presentFor(w) {
  const m = monitorOfWindow(w);
  const ctx = m && lastByMonitor.has(m) ? lastByMonitor.get(m) : lastExternal;
  return logic.overlayAllowed(config.get().overlayMode, ctx);
}

function applyPresence() {
  // Fenêtre ouverte mais réduite/masquée par Windows : on la réaffiche sans voler le focus au jeu.
  if (win && !win.isDestroyed() && overlayWanted && presentFor(win) && (win.isMinimized() || !win.isVisible())) {
    win.showInactive();
  }
  // Le bouton est traité en dernier pour rester au-dessus de la fenêtre principale.
  for (const w of [win, bubble]) {
    if (!w || w.isDestroyed() || !w.isVisible()) continue;
    const present = presentFor(w);
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
    let m = 0;
    try { m = native.monitorOf(fg.hwnd); } catch { /* écran inconnu */ }
    const changed = ctx !== lastExternal || (ctx === 'other' && fg.hwnd !== fgHwnd)
      || (m && lastByMonitor.get(m) !== ctx);
    lastExternal = ctx;
    fgHwnd = fg.hwnd;
    if (m) lastByMonitor.set(m, ctx);
    if (changed) applyPresence();
  }, 100);
}

// ---------------------------------------------------------------- état des onglets

function counts() {
  return logic.countStates([...tabs.values()].map((t) => t.state));
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
  const next = logic.nextTabState(t.state, event, payload || {});
  if (next) setTabState(tabId, next.state, next.sound, next.extra);
}

// Une interruption (Échap) ne déclenche aucun hook : on la repère dans la sortie du terminal.
// Une fin de ligne est conservée d'un bloc à l'autre (texte coupé entre deux blocs) ; on ignore
// les redessins complets qui suivent un redimensionnement (ils réaffichent l'historique).
const RESIZE_GRACE_MS = 1500;
function watchForInterrupt(tabId, data) {
  const t = tabs.get(tabId);
  if (!t) return;
  const text = (t.outTail || '') + logic.stripAnsi(data);
  t.outTail = text.slice(-80);
  if (t.state !== 'working' || Date.now() - (t.lastResize || 0) < RESIZE_GRACE_MS) return;
  if (logic.isInterruptOutput(text)) {
    t.outTail = '';
    onHookEvent(tabId, 'interrupt', {});
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------------------------------------------------------- terminaux

// Seuls ces lancements sont acceptés depuis l'interface (pas d'arguments arbitraires).
function launchArgs({ mode, sessionId }) {
  if (mode === 'new') return [];
  if (mode === 'continue') return ['--continue'];
  if (mode === 'resume' && logic.isValidSessionId(sessionId)) return ['--resume', sessionId];
  return null;
}

function spawnClaude({ cwd, mode, sessionId, cols = 120, rows = 30 }) {
  if (typeof cwd !== 'string' || !cwd || !fs.existsSync(cwd)) return { error: `Dossier introuvable : ${cwd}` };
  const args = launchArgs({ mode, sessionId });
  if (!args) return { error: 'Lancement invalide.' };
  const claude = resolveClaude(config.get().claudePath);
  if (!claude) {
    return { error: "Claude Code (CLI) introuvable. Installez-le (voir README) ou indiquez 'claudePath' dans config.json." };
  }
  const tabId = nextTabId++;
  const settingsPath = writeHookSettings(path.join(app.getPath('userData'), 'hooks'), tabId, hook.port, hook.token);
  const fullArgs = ['--settings', settingsPath, ...args];

  const { file, argv } = logic.buildSpawnCommand(claude.path, fullArgs, process.env.ComSpec);

  let proc;
  try {
    // cleanEnv : si ClaudeCraft est lancé depuis une session Claude Code, ne pas transmettre
    // les variables qui feraient croire au CLI qu'il est imbriqué.
    proc = pty.spawn(file, argv, { name: 'xterm-256color', cols, rows, cwd, env: logic.cleanEnv(process.env), useConpty: true });
  } catch (e) {
    removeHookSettings(settingsPath);
    return { error: `Impossible de lancer Claude : ${e.message}` };
  }

  tabs.set(tabId, { kind: 'claude', proc, settingsPath, state: 'idle', sessionId: mode === 'resume' ? sessionId : null, cwd });
  attachPty(tabId, proc);
  return { tabId, claudeSource: claude.source };
}

/** Relaie la sortie et la fin d'un pseudo-terminal vers l'interface. */
function attachPty(tabId, proc) {
  proc.onData((data) => {
    send('pty:data', { tabId, data });
    if (tabs.get(tabId)?.kind === 'claude') watchForInterrupt(tabId, data);
  });
  proc.onExit(({ exitCode }) => {
    const t = tabs.get(tabId);
    if (t && t.settingsPath) removeHookSettings(t.settingsPath);
    tabs.delete(tabId);
    send('pty:exit', { tabId, exitCode });
    updateBubble();
  });
}

/**
 * Onglet « Terminal » : un shell (PowerShell par défaut) dans le dossier du projet, pour
 * tester les commandes sans quitter l'overlay. Aucun hook ni suivi d'état.
 */
function spawnShell({ cwd, cols = 120, rows = 30 }) {
  if (typeof cwd !== 'string' || !cwd || !fs.existsSync(cwd)) cwd = os.homedir();
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const file = logic.resolveShell(config.get().shellPath, process.env, isFile);
  const argv = /(pwsh|powershell)\.exe$/i.test(file) ? ['-NoLogo'] : [];
  let proc;
  try {
    proc = pty.spawn(file, argv, { name: 'xterm-256color', cols, rows, cwd, env: logic.cleanEnv(process.env), useConpty: true });
  } catch (e) {
    return { error: `Impossible de lancer le terminal (${file}) : ${e.message}` };
  }
  const tabId = nextTabId++;
  tabs.set(tabId, { kind: 'shell', proc, settingsPath: null, state: 'idle', sessionId: null, cwd });
  attachPty(tabId, proc);
  return { tabId, shell: path.basename(file), cwd };
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('sessions:list', () => listSessions());
  // Suppression d'une conversation : envoyée à la Corbeille (récupérable), jamais effacée
  // définitivement. Refusée si la conversation est ouverte dans un onglet.
  ipcMain.handle('sessions:delete', async (_e, id) => {
    if (!logic.isValidSessionId(id)) return { error: 'Identifiant de session invalide.' };
    if ([...tabs.values()].some((t) => t.sessionId === id)) {
      return { error: "Cette conversation est ouverte dans un onglet : fermez l'onglet avant de la supprimer." };
    }
    const paths = await sessionPaths(id);
    if (!paths.length) return { error: 'Conversation introuvable (déjà supprimée ?).' };
    try {
      for (const p of paths) await shell.trashItem(p);
    } catch (e) {
      logError('suppression de session', e);
      return { error: `Suppression impossible : ${e.message}` };
    }
    return { ok: true };
  });
  ipcMain.handle('pty:spawn', (_e, opts) => spawnClaude(opts || {}));
  ipcMain.handle('pty:spawnShell', (_e, opts) => spawnShell(opts || {}));
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
      t.lastResize = Date.now();
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
    const safe = logic.sanitizeProjectName(name);
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
    const clean = logic.sanitizeConfigPatch(patch);
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
    if (t.settingsPath) removeHookSettings(t.settingsPath);
  }
  if (hook) hook.server.close();
});

app.on('window-all-closed', () => app.quit());
