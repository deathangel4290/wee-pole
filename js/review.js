'use strict';

/*
 * The post-game review sheet shared by every game.
 *
 *   const sheet = BB.review.open({ title, loading: 'Analysing…' });
 *   sheet.update({
 *     summary: 'One-line verdict',
 *     stats: [['Accuracy', '82%'], ['Blunders', 1]],
 *     items: [{ kind: 'blunder', title: 'Move 12: Qxb7??', detail: 'It lost your queen…', show: () => node }],
 *   });
 *
 * kinds: best · good · inaccuracy · mistake · blunder · missed · tip · info
 */
BB.review = (() => {
  const { el } = BB;
  const BADGE = {
    best: ['★', 'Best'],
    good: ['✓', 'Good'],
    inaccuracy: ['?!', 'Inaccuracy'],
    mistake: ['?', 'Mistake'],
    blunder: ['??', 'Blunder'],
    missed: ['!', 'Missed chance'],
    tip: ['💡', 'Tip'],
    info: ['ℹ', 'Note'],
  };

  function open({ title = 'Game review', loading = 'Analysing your game…' } = {}) {
    const body = el('div', { class: 'sheet-body' },
      el('div', { class: 'online-empty' }, el('span', { class: 'dots', 'aria-hidden': 'true' }), loading));
    const progress = el('div', { class: 'sheet-progress' });
    const close = () => {
      box.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const box = el('div', { class: 'overlay sheet-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'sheet' },
        el('div', { class: 'sheet-head' },
          el('strong', null, `📋 ${title}`),
          el('button', { class: 'btn', type: 'button', onclick: close, 'aria-label': 'Close review' }, '✕')),
        progress,
        body));
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    document.addEventListener('keydown', onKey);
    document.body.append(box);

    function update({ summary, stats = [], items = [], coach }) {
      progress.remove();
      const rows = items.map((it) => {
        const [badge, label] = BADGE[it.kind] || BADGE.info;
        const head = el('span', { class: 'rv-head' },
          el('span', { class: `rv-badge ${it.kind}`, title: label }, badge),
          el('span', { class: 'rv-title' }, it.title));
        if (!it.detail && !it.show) return el('div', { class: 'rv-item' }, head);
        const extra = el('div', { class: 'rv-detail' }, it.detail ? el('p', null, it.detail) : null);
        const d = el('details', { class: 'rv-item' }, el('summary', null, head), extra);
        if (it.show) {
          // Build the mini board only when the item is opened.
          d.addEventListener('toggle', () => {
            if (d.open && !extra.querySelector('.rv-board')) extra.append(el('div', { class: 'rv-board' }, it.show()));
          });
        }
        return d;
      });
      body.replaceChildren(
        coach ? el('div', { class: 'rv-coach' }, el('span', { class: 'pip happy mini', 'aria-hidden': 'true' }, el('span', { class: 'pip-eyes' }, el('i'), el('i')), el('span', { class: 'pip-mouth' })), el('p', null, coach)) : '',
        summary ? el('p', { class: 'rv-summary' }, summary) : '',
        stats.length ? el('div', { class: 'rv-stats' }, stats.map(([k, v]) => el('div', null, el('strong', null, String(v)), el('span', null, k)))) : '',
        rows.length ? el('div', { class: 'rv-list' }, rows) : el('p', { class: 'muted' }, 'Nothing to flag. Clean game! ✨'),
      );
    }

    return {
      update,
      progress: (fraction) => { progress.style.setProperty('--p', `${Math.round(fraction * 100)}%`); },
      close,
      get open() { return box.isConnected; },
    };
  }

  return { open };
})();
