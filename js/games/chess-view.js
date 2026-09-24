'use strict';

/*
 * The chess board UI shared by Chess and the daily puzzle: renders a state,
 * maps taps to squares (handling a flipped board) and shows the promotion picker.
 */
BB.chessView = function chessView(onTap) {
  const { el } = BB;
  const E = ChessEngine;
  // Solid glyphs for both sides (coloured by CSS); ︎ keeps the pawn from turning into an emoji.
  const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟︎' };

  let flipped = false;
  let promoBox = null;
  const toSquare = (r, c) => (flipped ? (7 - r) * 8 + (7 - c) : r * 8 + c);
  const grid = BB.squareGrid(8, 8, (r, c) => onTap(toSquare(r, c)), 'chess');

  function render({ state, selected = -1, legal = [], lastMove = null, flip = false }) {
    flipped = flip;
    const targets = new Map();
    if (selected >= 0) for (const m of legal) if (m.from === selected) targets.set(m.to, m);
    const checkSq = E.inCheck(state) ? state.board.indexOf(state.turn === 'w' ? 'K' : 'k') : -1;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = toSquare(r, c);
        const cell = grid.at(r, c);
        const p = state.board[sq];
        cell.classList.toggle('sel', sq === selected);
        cell.classList.toggle('target', targets.has(sq) && !targets.get(sq).captured);
        cell.classList.toggle('capture', targets.has(sq) && !!targets.get(sq).captured);
        cell.classList.toggle('last', !!lastMove && (sq === lastMove.from || sq === lastMove.to));
        cell.classList.toggle('check', sq === checkSq);
        cell.dataset.file = r === 7 ? 'abcdefgh'[sq & 7] : '';
        cell.dataset.rank = c === 0 ? String(8 - (sq >> 3)) : '';
        cell.setAttribute('aria-label', `${E.nameOf(sq)}${p ? ` ${E.colorOf(p) === 'w' ? 'white' : 'black'} ${p.toUpperCase()}` : ''}`);
        cell.replaceChildren();
        if (p) cell.append(el('span', { class: `pc ${E.colorOf(p)}` }, GLYPH[p.toUpperCase()]));
      }
    }
  }

  /** Ask which piece to promote to; calls onPick(move) with the chosen option. */
  function promote(color, options, onPick) {
    const box = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Promote pawn' });
    const close = () => { box.remove(); promoBox = null; };
    promoBox = box;
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    box.append(el('div', { class: 'reel' },
      el('div', { class: 'reel-label' }, 'PROMOTE TO'),
      el('div', { class: 'promo-row' },
        options.map((m) => el('button', {
          class: 'promo-btn', type: 'button', 'aria-label': m.promo.toUpperCase(),
          onclick: () => { close(); onPick(m); },
        }, el('span', { class: `pc ${color}` }, GLYPH[m.promo.toUpperCase()])))),
    ));
    document.body.append(box);
  }

  function destroy() {
    if (promoBox) promoBox.remove();
  }

  return { el: grid.el, render, promote, destroy };
};
