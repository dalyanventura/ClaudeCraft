// Configuration persistante, stockée dans %APPDATA%\ClaudeCraft\config.json
const fs = require('fs');
const path = require('path');
const os = require('os');

const defaults = {
  hotkey: 'Control+Alt+C',      // raccourci global pour afficher/masquer l'overlay
  opacity: 0.95,                // opacité de la fenêtre (0.4 – 1)
  sound: true,                  // signal sonore quand Claude attend une réponse
  volume: 0.6,
  bubblePos: null,              // position du bouton flottant (fenêtre réduite), mémorisée au déplacement
  overlayMode: 'wow',           // 'wow' : visible seulement par-dessus le jeu ; 'always' : au-dessus de tout
  gameProcesses: [              // exécutables considérés comme "le jeu" (insensible à la casse)
    'Wow.exe', 'WowClassic.exe', 'WowClassicT.exe', 'WowClassicB.exe', 'WowT.exe', 'WowB.exe',
  ],
  bounds: null,                 // position/taille de la fenêtre (sauvegardée automatiquement)
  sidebarCollapsed: false,
  claudePath: null,             // chemin forcé vers claude.exe (sinon détection automatique)
  projectsDir: path.join(os.homedir(), 'ClaudeProjects'), // où créer les nouveaux projets
};

/**
 * Crée un magasin de configuration lié à un fichier JSON.
 * @param {() => string} fileOf  fonction qui retourne le chemin du fichier (évaluée à la demande)
 */
function createConfig(fileOf, base = defaults) {
  let cache = null;

  function get() {
    if (cache) return cache;
    try {
      const saved = JSON.parse(fs.readFileSync(fileOf(), 'utf8'));
      cache = { ...base, ...(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) };
    } catch {
      cache = { ...base };
    }
    return cache;
  }

  function set(patch) {
    cache = { ...get(), ...patch };
    try {
      fs.mkdirSync(path.dirname(fileOf()), { recursive: true });
      fs.writeFileSync(fileOf(), JSON.stringify(cache, null, 2));
    } catch (e) {
      console.error('Impossible de sauvegarder la configuration :', e);
    }
    return cache;
  }

  return { get, set, defaults: base };
}

// Instance de l'application : fichier dans le dossier utilisateur d'Electron.
// `electron` n'est chargé qu'à la première utilisation (les tests n'en ont pas besoin).
const appConfig = createConfig(() => path.join(require('electron').app.getPath('userData'), 'config.json'));

module.exports = { ...appConfig, createConfig };
