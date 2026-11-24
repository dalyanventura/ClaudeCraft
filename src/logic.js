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

/** Arguments du CLI pour reprendre une session : seuls des identifiants sûrs sont acceptés. */
function isValidSessionId(id) {
  return typeof id === 'string' && /^[0-9a-zA-Z-]{1,100}$/.test(id);
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
  sanitizeProjectName,
  cleanEnv,
  buildSpawnCommand,
  isValidSessionId,
  sanitizeConfigPatch,
};
