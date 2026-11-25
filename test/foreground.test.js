// Appels Win32 réels (koffi) : uniquement sous Windows.
const test = require('node:test');
const assert = require('node:assert/strict');

const isWindows = process.platform === 'win32';

test('foreground : détecte la fenêtre au premier plan', { skip: !isWindows }, () => {
  const { getForeground } = require('../src/foreground');
  const fg = getForeground();
  // Sur une machine de CI sans bureau interactif, il peut ne pas y avoir de fenêtre active.
  if (fg === null) return;
  assert.equal(typeof fg.hwnd, 'number');
  assert.ok(fg.pid > 0);
  assert.ok(fg.name === null || /\.exe$/.test(fg.name), `nom inattendu : ${fg.name}`);
});

test('foreground : fonctions exportées', { skip: !isWindows }, () => {
  const mod = require('../src/foreground');
  for (const fn of ['getForeground', 'hwndOf', 'monitorOf', 'setTopmost', 'placeBehind', 'setToolWindow']) {
    assert.equal(typeof mod[fn], 'function', fn);
  }
});

test('foreground : écran de la fenêtre au premier plan', { skip: !isWindows }, () => {
  const { getForeground, monitorOf } = require('../src/foreground');
  const fg = getForeground();
  if (fg === null) return;
  const m = monitorOf(fg.hwnd);
  assert.equal(typeof m, 'number');
  assert.ok(m !== 0, 'HMONITOR nul');
});
