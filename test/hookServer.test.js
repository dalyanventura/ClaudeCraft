const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('child_process');
const { startHookServer } = require('../src/hookServer');
const { hookCommand } = require('../src/claude');

function post(port, urlPath, body, method = 'POST') {
  return fetch(`http://127.0.0.1:${port}${urlPath}`, { method, body, headers: { 'Content-Type': 'application/json' } });
}

async function withServer(fn) {
  const events = [];
  const srv = await startHookServer((tabId, event, payload) => events.push({ tabId, event, payload }));
  try {
    await fn(srv, events);
  } finally {
    srv.server.close();
  }
}

test("hookServer : écoute uniquement en local, avec un jeton aléatoire", async () => {
  await withServer(async (srv) => {
    assert.equal(srv.server.address().address, '127.0.0.1');
    assert.match(srv.token, /^[0-9a-f]{32}$/);
  });
});

test('hookServer : événement valide transmis avec son contenu', async () => {
  await withServer(async ({ port, token }, events) => {
    const res = await post(port, `/hook/${token}/4/stop`, JSON.stringify({ session_id: 's1' }));
    assert.equal(res.status, 204);
    assert.deepEqual(events, [{ tabId: 4, event: 'stop', payload: { session_id: 's1' } }]);
  });
});

test('hookServer : corps vide ou invalide => payload vide', async () => {
  await withServer(async ({ port, token }, events) => {
    assert.equal((await post(port, `/hook/${token}/1/working`, 'pas du json')).status, 204);
    assert.equal((await post(port, `/hook/${token}/1/working`, '')).status, 204);
    assert.deepEqual(events.map((e) => e.payload), [{}, {}]);
  });
});

test('hookServer : mauvais jeton, mauvaise méthode ou URL inconnue refusés', async () => {
  await withServer(async ({ port, token }, events) => {
    assert.equal((await post(port, '/hook/00000000000000000000000000000000/1/stop', '{}')).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/hook/${token}/1/stop`)).status, 404);
    assert.equal((await post(port, `/hook/${token}/abc/stop`, '{}')).status, 404);
    assert.equal((await post(port, `/hook/${token}/1/STOP;rm`, '{}')).status, 404);
    assert.equal((await post(port, '/', '{}')).status, 404);
    assert.equal(events.length, 0);
  });
});

// Test de bout en bout : la commande réellement écrite dans les réglages Claude Code
// (curl.exe) atteint le serveur. Uniquement sous Windows, où curl.exe est fourni.
test('hookServer : la commande de hook (curl.exe) atteint le serveur', { skip: process.platform !== 'win32' }, async () => {
  await withServer(async ({ port, token }, events) => {
    const cmd = hookCommand(port, token, 9, 'notification');
    await new Promise((resolve, reject) => {
      const child = execFile('powershell.exe', ['-NoProfile', '-Command', cmd], (err) => (err ? reject(err) : resolve()));
      child.stdin.end(JSON.stringify({ message: 'Claude needs your permission' }));
    });
    assert.deepEqual(events, [{ tabId: 9, event: 'notification', payload: { message: 'Claude needs your permission' } }]);
  });
});
