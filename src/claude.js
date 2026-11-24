// Localisation de l'exécutable Claude Code et génération des réglages de hooks.
const fs = require('fs');
const path = require('path');
const os = require('os');

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Binaire Claude Code embarqué par l'application Claude Desktop :
// %LOCALAPPDATA%\Claude-Data\<profil>\claude-code\<version>\<hash>\claude.exe
function findDesktopBundled(localAppData = process.env.LOCALAPPDATA || '') {
  const root = path.join(localAppData, 'Claude-Data');
  const found = [];
  let profiles = [];
  try { profiles = fs.readdirSync(root); } catch { return null; }
  for (const profile of profiles) {
    const ccDir = path.join(root, profile, 'claude-code');
    let versions = [];
    try { versions = fs.readdirSync(ccDir); } catch { continue; }
    for (const v of versions) {
      if (!/^\d+(\.\d+)*$/.test(v)) continue;
      let hashes = [];
      try { hashes = fs.readdirSync(path.join(ccDir, v)); } catch { continue; }
      for (const h of hashes) {
        const exe = path.join(ccDir, v, h, 'claude.exe');
        if (isFile(exe)) found.push({ v, exe });
      }
    }
  }
  found.sort((a, b) => compareVersions(b.v, a.v));
  return found.length ? found[0].exe : null;
}

/**
 * Retourne { path, source } ou null.
 * `env` et `home` sont paramétrables pour les tests.
 */
function resolveClaude(override, env = process.env, home = os.homedir()) {
  if (override && isFile(override)) return { path: override, source: 'config' };

  // 1. Installation native officielle
  const native = path.join(home, '.local', 'bin', 'claude.exe');
  if (isFile(native)) return { path: native, source: 'native' };

  // 2. PATH (installation npm => claude.cmd)
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of ['claude.exe', 'claude.cmd']) {
      const p = path.join(dir, name);
      if (isFile(p)) return { path: p, source: 'path' };
    }
  }
  if (env.APPDATA) {
    const npmShim = path.join(env.APPDATA, 'npm', 'claude.cmd');
    if (isFile(npmShim)) return { path: npmShim, source: 'npm' };
  }

  // 3. Binaire fourni avec l'application Claude Desktop
  const bundled = env.LOCALAPPDATA ? findDesktopBundled(env.LOCALAPPDATA) : null;
  if (bundled) return { path: bundled, source: 'desktop' };

  return null;
}

function hookCommand(port, token, tabId, event) {
  // curl.exe est fourni avec Windows 10/11 ; ".exe" explicite pour éviter l'alias
  // PowerShell "curl" => Invoke-WebRequest. "@-" entre guillemets pour PowerShell.
  // Fonctionne aussi sous Git Bash.
  return `curl.exe -s -m 3 -X POST -H "Content-Type: application/json" --data-binary "@-" http://127.0.0.1:${port}/hook/${token}/${tabId}/${event}`;
}

/** Écrit le fichier de réglages propre à un onglet et retourne son chemin. */
function writeHookSettings(dir, tabId, port, token) {
  const h = (event) => [{ hooks: [{ type: 'command', command: hookCommand(port, token, tabId, event), timeout: 5 }] }];
  const settings = {
    hooks: {
      SessionStart: h('session-start'),
      UserPromptSubmit: h('working'),
      Stop: h('stop'),
      Notification: h('notification'),
    },
  };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tab-${tabId}.json`);
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return file;
}

function removeHookSettings(file) {
  try { fs.unlinkSync(file); } catch { /* déjà supprimé */ }
}

module.exports = {
  resolveClaude, writeHookSettings, removeHookSettings, hookCommand, compareVersions, findDesktopBundled,
};
