// Configuration persistante, stockée dans %APPDATA%\ClaudeCraft\config.json
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const defaults = {
  hotkey: 'Control+Alt+C',      // raccourci global pour afficher/masquer l'overlay
  opacity: 0.95,                // opacité de la fenêtre (0.4 – 1)
  sound: true,                  // signal sonore quand Claude attend une réponse
  volume: 0.6,
  bubblePos: null,              // position du bouton flottant (fenêtre réduite), mémorisée au déplacement
  overlayMode: 'wow',           // 'wow' : au-dessus du jeu, mais passe derrière les autres applications ; 'always' : au-dessus de tout
  gameProcesses: [              // exécutables considérés comme "le jeu" (insensible à la casse)
    'Wow.exe', 'WowClassic.exe', 'WowClassicT.exe', 'WowClassicB.exe', 'WowT.exe', 'WowB.exe',
  ],
  bounds: null,                 // position/taille de la fenêtre (sauvegardée automatiquement)
  sidebarCollapsed: false,
  claudePath: null,             // chemin forcé vers claude.exe (sinon détection automatique)
  projectsDir: path.join(os.homedir(), 'ClaudeProjects'), // où créer les nouveaux projets
};

let cache = null;
const file = () => path.join(app.getPath('userData'), 'config.json');

function get() {
  if (cache) return cache;
  try {
    cache = { ...defaults, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...defaults };
  }
  return cache;
}

function set(patch) {
  cache = { ...get(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('Impossible de sauvegarder la configuration :', e);
  }
  return cache;
}

module.exports = { get, set, defaults };
