'use strict';

BB.register({
  id: 'tictactoe',
  name: 'Tic-Tac-Toe',
  icon: '❌',
  tagline: 'Three in a row. Beat the bot.',

  mount(stage, api, opts = {}) {
    const { el } = BB;
    const LINES = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];

    const net = BB.onlineGame(opts.online, api); // online match vs another player
    let mode = net ? 'online' : 'hard'; // 'easy' | 'hard' | '2p' | 'online'
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

    // ----- hints, ratings and review (exact: the game tree is tiny) -----

    const CELL = ['top-left', 'top', 'top-right', 'left', 'centre', 'right', 'bottom-left', 'bottom', 'bottom-right'];
    const other = (m) => (m === 'X' ? 'O' : 'X');
    let history = []; // [{ board, mark, cell }]
    let hint = -1;
    let hintsUsed = 0;

    /** Value of each empty cell for `mark` to move: +1 win, 0 draw, -1 loss (with perfect play). */
    function values(b0, mark) {
      const b = b0.slice();
      const out = [];
      for (let i = 0; i < 9; i++) {
        if (b[i]) continue;
        b[i] = mark;
        const sc = minimax(b, other(mark), 1); // O's point of view
        b[i] = null;
        out.push({ cell: i, value: Math.sign(mark === 'O' ? sc : -sc) });
      }
      return out.sort((x, y) => y.value - x.value);
    }

    // Cells where `mark` would complete a line right now.
    function winningCells(b, mark) {
      const out = [];
      for (const [a, c, d] of LINES) {
        const trio = [b[a], b[c], b[d]];
        if (trio.filter((v) => v === mark).length === 2 && trio.includes(null)) out.push([a, c, d][trio.indexOf(null)]);
      }
      return out;
    }

    function judge(b, mark, cell) {
      const vals = values(b, mark);
      const best = vals[0];
      const played = vals.find((v) => v.cell === cell);
      if (played.value === best.value) return { kind: vals.length > 1 && best.value > 0 ? 'best' : 'good', best, played };
      const wins = winningCells(b, mark);
      const threats = winningCells(b, other(mark));
      let detail;
      if (wins.length && !wins.includes(cell)) detail = `You could have won on the spot: ${CELL[wins[0]]}!`;
      else if (threats.length && !threats.includes(cell)) detail = `They had two in a row. You needed to block ${CELL[threats[0]]}.`;
      else if (best.value > played.value && best.value > 0) detail = `${CELL[best.cell]} set up a fork: two threats at once that can’t both be blocked.`;
      else detail = `This let them set up a fork. ${CELL[best.cell]} kept it a draw.`;
      return { kind: best.value > 0 ? 'missed' : 'blunder', best, played, detail };
    }

    const cells = Array.from({ length: 9 }, (_, i) =>
      el('button', { class: 'ttt-cell', type: 'button', 'aria-label': `Cell ${i + 1}`, onclick: () => humanMove(i) }));
    const svgNS = 'http://www.w3.org/2000/svg';
    const strike = document.createElementNS(svgNS, 'svg');
    strike.setAttribute('class', 'ttt-strike');
    strike.setAttribute('viewBox', '0 0 3 3');
    strike.setAttribute('aria-hidden', 'true');
    const grid = el('div', { class: 'ttt' }, cells, strike);

    function render(winLine) {
      board.forEach((v, i) => {
        cells[i].textContent = v || '';
        cells[i].className = `ttt-cell${v ? ` mark-${v.toLowerCase()}` : ''}${winLine && winLine.includes(i) ? ' win' : ''}${i === hint ? ' hinted' : ''}`;
        cells[i].disabled = over || !!v;
      });
      strike.replaceChildren();
      if (winLine) {
        // Draw a line through the winning three.
        const [a, , c] = winLine;
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', (a % 3) + 0.5);
        line.setAttribute('y1', Math.floor(a / 3) + 0.5);
        line.setAttribute('x2', (c % 3) + 0.5);
        line.setAttribute('y2', Math.floor(c / 3) + 0.5);
        line.setAttribute('pathLength', '1');
        line.style.animationDuration = `${BB.animMs(450)}ms`;
        strike.append(line);
      }
    }

    function showHint() {
      if (over || (mode !== '2p' && turn !== 'X')) {
        api.toast('Wait for your turn');
        return false;
      }
      const best = values(board, turn)[0];
      hint = best.cell;
      hintsUsed++;
      render();
      const wins = winningCells(board, turn);
      const threats = winningCells(board, other(turn));
      if (wins.includes(hint)) return `Win it: ${CELL[hint]}! 🎯`;
      if (threats.includes(hint)) return `Block them: ${CELL[hint]}!`;
      return `Try the ${CELL[hint]}.`;
    }

    function openReview() {
      const sheet = BB.review.open({ title: 'Tic-Tac-Toe review' });
      const me = net ? [net.seat === 0 ? 'X' : 'O'] : mode === '2p' ? ['X', 'O'] : ['X'];
      const rows = history.filter((h) => me.includes(h.mark) && h.board.filter((v) => !v).length > 1);
      const results = rows.map((h) => ({ h, r: judge(h.board, h.mark, h.cell) }));
      const bad = results.filter((x) => x.r.kind === 'missed' || x.r.kind === 'blunder');
      const items = bad.map(({ h, r }) => ({
        kind: r.kind,
        title: `${h.mark} on the ${CELL[h.cell]} (better: ${CELL[r.best.cell]})`,
        detail: r.detail,
        show: () => {
          const g = el('div', { class: 'ttt mini' });
          h.board.forEach((v, i) => g.append(el('div', {
            class: `ttt-cell${v ? ` mark-${v.toLowerCase()}` : ''}${i === h.cell ? ' last' : ''}${i === r.best.cell ? ' hinted' : ''}`,
          }, v || (i === h.cell ? h.mark : ''))));
          return el('div', null, g, el('p', { class: 'fineprint' }, 'Faded: your move · Pulsing green: the better square'));
        },
      }));
      const perfect = results.length - bad.length;
      sheet.update({
        coach: !bad.length
          ? 'Perfect play! Against a perfect bot a draw is the best anyone can do. 😎'
          : bad[0].r.kind === 'missed'
            ? 'You had a win in there! Look for forks: two threats at once.'
            : 'One slip decided it. Always check if they have two in a row!',
        stats: [['Perfect moves', `${perfect}/${results.length}`], ['Slips', bad.length], ...(hintsUsed ? [['Hints used', hintsUsed]] : [])],
        items,
      });
    }

    function place(i) {
      history.push({ board: board.slice(), mark: turn, cell: i });
      hint = -1;
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
      if (net) api.status(`${net.turnText(seatOf(turn))} (${turn})`);
      else if (mode === '2p') api.status(`${turn} to move`);
      else if (turn === 'O') {
        api.status('Bot is thinking…');
        const g = game;
        botTimer = setTimeout(() => { if (g === game) place(botMove()); }, 350);
      } else api.status('Your move (X)');
    }

    const seatOf = (mark) => (mark === 'X' ? 0 : 1);

    function humanMove(i) {
      if (over || board[i]) return;
      if (net) {
        if (!net.myTurn(seatOf(turn))) return;
        place(i);
        net.send(i, over ? winnerSeat : undefined);
        return;
      }
      if (mode !== '2p' && turn !== 'X') return;
      const before = board.slice();
      const mark = turn;
      place(i);
      if (mode !== '2p' && before.filter((v) => !v).length > 1) {
        const r = judge(before, mark, i);
        if (r.kind === 'missed') api.coach('blunder', `You had a win there: ${CELL[r.best.cell]}!`);
        else if (r.kind === 'blunder') api.coach('blunder', r.detail);
        else if (r.kind === 'best' && Math.random() < 0.5) api.coach('best');
      }
    }

    let winnerSeat;
    function finish(winner) {
      api.review(openReview);
      if (net) {
        winnerSeat = winner ? seatOf(winner) : null;
        api.status(net.finish(winnerSeat));
        return;
      }
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
      history = [];
      hint = -1;
      hintsUsed = 0;
      api.review(null);
      board = Array(9).fill(null);
      turn = 'X';
      over = false;
      render();
      if (net) api.status(`${net.turnText(0)} (X)`);
      else api.status(mode === '2p' ? 'X to move' : 'Your move (X)');
    }

    if (!net) {
      api.toolbar.append(
        BB.segmented([['easy', 'Bot · Easy'], ['hard', 'Bot · Hard'], ['2p', '2 Players']], mode, (m) => { mode = m; reset(); }),
        el('button', { class: 'btn', type: 'button', onclick: reset }, 'New game'),
      );
      api.hint(showHint);
    }
    stage.append(grid);
    reset();
    if (net) net.start((i) => { if (!over && !board[i]) place(i); });

    return () => clearTimeout(botTimer);
  },
});
