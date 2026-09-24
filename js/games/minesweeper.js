'use strict';

BB.register({
  id: 'minesweeper',
  name: 'Minesweeper',
  icon: '💣',
  tagline: 'Clear the field. Don’t go boom.',

  mount(stage, api, opts = {}) {
    const { el } = BB;
    const LEVELS = {
      easy: { rows: 9, cols: 9, mines: 10 },
      medium: { rows: 12, cols: 12, mines: 24 },
      hard: { rows: 16, cols: 12, mines: 36 },
    };
    const LONG_PRESS_MS = 420;

    const daily = opts.daily; // same board for everyone today

    let level = daily ? 'medium' : 'easy';
    let cfg;
    let cells; // { mine, adj, open, flag }
    let buttons;
    let laid; // mines placed
    let started; // clock running
    let over;
    let opened;
    let flags;
    let startTime;
    let tick = null;
    let flagMode = false;

    const minesEl = el('strong', null, '0');
    const timeEl = el('strong', null, '0:00');
    const grid = el('div', { class: 'mines' });

    const idx = (r, c) => r * cfg.cols + c;
    function neighbours(i) {
      const r = Math.floor(i / cfg.cols);
      const c = i % cfg.cols;
      const out = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < cfg.rows && cc >= 0 && cc < cfg.cols) out.push(idx(rr, cc));
        }
      }
      return out;
    }

    // Mines are placed on the first reveal so the first tap (and its neighbours) is always safe.
    function layMines(safe, random = Math.random) {
      laid = true;
      const banned = new Set([safe, ...neighbours(safe)]);
      const spots = BB.shuffle(cells.map((_, i) => i).filter((i) => !banned.has(i)), random);
      for (const i of spots.slice(0, cfg.mines)) cells[i].mine = true;
      cells.forEach((cell, i) => {
        cell.adj = neighbours(i).filter((n) => cells[n].mine).length;
      });
    }

    function reveal(i, auto = false) {
      if (over || cells[i].flag || cells[i].open) return;
      if (!laid) layMines(i);
      if (!started && !auto) {
        started = true;
        startTime = Date.now();
        tick = setInterval(updateTime, 500);
      }
      if (cells[i].mine) {
        lose(i);
        return;
      }
      // Flood-fill from zero cells.
      const stack = [i];
      while (stack.length) {
        const j = stack.pop();
        const cell = cells[j];
        if (cell.open || cell.flag) continue;
        cell.open = true;
        opened++;
        paint(j);
        if (cell.adj === 0) for (const n of neighbours(j)) if (!cells[n].open) stack.push(n);
      }
      if (opened === cells.length - cfg.mines) win();
    }

    // Tapping an opened number whose flags are all placed opens the rest around it.
    function chord(i) {
      const around = neighbours(i);
      if (around.filter((n) => cells[n].flag).length !== cells[i].adj) return;
      for (const n of around) if (!cells[n].open && !cells[n].flag) reveal(n);
    }

    function toggleFlag(i) {
      if (over || cells[i].open) return;
      cells[i].flag = !cells[i].flag;
      flags += cells[i].flag ? 1 : -1;
      minesEl.textContent = cfg.mines - flags;
      paint(i);
    }

    function paint(i) {
      const cell = cells[i];
      const b = buttons[i];
      b.className = 'mine-cell';
      b.textContent = '';
      if (cell.open) {
        b.classList.add('open');
        if (cell.mine) {
          b.textContent = '💣';
        } else if (cell.adj) {
          b.textContent = cell.adj;
          b.classList.add(`n${cell.adj}`);
        }
      } else if (cell.flag) {
        b.textContent = '🚩';
      }
    }

    function stopClock() {
      clearInterval(tick);
      tick = null;
    }

    function elapsed() {
      return started ? (Date.now() - startTime) / 1000 : 0;
    }

    function updateTime() {
      timeEl.textContent = BB.formatTime(elapsed());
    }

    function lose(hit) {
      over = true;
      stopClock();
      cells.forEach((cell, i) => {
        if (cell.mine && !cell.flag) { cell.open = true; paint(i); }
        else if (!cell.mine && cell.flag) { buttons[i].textContent = '❌'; }
      });
      buttons[hit].classList.add('boom');
      api.status(`Boom. 💥 Tap ${daily ? 'Restart' : 'New game'} to retry.`);
      api.record('loss', { level });
      if (daily) api.daily((e) => { e.tries++; });
    }

    function win() {
      over = true;
      stopClock();
      const secs = Math.round(elapsed() * 10) / 10;
      cells.forEach((cell, i) => {
        if (cell.mine && !cell.flag) { cell.flag = true; paint(i); }
      });
      minesEl.textContent = 0;
      api.status(`Cleared in ${secs}s! 🎉`);
      api.record('win', { score: secs, bestKey: level, lowerIsBetter: true, level });
      if (daily) {
        api.daily((e) => {
          e.tries++;
          e.done = true;
          e.time = Math.min(e.time ?? Infinity, secs);
        });
        api.toast('Daily challenge complete ✅');
      }
    }

    function onTap(i) {
      if (over) return;
      if (cells[i].open) chord(i);
      else if (flagMode) toggleFlag(i);
      else reveal(i);
    }

    function build() {
      cfg = LEVELS[level];
      cells = Array.from({ length: cfg.rows * cfg.cols }, () => ({ mine: false, adj: 0, open: false, flag: false }));
      laid = false;
      started = false;
      over = false;
      opened = 0;
      flags = 0;
      stopClock();
      grid.style.setProperty('--cols', cfg.cols);
      buttons = cells.map((_, i) => {
        const b = el('button', { class: 'mine-cell', type: 'button', 'aria-label': `Row ${Math.floor(i / cfg.cols) + 1} column ${(i % cfg.cols) + 1}` });
        let pressTimer = null;
        let longPressed = false;
        b.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          longPressed = false;
          pressTimer = setTimeout(() => {
            longPressed = true;
            toggleFlag(i);
            if (navigator.vibrate) navigator.vibrate(15);
          }, LONG_PRESS_MS);
        });
        const cancel = () => clearTimeout(pressTimer);
        b.addEventListener('pointerup', cancel);
        b.addEventListener('pointerleave', cancel);
        b.addEventListener('pointercancel', cancel);
        b.addEventListener('click', () => {
          if (longPressed) { longPressed = false; return; }
          onTap(i);
        });
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          clearTimeout(pressTimer);
          if (!longPressed) toggleFlag(i);
        });
        return b;
      });
      grid.replaceChildren(...buttons);
      minesEl.textContent = cfg.mines;
      updateTime();
      if (daily) {
        // Seeded layout, with a guaranteed-empty starting patch already open.
        const random = BB.rng(daily.seed);
        const start = Math.floor(random() * cells.length);
        layMines(start, random);
        reveal(start, true);
        const t = BB.dailyEntry(daily.date).sweep?.time;
        api.status(t ? `Today's best: ${t}s · clock starts on your first tap` : 'Same board for everyone · clock starts on your first tap');
        return;
      }
      const best = api.best(level);
      api.status(best === null ? 'Tap to dig · long-press to flag' : `Best (${level}): ${best}s`);
    }

    const flagBtn = el('button', {
      class: 'btn', type: 'button', 'aria-pressed': 'false',
      onclick: () => {
        flagMode = !flagMode;
        flagBtn.setAttribute('aria-pressed', String(flagMode));
        flagBtn.textContent = flagMode ? '🚩 Flagging' : '⛏ Digging';
      },
    }, '⛏ Digging');

    api.toolbar.append(
      ...(daily ? [] : [BB.segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], level, (l) => { level = l; build(); })]),
      el('div', { class: 'scorebox' }, el('span', null, 'MINES'), minesEl),
      el('div', { class: 'scorebox' }, el('span', null, 'TIME'), timeEl),
      flagBtn,
      el('button', { class: 'btn', type: 'button', onclick: build }, daily ? 'Restart' : 'New game'),
    );
    stage.append(grid);
    build();

    return stopClock;
  },
});
