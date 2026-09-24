'use strict';

BB.register({
  id: 'connect4',
  name: 'Connect 4',
  icon: '🔴',
  tagline: 'Drop discs. Line up four.',

  mount(stage, api) {
    const { el } = BB;
    const ROWS = 6;
    const COLS = 7;
    const ORDER = [3, 2, 4, 1, 5, 0, 6]; // search centre columns first
    const DEPTH = { easy: 2, medium: 4, hard: 7 };
    const WIN = 1e6;

    let mode = 'medium'; // 'easy' | 'medium' | 'hard' | '2p'
    let board; // board[r][c], r = 0 is the top row; 0 empty, 1 player one, 2 player two / bot
    let turn;
    let over;
    let busy;
    let game = 0;
    let botTimer = null;

    const freeRow = (b, c) => {
      for (let r = ROWS - 1; r >= 0; r--) if (!b[r][c]) return r;
      return -1;
    };

    // Returns the winning cells through (r, c), or null.
    function winLine(b, r, c) {
      const p = b[r][c];
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        const line = [[r, c]];
        for (const s of [1, -1]) {
          let rr = r + dr * s;
          let cc = c + dc * s;
          while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr][cc] === p) {
            line.push([rr, cc]);
            rr += dr * s;
            cc += dc * s;
          }
        }
        if (line.length >= 4) return line;
      }
      return null;
    }

    function scoreWindow(cells, p) {
      const o = 3 - p;
      let mine = 0;
      let theirs = 0;
      for (const v of cells) {
        if (v === p) mine++;
        else if (v === o) theirs++;
      }
      if (mine && theirs) return 0;
      if (mine === 3) return 50;
      if (mine === 2) return 6;
      if (theirs === 3) return -60;
      if (theirs === 2) return -6;
      return 0;
    }

    function evaluate(b, p) {
      let score = 0;
      for (let r = 0; r < ROWS; r++) {
        if (b[r][3] === p) score += 4;
        else if (b[r][3] === 3 - p) score -= 4;
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (c + 3 < COLS) score += scoreWindow([b[r][c], b[r][c + 1], b[r][c + 2], b[r][c + 3]], p);
          if (r + 3 < ROWS) score += scoreWindow([b[r][c], b[r + 1][c], b[r + 2][c], b[r + 3][c]], p);
          if (r + 3 < ROWS && c + 3 < COLS) score += scoreWindow([b[r][c], b[r + 1][c + 1], b[r + 2][c + 2], b[r + 3][c + 3]], p);
          if (r + 3 < ROWS && c - 3 >= 0) score += scoreWindow([b[r][c], b[r + 1][c - 1], b[r + 2][c - 2], b[r + 3][c - 3]], p);
        }
      }
      return score;
    }

    // Negamax with alpha-beta: score for player `p`, who is about to move.
    function negamax(b, depth, alpha, beta, p) {
      if (depth === 0) return evaluate(b, p);
      let best = -Infinity;
      let any = false;
      for (const c of ORDER) {
        const r = freeRow(b, c);
        if (r < 0) continue;
        any = true;
        b[r][c] = p;
        const score = winLine(b, r, c) ? WIN + depth : -negamax(b, depth - 1, -beta, -alpha, 3 - p);
        b[r][c] = 0;
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return any ? best : 0; // full board: draw
    }

    function botColumn() {
      const depth = DEPTH[mode];
      const scored = [];
      for (const c of ORDER) {
        const r = freeRow(board, c);
        if (r < 0) continue;
        board[r][c] = 2;
        const score = winLine(board, r, c) ? WIN + depth : -negamax(board, depth - 1, -Infinity, Infinity, 1);
        board[r][c] = 0;
        scored.push([c, score]);
      }
      if (mode === 'easy' && Math.random() < 0.35) return scored[Math.floor(Math.random() * scored.length)][0];
      const top = Math.max(...scored.map(([, s]) => s));
      const bests = scored.filter(([, s]) => s === top);
      return bests[Math.floor(Math.random() * bests.length)][0];
    }

    const cellEls = [];
    const grid = el('div', { class: 'c4', role: 'grid' });
    for (let r = 0; r < ROWS; r++) {
      cellEls.push([]);
      for (let c = 0; c < COLS; c++) {
        const cell = el('button', {
          class: 'c4-cell', type: 'button', 'aria-label': `Column ${c + 1}`,
          onclick: () => humanDrop(c),
        });
        cellEls[r].push(cell);
        grid.append(cell);
      }
    }

    function paint(r, c, animate) {
      const cell = cellEls[r][c];
      cell.replaceChildren();
      const v = board[r][c];
      if (!v) return;
      const disc = el('span', { class: `c4-disc p${v}${animate ? ' drop' : ''}` });
      disc.style.setProperty('--fall', r + 1);
      cell.append(disc);
    }

    const label = (p) => {
      if (mode === '2p') return p === 1 ? 'Player 1 (orange)' : 'Player 2';
      return p === 1 ? 'You' : 'Bot';
    };

    function drop(c) {
      const r = freeRow(board, c);
      if (r < 0) return false;
      board[r][c] = turn;
      paint(r, c, true);
      const line = winLine(board, r, c);
      if (line) {
        over = true;
        for (const [rr, cc] of line) cellEls[rr][cc].classList.add('win');
        finish(turn);
      } else if (board[0].every(Boolean)) {
        over = true;
        finish(0);
      } else {
        turn = 3 - turn;
        api.status(mode === '2p' ? `${label(turn)} to move` : turn === 1 ? 'Your move' : 'Bot is thinking…');
      }
      return true;
    }

    function humanDrop(c) {
      if (over || busy) return;
      if (mode !== '2p' && turn !== 1) return;
      if (!drop(c)) return;
      if (!over && mode !== '2p') {
        busy = true;
        const g = game;
        // Let the drop animation start before the (blocking) search runs.
        botTimer = setTimeout(() => {
          if (g !== game) return;
          drop(botColumn());
          busy = false;
        }, 420);
      }
    }

    function finish(winner) {
      if (mode === '2p') {
        api.status(winner ? `${label(winner)} wins!` : 'Board full — draw.');
        api.record('done');
      } else if (winner === 1) { api.status('You win! 🎉'); api.record('win', { level: mode }); }
      else if (winner === 2) { api.status('Bot wins.'); api.record('loss', { level: mode }); }
      else { api.status('Board full — draw.'); api.record('draw', { level: mode }); }
    }

    function reset() {
      game++;
      clearTimeout(botTimer);
      board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
      turn = 1;
      over = false;
      busy = false;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          cellEls[r][c].classList.remove('win');
          paint(r, c, false);
        }
      }
      api.status(mode === '2p' ? 'Player 1 (orange) to move' : 'Your move — tap a column');
    }

    api.toolbar.append(
      BB.segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['2p', '2P']], mode, (m) => { mode = m; reset(); }),
      el('button', { class: 'btn', type: 'button', onclick: reset }, 'New game'),
    );
    stage.append(grid);
    reset();

    return () => clearTimeout(botTimer);
  },
});
