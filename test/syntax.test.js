// Vérifie que tous les fichiers JavaScript de l'application sont syntaxiquement valides
// (y compris ceux qui ne peuvent être chargés que dans Electron, comme main.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

const SRC = path.join(__dirname, '..', 'src');

for (const file of jsFiles(SRC)) {
  test(`syntaxe : ${path.relative(SRC, file)}`, () => {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }));
  });
}

test('package.json : point d\'entrée et script de test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'src/main.js');
  assert.ok(fs.existsSync(path.join(__dirname, '..', pkg.main)));
  assert.ok(pkg.scripts.test);
});
