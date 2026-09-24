'use strict';

BB.register({
  id: 'reversi',
  name: 'Reversi',
  icon: '⚫',
  tagline: 'Outflank. Flip. Take the board.',

  mount(stage, api, opts = {}) {
    const { el } = BB;
    const N = 8;
    const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    // Classic positional weights: corners are gold, squares next to them are poison.
    const ROW_W = [
      [100, -20, 10, 5, 5, 10, -20, 100],
      [-20, -50, -2, -2, -2, -2, -50, -20],
      [10, -2, -1, -1, -1, -1, -2, 10],
      [5, -2, -1, -1, -1, -1, -2, 5],
    ];
    const WEIGHT = [...ROW_W, ...[...ROW_W].reverse()].flat();
    const DEPTH = { medium: 2, hard: 4 };
    const WIN = 1e6;

    // Online: orange is seat 0. Passes are explicit 'pass' moves so turns strictly alternate.
    const net = BB.onlineGame(opts.online, api);
    let mode = net ? 'online' : 'medium'; // 'easy' | 'medium' | 'hard' | '2p' | 'online'
    let passTimer = null;
    let board; // Int8Array(64): 0 empty, 1 orange (moves first), 2 white / bot
    let turn;
    let over;
    let busy;
    let lastMove = -1;
    let game = 0;
    let botTimer = null;

    function flipsFor(b, i, p) {
      if (b[i]) return [];
      const o = 3 - p;
      const r0 = Math.floor(i / N);
      const c0 = i % N;
      const out = [];
      for (const [dr, dc] of DIRS) {
        let r = r0 + dr;
        let c = c0 + dc;
        const run = [];
        while (r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === o) {
          run.push(r * N + c);
          r += dr;
          c += dc;
        }
        if (run.length && r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === p) out.push(...run);
      }
      return out;
    }

    function movesFor(b, p) {
      const out = [];
      for (let i = 0; i < N * N; i++) {
        const flips = flipsFor(b, i, p);
        if (flips.length) out.push({ i, flips });
      }
      return out;
    }

    function play(b, move, p) {
      const next = b.slice();
      next[move.i] = p;
      for (const f of move.flips) next[f] = p;
      return next;
    }

    function count(b, p) {
      let n = 0;
      for (const v of b) if (v === p) n++;
      return n;
    }

    function evaluate(b, p, myMoves, theirMoves) {
      let score = 0;
      for (let i = 0; i < N * N; i++) {
        if (b[i] === p) score += WEIGHT[i];
        else if (b[i]) score -= WEIGHT[i];
      }
      return score + 8 * (myMoves - theirMoves);
    }

    // Negamax with alpha-beta. A side with no moves passes; two passes end the game.
    function negamax(b, depth, alpha, beta, p, passed) {
      const moves = movesFor(b, p);
      if (!moves.length) {
        if (passed) {
          const diff = count(b, p) - count(b, 3 - p);
          return diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0;
        }
        return -negamax(b, depth, -beta, -alpha, 3 - p, true);
      }
      if (depth === 0) return evaluate(b, p, moves.length, movesFor(b, 3 - p).length);
      moves.sort((a, m) => WEIGHT[m.i] - WEIGHT[a.i]);
      let best = -Infinity;
      for (const m of moves) {
        const score = -negamax(play(b, m, p), depth - 1, -beta, -alpha, 3 - p, false);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }

    function botMove() {
      const moves = movesFor(board, 2);
      if (mode === 'easy') {
        if (Math.random() < 0.5) return moves[Math.floor(Math.random() * moves.length)];
        return moves.reduce((a, m) => (m.flips.length > a.flips.length ? m : a));
      }
      const empties = count(board, 0);
      // Near the end, search to the finish line.
      const depth = mode === 'hard' && empties <= 9 ? empties : DEPTH[mode];
      let best = [];
      let bestScore = -Infinity;
      for (const m of moves) {
        const s = -negamax(play(board, m, 2), depth - 1, -Infinity, Infinity, 1, false);
        if (s > bestScore) { bestScore = s; best = [m]; }
        else if (s === bestScore) best.push(m);
      }
      return best[Math.floor(Math.random() * best.length)];
    }

    // ----- hints, ratings and review -----

    const CORNERS = [0, 7, 56, 63];
    const X_SQUARES = { 9: 0, 14: 7, 49: 56, 54: 63 }; // diagonal neighbours of each corner
    const sqName = (i) => `${'abcdefgh'[i % N]}${N - Math.floor(i / N)}`;
    const BOT_THINK_MS = 700;
    let history = []; // [{ board, player, move }]
    let hint = -1;
    let hintsUsed = 0;
    let rateTimer = null;

    function scoreAll(b, p, depth) {
      return movesFor(b, p)
        .map((m) => ({ move: m, score: Math.max(-600, Math.min(600, -negamax(play(b, m, p), depth - 1, -Infinity, Infinity, 3 - p, false))) }))
        .sort((x, y) => y.score - x.score);
    }

    function rateMove(scores, m) {
      const best = scores[0];
      const played = scores.find((x) => x.move.i === m.i) || best;
      const loss = best.score - played.score;
      const kind = loss <= 6 ? (scores.length > 1 && played === best ? 'best' : 'good')
        : loss <= 18 ? 'good' : loss <= 40 ? 'inaccuracy' : loss <= 80 ? 'mistake' : 'blunder';
      return { kind, loss, best, played };
    }

    /** Why a move was worse, in corner terms when possible. */
    function explain(b, p, m, best) {
      const after = play(b, m, p);
      const theirCorners = (bb) => movesFor(bb, 3 - p).filter((x) => CORNERS.includes(x.i)).map((x) => x.i);
      const opened = theirCorners(after).filter((c) => !theirCorners(b).includes(c));
      if (CORNERS.includes(best.i) && !CORNERS.includes(m.i)) return `You could have taken the corner at ${sqName(best.i)}! Corners can never be flipped.`;
      if (opened.length) return `This handed them the corner at ${sqName(opened[0])}. ${sqName(best.i)} was safer.`;
      if (X_SQUARES[m.i] !== undefined && !b[X_SQUARES[m.i]]) return `Squares diagonal to an empty corner are risky: they help the other side get it. ${sqName(best.i)} was better.`;
      return `${sqName(best.i)} was stronger. It leaves them fewer good replies.`;
    }

    const grid = BB.squareGrid(N, N, (r, c) => humanMove(r * N + c), 'reversi');
    const p1El = el('strong', null, '2');
    const p2El = el('strong', null, '2');
    const p1Label = el('span', null, 'YOU');
    const p2Label = el('span', null, 'BOT');

    function render(flipped = []) {
      const humanToMove = net ? net.myTurn(turn - 1) : mode === '2p' || turn === 1;
      const hints = !over && !busy && humanToMove ? new Set(movesFor(board, turn).map((m) => m.i)) : new Set();
      for (let i = 0; i < N * N; i++) {
        const cell = grid.at(Math.floor(i / N), i % N);
        cell.classList.toggle('hint', hints.has(i));
        cell.classList.toggle('last', i === lastMove);
        cell.classList.toggle('hinted', i === hint);
        cell.setAttribute('aria-label', `${'abcdefgh'[i % N]}${N - Math.floor(i / N)}`);
        const v = board[i];
        const disc = cell.firstChild;
        if (!v) {
          if (disc) disc.remove();
          continue;
        }
        const flipping = flipped.includes(i) && BB.animMs(1) > 0;
        const cls = `disc p${v}${flipping ? ' flip' : ''}${i === lastMove ? ' placed' : ''}`;
        let d = disc;
        if (d) d.className = cls;
        else cell.append((d = el('span', { class: cls })));
        if (flipping) {
          // Ripple: discs further from the one just placed flip a little later.
          const dist = Math.max(Math.abs(Math.floor(i / N) - Math.floor(lastMove / N)), Math.abs((i % N) - (lastMove % N)));
          d.style.animationDelay = `${BB.animMs(70 * (dist - 1))}ms`;
          d.style.animationDuration = `${BB.animMs(360)}ms`;
        } else d.style.animationDelay = '';
      }
      p1El.textContent = count(board, 1);
      p2El.textContent = count(board, 2);
    }

    const name = (p) => (mode === '2p' ? (p === 1 ? 'Orange' : 'Player 2') : p === 1 ? 'You' : 'Bot');

    function place(move) {
      history.push({ board, player: turn, move });
      hint = -1;
      board = play(board, move, turn);
      lastMove = move.i;
      const flipped = move.flips;
      const next = 3 - turn;
      if (net) {
        if (!movesFor(board, next).length && !movesFor(board, turn).length) {
          over = true;
          render(flipped);
          finish();
          return;
        }
        turn = next; // even if they must pass: they send an explicit 'pass'
        render(flipped);
        api.status(onlineStatus());
        return;
      }
      if (movesFor(board, next).length) {
        turn = next;
      } else if (movesFor(board, turn).length) {
        api.toast(`${name(next)} ${mode !== '2p' && next === 1 ? 'have' : 'has'} no moves — pass`);
      } else {
        over = true;
        render(flipped);
        finish();
        return;
      }
      render(flipped);
      if (mode !== '2p' && turn === 2) queueBot();
      else api.status(mode === '2p' ? `${name(turn)} to move` : 'Your move');
    }

    function queueBot() {
      busy = true; // (no re-render here: it would cut the flip animation short)
      api.status('Bot is thinking…');
      const g = game;
      const started = Date.now();
      const flipTime = 70 * Math.min(6, history.length ? history[history.length - 1].move.flips.length : 0);
      botTimer = setTimeout(() => {
        if (g !== game) return;
        const m = botMove();
        const wait = Math.max(0, (BB.animMs(BOT_THINK_MS + flipTime) || 150) - (Date.now() - started));
        botTimer = setTimeout(() => {
          if (g !== game) return;
          busy = false;
          place(m);
        }, wait);
      }, 40);
    }

    function rateLater(b, m) {
      clearTimeout(rateTimer);
      rateTimer = setTimeout(() => {
        const scores = scoreAll(b, 1, 3);
        if (scores.length < 2) return;
        const r = rateMove(scores, m);
        if (CORNERS.includes(m.i)) api.coach('best', 'Corner secured! 🏰 Nobody can flip that.');
        else if (r.kind === 'blunder' || r.kind === 'mistake') {
          const why = explain(b, 1, m, r.best.move);
          api.coach(r.kind, /handed them the corner/.test(why) ? 'Careful, that opens a corner for them!' : undefined);
        } else if (r.kind === 'best') api.coach('best');
      }, 60);
    }

    function showHint() {
      if (over || busy || (mode !== '2p' && turn !== 1)) {
        api.toast('Wait for your turn');
        return false;
      }
      const empties = count(board, 0);
      const best = scoreAll(board, turn, empties <= 8 ? empties : 5)[0];
      if (!best) return false;
      hint = best.move.i;
      hintsUsed++;
      render();
      return CORNERS.includes(hint) ? `Take the corner at ${sqName(hint)}!` : `I’d play ${sqName(hint)}.`;
    }

    function openReview() {
      const sheet = BB.review.open({ title: 'Reversi review' });
      const me = net ? [net.seat + 1] : mode === '2p' ? [1, 2] : [1];
      const rows = history.filter((h) => me.includes(h.player) && movesFor(h.board, h.player).length > 1);
      const results = [];
      let i = 0;
      const step = () => {
        if (!sheet.open) return;
        if (i < rows.length) {
          const h = rows[i++];
          results.push({ h, r: rateMove(scoreAll(h.board, h.player, 4), h.move) });
          sheet.progress(i / rows.length);
          setTimeout(step, 0);
          return;
        }
        const count2 = (k) => results.filter((x) => x.r.kind === k).length;
        const accuracy = results.length ? Math.round(results.reduce((a, x) => a + Math.max(0, 100 - x.r.loss), 0) / results.length) : 100;
        const mine = me[0];
        const corners = CORNERS.filter((c) => board[c] === mine).length;
        const theirs = CORNERS.filter((c) => board[c] && board[c] !== mine).length;
        const bad = results.filter((x) => ['blunder', 'mistake', 'inaccuracy'].includes(x.r.kind))
          .sort((a, b) => b.r.loss - a.r.loss).slice(0, 8).sort((a, b) => history.indexOf(a.h) - history.indexOf(b.h));
        let cornerGifts = 0;
        const items = bad.map(({ h, r }) => {
          const detail = explain(h.board, h.player, h.move, r.best.move);
          if (/handed them the corner|diagonal to an empty corner/.test(detail)) cornerGifts++;
          return {
            kind: r.kind,
            title: `Move ${Math.floor(history.indexOf(h) / 2) + 1}: ${sqName(h.move.i)} (better: ${sqName(r.best.move.i)})`,
            detail,
            show: () => {
              const g = BB.squareGrid(N, N, () => {}, 'reversi');
              for (let k = 0; k < N * N; k++) {
                const cell = g.at(Math.floor(k / N), k % N);
                if (h.board[k]) cell.append(el('span', { class: `disc p${h.board[k]}` }));
                cell.classList.toggle('last', k === h.move.i);
                cell.classList.toggle('hinted', k === r.best.move.i);
              }
              return el('div', null, g.el, el('p', { class: 'fineprint' }, 'Tinted: your move · Pulsing green: the better move'));
            },
          };
        });
        let coach;
        if (!bad.length) coach = `Beautiful game: ${accuracy}% accuracy! 🌟`;
        else if (cornerGifts >= 2) coach = 'Corners decided this one. Avoid the squares next to an empty corner, and grab corners when you can!';
        else if (theirs > corners) coach = `They got ${theirs} corner${theirs > 1 ? 's' : ''} to your ${corners}. Corners are the key in Reversi.`;
        else coach = `Your turning point was move ${Math.floor(history.indexOf(bad[0].h) / 2) + 1}. Tap it to see the better square.`;
        sheet.update({
          coach,
          stats: [
            ['Accuracy', `${accuracy}%`],
            ['Your corners', `${corners}/4`],
            ['Mistakes', count2('mistake') + count2('inaccuracy')],
            ['Blunders', count2('blunder')],
            ...(hintsUsed ? [['Hints used', hintsUsed]] : []),
          ],
          items,
        });
      };
      setTimeout(step, 50);
    }

    const onlineStatus = () => `${net.turnText(turn - 1)} · you’re ${net.seat === 0 ? 'orange' : 'white'}`;
    let winnerSeat;

    // Apply a move from the match history or from the opponent.
    function applyNet(m) {
      if (over) return;
      if (m === 'pass') {
        turn = 3 - turn;
        render();
        api.status(onlineStatus());
      } else {
        const flips = flipsFor(board, m, turn);
        if (flips.length) place({ i: m, flips });
      }
      autoPass();
    }

    // With no legal move on our turn, pass automatically.
    function autoPass() {
      if (over || passTimer || !net.myTurn(turn - 1) || movesFor(board, turn).length) return;
      api.toast('You have no moves — passing');
      passTimer = setTimeout(() => {
        passTimer = null;
        if (over || !net.myTurn(turn - 1)) return;
        turn = 3 - turn;
        render();
        api.status(onlineStatus());
        net.send('pass');
      }, 900);
    }

    function humanMove(i) {
      if (over || busy) return;
      if (net) {
        if (!net.myTurn(turn - 1)) return;
        const flips = flipsFor(board, i, turn);
        if (!flips.length) return;
        place({ i, flips });
        net.send(i, over ? winnerSeat : undefined);
        return;
      }
      if (mode !== '2p' && turn !== 1) return;
      const flips = flipsFor(board, i, turn);
      if (!flips.length) return;
      const before = board;
      place({ i, flips });
      if (mode !== '2p') rateLater(before, { i, flips });
    }

    function finish() {
      api.review(openReview);
      const a = count(board, 1);
      const b = count(board, 2);
      const tally = `${a}–${b}`;
      if (net) {
        winnerSeat = a > b ? 0 : b > a ? 1 : null;
        api.status(`${net.finish(winnerSeat)} (${tally})`);
        return;
      }
      if (mode === '2p') {
        api.status(a === b ? `Draw, ${tally}.` : `${name(a > b ? 1 : 2)} wins ${tally}!`);
        api.record('done');
      } else if (a > b) { api.status(`You win ${tally}! 🎉`); api.record('win', { score: a - b, level: mode }); }
      else if (b > a) { api.status(`Bot wins ${tally}. Tap 📋 Review for tips.`); api.record('loss', { level: mode }); }
      else { api.status(`Draw, ${tally}.`); api.record('draw', { level: mode }); }
    }

    function reset() {
      game++;
      clearTimeout(botTimer);
      clearTimeout(rateTimer);
      history = [];
      hint = -1;
      hintsUsed = 0;
      api.review(null);
      board = new Int8Array(N * N);
      board[27] = 2; board[28] = 1; board[35] = 1; board[36] = 2;
      turn = 1;
      over = false;
      busy = false;
      lastMove = -1;
      if (net) {
        p1Label.textContent = net.seat === 0 ? 'YOU' : 'THEM';
        p2Label.textContent = net.seat === 1 ? 'YOU' : 'THEM';
      } else {
        p1Label.textContent = mode === '2p' ? 'ORANGE' : 'YOU';
        p2Label.textContent = mode === '2p' ? 'P2' : 'BOT';
      }
      render();
      api.status(net ? onlineStatus() : mode === '2p' ? 'Orange to move' : 'Your move — dots show legal squares');
    }

    api.toolbar.append(
      el('div', { class: 'scorebox p1' }, p1Label, p1El),
      el('div', { class: 'scorebox p2' }, p2Label, p2El),
    );
    if (!net) {
      api.toolbar.append(
        el('button', { class: 'btn', type: 'button', onclick: reset }, 'New game'),
        BB.segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['2p', '2P']], mode, (m) => { mode = m; reset(); }),
      );
      api.hint(showHint);
    }
    stage.append(grid.el);
    reset();
    if (net) {
      net.start(applyNet);
      render();
      autoPass(); // in case it was our pass when the app was last closed
    }

    return () => {
      clearTimeout(botTimer);
      clearTimeout(passTimer);
      clearTimeout(rateTimer);
    };
  },
});
