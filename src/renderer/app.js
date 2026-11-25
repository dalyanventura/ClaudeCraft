// Interface de ClaudeCraft : liste des projets/sessions, onglets, terminaux.
const api = window.claudecraft;
const $ = (sel) => document.querySelector(sel);

let cfg = {};
let sessions = [];
const tabs = new Map(); // tabId -> { term, fit, wrap, tabEl, title, cwd, sessionId, state, unread, ended }
let activeTab = null;
const collapsedProjects = new Set(JSON.parse(localStorage.getItem('collapsed') || '[]'));

// ------------------------------------------------------------------ utilitaires

function toast(msg, ms = 4500) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

const { basename, timeAgo, groupSessions } = window.ccUtils;

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

// ------------------------------------------------------------------ sessions

async function refreshSessions() {
  try {
    sessions = await api.listSessions();
  } catch (e) {
    sessions = [];
    toast('Lecture des sessions impossible : ' + e.message);
  }
  renderProjects();
}

function renderProjects() {
  const filter = $('#filter').value.trim().toLowerCase();
  const groups = groupSessions(sessions, filter);

  const openIds = new Set([...tabs.values()].filter((t) => !t.ended).map((t) => t.sessionId));
  const container = $('#projects');
  container.replaceChildren();
  if (!groups.length) {
    container.append(el('div', { class: 'side-empty' },
      sessions.length ? 'Aucun résultat.' : 'Aucune session Claude Code trouvée. Créez un nouveau projet pour commencer.'));
    return;
  }

  for (const g of groups) {
    const key = g.key;
    const collapsed = collapsedProjects.has(key) && !filter;
    const project = el('div', { class: 'project' + (collapsed ? ' collapsed' : '') });

    const head = el('div', { class: 'project-head', title: g.cwd },
      el('span', { class: 'caret' }, collapsed ? '▶' : '▼'),
      el('span', { class: 'project-name' }, basename(g.cwd)),
      el('button', { title: 'Nouvelle session dans ce projet', onclick: (e) => { e.stopPropagation(); openNew(g.cwd); } }, '+ Nouvelle'),
      el('button', { title: 'Reprendre la conversation la plus récente (--continue)', onclick: (e) => { e.stopPropagation(); openContinue(g.cwd); } }, '↻'),
      el('button', { title: "Ouvrir le dossier dans l'Explorateur", onclick: (e) => { e.stopPropagation(); api.openFolder(g.cwd); } }, '📂'),
    );
    head.addEventListener('click', () => {
      if (collapsedProjects.has(key)) collapsedProjects.delete(key); else collapsedProjects.add(key);
      localStorage.setItem('collapsed', JSON.stringify([...collapsedProjects]));
      renderProjects();
    });

    const list = el('div', { class: 'sessions' });
    for (const s of g.items.slice(0, 12)) {
      list.append(el('div', {
        class: 'session' + (openIds.has(s.id) ? ' open' : ''),
        title: (s.lastPrompt ? `Dernier message : ${s.lastPrompt}\n` : '') + `ID : ${s.id}`,
        onclick: () => openResume(s),
      },
        el('div', { class: 'session-title' }, s.title),
        el('div', { class: 'session-meta' }, timeAgo(s.mtime) + (openIds.has(s.id) ? ' · ouverte' : '')),
        openIds.has(s.id) ? null : el('button', {
          class: 'session-delete',
          title: 'Supprimer cette conversation (envoyée à la Corbeille)',
          onclick: (e) => { e.stopPropagation(); deleteSession(s); },
        }, '🗑'),
      ));
    }
    project.append(head, el('div', { class: 'project-path' }, g.cwd), list);
    container.append(project);
  }
}

async function deleteSession(s) {
  if (!confirm(`Supprimer la conversation « ${s.title} » ?

` +
               'Elle sera envoyée à la Corbeille de Windows et disparaîtra aussi de Claude Code ' +
               '(claude --resume) et de Claude Desktop.')) return;
  const res = await api.deleteSession(s.id);
  if (res && res.error) return toast(res.error, 6000);
  sessions = sessions.filter((x) => x.id !== s.id);
  renderProjects();
  toast('Conversation envoyée à la Corbeille.');
}

// ------------------------------------------------------------------ onglets & terminaux

function findTabBySession(id) {
  for (const [tabId, t] of tabs) if (t.sessionId === id && !t.ended) return tabId;
  return null;
}

function openResume(s) {
  const existing = findTabBySession(s.id);
  if (existing) return activate(existing);
  // Session modifiée il y a moins de 2 minutes : elle tourne sans doute ailleurs
  // (Claude Desktop ou un autre terminal). La reprendre créerait une deuxième copie
  // qui travaillerait en parallèle sur les mêmes fichiers.
  if (Date.now() - s.mtime < 120000 &&
      !confirm('Cette session semble encore active ailleurs (Claude Desktop ou un autre terminal).\n' +
               'La reprendre ici lancera une deuxième copie en parallèle. Continuer ?')) return;
  openTab({ cwd: s.cwd, mode: 'resume', title: s.title, sessionId: s.id });
}
function openNew(cwd) { openTab({ cwd, mode: 'new', title: basename(cwd) + ' (nouvelle)' }); }
function openContinue(cwd) { openTab({ cwd, mode: 'continue', title: basename(cwd) }); }

async function openTab({ cwd, mode, title, sessionId = null }) {
  const wrap = el('div', { class: 'term-wrap' });
  $('#terminals').append(wrap);
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    fontSize: 14,
    cursorBlink: true,
    scrollback: 8000,
    allowProposedApi: true,
    windowsPty: { backend: 'conpty', buildNumber: cfg.windowsBuild || 22000 },
    theme: {
      background: '#15110c', foreground: '#eadfc8', cursor: '#e6b54a', cursorAccent: '#15110c',
      selectionBackground: '#5c4a26',
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(wrap);
  wrap.classList.add('active');
  fit.fit();

  const res = await api.spawn({ cwd, mode, sessionId, cols: term.cols, rows: term.rows });
  if (res.error) {
    term.dispose();
    wrap.remove();
    toast(res.error, 8000);
    syncEmpty();
    return;
  }
  const tabId = res.tabId;
  const tabEl = el('div', { class: 'tab', title: cwd },
    el('span', { class: 'dot' }),
    el('span', { class: 'label' }, title),
    el('button', { class: 'close', title: 'Fermer cet onglet (arrête Claude dans cet onglet)', onclick: (e) => { e.stopPropagation(); closeTab(tabId); } }, '✕'),
  );
  tabEl.addEventListener('click', () => activate(tabId));
  $('#tabs').append(tabEl);

  const t = { term, fit, wrap, tabEl, title, cwd, sessionId, state: 'idle', unread: false, ended: false };
  tabs.set(tabId, t);

  term.onData((data) => { if (!t.ended) api.write(tabId, data); });
  term.onResize(({ cols, rows }) => api.resize(tabId, cols, rows));
  setupClipboard(term, tabId);
  activate(tabId);
  renderProjects();
}

function setupClipboard(term, tabId) {
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;
    const k = ev.key.toLowerCase();
    // Ctrl+V : coller du texte (Alt+V reste disponible dans Claude pour coller une image).
    if (ev.ctrlKey && !ev.altKey && k === 'v') {
      ev.preventDefault();
      api.readClipboard().then((text) => { if (text) term.paste(text); });
      return false;
    }
    // Ctrl+C avec une sélection : copier (sans sélection, Ctrl+C est transmis à Claude).
    if (ev.ctrlKey && !ev.altKey && k === 'c' && term.hasSelection()) {
      ev.preventDefault();
      api.writeClipboard(term.getSelection());
      term.clearSelection();
      return false;
    }
    return true;
  });
  // Clic droit : copier la sélection, sinon coller (comme Windows Terminal).
  term.element.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (term.hasSelection()) {
      api.writeClipboard(term.getSelection());
      term.clearSelection();
    } else {
      api.readClipboard().then((text) => { if (text) term.paste(text); });
    }
  });
}

function activate(tabId) {
  const t = tabs.get(tabId);
  if (!t) return;
  activeTab = tabId;
  for (const [id, x] of tabs) {
    x.wrap.classList.toggle('active', id === tabId);
    x.tabEl.classList.toggle('active', id === tabId);
  }
  t.unread = false;
  t.tabEl.classList.remove('unread');
  syncEmpty();
  requestAnimationFrame(() => {
    try { t.fit.fit(); } catch { /* terminal masqué */ }
    t.term.focus();
  });
}

function closeTab(tabId) {
  const t = tabs.get(tabId);
  if (!t) return;
  if (!t.ended) api.kill(tabId);
  t.term.dispose();
  t.wrap.remove();
  t.tabEl.remove();
  tabs.delete(tabId);
  if (activeTab === tabId) {
    const next = [...tabs.keys()].pop();
    activeTab = null;
    if (next !== undefined) activate(next);
  }
  syncEmpty();
  renderProjects();
}

function syncEmpty() {
  $('#empty').style.display = tabs.size ? 'none' : 'flex';
}

function setDot(t, state) {
  const dot = t.tabEl.querySelector('.dot');
  dot.className = 'dot ' + state;
  const labels = {
    working: 'Claude travaille…', waiting: 'Claude attend votre réponse',
    attention: 'Claude demande une autorisation', ended: 'Session terminée', idle: '',
  };
  dot.title = labels[state] || '';
}

// ------------------------------------------------------------------ événements du processus principal

api.on('pty:data', ({ tabId, data }) => {
  const t = tabs.get(tabId);
  if (t) t.term.write(data);
});

api.on('pty:exit', ({ tabId, exitCode }) => {
  const t = tabs.get(tabId);
  if (!t) return;
  t.ended = true;
  setDot(t, 'ended');
  t.term.write(`\r\n\x1b[38;5;180m[Session terminée (code ${exitCode}). Fermez l'onglet ou reprenez la session depuis la liste.]\x1b[0m\r\n`);
  refreshSessions();
});

api.on('tab:state', ({ tabId, state, sound, sessionId }) => {
  const t = tabs.get(tabId);
  if (!t) return;
  t.state = state;
  if (sessionId && !t.sessionId) {
    t.sessionId = sessionId;
    renderProjects();
  }
  setDot(t, state);

  if (!sound) return;
  const watching = document.hasFocus() && activeTab === tabId;
  if (!watching) {
    t.unread = true;
    t.tabEl.classList.add('unread');
  }
  // Pas de son si l'utilisateur regarde déjà cet onglet dans l'overlay.
  if (cfg.sound && !watching) window.playSignal(sound, cfg.volume);
  if (state === 'waiting') refreshSessions();
});

api.on('overlay:shown', () => {
  if (activeTab !== null) activate(activeTab);
  refreshSessions();
});

api.on('app:warning', (msg) => toast(msg, 8000));

// ------------------------------------------------------------------ barre de titre & actions

function applyConfig() {
  $('#opacity').value = Math.round(cfg.opacity * 100);
  $('#btn-sound').classList.toggle('off', !cfg.sound);
  $('#btn-sound').textContent = cfg.sound ? '🔔' : '🔕';
  const wowOnly = cfg.overlayMode === 'wow';
  $('#btn-wow-only').classList.toggle('on', wowOnly);
  $('#btn-wow-only').classList.toggle('off', !wowOnly);
  $('#btn-wow-only').title = wowOnly
    ? "Au-dessus de World of Warcraft, passe derrière les autres applications (cliquer pour rester au-dessus de tout)"
    : 'Toujours au-dessus de toutes les fenêtres (cliquer pour passer derrière les autres applications)';
  const hk = cfg.hotkey.replace('Control', 'Ctrl');
  $('#hotkey-hint').textContent = `(${hk} pour afficher/masquer)`;
  $('#hotkey-empty').textContent = hk;
  $('#projects-dir').textContent = cfg.projectsDir;
  document.body.classList.toggle('sidebar-collapsed', !!cfg.sidebarCollapsed);
}

async function updateConfig(patch) {
  const r = await api.setConfig(patch);
  if (r.error) toast(r.error);
  cfg = { ...cfg, ...r.config };
  applyConfig();
}

$('#opacity').addEventListener('input', (e) => updateConfig({ opacity: e.target.value / 100 }));
$('#btn-wow-only').addEventListener('click', async () => {
  await updateConfig({ overlayMode: cfg.overlayMode === 'wow' ? 'always' : 'wow' });
  toast(cfg.overlayMode === 'wow'
    ? "L'overlay reste au-dessus du jeu et passe derrière Discord, le navigateur, etc."
    : "L'overlay reste au-dessus de toutes les fenêtres.");
});
$('#btn-sound').addEventListener('click', () => updateConfig({ sound: !cfg.sound }));
$('#btn-test-sound').addEventListener('click', () => {
  window.playSignal('done', cfg.volume);
  setTimeout(() => window.playSignal('attention', cfg.volume), 1200);
});
$('#btn-hide').addEventListener('click', () => api.hide());
$('#btn-quit').addEventListener('click', () => {
  const running = [...tabs.values()].filter((t) => !t.ended).length;
  if (running && !confirm(`${running} session(s) Claude en cours seront arrêtées. Quitter ?`)) return;
  api.quit();
});
$('#btn-sidebar').addEventListener('click', async () => {
  await updateConfig({ sidebarCollapsed: !cfg.sidebarCollapsed });
  if (activeTab !== null) activate(activeTab);
});
$('#btn-refresh').addEventListener('click', refreshSessions);
$('#filter').addEventListener('input', renderProjects);

$('#btn-open-folder').addEventListener('click', async () => {
  const dir = await api.pickFolder();
  if (dir) openNew(dir);
});

$('#btn-new-project').addEventListener('click', () => {
  $('#new-name').value = '';
  $('#dlg-new').showModal();
});
$('#dlg-new').addEventListener('close', async () => {
  if ($('#dlg-new').returnValue !== 'ok') return;
  const r = await api.createProject($('#new-name').value);
  if (r.error) return toast(r.error);
  openNew(r.dir);
});

new ResizeObserver(() => {
  const t = tabs.get(activeTab);
  if (t) { try { t.fit.fit(); } catch { /* ignoré */ } }
}).observe($('#terminals'));

// ------------------------------------------------------------------ démarrage

(async function init() {
  cfg = await api.getConfig();
  applyConfig();
  syncEmpty();
  if (!cfg.claude) {
    toast("Claude Code (CLI) introuvable : installez-le avant d'ouvrir une session (voir README).", 10000);
  }
  refreshSessions();
})();
