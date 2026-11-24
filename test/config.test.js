const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConfig, defaults } = require('../src/config');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claudecraft-config-'));

test('config : valeurs par défaut sans fichier', () => {
  const dir = tmp();
  const cfg = createConfig(() => path.join(dir, 'config.json'));
  assert.equal(cfg.get().hotkey, 'Control+Alt+C');
  assert.equal(cfg.get().overlayMode, 'wow');
  assert.ok(cfg.get().gameProcesses.includes('Wow.exe'));
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), false);
});

test('config : set() enregistre et fusionne avec les valeurs par défaut', () => {
  const dir = tmp();
  const file = path.join(dir, 'sous', 'config.json');
  const cfg = createConfig(() => file);
  cfg.set({ opacity: 0.7, bubblePos: { x: 10, y: 20 } });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.opacity, 0.7);
  assert.deepEqual(saved.bubblePos, { x: 10, y: 20 });
  assert.equal(saved.hotkey, defaults.hotkey);

  // Relecture par une nouvelle instance (redémarrage de l'application)
  const again = createConfig(() => file);
  assert.equal(again.get().opacity, 0.7);
});

test('config : fichier corrompu ou invalide => valeurs par défaut', () => {
  const dir = tmp();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{ pas du json');
  assert.equal(createConfig(() => file).get().opacity, defaults.opacity);
  fs.writeFileSync(file, '[1, 2, 3]');
  assert.equal(createConfig(() => file).get().opacity, defaults.opacity);
  fs.writeFileSync(file, 'null');
  assert.equal(createConfig(() => file).get().hotkey, defaults.hotkey);
});
