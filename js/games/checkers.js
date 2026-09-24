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
    let game = 0;
    let botTimer = null;

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

    // ----- UI -----

    const grid = BB.squareGrid(N, N, (r, c) => tap(flip ? (N - 1 - r) * N + (N - 1 - c) : r * N + c), 'checkers');
    const p1El = el('strong', null, '12');
    const p2El = el('strong', null, '12');
    const p1Label = el('span', null, 'YOU');
    const p2Label = el('span', null, 'BOT');

    const humanTurn = () => !over && !busy && (net ? net.myTurn(turn - 1) : mode === '2p' || turn === 1);
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
          prefix = [...prefix, i];
          const done = next.find((m) => m.path.length === prefix.length);
          if (!done) render();
          else {
            commit(done);
            if (net) net.send({ f: done.from, p: done.path }, over ? winnerSeat : undefined);
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

    function commit(m) {
      const v = board[m.from];
      quiet = m.captures.length || !isKing(v) ? 0 : quiet + 1;
      board = apply(board, m);
      lastPath = [m.from, ...m.path];
      selected = -1;
      prefix = [];
      turn = 3 - turn;
      legal = movesFor(board, turn);
      if (!legal.length) {
        over = true;
        render();
        finish(3 - turn);
        return;
      }
      if (quiet >= DRAW_PLIES) {
        over = true;
        render();
        finish(0);
        return;
      }
      if (net) {
        render();
        api.status(onlineStatus());
        return;
      }
      if (mode !== '2p' && turn === 2) {
        busy = true;
        render();
        api.status('Bot is thinking…');
        const g = game;
        botTimer = setTimeout(() => {
          if (g !== game) return;
          const bm = botMove();
          busy = false;
          commit(bm);
        }, 450);
        return;
      }
      render();
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

    function finish(winner) {
      if (net) {
        winnerSeat = winner ? winner - 1 : null;
        api.status(net.finish(winnerSeat));
        return;
      }
      if (mode === '2p') {
        api.status(winner ? `${name(winner)} wins!` : 'Draw — no progress in 40 moves.');
        api.record('done');
      } else if (winner === 1) { api.status('You win! 🎉'); api.record('win', { level: mode }); }
      else if (winner === 2) { api.status('Bot wins.'); api.record('loss', { level: mode }); }
      else { api.status('Draw — no progress in 40 moves.'); api.record('draw', { level: mode }); }
    }

    function reset() {
      game++;
      clearTimeout(botTimer);
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
    }
    stage.append(grid.el);
    reset();
    if (net) {
      net.start(applyNet);
      render(); // refresh move hints now that replay is over
    }

    return () => clearTimeout(botTimer);
  },
});
