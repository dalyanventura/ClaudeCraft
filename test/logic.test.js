const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/logic');

const GAMES = ['Wow.exe', 'WowClassic.exe'];

test('classifyForeground : jeu, ClaudeCraft, autre application, inconnu', () => {
  assert.equal(logic.classifyForeground({ pid: 10, name: 'wow.exe' }, 1, GAMES), 'game');
  assert.equal(logic.classifyForeground({ pid: 10, name: 'WOWCLASSIC.EXE' }, 1, GAMES), 'game');
  assert.equal(logic.classifyForeground({ pid: 1, name: 'electron.exe' }, 1, GAMES), 'self');
  assert.equal(logic.classifyForeground({ pid: 10, name: 'steam.exe' }, 1, GAMES), 'other');
  assert.equal(logic.classifyForeground({ pid: 10, name: null }, 1, GAMES), 'other');
  assert.equal(logic.classifyForeground(null, 1, GAMES), null);
  assert.equal(logic.classifyForeground({ pid: 0, name: 'x' }, 1, GAMES), null);
});

test("overlayAllowed : en mode 'wow', visible seulement après le jeu", () => {
  assert.equal(logic.overlayAllowed('wow', 'game'), true);
  assert.equal(logic.overlayAllowed('wow', 'other'), false);
  assert.equal(logic.overlayAllowed('always', 'other'), true);
  assert.equal(logic.overlayAllowed('always', 'game'), true);
});

test('nextTabState : Stop => attend la réponse avec son', () => {
  assert.deepEqual(logic.nextTabState('working', 'stop'), { state: 'waiting', sound: 'done', extra: {} });
});

test('nextTabState : UserPromptSubmit => travaille, sans son', () => {
  assert.deepEqual(logic.nextTabState('waiting', 'working'), { state: 'working', sound: null, extra: {} });
});

test("nextTabState : SessionStart garde l'état et mémorise l'identifiant", () => {
  assert.deepEqual(logic.nextTabState(undefined, 'session-start', { session_id: 'abc' }),
    { state: 'idle', sound: null, extra: { sessionId: 'abc' } });
  assert.deepEqual(logic.nextTabState('working', 'session-start', {}),
    { state: 'working', sound: null, extra: {} });
});

test('nextTabState : demande de permission => attention avec son', () => {
  const r = logic.nextTabState('working', 'notification', { message: 'Claude needs your permission to use Bash' });
  assert.equal(r.state, 'attention');
  assert.equal(r.sound, 'attention');
  assert.equal(r.extra.lastMessage, 'Claude needs your permission to use Bash');
});

test("nextTabState : rappel d'inactivité sans rejouer le son si déjà en attente", () => {
  assert.equal(logic.nextTabState('waiting', 'notification', { notification_type: 'idle_prompt' }), null);
  assert.equal(logic.nextTabState('waiting', 'notification', { message: 'Claude is waiting for your input' }), null);
  assert.deepEqual(logic.nextTabState('working', 'notification', { notification_type: 'idle_prompt' }),
    { state: 'waiting', sound: 'done', extra: {} });
});

test('nextTabState : interruption => attend la réponse avec son, seulement si Claude travaillait', () => {
  assert.deepEqual(logic.nextTabState('working', 'interrupt'), { state: 'waiting', sound: 'done', extra: {} });
  assert.equal(logic.nextTabState('waiting', 'interrupt'), null);
  assert.equal(logic.nextTabState('idle', 'interrupt'), null);
});

test("stripAnsi / isInterruptOutput : repère le message d'interruption dans la sortie brute", () => {
  const raw = '\x1b[38;2;255;107;128m  ⎿  Interrupted\x1b[39m \x1b[2m· What\x1b[1Cshould Claude do next?\x1b[22m\r\n';
  assert.ok(logic.isInterruptOutput(logic.stripAnsi(raw)));
  assert.equal(logic.stripAnsi('\x1b]0;titre\x07ok\x1b[2K'), 'ok');
  assert.ok(!logic.isInterruptOutput(logic.stripAnsi('Claude is thinking…')));
});

test('nextTabState : événement inconnu ignoré', () => {
  assert.equal(logic.nextTabState('idle', 'inconnu', {}), null);
});

test('countStates : compte uniquement les états actifs', () => {
  assert.deepEqual(logic.countStates(['working', 'waiting', 'waiting', 'idle', 'attention', undefined]),
    { working: 1, waiting: 2, attention: 1 });
  assert.deepEqual(logic.countStates([]), { working: 0, waiting: 0, attention: 0 });
});

test('sanitizeProjectName : noms valides conservés', () => {
  assert.equal(logic.sanitizeProjectName('  Mon projet  '), 'Mon projet');
  assert.equal(logic.sanitizeProjectName('addon-wow_2'), 'addon-wow_2');
});

test('sanitizeProjectName : pas de chemin ni de remontée de dossier', () => {
  assert.equal(logic.sanitizeProjectName('a/../b'), 'a-..-b');
  assert.equal(logic.sanitizeProjectName('..\\..\\Windows'), '..-..-Windows');
  assert.equal(logic.sanitizeProjectName('C:\\temp'), 'C--temp');
  assert.equal(logic.sanitizeProjectName('..'), null);
  assert.equal(logic.sanitizeProjectName('.'), null);
});

test('sanitizeProjectName : caractères interdits, noms réservés et vides refusés', () => {
  assert.equal(logic.sanitizeProjectName('a<b>c:d"e|f?g*h'), 'a-b-c-d-e-f-g-h');
  assert.equal(logic.sanitizeProjectName('projet. . '), 'projet');
  for (const bad of ['', '   ', null, undefined, 'CON', 'nul', 'com1', 'LPT9.txt']) {
    assert.equal(logic.sanitizeProjectName(bad), null, `"${bad}" devrait être refusé`);
  }
  assert.equal(logic.sanitizeProjectName('x'.repeat(300)).length, 100);
});

test("cleanEnv : retire les variables d'une session Claude parente", () => {
  const env = logic.cleanEnv({
    PATH: 'C:\\bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', ELECTRON_RUN_AS_NODE: '1', CC_DEV_SCRIPT: 'x', HOME: 'h',
  });
  assert.deepEqual(env, { PATH: 'C:\\bin', HOME: 'h', COLORTERM: 'truecolor' });
});

test('buildSpawnCommand : exécutable direct avec arguments séparés', () => {
  const r = logic.buildSpawnCommand('C:\\Users\\a\\.local\\bin\\claude.exe', ['--settings', 'C:\\s.json', '--continue']);
  assert.equal(r.file, 'C:\\Users\\a\\.local\\bin\\claude.exe');
  assert.deepEqual(r.argv, ['--settings', 'C:\\s.json', '--continue']);
});

test('buildSpawnCommand : script .cmd lancé via cmd.exe avec guillemets échappés', () => {
  const r = logic.buildSpawnCommand('C:\\Program Files\\npm\\claude.cmd', ['--resume', 'a"b'], 'C:\\Windows\\cmd.exe');
  assert.equal(r.file, 'C:\\Windows\\cmd.exe');
  assert.equal(r.argv, '/d /s /c ""C:\\Program Files\\npm\\claude.cmd" "--resume" "a""b""');
  assert.equal(logic.buildSpawnCommand('x.BAT', [], '').file, 'cmd.exe');
});

test("isValidSessionId : n'accepte que des identifiants sûrs", () => {
  assert.equal(logic.isValidSessionId('0355c68f-25d3-435f-bd6b-4ecbe0af1baf'), true);
  assert.equal(logic.isValidSessionId('a'), true);
  assert.equal(logic.isValidSessionId('x'.repeat(100)), true);
  for (const bad of ['', '--dangerously-skip-permissions x', 'a;b', 'a b', '../x', null, 42, 'x'.repeat(101)]) {
    assert.equal(logic.isValidSessionId(bad), false, `${bad} devrait être refusé`);
  }
});

test("isValidSessionId : une option seule n'est jamais acceptée (injection d'option CLI)", () => {
  for (const option of ['--dangerously-skip-permissions', '--help', '-p', '-', '--', '-0355c68f']) {
    assert.equal(logic.isValidSessionId(option), false, `${option} devrait être refusé`);
  }
});

test('sanitizeConfigPatch : clés inconnues ignorées et valeurs bornées', () => {
  assert.deepEqual(logic.sanitizeConfigPatch({ claudePath: 'C:\\evil.exe', gameProcesses: [], projectsDir: 'C:\\' }), {});
  assert.deepEqual(logic.sanitizeConfigPatch({ opacity: 0.1 }), { opacity: 0.4 });
  assert.deepEqual(logic.sanitizeConfigPatch({ opacity: 5 }), { opacity: 1 });
  assert.deepEqual(logic.sanitizeConfigPatch({ opacity: 'abc' }), { opacity: 1 });
  assert.deepEqual(logic.sanitizeConfigPatch({ volume: -2 }), { volume: 0 });
  assert.deepEqual(logic.sanitizeConfigPatch({ sound: 0, sidebarCollapsed: 'oui' }), { sound: false, sidebarCollapsed: true });
  assert.deepEqual(logic.sanitizeConfigPatch({ overlayMode: 'partout' }), {});
  assert.deepEqual(logic.sanitizeConfigPatch({ overlayMode: 'always' }), { overlayMode: 'always' });
  assert.deepEqual(logic.sanitizeConfigPatch({ hotkey: '' }), {});
  assert.deepEqual(logic.sanitizeConfigPatch({ hotkey: 'Alt+F12' }), { hotkey: 'Alt+F12' });
  assert.deepEqual(logic.sanitizeConfigPatch(null), {});
});
