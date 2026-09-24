'use strict';

BB.register({
  id: 'chess',
  name: 'Chess',
  icon: '♟️',
  tagline: 'The classic. Checkmate the bot.',

  mount(stage, api) {
    const { el } = BB;
    const E = ChessEngine;
    const BOTS = {
      easy: { depth: 2, timeMs: 800, randomness: 0.25 },
      medium: { depth: 3, timeMs: 1500, randomness: 0 },
      hard: { depth: 5, timeMs: 2000, randomness: 0 },
    };
    const RESULT_TEXT = {
      stalemate: 'Stalemate',
      fifty: 'Draw by the 50-move rule',
      insufficient: 'Draw — not enough material',
      repetition: 'Draw by threefold repetition',
    };

    let mode = 'medium'; // 'easy' | 'medium' | 'hard' | '2p'
    let side = 'w'; // human colour vs the bot
    let state;
    let history; // [{ state, san, move }] — state *before* each move
    let seen; // position key -> count
    let legal;
    let selected = -1;
    let lastMove = null;
    let over = false;
    let busy = false;
    let game = 0;
    let botTimer = null;

    const humanTurn = () => !over && !busy && (mode === '2p' || state.turn === side);

    const view = BB.chessView(tap);
    const moveList = el('ol', { class: 'move-list', 'aria-label': 'Moves' });
    const undoBtn = el('button', { class: 'btn', type: 'button', onclick: undo }, '↶ Undo');

    function render() {
      view.render({ state, selected, legal, lastMove, flip: mode !== '2p' && side === 'b' });
      moveList.replaceChildren();
      for (let i = 0; i < history.length; i += 2) {
        moveList.append(el('li', null,
          el('span', null, history[i].san),
          history[i + 1] ? el('span', null, history[i + 1].san) : null));
      }
      moveList.scrollTop = moveList.scrollHeight;
      undoBtn.disabled = busy || !history.length;
    }

    const colourName = (c) => (c === 'w' ? 'White' : 'Black');

    function updateStatus() {
      const check = E.inCheck(state) ? ' — check!' : '';
      if (mode === '2p') api.status(`${colourName(state.turn)} to move${check}`);
      else if (state.turn === side) api.status(`Your move${check}`);
      else api.status('Bot is thinking…');
    }

    function tap(sq) {
      if (!humanTurn()) return;
      if (selected >= 0) {
        const options = legal.filter((m) => m.from === selected && m.to === sq);
        if (options.length === 1) { play(options[0]); return; }
        if (options.length > 1) { view.promote(state.turn, options, play); return; }
      }
      const p = state.board[sq];
      selected = p && E.colorOf(p) === state.turn && sq !== selected ? sq : -1;
      render();
    }

    function play(m) {
      const san = E.san(state, m, legal);
      history.push({ state, san, move: m });
      state = m.next;
      const k = E.key(state);
      seen.set(k, (seen.get(k) || 0) + 1);
      legal = E.legalMoves(state);
      selected = -1;
      lastMove = m;
      const res = E.result(state, seen);
      if (res) {
        over = true;
        render();
        finish(res);
        return;
      }
      if (mode !== '2p' && state.turn !== side) {
        botTurn(80);
        return;
      }
      render();
      updateStatus();
    }

    function botTurn(delay) {
      busy = true;
      render();
      updateStatus();
      const g = game;
      // The delay lets the browser paint before the (blocking) search runs.
      botTimer = setTimeout(() => {
        if (g !== game) return;
        const bm = E.bestMove(state, BOTS[mode]);
        busy = false;
        play(legal.find((x) => x.from === bm.from && x.to === bm.to && x.promo === bm.promo));
      }, delay);
    }

    function finish(res) {
      if (res === 'checkmate') {
        const winner = state.turn === 'w' ? 'b' : 'w'; // the side that just moved
        if (mode === '2p') {
          api.status(`Checkmate — ${colourName(winner)} wins!`);
          api.record('done');
        } else if (winner === side) {
          api.status('Checkmate — you win! 🎉');
          api.record('win', { score: Math.ceil(history.length / 2), bestKey: mode, lowerIsBetter: true, level: mode });
        } else {
          api.status('Checkmate — bot wins.');
          api.record('loss', { level: mode });
        }
        return;
      }
      api.status(`${RESULT_TEXT[res]}.`);
      api.record(mode === '2p' ? 'done' : 'draw', { level: mode });
    }

    function undo() {
      if (busy || !history.length) return;
      over = false;
      const popOne = () => {
        const k = E.key(state);
        seen.set(k, seen.get(k) - 1);
        const h = history.pop();
        state = h.state;
      };
      popOne();
      // Against the bot, rewind to the human's turn.
      if (mode !== '2p') while (history.length && state.turn !== side) popOne();
      legal = E.legalMoves(state);
      selected = -1;
      lastMove = history.length ? history[history.length - 1].move : null;
      render();
      updateStatus();
      // If the human is Black and everything was undone, the bot opens again.
      if (mode !== '2p' && state.turn !== side) botTurn(300);
    }

    function reset() {
      game++;
      clearTimeout(botTimer);
      state = E.initial();
      history = [];
      seen = new Map([[E.key(state), 1]]);
      legal = E.legalMoves(state);
      selected = -1;
      lastMove = null;
      over = false;
      busy = false;
      sideSeg.hidden = mode === '2p';
      render();
      updateStatus();
      if (mode !== '2p' && side === 'b') botTurn(300);
    }

    const sideSeg = BB.segmented([['w', '♔ White'], ['b', '♚ Black']], side, (s) => { side = s; reset(); });
    api.toolbar.append(
      BB.segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['2p', '2P']], mode, (m) => { mode = m; reset(); }),
      sideSeg,
      undoBtn,
      el('button', { class: 'btn', type: 'button', onclick: reset }, 'New game'),
    );
    stage.append(view.el, moveList);
    reset();

    return () => {
      clearTimeout(botTimer);
      view.destroy();
    };
  },
});
