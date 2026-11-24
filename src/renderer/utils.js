// Fonctions utilitaires de l'interface (sans DOM), partagées entre la fenêtre,
// le bouton flottant et les tests unitaires (chargées via <script> ou require()).
(function (root) {
  function basename(p) {
    const s = String(p || '');
    return s.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s;
  }

  function timeAgo(ms, now = Date.now()) {
    const s = Math.round((now - ms) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    if (s < 86400 * 30) return `il y a ${Math.round(s / 86400)} j`;
    return new Date(ms).toLocaleDateString('fr-FR');
  }

  /** Regroupe les sessions par dossier de projet (insensible à la casse), avec filtre texte. */
  function groupSessions(sessions, filter = '') {
    const f = String(filter).trim().toLowerCase();
    const groups = new Map();
    for (const s of sessions) {
      const hay = `${s.cwd} ${s.title} ${s.lastPrompt || ''}`.toLowerCase();
      if (f && !hay.includes(f)) continue;
      const key = s.cwd.toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, cwd: s.cwd, items: [] });
      groups.get(key).items.push(s);
    }
    return [...groups.values()];
  }

  /** Texte et couleur du bouton flottant selon l'état des sessions. */
  function bubbleLabel({ working = 0, waiting = 0, attention = 0 } = {}) {
    if (attention) return { cls: 'attention', text: attention > 1 ? `${attention} autorisations demandées` : 'Autorisation demandée' };
    if (waiting) return { cls: 'waiting', text: waiting > 1 ? `${waiting} sessions vous attendent` : 'Claude vous attend' };
    if (working) return { cls: 'working', text: working > 1 ? `${working} sessions en cours…` : 'Claude travaille…' };
    return { cls: '', text: 'Claude' };
  }

  const api = { basename, timeAgo, groupSessions, bubbleLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ccUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
