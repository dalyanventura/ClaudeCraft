// Logique pure de ClaudeCraft (sans Electron ni Win32), testée par les tests unitaires.

const GAME_STATES = ['working', 'waiting', 'attention'];

/**
 * Classe l'application au premier plan.
 * @param {{pid:number,name:string|null}|null} fg
 * @param {number} selfPid  PID du processus principal de ClaudeCraft
 * @param {string[]} gameProcesses  exécutables considérés comme le jeu
 * @returns {'self'|'game'|'other'|null}
 */
function classifyForeground(fg, selfPid, gameProcesses = []) {
  if (!fg || !fg.pid) return null;
  if (fg.pid === selfPid) return 'self';
  const games = gameProcesses.map((s) => String(s).toLowerCase());
  return fg.name && games.includes(String(fg.name).toLowerCase()) ? 'game' : 'other';
}

/** L'overlay peut-il être visible ? (mode 'wow' : seulement si le jeu était la dernière application active) */
function overlayAllowed(overlayMode, lastExternal) {
  return overlayMode !== 'wow' || lastExternal === 'game';
}

/**
 * Transition d'état d'un onglet à la réception d'un événement de hook Claude Code.
 * @returns {{state:string, sound:'done'|'attention'|null, extra:object}|null} null = rien à changer
 */
function nextTabState(current, event, payload = {}) {
  switch (event) {
    case 'session-start':
      return { state: current || 'idle', sound: null, extra: payload.session_id ? { sessionId: payload.session_id } : {} };
    case 'working':
      return { state: 'working', sound: null, extra: {} };
    case 'stop':
      return { state: 'waiting', sound: 'done', extra: {} };
    case 'interrupt':
      // Interruption (Échap) : Claude Code ne déclenche pas le hook Stop, détectée dans la sortie du terminal.
      return current === 'working' ? { state: 'waiting', sound: 'done', extra: {} } : null;
    case 'notification': {
      const type = payload.notification_type || '';
      const msg = String(payload.message || '');
      const idle = type === 'idle_prompt' || /waiting for your input/i.test(msg);
      if (idle) {
        // Rappel d'inactivité : déjà signalé par le hook Stop, on ne rejoue pas le son.
        return current === 'waiting' ? null : { state: 'waiting', sound: 'done', extra: {} };
      }
      // Demande de permission ou question de Claude.
      return { state: 'attention', sound: 'attention', extra: { lastMessage: msg } };
    }
    default:
      return null;
  }
}

// Séquences d'échappement ANSI/VT (CSI, OSC, échappements simples).
const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
// Déplacement du curseur vers la droite : ConPTY s'en sert parfois à la place des espaces.
const CURSOR_FWD_RE = /\x1b\[\d*C/g;
const INTERRUPT_RE = /What\s*should\s*Claude\s*do\s*next\?/i;

/** Texte visible d'une sortie de terminal (sans séquences d'échappement). */
function stripAnsi(data) {
  return String(data ?? '').replace(CURSOR_FWD_RE, ' ').replace(ANSI_RE, '');
}

/** La sortie du terminal annonce-t-elle une interruption (« Interrupted · What should Claude do next? ») ? */
function isInterruptOutput(text) {
  return INTERRUPT_RE.test(text);
}

/** Compte les onglets par état (pour le bouton flottant). */
function countStates(states) {
  const c = { working: 0, waiting: 0, attention: 0 };
  for (const s of states) if (GAME_STATES.includes(s)) c[s]++;
  return c;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Nom de dossier sûr pour un nouveau projet (Windows), ou null s'il est invalide.
 * Empêche les chemins (/, \, ..), les caractères interdits et les noms réservés.
 */
function sanitizeProjectName(name) {
  const safe = String(name ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/, '')
    .slice(0, 100);
  if (!safe || /^\.+$/.test(safe) || WINDOWS_RESERVED.test(safe)) return null;
  return safe;
}

/** Variables d'environnement transmises au CLI Claude (sans celles d'une session parente). */
function cleanEnv(env) {
  const out = { ...env, COLORTERM: 'truecolor' };
  for (const k of Object.keys(out)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ELECTRON_RUN_AS_NODE' || k === 'CC_DEV_SCRIPT') {
      delete out[k];
    }
  }
  return out;
}

const quoteCmd = (s) => `"${String(s).replace(/"/g, '""')}"`;

/**
 * Commande à lancer dans le pseudo-terminal.
 * Les scripts .cmd/.bat (installation npm) doivent passer par cmd.exe.
 */
function buildSpawnCommand(claudePath, args, comspec = 'cmd.exe') {
  if (/\.(cmd|bat)$/i.test(claudePath)) {
    return {
      file: comspec || 'cmd.exe',
      argv: `/d /s /c "${[quoteCmd(claudePath), ...args.map(quoteCmd)].join(' ')}"`,
    };
  }
  return { file: claudePath, argv: [...args] };
}

/**
 * Arguments du CLI pour reprendre une session : seuls des identifiants sûrs sont acceptés.
 * Le premier caractère doit être alphanumérique : un identifiant commençant par un tiret
 * (ex. "--dangerously-skip-permissions") serait interprété comme une option par le CLI.
 */
function isValidSessionId(id) {
  return typeof id === 'string' && /^[0-9a-zA-Z][0-9a-zA-Z-]{0,99}$/.test(id);
}

/**
 * Shell à lancer dans un onglet « Terminal » : `override` (config shellPath) s'il existe,
 * sinon PowerShell 7 (pwsh.exe) trouvé dans le PATH, sinon Windows PowerShell, sinon cmd.exe.
 * `exists` est paramétrable pour les tests.
 */
function resolveShell(override, env = {}, exists = () => false, sep = ';') {
  if (typeof override === 'string' && override && exists(override)) return override;
  for (const dir of String(env.PATH || env.Path || '').split(sep)) {
    if (!dir) continue;
    const p = dir.replace(/[\\/]+$/, '') + '\\pwsh.exe';
    if (exists(p)) return p;
  }
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  const winPs = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  if (exists(winPs)) return winPs;
  return env.ComSpec || env.COMSPEC || 'cmd.exe';
}

const CONFIG_KEYS = ['opacity', 'sound', 'volume', 'hotkey', 'sidebarCollapsed', 'overlayMode'];

/** Filtre et normalise une modification de réglages venant de l'interface. */
function sanitizeConfigPatch(patch) {
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => CONFIG_KEYS.includes(k)));
  if ('opacity' in clean) clean.opacity = Math.min(1, Math.max(0.4, Number(clean.opacity) || 1));
  if ('volume' in clean) clean.volume = Math.min(1, Math.max(0, Number(clean.volume) || 0));
  if ('sound' in clean) clean.sound = !!clean.sound;
  if ('sidebarCollapsed' in clean) clean.sidebarCollapsed = !!clean.sidebarCollapsed;
  if ('overlayMode' in clean && !['wow', 'always'].includes(clean.overlayMode)) delete clean.overlayMode;
  if ('hotkey' in clean && (typeof clean.hotkey !== 'string' || !clean.hotkey.trim())) delete clean.hotkey;
  return clean;
}

module.exports = {
  classifyForeground,
  overlayAllowed,
  nextTabState,
  countStates,
  stripAnsi,
  isInterruptOutput,
  sanitizeProjectName,
  cleanEnv,
  buildSpawnCommand,
  isValidSessionId,
  sanitizeConfigPatch,
  resolveShell,
};
