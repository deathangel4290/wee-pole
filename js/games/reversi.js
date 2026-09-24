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
        cell.setAttribute('aria-label', `${'abcdefgh'[i % N]}${N - Math.floor(i / N)}`);
        const v = board[i];
        const disc = cell.firstChild;
        if (!v) {
          if (disc) disc.remove();
          continue;
        }
        const cls = `disc p${v}${flipped.includes(i) ? ' flip' : ''}${i === lastMove ? ' placed' : ''}`;
        if (disc) disc.className = cls;
        else cell.append(el('span', { class: cls }));
      }
      p1El.textContent = count(board, 1);
      p2El.textContent = count(board, 2);
    }

    const name = (p) => (mode === '2p' ? (p === 1 ? 'Orange' : 'Player 2') : p === 1 ? 'You' : 'Bot');

    function place(move) {
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
      busy = true;
      render();
      api.status('Bot is thinking…');
      const g = game;
      botTimer = setTimeout(() => {
        if (g !== game) return;
        const m = botMove();
        busy = false;
        place(m);
      }, 450);
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
      place({ i, flips });
    }

    function finish() {
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
      else if (b > a) { api.status(`Bot wins ${tally}.`); api.record('loss', { level: mode }); }
      else { api.status(`Draw, ${tally}.`); api.record('draw', { level: mode }); }
    }

    function reset() {
      game++;
      clearTimeout(botTimer);
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
    };
  },
});
