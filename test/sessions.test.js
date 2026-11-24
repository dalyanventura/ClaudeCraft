const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listSessions, extractText } = require('../src/sessions');

const line = (o) => JSON.stringify(o) + '\n';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudecraft-sessions-'));
  const proj = path.join(root, 'C--Projets-Addon');
  fs.mkdirSync(proj);

  // Session 1 : titre personnalisé, rappels système ignorés
  fs.writeFileSync(path.join(proj, 'aaaa-1111.jsonl'),
    line({ type: 'queue-operation', sessionId: 'aaaa-1111' }) +
    line({ type: 'user', cwd: 'C:\\Projets\\Addon', message: { content: [{ type: 'text', text: '<system-reminder>ignoré</system-reminder>' }, { type: 'text', text: 'Crée un addon WoW' }] } }) +
    line({ type: 'assistant', message: { content: 'ok' } }) +
    line({ type: 'user', cwd: 'C:\\Projets\\Addon', message: { content: 'Ajoute un son' } }) +
    line({ type: 'custom-title', customTitle: 'Addon WoW pour Claude Code' }));

  // Session 2 : sans titre, premier message utilisé ; ligne JSON corrompue ignorée
  fs.writeFileSync(path.join(proj, 'bbbb-2222.jsonl'),
    '{ corrompu\n' +
    line({ type: 'user', cwd: 'C:\\Projets\\Addon', isMeta: true, message: { content: 'méta ignoré' } }) +
    line({ type: 'user', cwd: 'C:\\Projets\\Addon', message: { content: '  Corrige   le bug  ' } }));

  // Fichiers à ignorer : vide, sous-agent, sans dossier de travail, autre extension
  fs.writeFileSync(path.join(proj, 'vide.jsonl'), '');
  fs.writeFileSync(path.join(proj, 'agent-xyz.jsonl'), line({ type: 'user', cwd: 'C:\\x', message: { content: 'agent' } }));
  fs.writeFileSync(path.join(proj, 'sans-cwd.jsonl'), line({ type: 'user', message: { content: 'x' } }));
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'x');

  // Dates de modification : la session 2 est la plus récente
  const t = Date.now() / 1000;
  fs.utimesSync(path.join(proj, 'aaaa-1111.jsonl'), t - 3600, t - 3600);
  fs.utimesSync(path.join(proj, 'bbbb-2222.jsonl'), t, t);
  return root;
}

test('listSessions : lit titres, dossiers et derniers messages, triés du plus récent', async () => {
  const sessions = await listSessions(150, makeRoot());
  assert.deepEqual(sessions.map((s) => s.id), ['bbbb-2222', 'aaaa-1111']);

  const [s2, s1] = sessions;
  assert.equal(s1.cwd, 'C:\\Projets\\Addon');
  assert.equal(s1.title, 'Addon WoW pour Claude Code');
  assert.equal(s1.lastPrompt, 'Ajoute un son');
  assert.equal(s2.title, 'Corrige le bug');
  assert.ok(s2.mtime > s1.mtime);
});

test('listSessions : respecte la limite', async () => {
  const sessions = await listSessions(1, makeRoot());
  assert.deepEqual(sessions.map((s) => s.id), ['bbbb-2222']);
});

test('listSessions : un fichier récent invalide ne consomme pas la limite', async () => {
  const root = makeRoot();
  // Le fichier sans dossier de travail devient le plus récent de tous.
  const t = Date.now() / 1000 + 60;
  fs.utimesSync(path.join(root, 'C--Projets-Addon', 'sans-cwd.jsonl'), t, t);
  const sessions = await listSessions(1, root);
  assert.deepEqual(sessions.map((s) => s.id), ['bbbb-2222']);
});

test("listSessions : dossier absent => liste vide (pas d'erreur)", async () => {
  // Dossier inexistant situé dans un dossier temporaire privé (mkdtemp), jamais un nom prévisible.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'claudecraft-absent-'));
  assert.deepEqual(await listSessions(10, path.join(parent, 'nexiste-pas')), []);
});

test('extractText : texte utilisateur sans balises système', () => {
  assert.equal(extractText('Bonjour'), 'Bonjour');
  assert.equal(extractText('<command-name>/clear</command-name>'), '');
  assert.equal(extractText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a b');
  assert.equal(extractText(undefined), '');
});
