'use strict';

BB.register({
  id: '2048',
  name: '2048',
  icon: '🔢',
  tagline: 'Swipe. Merge. Reach 2048.',

  mount(stage, api) {
    const { el } = BB;
    const N = 4;

    let grid;
    let score;
    let won;
    let over;

    const scoreEl = el('strong', null, '0');
    const bestEl = el('strong', null, '0');
    const board = el('div', { class: 'g2048', 'aria-label': '2048 board' });
    const cells = Array.from({ length: N * N }, () => el('div', { class: 'g2048-cell' }));
    board.append(...cells);

    function emptyCells() {
      const out = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) out.push([r, c]);
      return out;
    }

    function spawn() {
      const empty = emptyCells();
      if (!empty.length) return null;
      const [r, c] = empty[Math.floor(Math.random() * empty.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
      return r * N + c;
    }

    // Coordinates of each line, ordered in the direction tiles slide towards.
    function lines(dir) {
      const out = [];
      for (let i = 0; i < N; i++) {
        const line = [];
        for (let j = 0; j < N; j++) {
          if (dir === 'left') line.push([i, j]);
          else if (dir === 'right') line.push([i, N - 1 - j]);
          else if (dir === 'up') line.push([j, i]);
          else line.push([N - 1 - j, i]);
        }
        out.push(line);
      }
      return out;
    }

    function canMove() {
      if (emptyCells().length) return true;
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (c + 1 < N && grid[r][c] === grid[r][c + 1]) return true;
          if (r + 1 < N && grid[r][c] === grid[r + 1][c]) return true;
        }
      }
      return false;
    }

    function move(dir) {
      if (over) return;
      let moved = false;
      const merged = new Set();
      for (const line of lines(dir)) {
        const vals = line.map(([r, c]) => grid[r][c]).filter(Boolean);
        const out = [];
        const mergedAt = [];
        for (let k = 0; k < vals.length; k++) {
          if (k + 1 < vals.length && vals[k] === vals[k + 1]) {
            const v = vals[k] * 2;
            score += v;
            if (v === 2048 && !won) {
              won = true;
              api.toast('2048! 🎉 Keep going for a high score');
            }
            mergedAt.push(out.length);
            out.push(v);
            k++;
          } else out.push(vals[k]);
        }
        line.forEach(([r, c], idx) => {
          const v = out[idx] || 0;
          if (grid[r][c] !== v) moved = true;
          grid[r][c] = v;
        });
        for (const idx of mergedAt) {
          const [r, c] = line[idx];
          merged.add(r * N + c);
        }
      }
      if (!moved) return;
      const fresh = spawn();
      render(fresh, merged);
      if (!canMove()) {
        over = true;
        api.status(`Game over — score ${score}`);
        api.record(won ? 'win' : 'done', { score });
        bestEl.textContent = api.best() ?? score;
      }
    }

    function render(fresh = null, merged = new Set()) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const i = r * N + c;
          const v = grid[r][c];
          const cell = cells[i];
          cell.textContent = v || '';
          cell.className = 'g2048-cell';
          if (v) cell.classList.add(`t${Math.min(v, 4096)}`);
          if (v >= 1024) cell.classList.add('small');
          if (i === fresh) cell.classList.add('new');
          if (merged.has(i)) cell.classList.add('merged');
        }
      }
      scoreEl.textContent = score;
      if (!over) api.status(won ? 'Past 2048 — keep going!' : 'Swipe or use arrow keys');
    }

    function reset() {
      grid = Array.from({ length: N }, () => Array(N).fill(0));
      score = 0;
      won = false;
      over = false;
      spawn();
      spawn();
      bestEl.textContent = api.best() ?? 0;
      render();
    }

    api.toolbar.append(
      el('div', { class: 'scorebox' }, el('span', null, 'SCORE'), scoreEl),
      el('div', { class: 'scorebox' }, el('span', null, 'BEST'), bestEl),
      el('button', { class: 'btn', type: 'button', onclick: reset }, 'New game'),
    );
    stage.append(board);
    reset();

    const offSwipe = BB.onSwipe(board, move);
    const offKeys = BB.onArrowKeys(move);
    return () => { offSwipe(); offKeys(); };
  },
});
