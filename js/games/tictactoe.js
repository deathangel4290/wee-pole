'use strict';

BB.register({
  id: 'tictactoe',
  name: 'Tic-Tac-Toe',
  icon: '❌',
  tagline: 'Three in a row. Beat the bot.',

  mount(stage, api) {
    const { el } = BB;
    const LINES = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];

    let mode = 'hard'; // 'easy' | 'hard' | '2p'
    let board;
    let turn;
    let over;
    let game = 0; // bumps on reset so pending bot moves from an old game are ignored
    let botTimer = null;

    function outcome(b) {
      for (const line of LINES) {
        const [a, c, d] = line;
        if (b[a] && b[a] === b[c] && b[a] === b[d]) return { winner: b[a], line };
      }
      return b.every(Boolean) ? { winner: null, line: null } : null;
    }

    // Minimax from O's (the bot's) point of view. Prefers faster wins.
    function minimax(b, player, depth) {
      const res = outcome(b);
      if (res) {
        if (res.winner === 'O') return 10 - depth;
        if (res.winner === 'X') return depth - 10;
        return 0;
      }
      let best = player === 'O' ? -Infinity : Infinity;
      for (let i = 0; i < 9; i++) {
        if (b[i]) continue;
        b[i] = player;
        const score = minimax(b, player === 'O' ? 'X' : 'O', depth + 1);
        b[i] = null;
        best = player === 'O' ? Math.max(best, score) : Math.min(best, score);
      }
      return best;
    }

    function botMove() {
      const empty = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      if (mode === 'easy' && Math.random() < 0.55) {
        return empty[Math.floor(Math.random() * empty.length)];
      }
      let bestScore = -Infinity;
      let moves = [];
      for (const i of empty) {
        board[i] = 'O';
        const s = minimax(board, 'X', 1);
        board[i] = null;
        if (s > bestScore) { bestScore = s; moves = [i]; }
        else if (s === bestScore) moves.push(i);
      }
      return moves[Math.floor(Math.random() * moves.length)];
    }

    const cells = Array.from({ length: 9 }, (_, i) =>
      el('button', { class: 'ttt-cell', type: 'button', 'aria-label': `Cell ${i + 1}`, onclick: () => humanMove(i) }));
    const grid = el('div', { class: 'ttt' }, cells);

    function render(winLine) {
      board.forEach((v, i) => {
        cells[i].textContent = v || '';
        cells[i].className = `ttt-cell${v ? ` mark-${v.toLowerCase()}` : ''}${winLine && winLine.includes(i) ? ' win' : ''}`;
        cells[i].disabled = over || !!v;
      });
    }

    function place(i) {
      board[i] = turn;
      const res = outcome(board);
      if (res) {
        over = true;
        render(res.line);
        finish(res.winner);
        return;
      }
      turn = turn === 'X' ? 'O' : 'X';
      render();
      if (mode === '2p') api.status(`${turn} to move`);
      else if (turn === 'O') {
        api.status('Bot is thinking…');
        const g = game;
        botTimer = setTimeout(() => { if (g === game) place(botMove()); }, 350);
      } else api.status('Your move (X)');
    }

    function humanMove(i) {
      if (over || board[i]) return;
      if (mode !== '2p' && turn !== 'X') return;
      place(i);
    }

    function finish(winner) {
      if (mode === '2p') {
        api.status(winner ? `${winner} wins!` : "It's a draw.");
        api.record('done');
        return;
      }
      if (winner === 'X') { api.status('You win! 🎉'); api.record('win', { level: mode }); }
      else if (winner === 'O') { api.status('Bot wins.'); api.record('loss', { level: mode }); }
      else { api.status("Draw. Nobody's surprised."); api.record('draw', { level: mode }); }
    }

    function reset() {
      game++;
      clearTimeout(botTimer);
      board = Array(9).fill(null);
      turn = 'X';
      over = false;
      render();
      api.status(mode === '2p' ? 'X to move' : 'Your move (X)');
    }

    api.toolbar.append(
      BB.segmented([['easy', 'Bot · Easy'], ['hard', 'Bot · Hard'], ['2p', '2 Players']], mode, (m) => { mode = m; reset(); }),
      el('button', { class: 'btn', type: 'button', onclick: reset }, 'New game'),
    );
    stage.append(grid);
    reset();

    return () => clearTimeout(botTimer);
  },
});
