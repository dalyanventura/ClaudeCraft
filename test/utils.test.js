const test = require('node:test');
const assert = require('node:assert/strict');
const { basename, timeAgo, groupSessions, bubbleLabel } = require('../src/renderer/utils');

test('basename : dernier élément du chemin Windows ou POSIX', () => {
  assert.equal(basename('C:\\Users\\dalya\\Projets\\ClaudeCraft'), 'ClaudeCraft');
  assert.equal(basename('C:\\Users\\dalya\\Projets\\ClaudeCraft\\'), 'ClaudeCraft');
  assert.equal(basename('/home/a/projet/'), 'projet');
  assert.equal(basename(''), '');
});

test('timeAgo : formats relatifs en français', () => {
  const now = 1_000_000_000_000;
  assert.equal(timeAgo(now - 10_000, now), "à l'instant");
  assert.equal(timeAgo(now - 5 * 60_000, now), 'il y a 5 min');
  assert.equal(timeAgo(now - 3 * 3_600_000, now), 'il y a 3 h');
  assert.equal(timeAgo(now - 2 * 86_400_000, now), 'il y a 2 j');
  assert.match(timeAgo(now - 60 * 86_400_000, now), /\d{2}\/\d{2}\/\d{4}/);
});

const SESSIONS = [
  { id: '1', cwd: 'C:\\Projets\\A', title: 'Addon WoW', lastPrompt: 'ajoute un son' },
  { id: '2', cwd: 'c:\\projets\\a', title: 'Deuxième session' },
  { id: '3', cwd: 'C:\\Projets\\B', title: 'Site web', lastPrompt: 'corrige le CSS' },
];

test('groupSessions : regroupe par dossier sans tenir compte de la casse', () => {
  const groups = groupSessions(SESSIONS);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].items.map((s) => s.id), ['1', '2']);
  assert.equal(groups[0].cwd, 'C:\\Projets\\A');
});

test('groupSessions : filtre sur le dossier, le titre et le dernier message', () => {
  assert.deepEqual(groupSessions(SESSIONS, 'css').map((g) => g.cwd), ['C:\\Projets\\B']);
  assert.deepEqual(groupSessions(SESSIONS, '  SON ').flatMap((g) => g.items.map((s) => s.id)), ['1']);
  assert.deepEqual(groupSessions(SESSIONS, 'projets\\b').map((g) => g.cwd), ['C:\\Projets\\B']);
  assert.equal(groupSessions(SESSIONS, 'introuvable').length, 0);
});

test("bubbleLabel : priorité autorisation > attente > travail", () => {
  assert.deepEqual(bubbleLabel({}), { cls: '', text: 'Claude' });
  assert.deepEqual(bubbleLabel({ working: 1 }), { cls: 'working', text: 'Claude travaille…' });
  assert.deepEqual(bubbleLabel({ working: 3 }), { cls: 'working', text: '3 sessions en cours…' });
  assert.deepEqual(bubbleLabel({ working: 2, waiting: 1 }), { cls: 'waiting', text: 'Claude vous attend' });
  assert.deepEqual(bubbleLabel({ waiting: 2 }), { cls: 'waiting', text: '2 sessions vous attendent' });
  assert.deepEqual(bubbleLabel({ waiting: 2, attention: 1 }), { cls: 'attention', text: 'Autorisation demandée' });
  assert.deepEqual(bubbleLabel({ attention: 2 }), { cls: 'attention', text: '2 autorisations demandées' });
});
