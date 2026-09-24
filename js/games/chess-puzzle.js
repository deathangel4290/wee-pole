'use strict';

/*
 * Daily chess puzzle: mate in 2, the same position for everyone on a given day.
 * Any move that still forces mate counts (not just the "book" line); the bot
 * defends with its best reply.
 */
BB.registerDaily({
  kind: 'puzzle',
  name: 'Chess Puzzle',
  icon: '♟️',
  blurb: 'Mate in 2',
  summary: (e) => (e.done ? `Solved${e.tries === 1 ? ' first try' : ` in ${e.tries} tries`}` : e.tries ? `${e.tries} tries so far` : null),

  mount(stage, api, opts) {
    const { el } = BB;
    const E = ChessEngine;
    const MATE_IN = 2;
    const index = BB.dayNumber(opts.daily.date) % CHESS_PUZZLES.length;
    const start = E.fromFEN(CHESS_PUZZLES[index]);
    const attacker = start.turn;
    const colourName = attacker === 'w' ? 'White' : 'Black';

    let state;
    let legal;
    let selected;
    let lastMove;
    let movesLeft;
    let line; // SAN of the moves played in this attempt
    let locked; // waiting on the bot, or the attempt is over
    let timer = null;

    const view = BB.chessView(tap);
    const lineEl = el('div', { class: 'puzzle-line', 'aria-live': 'polite' });
    const entry = () => BB.dailyEntry(opts.daily.date).puzzle || { tries: 0, done: false };

    function render(animate = false) {
      view.render({ state, selected, legal, lastMove, flip: attacker === 'b', animate: animate ? lastMove : null });
      lineEl.textContent = line.join('  ');
    }

    function reset() {
      clearTimeout(timer);
      state = start;
      legal = E.legalMoves(state);
      selected = -1;
      lastMove = null;
      movesLeft = MATE_IN;
      line = [];
      locked = false;
      render();
      api.status(entry().done
        ? `Solved ✅ — replay it, or come back tomorrow for a new one. ${colourName} to move.`
        : `Puzzle #${index + 1} · ${colourName} to move and mate in ${MATE_IN}`);
    }

    function tap(sq) {
      if (locked || state.turn !== attacker) return;
      if (selected >= 0) {
        const options = legal.filter((m) => m.from === selected && m.to === sq);
        if (options.length === 1) { attempt(options[0]); return; }
        if (options.length > 1) { view.promote(state.turn, options, attempt); return; }
      }
      const p = state.board[sq];
      selected = p && E.colorOf(p) === state.turn && sq !== selected ? sq : -1;
      render();
    }

    function attempt(m) {
      line.push(E.san(state, m, legal));
      state = m.next;
      lastMove = m;
      selected = -1;
      legal = E.legalMoves(state);
      render(true);

      const mated = !legal.length && E.inCheck(state);
      if (mated) { solved(); return; }

      if (movesLeft > 1 && E.defenderLoses(state, movesLeft)) {
        // Correct so far: the bot picks its most stubborn defence.
        movesLeft--;
        locked = true;
        api.status('Good move. Bot is defending…');
        timer = setTimeout(() => {
          const reply = E.bestMove(state, { depth: 3, timeMs: 800 });
          const played = legal.find((x) => x.from === reply.from && x.to === reply.to && x.promo === reply.promo);
          line.push(E.san(state, played, legal));
          state = played.next;
          lastMove = played;
          legal = E.legalMoves(state);
          locked = false;
          render(true);
          api.status(`Now finish it — mate in ${movesLeft}.`);
        }, BB.animMs(750) || 200);
        return;
      }

      // Wrong: explain briefly, then reset for another try.
      locked = true;
      const noMateNow = movesLeft === 1;
      if (!entry().done) api.daily((e) => { e.tries++; });
      api.status(noMateNow
        ? E.inCheck(state) ? 'Check — but they can escape. Try again.' : 'That’s not mate. Try again.'
        : 'That lets them off the hook. Try again.');
      timer = setTimeout(reset, 1300);
    }

    function solved() {
      locked = true;
      const first = !entry().done;
      if (first) {
        api.daily((e) => {
          e.tries++;
          e.done = true;
        });
      }
      const tries = entry().tries;
      api.status(first
        ? `Checkmate! Solved ${tries === 1 ? 'on the first try 🎯' : `in ${tries} tries`}.`
        : 'Checkmate! ✅');
      api.toast(first ? 'Daily puzzle solved ✅' : 'Solved again 👌');
    }

    function reveal() {
      // Highlight the first move of a solution.
      const sol = E.matingMoves(start, MATE_IN)[0];
      reset();
      selected = sol.from;
      render();
      api.status(`Hint: move the piece on ${E.nameOf(sol.from)}.`);
    }

    api.toolbar.append(
      el('button', { class: 'btn', type: 'button', onclick: reset }, '↺ Reset'),
      el('button', { class: 'btn', type: 'button', onclick: reveal }, '💡 Hint'),
    );
    stage.append(view.el, lineEl);
    reset();

    return () => {
      clearTimeout(timer);
      view.destroy();
    };
  },
});
