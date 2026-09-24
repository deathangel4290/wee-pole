'use strict';

BB.register({
  id: '2048',
  name: '2048',
  icon: '🔢',
  tagline: 'Swipe. Merge. Reach 2048.',

  mount(stage, api, opts = {}) {
    const { el } = BB;
    const N = 4;
    const daily = opts.daily; // same starting board and tile sequence for everyone today
    const DAILY_GOAL = 512;
    const SLIDE_MS = 120;
    const DIRS = ['up', 'down', 'left', 'right'];
    const ARROW = { up: '⬆️', down: '⬇️', left: '⬅️', right: '➡️' };

    let random = Math.random;
    let grid; // numbers, for the rules
    let tiles; // tile objects on screen: { v, r, c, el }
    let score;
    let won;
    let over;
    let pending = []; // visual steps waiting for the slide to finish
    let pendingTimer = null;
    let stats; // for the review
    let hintsUsed = 0;
    let milestone = 0;

    const scoreEl = el('strong', null, '0');
    const bestEl = el('strong', null, '0');
    const layer = el('div', { class: 'g2048-tiles' });
    const board = el('div', { class: 'g2048', 'aria-label': '2048 board' },
      Array.from({ length: N * N }, () => el('div', { class: 'g2048-cell' })), layer);

    // ----- rules (pure, also used by hints) -----

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

    /** Slides a number grid; returns { grid, moved, gain }. */
    function slide(g, dir) {
      const next = g.map((row) => row.slice());
      let moved = false;
      let gain = 0;
      for (const line of lines(dir)) {
        const vals = line.map(([r, c]) => g[r][c]).filter(Boolean);
        const out = [];
        for (let k = 0; k < vals.length; k++) {
          if (k + 1 < vals.length && vals[k] === vals[k + 1]) {
            out.push(vals[k] * 2);
            gain += vals[k] * 2;
            k++;
          } else out.push(vals[k]);
        }
        line.forEach(([r, c], idx) => {
          const v = out[idx] || 0;
          if (next[r][c] !== v) moved = true;
          next[r][c] = v;
        });
      }
      return { grid: next, moved, gain };
    }

    const empties = (g) => g.flat().filter((v) => !v).length;
    const canMove = (g) => DIRS.some((d) => slide(g, d).moved);
    const maxTile = (g) => Math.max(...g.flat());
    const inCorner = (g) => {
      const m = maxTile(g);
      return [g[0][0], g[0][N - 1], g[N - 1][0], g[N - 1][N - 1]].includes(m);
    };

    // Board quality for hints: space, a big tile in a corner, and smooth rows/columns.
    function heuristic(g) {
      let mono = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j + 1 < N; j++) {
          mono -= Math.abs(Math.log2(g[i][j] || 1) - Math.log2(g[i][j + 1] || 1));
          mono -= Math.abs(Math.log2(g[j][i] || 1) - Math.log2(g[j + 1][i] || 1));
        }
      }
      return empties(g) * 12 + (inCorner(g) ? 30 : 0) + mono * 2;
    }

    // Two-ply look-ahead: my move, then an average over where the next tile could land.
    function bestDirection(g) {
      let best = null;
      for (const d of DIRS) {
        const s = slide(g, d);
        if (!s.moved) continue;
        const spots = [];
        s.grid.forEach((row, r) => row.forEach((v, c) => { if (!v) spots.push([r, c]); }));
        let total = 0;
        const sample = spots.slice(0, 6);
        for (const [r, c] of sample) {
          const after = s.grid.map((row) => row.slice());
          after[r][c] = 2;
          let reply = -Infinity;
          for (const d2 of DIRS) {
            const s2 = slide(after, d2);
            if (s2.moved) reply = Math.max(reply, heuristic(s2.grid) + s2.gain / 20);
          }
          total += reply === -Infinity ? -500 : reply;
        }
        const value = s.gain / 10 + (sample.length ? total / sample.length : heuristic(s.grid));
        if (!best || value > best.value) best = { dir: d, value };
      }
      return best && best.dir;
    }

    // ----- tiles on screen -----

    function tileClass(v) {
      return `g2048-tile t${Math.min(v, 4096)}${v >= 1024 ? ' small' : ''}`;
    }

    function place(t, r, c) {
      t.r = r;
      t.c = c;
      t.el.style.setProperty('--r', r);
      t.el.style.setProperty('--c', c);
    }

    function makeTile(v, r, c, delay = 0) {
      const t = { v, el: el('div', { class: `${tileClass(v)} new` }, String(v)) };
      t.el.style.animationDelay = `${delay}ms`;
      place(t, r, c);
      layer.append(t.el);
      return t;
    }

    function flush() {
      clearTimeout(pendingTimer);
      const steps = pending;
      pending = [];
      for (const f of steps) f();
    }

    function spawn(delay) {
      const spots = [];
      grid.forEach((row, r) => row.forEach((v, c) => { if (!v) spots.push([r, c]); }));
      if (!spots.length) return;
      const [r, c] = spots[Math.floor(random() * spots.length)];
      const v = random() < 0.9 ? 2 : 4;
      grid[r][c] = v;
      tiles[r][c] = makeTile(v, r, c, delay);
    }

    function move(dir) {
      if (over) return;
      flush(); // finish any slide still in progress
      const next = Array.from({ length: N }, () => Array(N).fill(null));
      const merges = [];
      let moved = false;
      for (const line of lines(dir)) {
        const items = line.map(([r, c]) => tiles[r][c]).filter(Boolean);
        let pos = 0;
        for (let k = 0; k < items.length; k++, pos++) {
          const [tr, tc] = line[pos];
          const t = items[k];
          if (t.r !== tr || t.c !== tc) moved = true;
          if (k + 1 < items.length && items[k + 1].v === t.v) {
            const u = items[k + 1];
            moved = true;
            place(t, tr, tc);
            place(u, tr, tc);
            u.el.classList.add('under');
            t.v *= 2;
            score += t.v;
            merges.push({ keep: t, drop: u });
            k++;
          } else place(t, tr, tc);
          next[tr][tc] = t;
        }
      }
      if (!moved) return;
      tiles = next;
      grid = tiles.map((row) => row.map((t) => (t ? t.v : 0)));

      // Review stats.
      stats.moves++;
      stats.dirs[dir]++;
      if (inCorner(grid)) stats.corner++;

      // After the slide: merged tiles update, then the new tile pops in.
      const ms = BB.animMs(SLIDE_MS);
      pending.push(() => {
        for (const { keep, drop } of merges) {
          drop.el.remove();
          keep.el.className = `${tileClass(keep.v)} merged`;
          keep.el.textContent = keep.v;
        }
      });
      pendingTimer = setTimeout(flush, ms);
      spawn(ms);
      scoreEl.textContent = score;

      const top = maxTile(grid);
      if (daily && top >= DAILY_GOAL) {
        api.daily((e) => {
          if (!e.done) api.toast(`${DAILY_GOAL}! Daily challenge complete ✅`);
          e.done = true;
        });
      }
      if (top >= 2048 && !won) {
        won = true;
        api.toast('2048! 🎉 Keep going for a high score');
      }
      if (top >= 256 && top > milestone) {
        milestone = top;
        api.coach('best', top >= 2048 ? '2048!!! You absolute legend! 🏆' : `${top} tile! You’re cooking now 🔥`);
      }

      if (!canMove(grid)) {
        over = true;
        api.status(`Game over. Score ${score}`);
        api.record(won ? 'win' : 'done', { score });
        if (daily) {
          api.daily((e) => {
            e.tries++;
            e.score = Math.max(e.score || 0, score);
          });
        }
        bestEl.textContent = currentBest() ?? score;
        api.review(openReview);
      } else status();
    }

    function status() {
      if (daily) api.status(`Daily: reach the ${DAILY_GOAL} tile · same board for everyone`);
      else api.status(won ? 'Past 2048, keep going!' : 'Swipe or use arrow keys');
    }

    function showHint() {
      if (over) return false;
      flush();
      const d = bestDirection(grid);
      if (!d) return false;
      hintsUsed++;
      board.classList.remove('hint-up', 'hint-down', 'hint-left', 'hint-right');
      void board.offsetWidth;
      board.classList.add(`hint-${d}`);
      setTimeout(() => board.classList.remove(`hint-${d}`), 1800);
      return `Swipe ${d} ${ARROW[d]}`;
    }

    function openReview() {
      const sheet = BB.review.open({ title: '2048 review' });
      const top = maxTile(grid);
      const cornerPct = stats.moves ? Math.round((stats.corner / stats.moves) * 100) : 0;
      const used = DIRS.map((d) => [d, stats.dirs[d]]).sort((a, b) => a[1] - b[1]);
      const rarest = used[0];
      const items = [];
      if (cornerPct >= 70) items.push({ kind: 'good', title: `Big tile in a corner ${cornerPct}% of the time`, detail: 'That’s the core strategy. Nice discipline!' });
      else items.push({ kind: 'tip', title: `Your biggest tile was in a corner only ${cornerPct}% of the time`, detail: 'Pick one corner and keep your biggest tile there. Build the other tiles down from it in order.' });
      const fourth = rarest[1] / Math.max(1, stats.moves);
      if (fourth > 0.12) items.push({ kind: 'tip', title: 'You used all four directions a lot', detail: `Try to use only three. For example, avoid swiping ${rarest[0]} unless you have no choice. That keeps your big tiles from getting dragged out of their corner.` });
      else items.push({ kind: 'good', title: `You mostly avoided swiping ${rarest[0]}`, detail: 'Sticking to three directions keeps the board organised. 👍' });
      if (top < 512) items.push({ kind: 'tip', title: 'Keep one edge full', detail: 'If the row with your biggest tile is full, it can’t slide around when you swipe along it.' });
      if (hintsUsed) items.push({ kind: 'info', title: `You used ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}`, detail: 'Hints use a two-move look-ahead. Try to spot why it picked each direction.' });
      sheet.update({
        coach: top >= 2048 ? 'You reached 2048. That’s the real deal! 🏆'
          : cornerPct < 50 ? 'The #1 habit to build: keep your biggest tile in a corner.'
            : `Solid run! Your best tile was ${top}. Next goal: ${top * 2}.`,
        stats: [['Score', score.toLocaleString()], ['Best tile', top], ['Moves', stats.moves], ['In corner', `${cornerPct}%`]],
        items,
      });
    }

    const currentBest = () => (daily ? BB.dailyEntry(daily.date)['2048']?.score ?? null : api.best());

    function reset() {
      flush();
      if (daily) random = BB.rng(daily.seed);
      grid = Array.from({ length: N }, () => Array(N).fill(0));
      tiles = Array.from({ length: N }, () => Array(N).fill(null));
      layer.replaceChildren();
      score = 0;
      won = false;
      over = false;
      milestone = 0;
      hintsUsed = 0;
      stats = { moves: 0, corner: 0, dirs: { up: 0, down: 0, left: 0, right: 0 } };
      spawn(0);
      spawn(0);
      scoreEl.textContent = '0';
      bestEl.textContent = currentBest() ?? 0;
      api.review(null);
      status();
    }

    api.toolbar.append(
      el('div', { class: 'scorebox' }, el('span', null, 'SCORE'), scoreEl),
      el('div', { class: 'scorebox' }, el('span', null, daily ? 'TODAY' : 'BEST'), bestEl),
      el('button', { class: 'btn', type: 'button', onclick: reset }, daily ? 'Restart' : 'New game'),
    );
    api.hint(showHint);
    stage.append(board);
    reset();

    const offSwipe = BB.onSwipe(board, move);
    const offKeys = BB.onArrowKeys(move);
    return () => {
      flush();
      offSwipe();
      offKeys();
    };
  },
});
