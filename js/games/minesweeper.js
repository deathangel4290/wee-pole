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
      if (around.some((n) => !cells[n].open && !cells[n].flag)) chords++;
      for (const n of around) if (!cells[n].open && !cells[n].flag) reveal(n);
    }

    function toggleFlag(i) {
      if (over || cells[i].open) return;
      cells[i].flag = !cells[i].flag;
      flags += cells[i].flag ? 1 : -1;
      if (cells[i].flag) flagsPlaced++;
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

    // ----- logic solver: what can be *proven* from the numbers showing -----

    /**
     * Returns { safe, mines } (Sets of hidden squares) using the two rules good
     * players use: a number that's "full" clears its other neighbours, and one
     * number's hidden neighbours inside another's tell you about the difference.
     * Flags are ignored (they might be wrong).
     */
    function deduce() {
      const safe = new Set();
      const mines = new Set();
      const hidden = (i) => !cells[i].open;
      let changed = true;
      while (changed) {
        changed = false;
        const cons = [];
        cells.forEach((cell, i) => {
          if (!cell.open || cell.mine || !cell.adj) return;
          const unknown = neighbours(i).filter((n) => hidden(n) && !safe.has(n) && !mines.has(n));
          const left = cell.adj - neighbours(i).filter((n) => mines.has(n)).length;
          if (unknown.length) cons.push({ unknown, left });
        });
        const mark = (set, list) => {
          for (const n of list) if (!set.has(n)) { set.add(n); changed = true; }
        };
        for (const c of cons) {
          if (c.left === 0) mark(safe, c.unknown);
          else if (c.left === c.unknown.length) mark(mines, c.unknown);
        }
        if (changed) continue;
        // Subset rule.
        for (const a of cons) {
          for (const b of cons) {
            if (a === b || a.unknown.length >= b.unknown.length) continue;
            if (!a.unknown.every((n) => b.unknown.includes(n))) continue;
            const rest = b.unknown.filter((n) => !a.unknown.includes(n));
            const extra = b.left - a.left;
            if (extra === 0) mark(safe, rest);
            else if (extra === rest.length) mark(mines, rest);
          }
        }
      }
      return { safe, mines };
    }

    /** Rough mine chance for every hidden square (for "best guess" hints). */
    function risk(known) {
      const hiddenCells = cells.map((c, i) => i).filter((i) => !cells[i].open && !known.mines.has(i));
      const minesLeft = cfg.mines - known.mines.size;
      const density = hiddenCells.length ? minesLeft / hiddenCells.length : 1;
      const out = new Map(hiddenCells.map((i) => [i, density]));
      cells.forEach((cell, i) => {
        if (!cell.open || !cell.adj) return;
        const unknown = neighbours(i).filter((n) => !cells[n].open && !known.mines.has(n));
        const left = cell.adj - neighbours(i).filter((n) => known.mines.has(n)).length;
        for (const n of unknown) out.set(n, Math.max(out.get(n) === density ? 0 : out.get(n), left / unknown.length));
      });
      for (const n of known.safe) out.set(n, 0);
      return out;
    }

    let lossInfo = null;
    let hintsUsed = 0;
    let hinted = -1;

    function showHint() {
      if (over) return false;
      if (!laid) return 'Tap anywhere. Your first tap is always safe!';
      const known = deduce();
      const safe = [...known.safe].filter((i) => !cells[i].flag);
      hintsUsed++;
      let line;
      if (safe.length) {
        hinted = safe[0];
        line = safe.length > 1 ? `This square is 100% safe (and ${safe.length - 1} more).` : 'This square is 100% safe.';
      } else {
        const r = risk(known);
        let bestI = -1;
        let bestP = 2;
        for (const [i, p] of r) if (!cells[i].flag && p < bestP) { bestP = p; bestI = i; }
        if (bestI < 0) return false;
        hinted = bestI;
        line = `Nothing is certain here. This is the safest guess (about ${Math.round(bestP * 100)}% risk).`;
      }
      buttons.forEach((b, i) => b.classList.toggle('hinted', i === hinted));
      return line;
    }

    function miniBoard(hit, safe) {
      const g = el('div', { class: 'mines mini' });
      g.style.setProperty('--cols', cfg.cols);
      cells.forEach((cell, i) => {
        const opened = cell.open && !cell.mine;
        const d = el('div', { class: `mine-cell${opened ? ' open' : ''}${opened && cell.adj ? ` n${cell.adj}` : ''}${i === hit ? ' boom' : ''}${safe.has(i) ? ' hinted' : ''}` },
          i === hit ? '💥' : opened && cell.adj ? String(cell.adj) : '');
        g.append(d);
      });
      return el('div', null, g, el('p', { class: 'fineprint' }, 'Pulsing green: squares that were provably safe'));
    }

    function openReview() {
      const sheet = BB.review.open({ title: 'Minesweeper review' });
      const total = cells.length - cfg.mines;
      const cleared = cells.filter((c) => c.open && !c.mine).length;
      const items = [];
      let coach;
      if (lossInfo) {
        const { hit, known, chance } = lossInfo;
        if (known.mines.has(hit)) {
          items.push({ kind: 'blunder', title: 'That square was definitely a mine', detail: 'The numbers around it already proved it. Worth a flag before clicking nearby!', show: () => miniBoard(hit, known.safe) });
          coach = 'That one was avoidable. The numbers had it marked. Slow down near the edges of what you know!';
        } else if (known.safe.size) {
          items.push({ kind: 'mistake', title: `You didn’t need to guess: ${known.safe.size} square${known.safe.size > 1 ? 's were' : ' was'} 100% safe`, detail: 'When you’re stuck, look for a number that already has all its mines. Every other square around it is safe.', show: () => miniBoard(hit, known.safe) });
          coach = 'There were safe squares left. Open those first and the guess might never have been needed!';
        } else {
          items.push({ kind: 'info', title: 'That was a genuine guess', detail: `Nothing on the board was certain, so you had to take a chance (about ${Math.round(chance * 100)}% risk on that square). Unlucky! 🍀`, show: () => miniBoard(hit, known.safe) });
          coach = 'Honestly? Unlucky. Nothing was certain, so that was a forced guess.';
        }
      } else coach = `Board cleared in ${timeEl.textContent}! 🎉`;
      if (!flagsPlaced) items.push({ kind: 'tip', title: 'Try flagging mines', detail: 'Long-press (or use 🚩 mode) to flag. Then tap a number with all its flags placed to clear around it in one go.' });
      if (!chords && cleared > 20) items.push({ kind: 'tip', title: 'Use chording to go faster', detail: 'Tapping an opened number whose mines are all flagged opens all its other neighbours at once.' });
      if (hintsUsed) items.push({ kind: 'info', title: `You used ${hintsUsed} hint${hintsUsed > 1 ? 's' : ''}` });
      sheet.update({
        coach,
        stats: [['Cleared', `${Math.round((cleared / total) * 100)}%`], ['Time', timeEl.textContent], ['Flags', flagsPlaced], ['Level', level]],
        items,
      });
    }

    let flagsPlaced = 0;
    let chords = 0;

    function lose(hit) {
      // Snapshot what was provable *before* the click, for the review.
      const known = deduce();
      lossInfo = { hit, known, chance: risk(known).get(hit) ?? 0 };
      api.review(openReview);
      if (known.mines.has(hit)) api.coach('blunder', 'Oof, the numbers showed that was a mine. Check the review!');
      else if (known.safe.size) api.coach('mistake', `There were ${known.safe.size} safe squares left. You didn’t need to guess!`);
      else api.coach('loss', 'Unlucky! That was a real 50/50. Nothing you could do. 🍀');
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
      lossInfo = null;
      api.review(openReview);
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
      if (hinted >= 0) {
        buttons[hinted].classList.remove('hinted');
        hinted = -1;
      }
      if (cells[i].open) chord(i);
      else if (flagMode) toggleFlag(i);
      else reveal(i);
    }

    function build() {
      cfg = LEVELS[level];
      cells = Array.from({ length: cfg.rows * cfg.cols }, () => ({ mine: false, adj: 0, open: false, flag: false }));
      laid = false;
      started = false;
      lossInfo = null;
      hintsUsed = 0;
      hinted = -1;
      flagsPlaced = 0;
      chords = 0;
      api.review(null);
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
    api.hint(showHint);
    stage.append(grid);
    build();

    return stopClock;
  },
});
