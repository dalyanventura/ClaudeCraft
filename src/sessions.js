// Lecture des sessions Claude Code existantes (~/.claude/projects/<projet>/<sessionId>.jsonl).
// Ces sessions incluent celles du CLI et celles de l'onglet Code de l'application Claude Desktop.
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const HEAD = 256 * 1024;
const TAIL = 128 * 1024;

async function readChunk(file, start, length) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

function extractText(content) {
  if (typeof content === 'string') return content.startsWith('<') ? '' : content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string' && !c.text.trimStart().startsWith('<'))
    .map((c) => c.text)
    .join(' ');
}

const clean = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 160);

async function readMeta(f) {
  const head = await readChunk(f.fp, 0, Math.min(f.size, HEAD));
  const tail = f.size > HEAD ? await readChunk(f.fp, Math.max(HEAD, f.size - TAIL), TAIL) : '';
  let cwd = null, firstPrompt = null, lastPrompt = null, customTitle = null, summary = null;

  for (const line of (head + '\n' + tail).split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
    if (o.type === 'custom-title' && o.customTitle) customTitle = o.customTitle;
    if (o.type === 'summary' && o.summary) summary = o.summary;
    if (o.type === 'last-prompt' && typeof o.lastPrompt === 'string') lastPrompt = clean(o.lastPrompt);
    if (o.type === 'user' && !o.isMeta && !o.isSidechain && o.message) {
      const t = clean(extractText(o.message.content));
      if (t) {
        if (!firstPrompt) firstPrompt = t;
        lastPrompt = t;
      }
    }
  }
  if (!cwd) return null;
  return {
    id: f.id,
    cwd,
    title: customTitle || summary || firstPrompt || '(session sans titre)',
    lastPrompt,
    mtime: f.mtime,
  };
}

async function listSessions(limit = 150) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  let dirs;
  try { dirs = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }

  const files = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dp = path.join(root, d.name);
    let entries;
    try { entries = await fsp.readdir(dp); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.jsonl') || name.startsWith('agent-')) continue;
      const fp = path.join(dp, name);
      try {
        const st = await fsp.stat(fp);
        if (st.isFile() && st.size > 0) files.push({ fp, id: name.slice(0, -6), size: st.size, mtime: st.mtimeMs });
      } catch { /* ignoré */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const metas = await Promise.all(files.slice(0, limit).map((f) => readMeta(f).catch(() => null)));
  return metas.filter(Boolean);
}

module.exports = { listSessions };
