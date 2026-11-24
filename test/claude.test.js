const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveClaude, writeHookSettings, removeHookSettings, hookCommand, compareVersions, findDesktopBundled,
} = require('../src/claude');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claudecraft-claude-'));
const touch = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); return p; };
const EMPTY_ENV = { PATH: '' };

test('compareVersions : ordre numérique, pas alphabétique', () => {
  assert.ok(compareVersions('2.1.330', '2.1.309') > 0);
  assert.ok(compareVersions('2.10.0', '2.9.9') > 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
});

test('resolveClaude : chemin forcé dans la configuration en priorité', () => {
  const home = tmp();
  const forced = touch(path.join(home, 'perso', 'claude.exe'));
  touch(path.join(home, '.local', 'bin', 'claude.exe'));
  assert.deepEqual(resolveClaude(forced, EMPTY_ENV, home), { path: forced, source: 'config' });
});

test("resolveClaude : installation native, puis PATH, puis npm, puis Claude Desktop", () => {
  const home = tmp();
  const env = { PATH: path.join(home, 'bin'), APPDATA: path.join(home, 'AppData'), LOCALAPPDATA: path.join(home, 'Local') };

  assert.equal(resolveClaude(null, env, home), null);

  const desktop = touch(path.join(home, 'Local', 'Claude-Data', 'profil', 'claude-code', '2.1.0', 'h', 'claude.exe'));
  assert.deepEqual(resolveClaude(null, env, home), { path: desktop, source: 'desktop' });

  const npm = touch(path.join(home, 'AppData', 'npm', 'claude.cmd'));
  assert.deepEqual(resolveClaude(null, env, home), { path: npm, source: 'npm' });

  const inPath = touch(path.join(home, 'bin', 'claude.exe'));
  assert.deepEqual(resolveClaude(null, env, home), { path: inPath, source: 'path' });

  const native = touch(path.join(home, '.local', 'bin', 'claude.exe'));
  assert.deepEqual(resolveClaude(null, env, home), { path: native, source: 'native' });
});

test('resolveClaude : chemin forcé inexistant ignoré', () => {
  const home = tmp();
  assert.equal(resolveClaude(path.join(home, 'absent.exe'), EMPTY_ENV, home), null);
});

test('findDesktopBundled : choisit la version la plus récente', () => {
  const local = tmp();
  const base = path.join(local, 'Claude-Data', 'p', 'claude-code');
  touch(path.join(base, '2.1.309', 'a', 'claude.exe'));
  const newest = touch(path.join(base, '2.1.330', 'b', 'claude.exe'));
  touch(path.join(base, '2.1.99', 'c', 'claude.exe'));
  fs.mkdirSync(path.join(base, 'pas-une-version', 'd'), { recursive: true });
  assert.equal(findDesktopBundled(local), newest);
  assert.equal(findDesktopBundled(path.join(local, 'absent')), null);
});

test('hookCommand : appel local avec jeton, onglet et événement', () => {
  const cmd = hookCommand(4567, 'abc123', 7, 'stop');
  assert.match(cmd, /^curl\.exe /);
  assert.match(cmd, /--data-binary "@-"/);
  assert.ok(cmd.endsWith('http://127.0.0.1:4567/hook/abc123/7/stop'));
});

test("writeHookSettings : fichier de réglages avec les 4 hooks, puis suppression", () => {
  const dir = path.join(tmp(), 'hooks');
  const file = writeHookSettings(dir, 3, 1234, 'tok');
  assert.equal(path.basename(file), 'tab-3.json');
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['Notification', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  const events = {
    SessionStart: 'session-start', UserPromptSubmit: 'working', Stop: 'stop', Notification: 'notification',
  };
  for (const [hookName, event] of Object.entries(events)) {
    const h = settings.hooks[hookName][0].hooks[0];
    assert.equal(h.type, 'command');
    assert.equal(h.timeout, 5);
    assert.ok(h.command.endsWith(`/hook/tok/3/${event}`), `${hookName} => ${event}`);
  }
  removeHookSettings(file);
  assert.equal(fs.existsSync(file), false);
  removeHookSettings(file); // déjà supprimé : pas d'erreur
});
