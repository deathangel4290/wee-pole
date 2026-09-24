'use strict';

BB.register({
  id: 'checkers',
  name: 'Checkers',
  icon: '🟠',
  tagline: 'Jump, chain, crown. Captures are forced.',

  mount(stage, api, opts = {}) {
    const { el } = BB;
    const N = 8;
    const DEPTH = { easy: 2, medium: 4, hard: 7 };
    const WIN = 1e6;
    const DRAW_PLIES = 80; // no capture or man move for this long = draw

    // Pieces: 0 empty, 1 orange man (moves up), 2 white man (moves down), 3 orange king, 4 white king.
    const owner = (v) => (v ? ((v - 1) % 2) + 1 : 0);
    const isKing = (v) => v > 2;
    const rc = (i) => [Math.floor(i / N), i % N];

    // Online: orange (seat 0) moves first; the white player sees the board flipped.
    const net = BB.onlineGame(opts.online, api);
    const flip = !!net && net.seat === 1;
    let mode = net ? 'online' : 'medium'; // 'easy' | 'medium' | 'hard' | '2p' | 'online'
    let board;
    let turn;
    let over;
    let busy;
    let quiet; // plies since the last capture or man move
    let legal; // legal move sequences for the side to move
    let selected = -1;
    let prefix = []; // squares already stepped through during a multi-jump
    let lastPath = [];
    let hint = null; // suggested move, pulsing
    let hintsUsed = 0;
    let history = []; // [{ board, player, move, legal }] for the review
    let game = 0;
    let botTimer = null;
    let rateTimer = null;
    const HOP_MS = 210;
    const BOT_THINK_MS = 650;
    const sqName = (i) => 'abcdefgh'[i % N] + (N - Math.floor(i / N));

    function dirsFor(v) {
      if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      return owner(v) === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    }

    const promotes = (v, to) => !isKing(v) && Math.floor(to / N) === (owner(v) === 1 ? 0 : N - 1);

    // Every legal move for `p`, as { from, path: [landing squares], captures: [squares] }.
    function movesFor(b, p) {
      const jumps = [];
      const steps = [];
      for (let i = 0; i < N * N; i++) {
        const v = b[i];
        if (owner(v) !== p) continue;
        b[i] = 0; // the moving piece's start square counts as empty mid-jump
        collectJumps(b, i, v, i, [], [], jumps);
        b[i] = v;
        if (jumps.length) continue;
        const [r, c] = rc(i);
        for (const [dr, dc] of dirsFor(v)) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < N && cc >= 0 && cc < N && !b[rr * N + cc]) {
            steps.push({ from: i, path: [rr * N + cc], captures: [] });
          }
        }
      }
      return jumps.length ? jumps : steps;
    }

    function collectJumps(b, from, v, at, path, captures, out) {
      const [r, c] = rc(at);
      let extended = false;
      for (const [dr, dc] of dirsFor(v)) {
        const mr = r + dr;
        const mc = c + dc;
        const lr = r + 2 * dr;
        const lc = c + 2 * dc;
        if (lr < 0 || lr >= N || lc < 0 || lc >= N) continue;
        const mid = mr * N + mc;
        const land = lr * N + lc;
        if (owner(b[mid]) !== 3 - owner(v) || captures.includes(mid) || b[land]) continue;
        extended = true;
        const nextPath = [...path, land];
        const nextCaps = [...captures, mid];
        // A man that reaches the far row is crowned and its turn ends there.
        if (promotes(v, land)) out.push({ from, path: nextPath, captures: nextCaps });
        else collectJumps(b, from, v, land, nextPath, nextCaps, out);
      }
      if (!extended && path.length) out.push({ from, path, captures });
    }

    function apply(b, m) {
      const next = b.slice();
      const v = next[m.from];
      const to = m.path[m.path.length - 1];
      next[m.from] = 0;
      for (const cap of m.captures) next[cap] = 0;
      next[to] = promotes(v, to) ? v + 2 : v;
      return next;
    }

    function evaluate(b, p) {
      let score = 0;
      for (let i = 0; i < N * N; i++) {
        const v = b[i];
        if (!v) continue;
        const [r, c] = rc(i);
        let s;
        if (isKing(v)) s = 175 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) * 2;
        else {
          const advance = owner(v) === 1 ? N - 1 - r : r;
          s = 100 + advance * 4 + (c > 1 && c < 6 ? 3 : 0);
          if (advance === 0) s += 6; // keep the back row as a guard
        }
        score += owner(v) === p ? s : -s;
      }
      return score;
    }

    function negamax(b, depth, alpha, beta, p) {
      const moves = movesFor(b, p);
      if (!moves.length) return -WIN - depth;
      if (depth === 0) return evaluate(b, p);
      moves.sort((x, y) => y.captures.length - x.captures.length);
      let best = -Infinity;
      for (const m of moves) {
        const s = -negamax(apply(b, m), depth - 1, -beta, -alpha, 3 - p);
        if (s > best) best = s;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }

    function botMove() {
      const moves = movesFor(board, 2);
      if (mode === 'easy' && Math.random() < 0.3) return moves[Math.floor(Math.random() * moves.length)];
      let best = [];
      let bestScore = -Infinity;
      for (const m of moves) {
        const s = -negamax(apply(board, m), DEPTH[mode] - 1, -Infinity, Infinity, 1);
        if (s > bestScore) { bestScore = s; best = [m]; }
        else if (s === bestScore) best.push(m);
      }
      return best[Math.floor(Math.random() * best.length)];
    }

    /** Every legal move for `p` with a search score (best first), for hints, ratings and reviews. */
    function scoreAll(b, p, depth) {
      return movesFor(b, p)
        .map((m) => ({ move: m, score: Math.max(-2000, Math.min(2000, -negamax(apply(b, m), depth - 1, -Infinity, Infinity, 3 - p))) }))
        .sort((x, y) => y.score - x.score);
    }

    const sameMove = (a, b) => a.from === b.from && a.path.length === b.path.length && a.path.every((sq, k) => sq === b.path[k]);

    function rateMove(scores, m) {
      const best = scores[0];
      const played = scores.find((x) => sameMove(x.move, m)) || best;
      const loss = best.score - played.score;
      let kind;
      if (best.score >= 1000 && played.score < 1000) kind = 'missed';
      else if (loss <= 10) kind = scores.length > 1 && played === best ? 'best' : 'good';
      else if (loss <= 30) kind = 'good';
      else if (loss <= 70) kind = 'inaccuracy';
      else if (loss <= 150) kind = 'mistake';
      else kind = 'blunder';
      return { kind, loss, best, played };
    }

    // ----- UI -----

    const grid = BB.squareGrid(N, N, (r, c) => tap(flip ? (N - 1 - r) * N + (N - 1 - c) : r * N + c), 'checkers');
    const p1El = el('strong', null, '12');
    const p2El = el('strong', null, '12');
    const p1Label = el('span', null, 'YOU');
    const p2Label = el('span', null, 'BOT');

    const humanTurn = () => !over && !busy && (net ? net.myTurn(turn - 1) : mode === '2p' || turn === 1);
    const vsBot = () => !net && mode !== '2p';
    const cellOf = (i) => {
      const [r, c] = rc(i);
      return flip ? grid.at(N - 1 - r, N - 1 - c) : grid.at(r, c);
    };

    /** The piece now on `to` hops in through `stops`; `ghosts` ([square, value]) fade out as it jumps them. */
    function animateHops(stops, to, ghosts) {
      if (!BB.animMs(HOP_MS)) return;
      const piece = cellOf(to).querySelector('.man');
      BB.travel(piece, stops.map((sq) => BB.offset(cellOf(sq), cellOf(to))), HOP_MS * stops.length, 'ease-in-out');
      ghosts.forEach(([sq, v], k) => {
        const g = el('span', { class: `man ghost p${owner(v)}${isKing(v) ? ' king' : ''}` });
        cellOf(sq).append(g);
        g.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 1, offset: 0.5 }, { opacity: 0, transform: 'scale(0.3)' }],
          { duration: BB.animMs(HOP_MS * (k + 1.6)), easing: 'ease-in' }).finished.catch(() => {}).then(() => g.remove());
      });
    }
    const pending = () => legal.filter((m) => m.from === selected && prefix.every((sq, k) => m.path[k] === sq));

    // Board as it looks mid-multi-jump: the piece has moved along `prefix`, jumped pieces removed.
    function displayBoard() {
      if (selected < 0 || !prefix.length) return board;
      const m = pending()[0];
      return apply(board, { from: selected, path: prefix, captures: m.captures.slice(0, prefix.length) });
    }

    function render() {
      const b = displayBoard();
      const current = selected >= 0 && prefix.length ? prefix[prefix.length - 1] : selected;
      const targets = new Set();
      const movable = new Set();
      if (humanTurn()) {
        if (selected >= 0) for (const m of pending()) targets.add(m.path[prefix.length]);
        if (!prefix.length) for (const m of legal) movable.add(m.from);
      }
      let p1 = 0;
      let p2 = 0;
      for (let i = 0; i < N * N; i++) {
        const [r, c] = rc(i);
        const cell = flip ? grid.at(N - 1 - r, N - 1 - c) : grid.at(r, c);
        const v = b[i];
        if (owner(v) === 1) p1++;
        else if (owner(v) === 2) p2++;
        cell.classList.toggle('sel', i === current);
        cell.classList.toggle('target', targets.has(i));
        cell.classList.toggle('movable', movable.has(i) && i !== current);
        cell.classList.toggle('last', lastPath.includes(i));
        cell.classList.toggle('hinted', !!hint && (i === hint.from || i === hint.path[hint.path.length - 1]));
        cell.replaceChildren();
        if (v) cell.append(el('span', { class: `man p${owner(v)}${isKing(v) ? ' king' : ''}` }));
      }
      p1El.textContent = p1;
      p2El.textContent = p2;
    }

    const name = (p) => (mode === '2p' ? (p === 1 ? 'Orange' : 'Player 2') : p === 1 ? 'You' : 'Bot');

    function tap(i) {
      if (!humanTurn()) return;
      const b = displayBoard();
      // Continue or finish a move with the selected piece.
      if (selected >= 0) {
        const next = pending().filter((m) => m.path[prefix.length] === i);
        if (next.length) {
          const prev = prefix.length ? prefix[prefix.length - 1] : selected;
          const jumped = next[0].captures[prefix.length];
          const jumpedValue = jumped === undefined ? 0 : displayBoard()[jumped];
          prefix = [...prefix, i];
          const done = next.find((m) => m.path.length === prefix.length);
          if (!done) {
            // Mid multi-jump: show this hop, then wait for the next tap.
            render();
            animateHops([prev], i, jumped === undefined ? [] : [[jumped, jumpedValue]]);
          } else {
            const beforeBoard = board;
            const beforeLegal = legal;
            commit(done, prefix.length > 1 ? prev : undefined);
            if (net) net.send({ f: done.from, p: done.path }, over ? winnerSeat : undefined);
            if (vsBot()) rateLater(beforeBoard, beforeLegal, done);
          }
          return;
        }
        if (prefix.length) return; // mid-jump: must keep jumping with this piece
      }
      if (owner(b[i]) === turn) {
        if (legal.some((m) => m.from === i)) {
          selected = i;
          prefix = [];
        } else {
          selected = -1;
          if (legal[0].captures.length) api.toast('A capture is available — you must take it');
        }
        render();
      }
    }

    /**
     * Plays a complete move. `hopFrom` is set when the player already watched the
     * earlier hops of a multi-jump, so only the last hop animates.
     */
    function commit(m, hopFrom) {
      const before = board;
      const v = board[m.from];
      history.push({ board: before, player: turn, move: m, legal });
      quiet = m.captures.length || !isKing(v) ? 0 : quiet + 1;
      board = apply(board, m);
      lastPath = [m.from, ...m.path];
      selected = -1;
      prefix = [];
      hint = null;
      turn = 3 - turn;
      legal = movesFor(board, turn);
      render();
      const stops = hopFrom !== undefined ? [hopFrom] : [m.from, ...m.path.slice(0, -1)];
      const shownCaps = m.captures.length - (hopFrom !== undefined ? 1 : m.captures.length);
      animateHops(stops, m.path[m.path.length - 1], m.captures.slice(shownCaps).map((sq) => [sq, before[sq]]));
      if (!legal.length) {
        over = true;
        finish(3 - turn);
        return;
      }
      if (quiet >= DRAW_PLIES) {
        over = true;
        finish(0);
        return;
      }
      if (net) {
        api.status(onlineStatus());
        return;
      }
      if (mode !== '2p' && turn === 2) {
        busy = true;
        api.status('Bot is thinking…');
        const g = game;
        const started = Date.now();
        botTimer = setTimeout(() => {
          if (g !== game) return;
          const bm = botMove();
          const wait = Math.max(0, (BB.animMs(BOT_THINK_MS + HOP_MS * (m.path.length - 1)) || 150) - (Date.now() - started));
          botTimer = setTimeout(() => {
            if (g !== game) return;
            busy = false;
            commit(bm);
          }, wait);
        }, 40);
        return;
      }
      const must = legal[0].captures.length ? ' — capture!' : '';
      api.status(mode === '2p' ? `${name(turn)} to move${must}` : `Your move${must}`);
    }

    const onlineStatus = () => `${net.turnText(turn - 1)}${legal[0]?.captures.length ? ' — capture!' : ''} · you’re ${net.seat === 0 ? 'orange' : 'white'}`;
    let winnerSeat;

    // Apply a move from the match history or from the opponent.
    function applyNet(mv) {
      if (over) return;
      const m = legal.find((x) => x.from === mv.f && x.path.length === mv.p.length && x.path.every((sq, k) => sq === mv.p[k]));
      if (m) commit(m);
    }

    // Pip rates the move you just made (against the bot).
    function rateLater(b, movesBefore, m) {
      clearTimeout(rateTimer);
      rateTimer = setTimeout(() => {
        if (movesBefore.length < 2) return; // forced move: nothing to rate
        const r = rateMove(scoreAll(b, 1, 4), m);
        if (r.kind === 'missed') api.coach('blunder', 'Ooh, you had a winning line there. Check the review after!');
        else if (r.kind === 'blunder') api.coach('blunder');
        else if (r.kind === 'mistake') api.coach('mistake');
        else if (r.kind === 'best') api.coach('best');
      }, 60);
    }

    function showHint() {
      if (!humanTurn()) {
        api.toast('Wait for your turn');
        return false;
      }
      const best = scoreAll(board, turn, 6)[0];
      hint = best.move;
      selected = best.move.from;
      prefix = [];
      hintsUsed++;
      render();
      const hops = best.move.path.map(sqName).join(' → ');
      return best.move.captures.length > 1
        ? `Look for the ${best.move.captures.length}-piece jump: ${sqName(best.move.from)} → ${hops}!`
        : `Try ${sqName(best.move.from)} → ${hops}.`;
    }

    function miniBoard(b, played, better) {
      const g = BB.squareGrid(N, N, () => {}, 'checkers');
      for (let i = 0; i < N * N; i++) {
        const [r, c] = rc(i);
        const cell = g.at(r, c);
        if (b[i]) cell.append(el('span', { class: `man p${owner(b[i])}${isKing(b[i]) ? ' king' : ''}` }));
        cell.classList.toggle('last', i === played.from || played.path.includes(i));
        cell.classList.toggle('hinted', i === better.from || better.path.includes(i));
      }
      return el('div', null, g.el, el('p', { class: 'fineprint' }, 'Yellow: your move · Pulsing green: the better move'));
    }

    function openReview() {
      const sheet = BB.review.open({ title: 'Checkers review' });
      const me = net ? [net.seat + 1] : vsBot() ? [1] : [1, 2];
      const rows = history.filter((h) => me.includes(h.player) && h.legal.length > 1);
      const results = [];
      let i = 0;
      const step = () => {
        if (!sheet.open) return;
        if (i < rows.length) {
          const h = rows[i++];
          results.push({ h, r: rateMove(scoreAll(h.board, h.player, 6), h.move) });
          sheet.progress(i / rows.length);
          setTimeout(step, 0);
          return;
        }
        const count = (k) => results.filter((x) => x.r.kind === k).length;
        const accuracy = results.length ? Math.round(results.reduce((a, x) => a + Math.max(0, 100 - x.r.loss / 2), 0) / results.length) : 100;
        const bad = results.filter((x) => ['missed', 'blunder', 'mistake', 'inaccuracy'].includes(x.r.kind))
          .sort((a, b) => b.r.loss - a.r.loss).slice(0, 8).sort((a, b) => history.indexOf(a.h) - history.indexOf(b.h));
        let gaveJumps = 0;
        const items = bad.map(({ h, r }) => {
          const best = r.best.move;
          const after = apply(h.board, h.move);
          const reply = movesFor(after, 3 - h.player)[0];
          let detail;
          if (best.captures.length > h.move.captures.length) detail = `A bigger jump was there: ${best.captures.length} pieces, from ${sqName(best.from)}.`;
          else if (reply && reply.captures.length) {
            gaveJumps++;
            detail = `This left a piece open, and they could jump ${reply.captures.length} of yours. ${sqName(best.from)} → ${sqName(best.path[best.path.length - 1])} was safer.`;
          } else detail = `${sqName(best.from)} → ${best.path.map(sqName).join(' → ')} was stronger.`;
          const moveNo = Math.floor(history.indexOf(h) / 2) + 1;
          return {
            kind: r.kind,
            title: `Move ${moveNo}: ${sqName(h.move.from)} → ${sqName(h.move.path[h.move.path.length - 1])}`,
            detail,
            show: () => miniBoard(h.board, h.move, best),
          };
        });
        let coach;
        if (!results.length) coach = 'Not many choices that game. Most of your moves were forced captures!';
        else if (!bad.length) coach = `Great game: ${accuracy}% accuracy and no real mistakes! 🌟`;
        else if (gaveJumps >= 2) coach = 'Main lesson: before moving, check if your piece can be jumped. Keep them backed up!';
        else coach = `Your biggest swing was move ${Math.floor(history.indexOf(bad[0].h) / 2) + 1}. Tap it to see why.`;
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

    function finish(winner) {
      api.review(openReview);
      if (net) {
        winnerSeat = winner ? winner - 1 : null;
        api.status(net.finish(winnerSeat));
        return;
      }
      if (mode === '2p') {
        api.status(winner ? `${name(winner)} wins!` : 'Draw — no progress in 40 moves.');
        api.record('done');
      } else if (winner === 1) { api.status('You win! 🎉'); api.record('win', { level: mode }); }
      else if (winner === 2) { api.status('Bot wins. Tap 📋 Review to see what happened.'); api.record('loss', { level: mode }); }
      else { api.status('Draw — no progress in 40 moves.'); api.record('draw', { level: mode }); }
    }

    function reset() {
      game++;
      clearTimeout(botTimer);
      clearTimeout(rateTimer);
      history = [];
      hint = null;
      hintsUsed = 0;
      api.review(null);
      board = new Int8Array(N * N);
      for (let i = 0; i < N * N; i++) {
        const [r, c] = rc(i);
        if ((r + c) % 2 === 0) continue;
        if (r < 3) board[i] = 2;
        else if (r > 4) board[i] = 1;
      }
      turn = 1;
      over = false;
      busy = false;
      quiet = 0;
      selected = -1;
      prefix = [];
      lastPath = [];
      legal = movesFor(board, 1);
      if (net) {
        p1Label.textContent = net.seat === 0 ? 'YOU' : 'THEM';
        p2Label.textContent = net.seat === 1 ? 'YOU' : 'THEM';
      } else {
        p1Label.textContent = mode === '2p' ? 'ORANGE' : 'YOU';
        p2Label.textContent = mode === '2p' ? 'P2' : 'BOT';
      }
      render();
      api.status(net ? onlineStatus() : mode === '2p' ? 'Orange to move' : 'Your move — tap a piece');
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
      render(); // refresh move hints now that replay is over
    }

    return () => {
      clearTimeout(botTimer);
      clearTimeout(rateTimer);
    };
  },
});
