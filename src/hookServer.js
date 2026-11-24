// Petit serveur HTTP local qui reçoit les événements des hooks Claude Code.
// Chaque session lancée par l'overlay reçoit un fichier de réglages (--settings)
// dont les hooks appellent : POST http://127.0.0.1:<port>/hook/<jeton>/<onglet>/<événement>
const http = require('http');
const crypto = require('crypto');

function startHookServer(onEvent) {
  const token = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const m = /^\/hook\/([0-9a-f]+)\/(\d+)\/([a-z-]+)$/.exec(req.url || '');
      if (req.method !== 'POST' || !m || m[1] !== token) {
        res.writeHead(404);
        return res.end();
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) req.destroy();
      });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body); } catch { /* corps vide ou invalide */ }
        // Réponse vide : le hook n'influence pas le comportement de Claude.
        res.writeHead(204);
        res.end();
        try { onEvent(Number(m[2]), m[3], payload); } catch (e) { console.error(e); }
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, token, server });
    });
  });
}

module.exports = { startHookServer };
