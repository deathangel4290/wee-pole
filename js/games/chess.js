'use strict';

(() => {
  const E = ChessEngine;
  const { el } = BB;
  const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const pieceName = (p) => PIECE[p.toLowerCase()];
  const clampCp = (sc) => Math.max(-2000, Math.min(2000, sc)); // mate scores count as ±20 pawns
  const isMate = (sc) => Math.abs(sc) >= E.MATE - 200;

  /** Rates a move from the scores of every legal move (best first). */
  function rate(scores, move) {
    const best = scores[0];
    const played = scores.find((x) => x.move.from === move.from && x.move.to === move.to && x.move.promo === move.promo) || best;
    const loss = Math.max(0, clampCp(best.score) - clampCp(played.score));
    let kind;
    if (isMate(best.score) && best.score > 0 && !(isMate(played.score) && played.score > 0)) kind = 'missed';
    else if (loss <= 15) kind = scores.length > 1 && played === best ? 'best' : 'good';
    else if (loss <= 60) kind = 'good';
    else if (loss <= 150) kind = 'inaccuracy';
    else if (loss <= 350) kind = 'mistake';
    else kind = 'blunder';
    return { kind, loss, best, played };
  }

  /** One sentence on why a move was worse than the engine's choice. */
  function explain(state, r) {
    const bestSan = E.san(state, r.best.move);
    if (r.kind === 'missed') return `You had a forced checkmate starting with ${bestSan}!`;
    const replies = E.scoreMoves(r.played.move.next, 2, 300);
    const reply = replies[0];
    if (reply) {
      const replySan = E.san(r.played.move.next, reply.move);
      if (isMate(reply.score) && reply.score > 0) return `It allowed a forced mate: ${replySan}. ${bestSan} was needed.`;
      if (reply.move.captured && reply.move.captured.toLowerCase() !== 'p') {
        return `After this, they can take your ${pieceName(reply.move.captured)} (${replySan}). ${bestSan} kept things safe.`;
      }
    }
    if (r.best.move.captured) return `${bestSan} would have won a ${pieceName(r.best.move.captured)}.`;
    if (E.inCheck(r.best.move.next)) return `${bestSan}, a strong check, was better.`;
    return `${bestSan} was stronger.`;
  }

  /** Opens the review sheet and analyses `side`'s moves (null = both sides). */
  function openReview(history, side, flip, hintsUsed) {
    const sheet = BB.review.open({ title: 'Chess review' });
    const rows = history.map((h, i) => ({ ...h, index: i })).filter((h) => !side || h.state.turn === side);
    const results = [];
    let i = 0;
    const step = () => {
      if (!sheet.open) return;
      if (i < rows.length) {
        // One position per tick keeps the page responsive while analysing.
        const h = rows[i++];
        const r = rate(E.scoreMoves(h.state, 3, 500), h.move);
        results.push({ h, r });
        sheet.progress(i / rows.length);
        setTimeout(step, 0);
        return;
      }
      finish();
    };
    const finish = () => {
      const count = (k) => results.filter((x) => x.r.kind === k).length;
      const accuracy = results.length
        ? Math.round(results.reduce((a, x) => a + Math.max(0, 100 - x.r.loss / 3), 0) / results.length)
        : 100;
      const bad = results
        .filter((x) => ['missed', 'blunder', 'mistake', 'inaccuracy'].includes(x.r.kind))
        .sort((a, b) => b.r.loss - a.r.loss)
        .slice(0, 8)
        .sort((a, b) => a.h.index - b.h.index);
      const items = bad.map(({ h, r }) => {
        const n = Math.floor(h.index / 2) + 1;
        return {
          kind: r.kind,
          title: `${n}${h.state.turn === 'w' ? '.' : '…'} ${h.san}: better was ${E.san(h.state, r.best.move)}`,
          detail: explain(h.state, r),
          show: () => {
            const v = BB.chessView(() => {});
            v.render({ state: h.state, lastMove: h.move, flip, hint: { from: r.best.move.from, to: r.best.move.to } });
            return el('div', null, v.el, el('p', { class: 'fineprint' }, 'Yellow: your move · Pulsing green: the better move'));
          },
        };
      });
      const hanging = bad.filter((x) => /take your/.test(explain(x.h.state, x.r))).length;
      let coach;
      if (!results.length) coach = 'Play a few moves and I’ll have something to say!';
      else if (count('blunder') + count('missed') === 0 && count('mistake') === 0) coach = `Really clean game: ${accuracy}% accuracy with no big mistakes. Try a harder level? 💪`;
      else if (hanging >= 2) coach = 'The big theme: pieces left unprotected. Before every move, ask “what can they capture?”';
      else if (count('missed')) coach = 'You had a checkmate you didn’t spot. Always look for checks first!';
      else coach = `Your turning point was move ${Math.floor(bad[0].h.index / 2) + 1}. Tap it to see the better idea.`;
      sheet.update({
        coach,
        stats: [
          ['Accuracy', `${accuracy}%`],
          ['Best moves', count('best')],
          ['Mistakes', count('mistake') + count('inaccuracy')],
          ['Blunders', count('blunder') + count('missed')],
          ...(hintsUsed ? [['Hints used', hintsUsed]] : []),
        ],
        items,
      });
    };
    setTimeout(step, 50);
  }

  BB.register({
    id: 'chess',
    name: 'Chess',
    icon: '♟️',
    tagline: 'The classic. Checkmate the bot.',

    mount(stage, api, opts = {}) {
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
      const BOT_THINK_MS = 700; // the bot never answers faster than this, so you see your move land

      const net = BB.onlineGame(opts.online, api); // online: White is seat 0
      let mode = net ? 'online' : 'medium'; // 'easy' | 'medium' | 'hard' | '2p' | 'online'
      let side = net && net.seat === 1 ? 'b' : 'w'; // the human's colour vs the bot / online
      let state;
      let history; // [{ state, san, move }] — state *before* each move
      let seen; // position key -> count
      let legal;
      let selected = -1;
      let lastMove = null;
      let hint = null;
      let hintsUsed = 0;
      let over = false;
      let busy = false;
      let game = 0;
      let botTimer = null;
      let rateTimer = null;

      const seatOf = (colour) => (colour === 'w' ? 0 : 1);
      const vsBot = () => !net && mode !== '2p';
      const humanTurn = () => !over && !busy && (net ? net.myTurn(seatOf(state.turn)) : mode === '2p' || state.turn === side);
      const flipped = () => mode !== '2p' && side === 'b';

      const view = BB.chessView(tap);
      const moveList = el('ol', { class: 'move-list', 'aria-label': 'Moves' });
      const undoBtn = el('button', { class: 'btn', type: 'button', onclick: undo }, '↶ Undo');

      function render(animate = false) {
        view.render({ state, selected, legal, lastMove, flip: flipped(), animate: animate ? lastMove : null, hint });
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
        if (net) api.status(`${net.turnText(seatOf(state.turn))}${check} · you’re ${colourName(side)}`);
        else if (mode === '2p') api.status(`${colourName(state.turn)} to move${check}`);
        else if (state.turn === side) api.status(`Your move${check}`);
        else api.status('Bot is thinking…');
      }

      function tap(sq) {
        if (!humanTurn()) return;
        if (selected >= 0) {
          const options = legal.filter((m) => m.from === selected && m.to === sq);
          if (options.length === 1) { playLocal(options[0]); return; }
          if (options.length > 1) { view.promote(state.turn, options, playLocal); return; }
        }
        const p = state.board[sq];
        selected = p && E.colorOf(p) === state.turn && sq !== selected ? sq : -1;
        render();
      }

      let winnerSeat;

      function playLocal(m) {
        const before = state;
        play(m);
        if (net) net.send({ f: m.from, t: m.to, p: m.promo || undefined }, over ? winnerSeat : undefined);
        // Pip rates your move (against the bot) once the piece has landed.
        if (vsBot() && !over) {
          clearTimeout(rateTimer);
          rateTimer = setTimeout(() => {
            const r = rate(E.scoreMoves(before, 2, 250), m);
            if (r.kind === 'missed') api.coach('blunder', `Ooh, you had checkmate there: ${E.san(before, r.best.move)}!`);
            else if (r.kind === 'blunder') api.coach('blunder');
            else if (r.kind === 'mistake') api.coach('mistake');
            else if (r.kind === 'best') api.coach('best');
          }, 40);
        }
      }

      // Apply a move from the match history or from the opponent.
      function applyNet(mv) {
        if (over) return;
        const m = legal.find((x) => x.from === mv.f && x.to === mv.t && (x.promo || undefined) === (mv.p || undefined));
        if (m) play(m);
      }

      function play(m) {
        const san = E.san(state, m, legal);
        history.push({ state, san, move: m });
        state = m.next;
        const k = E.key(state);
        seen.set(k, (seen.get(k) || 0) + 1);
        legal = E.legalMoves(state);
        selected = -1;
        hint = null;
        lastMove = m;
        render(true);
        const res = E.result(state, seen);
        if (res) {
          over = true;
          finish(res);
          return;
        }
        if (vsBot() && state.turn !== side) botTurn();
        else updateStatus();
      }

      function botTurn(delay = 60) {
        busy = true;
        undoBtn.disabled = true;
        updateStatus();
        const g = game;
        const started = Date.now();
        // A short delay lets the browser paint before the (blocking) search runs.
        botTimer = setTimeout(() => {
          if (g !== game) return;
          const bm = E.bestMove(state, BOTS[mode]);
          const m = legal.find((x) => x.from === bm.from && x.to === bm.to && x.promo === bm.promo);
          const wait = Math.max(0, (BB.animMs(BOT_THINK_MS) || 150) - (Date.now() - started));
          botTimer = setTimeout(() => {
            if (g !== game) return;
            busy = false;
            play(m);
          }, wait);
        }, delay);
      }

      function finish(res) {
        api.review(() => openReview(history, net ? side : vsBot() ? side : null, flipped(), hintsUsed));
        if (net) {
          winnerSeat = res === 'checkmate' ? seatOf(state.turn === 'w' ? 'b' : 'w') : null;
          api.status(`${res === 'checkmate' ? 'Checkmate' : RESULT_TEXT[res]} — ${net.finish(winnerSeat)}`);
          return;
        }
        if (res === 'checkmate') {
          const winner = state.turn === 'w' ? 'b' : 'w'; // the side that just moved
          if (mode === '2p') {
            api.status(`Checkmate — ${colourName(winner)} wins!`);
            api.record('done');
          } else if (winner === side) {
            api.status('Checkmate — you win! 🎉');
            api.record('win', { score: Math.ceil(history.length / 2), bestKey: mode, lowerIsBetter: true, level: mode });
          } else {
            api.status('Checkmate — bot wins. Tap 📋 Review to see what happened.');
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
        api.review(null);
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
        hint = null;
        lastMove = history.length ? history[history.length - 1].move : null;
        render();
        updateStatus();
        // If the human is Black and everything was undone, the bot opens again.
        if (vsBot() && state.turn !== side) botTurn(300);
      }

      function showHint() {
        if (!humanTurn()) {
          api.toast('Wait for your turn');
          return false;
        }
        const best = E.scoreMoves(state, 3, 1200)[0];
        if (!best) return false;
        hint = { from: best.move.from, to: best.move.to };
        selected = best.move.from;
        hintsUsed++;
        render();
        return `I like ${E.san(state, best.move)} here.`;
      }

      function reset() {
        game++;
        clearTimeout(botTimer);
        clearTimeout(rateTimer);
        state = E.initial();
        history = [];
        seen = new Map([[E.key(state), 1]]);
        legal = E.legalMoves(state);
        selected = -1;
        lastMove = null;
        hint = null;
        hintsUsed = 0;
        over = false;
        busy = false;
        sideSeg.hidden = mode === '2p';
        api.review(null);
        render();
        updateStatus();
        if (vsBot() && side === 'b') botTurn(300);
      }

      const sideSeg = BB.segmented([['w', '♔ White'], ['b', '♚ Black']], side, (s) => { side = s; reset(); });
      if (!net) {
        api.toolbar.append(
          BB.segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['2p', '2P']], mode, (m) => { mode = m; reset(); }),
          sideSeg,
          undoBtn,
          el('button', { class: 'btn', type: 'button', onclick: reset }, 'New game'),
        );
        api.hint(showHint);
      }
      stage.append(view.el, moveList);
      reset();
      if (net) {
        net.start(applyNet);
        render();
        if (!over) updateStatus();
      }

      return () => {
        clearTimeout(botTimer);
        clearTimeout(rateTimer);
        view.destroy();
      };
    },
  });
})();
