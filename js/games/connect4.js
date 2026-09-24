'use strict';

BB.register({
  id: 'connect4',
  name: 'Connect 4',
  icon: '🔴',
  tagline: 'Drop discs. Line up four.',

  mount(stage, api, opts = {}) {
    const { el } = BB;
    const ROWS = 6;
    const COLS = 7;
    const ORDER = [3, 2, 4, 1, 5, 0, 6]; // search centre columns first
    const DEPTH = { easy: 2, medium: 4, hard: 7 };
    const WIN = 1e6;

    const net = BB.onlineGame(opts.online, api); // online match: player 1 is seat 0
    let mode = net ? 'online' : 'medium'; // 'easy' | 'medium' | 'hard' | '2p' | 'online'
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

    // ----- hints, ratings and review -----

    let history = []; // [{ board, player, col }]
    let hintCol = -1;
    let hintsUsed = 0;
    let rateTimer = null;
    const copy = (b) => b.map((row) => row.slice());

    /** Score of dropping in each column for player `p` (best first). Wins are ±1000. */
    function scoreCols(b0, p, depth) {
      const b = copy(b0);
      const out = [];
      for (const c of ORDER) {
        const r = freeRow(b, c);
        if (r < 0) continue;
        b[r][c] = p;
        let sc = winLine(b, r, c) ? WIN + depth : -negamax(b, depth - 1, -Infinity, Infinity, 3 - p);
        b[r][c] = 0;
        sc = Math.abs(sc) >= WIN / 2 ? Math.sign(sc) * 1000 : Math.max(-900, Math.min(900, sc));
        out.push({ col: c, score: sc });
      }
      return out.sort((x, y) => y.score - x.score);
    }

    // Columns where `p` would win right now.
    function winningCols(b0, p) {
      const b = copy(b0);
      const out = [];
      for (let c = 0; c < COLS; c++) {
        const r = freeRow(b, c);
        if (r < 0) continue;
        b[r][c] = p;
        if (winLine(b, r, c)) out.push(c);
        b[r][c] = 0;
      }
      return out;
    }

    function rateDrop(scores, col) {
      const best = scores[0];
      const played = scores.find((x) => x.col === col) || best;
      const loss = best.score - played.score;
      let kind;
      if (best.score === 1000 && played.score < 1000) kind = 'missed';
      else if (played.score === -1000 && best.score > -1000) kind = 'blunder';
      else if (loss <= 8) kind = scores.length > 1 && played === best ? 'best' : 'good';
      else if (loss <= 25) kind = 'good';
      else if (loss <= 60) kind = 'inaccuracy';
      else kind = 'mistake';
      return { kind, loss, best, played };
    }

    function explain(b, p, col, best) {
      const mine = winningCols(b, p);
      if (mine.length && !mine.includes(col)) return `You had a winning drop in column ${mine[0] + 1}!`;
      const theirs = winningCols(b, 3 - p);
      if (theirs.length && !theirs.includes(col)) return `They were threatening column ${theirs[0] + 1}. You needed to block it.`;
      const after = copy(b);
      const r = freeRow(after, col);
      after[r][col] = p;
      const opens = winningCols(after, 3 - p);
      if (opens.includes(col)) return `Dropping here let them play right on top and win in column ${col + 1}.`;
      if (opens.length) return `This let them win in column ${opens[0] + 1}.`;
      return `Column ${best.col + 1} was stronger.`;
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
      history.push({ board: copy(board), player: turn, col: c });
      setHint(-1);
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
        api.status(net ? onlineStatus() : mode === '2p' ? `${label(turn)} to move` : turn === 1 ? 'Your move' : 'Bot is thinking…');
      }
      return true;
    }

    const onlineStatus = () => `${net.turnText(turn - 1)} · you’re ${net.seat === 0 ? 'orange' : 'white'}`;
    let winnerSeat;

    function humanDrop(c) {
      if (over || busy) return;
      if (net) {
        if (!net.myTurn(turn - 1) || !drop(c)) return;
        net.send(c, over ? winnerSeat : undefined);
        return;
      }
      if (mode !== '2p' && turn !== 1) return;
      const before = copy(board);
      if (!drop(c)) return;
      if (mode !== '2p') rateLater(before, c);
      if (!over && mode !== '2p') {
        busy = true;
        const g = game;
        const started = Date.now();
        // Let the drop animation play before the (blocking) search runs.
        botTimer = setTimeout(() => {
          if (g !== game) return;
          const col = botColumn();
          botTimer = setTimeout(() => {
            if (g !== game) return;
            drop(col);
            busy = false;
          }, Math.max(0, (BB.animMs(750) || 150) - (Date.now() - started)));
        }, BB.animMs(380) || 30);
      }
    }

    function rateLater(b, col) {
      clearTimeout(rateTimer);
      rateTimer = setTimeout(() => {
        const scores = scoreCols(b, 1, 5);
        if (scores.length < 2) return;
        const r = rateDrop(scores, col);
        if (r.kind === 'missed') api.coach('blunder', `Ahh, column ${r.best.col + 1} would have won it!`);
        else if (r.kind === 'blunder') api.coach('blunder', explain(b, 1, col, r.best));
        else if (r.kind === 'mistake') api.coach('mistake');
        else if (r.kind === 'best') api.coach('best');
      }, 60);
    }

    function setHint(col) {
      hintCol = col;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cellEls[r][c].classList.remove('hinted');
      if (col < 0) return;
      const r = freeRow(board, col);
      if (r >= 0) cellEls[r][col].classList.add('hinted');
    }

    function showHint() {
      if (over || busy || (mode !== '2p' && turn !== 1)) {
        api.toast('Wait for your turn');
        return false;
      }
      const best = scoreCols(board, turn, 7)[0];
      setHint(best.col);
      hintsUsed++;
      if (winningCols(board, turn).includes(best.col)) return `Column ${best.col + 1} wins it! 🎯`;
      if (winningCols(board, 3 - turn).includes(best.col)) return `Block column ${best.col + 1}, they’re threatening it!`;
      return `I’d drop in column ${best.col + 1}.`;
    }

    function openReview() {
      const sheet = BB.review.open({ title: 'Connect 4 review' });
      const me = net ? [net.seat + 1] : mode === '2p' ? [1, 2] : [1];
      const rows = history.filter((h) => me.includes(h.player));
      const results = [];
      let i = 0;
      const step = () => {
        if (!sheet.open) return;
        if (i < rows.length) {
          const h = rows[i++];
          const scores = scoreCols(h.board, h.player, 7);
          if (scores.length > 1) results.push({ h, r: rateDrop(scores, h.col) });
          sheet.progress(i / rows.length);
          setTimeout(step, 0);
          return;
        }
        const count = (k) => results.filter((x) => x.r.kind === k).length;
        const accuracy = results.length ? Math.round(results.reduce((a, x) => a + Math.max(0, 100 - Math.min(100, x.r.loss)), 0) / results.length) : 100;
        const bad = results.filter((x) => ['missed', 'blunder', 'mistake', 'inaccuracy'].includes(x.r.kind))
          .sort((a, b) => b.r.loss - a.r.loss).slice(0, 8).sort((a, b) => history.indexOf(a.h) - history.indexOf(b.h));
        let missedBlocks = 0;
        const items = bad.map(({ h, r }) => {
          const detail = explain(h.board, h.player, h.col, r.best);
          if (/needed to block|let them/.test(detail)) missedBlocks++;
          return {
            kind: r.kind,
            title: `Move ${Math.floor(history.indexOf(h) / 2) + 1}: column ${h.col + 1} (better: ${r.best.col + 1})`,
            detail,
            show: () => {
              const g = el('div', { class: 'c4 mini' });
              const landing = (c) => freeRow(h.board, c);
              for (let rr = 0; rr < ROWS; rr++) {
                for (let cc = 0; cc < COLS; cc++) {
                  const cell = el('div', { class: 'c4-cell' });
                  if (h.board[rr][cc]) cell.append(el('span', { class: `c4-disc p${h.board[rr][cc]}` }));
                  if (cc === h.col && rr === landing(cc)) cell.classList.add('last');
                  if (cc === r.best.col && rr === landing(cc)) cell.classList.add('hinted');
                  g.append(cell);
                }
              }
              return el('div', null, g, el('p', { class: 'fineprint' }, 'Tinted: where you dropped · Pulsing green: the better drop'));
            },
          };
        });
        let coach;
        if (!bad.length) coach = `Flawless! ${accuracy}% accuracy. The hard bot is waiting for you… 😏`;
        else if (count('missed')) coach = 'You had a winning move you didn’t take. Always check your own threats first!';
        else if (missedBlocks >= 1) coach = 'Before every drop, ask: “can they win next move?” That habit wins games.';
        else coach = `The game turned on move ${Math.floor(history.indexOf(bad[0].h) / 2) + 1}. Tap it to see why.`;
        sheet.update({
          coach,
          stats: [
            ['Accuracy', `${accuracy}%`],
            ['Best drops', count('best')],
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
        api.status(winner ? `${label(winner)} wins!` : 'Board full — draw.');
        api.record('done');
      } else if (winner === 1) { api.status('You win! 🎉'); api.record('win', { level: mode }); }
      else if (winner === 2) { api.status('Bot wins. Tap 📋 Review for tips.'); api.record('loss', { level: mode }); }
      else { api.status('Board full — draw.'); api.record('draw', { level: mode }); }
    }

    function reset() {
      game++;
      clearTimeout(botTimer);
      clearTimeout(rateTimer);
      history = [];
      hintsUsed = 0;
      api.review(null);
      board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
      setHint(-1);
      turn = 1;
      over = false;
      busy = false;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          cellEls[r][c].classList.remove('win');
          paint(r, c, false);
        }
      }
      api.status(net ? onlineStatus() : mode === '2p' ? 'Player 1 (orange) to move' : 'Your move — tap a column');
    }

    if (!net) {
      api.toolbar.append(
        BB.segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['2p', '2P']], mode, (m) => { mode = m; reset(); }),
        el('button', { class: 'btn', type: 'button', onclick: reset }, 'New game'),
      );
      api.hint(showHint);
    }
    stage.append(grid);
    reset();
    if (net) net.start((c) => { if (!over) drop(c); });

    return () => {
      clearTimeout(botTimer);
      clearTimeout(rateTimer);
    };
  },
});
