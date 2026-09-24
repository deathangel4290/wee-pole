'use strict';

/*
 * Snake Arcade: smooth snake, levels with obstacles, combos and power-ups.
 *
 *   🍎 apple      +1 (× combo)          ⭐ golden  +5 (× combo), vanishes after a few seconds
 *   👻 ghost      pass through yourself, blocks and walls for a while
 *   🐢 slow-mo    everything slows down for a while
 *
 * Eating again within 2.5 s builds a combo (up to ×5). Every 6 apples is a new
 * level: faster, with new blocks on the board.
 */
BB.register({
  id: 'snake',
  name: 'Snake',
  icon: '🐍',
  tagline: 'Arcade mode: combos, power-ups, levels.',

  mount(stage, api) {
    const { el } = BB;
    const SIZE = 18; // cells per side
    const START_MS = 135;
    const MIN_MS = 62;
    const COMBO_WINDOW = 2500;
    const APPLES_PER_LEVEL = 6;
    const POWER_MS = 6000;
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const ITEM = {
      apple: { emoji: '🍎', color: '#ff4d4d' },
      gold: { emoji: '⭐', color: '#ffc83d', life: 5000 },
      ghost: { emoji: '👻', color: '#b8a8ff', life: 7000 },
      slow: { emoji: '🐢', color: '#3ddc84', life: 7000 },
    };

    let snake; // [[x, y], …] head first
    let prev; // snake positions at the previous tick (for smooth drawing)
    let dir;
    let queue;
    let items; // [{ x, y, type, born }]
    let blocks; // Set of "x,y"
    let score;
    let apples;
    let level;
    let combo;
    let bestCombo;
    let lastEat;
    let ghostUntil;
    let slowUntil;
    let stepMs;
    let state; // 'ready' | 'running' | 'paused' | 'over'
    let acc; // ms accumulated towards the next tick
    let lastFrame;
    let raf = null;
    let particles;
    let shake;
    let banner; // { text, until }
    let run; // stats for the review

    const canvas = el('canvas', { class: 'snake-canvas', 'aria-label': 'Snake board' });
    const ctx = canvas.getContext('2d');
    const scoreEl = el('strong', null, '0');
    const levelEl = el('strong', null, '1');
    const bestEl = el('strong', null, '0');
    const comboEl = el('div', { class: 'snake-combo', hidden: true });
    const powerEl = el('div', { class: 'snake-power', hidden: true });
    const overlay = el('div', { class: 'snake-overlay' });
    const wrap = el('div', { class: 'snake-wrap' }, canvas, comboEl, powerEl, overlay);

    const pad = el('div', { class: 'dpad' },
      ['up', 'left', 'right', 'down'].map((d) =>
        el('button', {
          class: `dpad-${d}`, type: 'button', 'aria-label': d,
          onpointerdown: (e) => { e.preventDefault(); steer(d); },
        }, { up: '▲', down: '▼', left: '◀', right: '▶' }[d])),
    );

    const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const key = (x, y) => `${x},${y}`;
    const now = () => performance.now();

    function resize() {
      const px = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1));
      if (px && canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      draw(0);
    }

    function freeCell(avoidHead = 0) {
      const taken = new Set([...snake.map(([x, y]) => key(x, y)), ...blocks, ...items.map((f) => key(f.x, f.y))]);
      const [hx, hy] = snake[0];
      for (let tries = 0; tries < 500; tries++) {
        const x = Math.floor(Math.random() * SIZE);
        const y = Math.floor(Math.random() * SIZE);
        if (taken.has(key(x, y))) continue;
        if (Math.abs(x - hx) + Math.abs(y - hy) < avoidHead) continue;
        return [x, y];
      }
      return null;
    }

    function addItem(type) {
      const spot = freeCell(2);
      if (spot) items.push({ x: spot[0], y: spot[1], type, born: now() });
    }

    function addBlocks(n) {
      for (let i = 0; i < n; i++) {
        const spot = freeCell(5);
        if (spot) blocks.add(key(spot[0], spot[1]));
      }
    }

    function burst(x, y, color, count = 12) {
      if (!BB.animMs(1)) return;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 0.004 + Math.random() * 0.006;
        particles.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color });
      }
    }

    const ghost = () => now() < ghostUntil;
    const slow = () => now() < slowUntil;
    const tickMs = () => (slow() ? stepMs * 1.7 : stepMs);

    // ----- rules -----

    function step() {
      if (queue.length) dir = queue.shift();
      const [dx, dy] = DIRS[dir];
      let hx = snake[0][0] + dx;
      let hy = snake[0][1] + dy;
      const wall = hx < 0 || hy < 0 || hx >= SIZE || hy >= SIZE;
      if (wall && ghost()) {
        hx = (hx + SIZE) % SIZE; // ghosts drift through walls
        hy = (hy + SIZE) % SIZE;
      }
      const itemIdx = items.findIndex((f) => f.x === hx && f.y === hy);
      const eating = itemIdx >= 0 && items[itemIdx].type !== 'ghost' && items[itemIdx].type !== 'slow';
      const body = eating ? snake : snake.slice(0, -1);
      let cause = null;
      if (wall && !ghost()) cause = 'wall';
      else if (!ghost() && blocks.has(key(hx, hy))) cause = 'block';
      else if (!ghost() && body.some(([x, y]) => x === hx && y === hy)) cause = 'self';
      if (cause) {
        gameOver(cause);
        return;
      }
      prev = snake.map((p) => p.slice()); // segment i glides from prev[i] to snake[i]
      snake = [[hx, hy], ...body];
      if (itemIdx >= 0) collect(itemIdx);
    }

    function collect(idx) {
      const f = items.splice(idx, 1)[0];
      const t = now();
      burst(f.x, f.y, ITEM[f.type].color, f.type === 'gold' ? 22 : 12);
      if (f.type === 'ghost') {
        ghostUntil = t + POWER_MS;
        run.powerups++;
        api.coach('best', 'Ghost mode! Walls and blocks can’t stop you 👻');
        return;
      }
      if (f.type === 'slow') {
        slowUntil = t + POWER_MS;
        run.powerups++;
        return;
      }
      combo = t - lastEat < COMBO_WINDOW ? Math.min(5, combo + 1) : 1;
      bestCombo = Math.max(bestCombo, combo);
      lastEat = t;
      const base = f.type === 'gold' ? 5 : 1;
      score += base * combo;
      scoreEl.textContent = score;
      if (combo >= 2) {
        comboEl.hidden = false;
        comboEl.textContent = `COMBO ×${combo}`;
        comboEl.classList.remove('pop');
        void comboEl.offsetWidth;
        comboEl.classList.add('pop');
        if (combo === 4) api.coach('best', 'COMBO ×4! Don’t stop now! 🔥');
      }
      if (f.type === 'gold') {
        run.gold++;
        api.coach('best', '+5 golden apple! ⭐');
        return;
      }
      apples++;
      run.apples++;
      addItem('apple');
      // Occasional power-ups.
      const roll = Math.random();
      if (roll < 0.18 && !items.some((x) => x.type === 'gold')) addItem('gold');
      else if (roll < 0.26 && level >= 2 && !items.some((x) => x.type === 'ghost')) addItem('ghost');
      else if (roll < 0.33 && level >= 2 && !items.some((x) => x.type === 'slow')) addItem('slow');
      if (apples % APPLES_PER_LEVEL === 0) levelUp();
    }

    function levelUp() {
      level++;
      levelEl.textContent = level;
      stepMs = Math.max(MIN_MS, stepMs - 9);
      addBlocks(level <= 2 ? 2 : 3);
      banner = { text: `LEVEL ${level}`, until: now() + 1200 };
      api.coach('best', level === 2 ? 'Level 2! Watch out for the blocks 🧱' : `Level ${level}! Faster now 🏎️`);
    }

    // ----- drawing -----

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function draw(t) {
      const W = canvas.width;
      if (!W) return;
      const cell = W / SIZE;
      const surface = css('--surface');
      const line = css('--line');
      const text = css('--text');
      const accent = css('--accent');
      const time = now();

      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * cell, (Math.random() - 0.5) * shake * cell);
      ctx.fillStyle = surface;
      ctx.fillRect(0, 0, W, W);
      ctx.fillStyle = line;
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if ((x + y) % 2) ctx.fillRect(x * cell, y * cell, cell, cell);

      // Blocks.
      ctx.fillStyle = text;
      ctx.globalAlpha = 0.85;
      for (const b of blocks) {
        const [x, y] = b.split(',').map(Number);
        roundRect(x * cell + cell * 0.06, y * cell + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.18);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Items (bobbing; timed ones blink before they vanish).
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${cell * 0.8}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      for (const f of items) {
        const def = ITEM[f.type];
        const age = time - f.born;
        if (def.life && def.life - age < 1500 && Math.floor(age / 150) % 2) continue;
        const bob = Math.sin(time / 220 + f.x) * cell * 0.06;
        ctx.fillText(def.emoji, (f.x + 0.5) * cell, (f.y + 0.55) * cell + bob);
      }

      // Snake: each segment glides from its previous cell.
      const n = snake.length;
      const ghostly = ghost();
      for (let i = n - 1; i >= 0; i--) {
        const [cx, cy] = snake[i];
        const [px, py] = prev[i] || snake[i];
        const wrapJump = Math.abs(cx - px) > 1 || Math.abs(cy - py) > 1;
        const x = wrapJump ? cx : px + (cx - px) * t;
        const y = wrapJump ? cy : py + (cy - py) * t;
        const k = i / Math.max(1, n - 1);
        const inset = cell * (0.08 + k * 0.1);
        ctx.globalAlpha = ghostly ? 0.45 : 1;
        ctx.fillStyle = i === 0 ? accent : mix(accent, text, Math.min(1, 0.35 + k * 0.65));
        roundRect(x * cell + inset, y * cell + inset, cell - inset * 2, cell - inset * 2, cell * 0.3);
        ctx.fill();
        if (i === 0) drawEyes(x, y, cell);
      }
      ctx.globalAlpha = 1;

      // Particles.
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x * cell - cell * 0.08, p.y * cell - cell * 0.08, cell * 0.16, cell * 0.16);
      }
      ctx.globalAlpha = 1;

      if (banner && time < banner.until) {
        const a = Math.min(1, (banner.until - time) / 400);
        ctx.globalAlpha = a;
        ctx.fillStyle = accent;
        ctx.font = `800 ${cell * 2}px ui-monospace, Menlo, monospace`;
        ctx.fillText(banner.text, W / 2, W / 2);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    function drawEyes(x, y, cell) {
      const [dx, dy] = DIRS[dir];
      const cx = (x + 0.5) * cell;
      const cy = (y + 0.5) * cell;
      const side = [-dy, dx];
      for (const s of [-1, 1]) {
        const ex = cx + dx * cell * 0.14 + side[0] * s * cell * 0.17;
        const ey = cy + dy * cell * 0.14 + side[1] * s * cell * 0.17;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ex, ey, cell * 0.11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(ex + dx * cell * 0.04, ey + dy * cell * 0.04, cell * 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Blend two #rrggbb colours (the theme tokens are hex).
    function mix(a, b, t) {
      const pa = parseInt(a.slice(1), 16);
      const pb = parseInt(b.slice(1), 16);
      const ch = (p, s) => (p >> s) & 255;
      const c = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
      return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
    }

    // ----- loop -----

    function frame(ts) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, ts - (lastFrame || ts));
      lastFrame = ts;
      if (state === 'running') {
        acc += dt;
        while (acc >= tickMs() && state === 'running') {
          acc -= tickMs();
          step();
        }
        // Expire timed items.
        const t = now();
        items = items.filter((f) => {
          const life = ITEM[f.type].life;
          if (life && t - f.born > life) {
            if (f.type === 'gold') run.goldMissed++;
            return false;
          }
          return true;
        });
        if (combo > 1 && t - lastEat > COMBO_WINDOW) {
          combo = 1;
          comboEl.hidden = true;
        }
        const power = ghost() ? `👻 ${Math.ceil((ghostUntil - t) / 1000)}s` : slow() ? `🐢 ${Math.ceil((slowUntil - t) / 1000)}s` : '';
        powerEl.hidden = !power;
        powerEl.textContent = power;
      }
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt / 450;
      }
      particles = particles.filter((p) => p.life > 0);
      if (shake > 0) shake = Math.max(0, shake - dt / 400);
      const t = state === 'running' ? Math.min(1, acc / tickMs()) : 1;
      draw(BB.animMs(1) ? t : 1);
    }

    function showOverlay(title, sub) {
      overlay.replaceChildren(el('strong', null, title), el('span', null, sub));
      overlay.hidden = false;
    }

    function start() {
      if (state === 'running') return;
      if (state === 'over') reset();
      state = 'running';
      overlay.hidden = true;
      run.started = run.started || Date.now();
      api.status('Swipe, arrow keys, or the pad');
    }

    function pause() {
      if (state !== 'running') return;
      state = 'paused';
      showOverlay('Paused', 'Tap or press a direction to resume');
    }

    const CAUSE = {
      wall: ['You hit the wall', 'Start turning a square earlier near the edges.'],
      self: ['You ran into yourself', 'Leave yourself an exit: loop along the outside instead of zig-zagging.'],
      block: ['You hit a block', 'Blocks appear each level. Look ahead a few squares when you speed up.'],
    };

    function gameOver(cause) {
      state = 'over';
      run.cause = cause;
      run.seconds = Math.round((Date.now() - (run.started || Date.now())) / 1000);
      shake = BB.animMs(1) ? 0.6 : 0;
      burst(snake[0][0], snake[0][1], css('--accent'), 18);
      const { newBest } = api.record('done', { score });
      bestEl.textContent = api.best() ?? score;
      showOverlay('Game over', `${CAUSE[cause][0]} · score ${score}${newBest ? ' · new best!' : ''}. Tap to play again`);
      api.status(`Final score: ${score} · level ${level}`);
      if (!newBest) api.coach('mistake', `${CAUSE[cause][0]}! ${CAUSE[cause][1]}`);
      api.review(openReview);
    }

    function openReview() {
      const sheet = BB.review.open({ title: 'Snake review' });
      const items = [];
      const [what, fix] = CAUSE[run.cause] || ['', ''];
      items.push({ kind: 'mistake', title: what, detail: fix });
      if (bestCombo >= 3) items.push({ kind: 'good', title: `Best combo ×${bestCombo}`, detail: 'Chaining apples quickly multiplies your points. Great hunting!' });
      else items.push({ kind: 'tip', title: 'Build combos for big scores', detail: 'Eat again within 2.5 seconds to multiply points (up to ×5). Plan a route through nearby apples.' });
      if (run.goldMissed) items.push({ kind: 'tip', title: `${run.goldMissed} golden apple${run.goldMissed > 1 ? 's' : ''} got away`, detail: 'They’re worth 5× and only last a few seconds. Go for them when they appear!' });
      if (level >= 3) items.push({ kind: 'good', title: `Reached level ${level}`, detail: 'The snake speeds up every level. Nice reflexes.' });
      if (!run.powerups && level >= 2) items.push({ kind: 'tip', title: 'Try the power-ups', detail: '👻 lets you pass through everything for a few seconds; 🐢 slows the game down when it gets hectic.' });
      sheet.update({
        coach: run.cause === 'self' && snake.length > 15 ? 'Long snake, tight corners. Give yourself more room!' : `Score ${score}. ${fix}`,
        stats: [['Score', score], ['Level', level], ['Length', snake.length], ['Time', BB.formatTime(run.seconds || 0)]],
        items,
      });
    }

    function steer(d) {
      if (state !== 'running') {
        // A direction starts / resumes the game, unless it's straight back into the body.
        if (state === 'over') reset();
        if (d !== OPPOSITE[dir]) queue = [d];
        start();
        return;
      }
      const last = queue.length ? queue[queue.length - 1] : dir;
      if (d === last || d === OPPOSITE[last] || queue.length >= 3) return;
      queue.push(d);
    }

    function reset() {
      const mid = Math.floor(SIZE / 2);
      snake = [[mid, mid], [mid - 1, mid], [mid - 2, mid]];
      prev = snake.map((p) => p.slice());
      dir = 'right';
      queue = [];
      items = [];
      blocks = new Set();
      particles = [];
      score = 0;
      apples = 0;
      level = 1;
      combo = 1;
      bestCombo = 1;
      lastEat = -Infinity;
      ghostUntil = 0;
      slowUntil = 0;
      shake = 0;
      banner = null;
      acc = 0;
      stepMs = START_MS;
      run = { apples: 0, gold: 0, goldMissed: 0, powerups: 0, cause: null, started: 0, seconds: 0 };
      addItem('apple');
      state = 'ready';
      scoreEl.textContent = '0';
      levelEl.textContent = '1';
      bestEl.textContent = api.best() ?? 0;
      comboEl.hidden = true;
      powerEl.hidden = true;
      api.review(null);
      showOverlay('Snake Arcade', 'Tap or press a direction to start');
      api.status('🍎 +1 · ⭐ +5 · 👻 ghost · 🐢 slow-mo · eat fast for combos');
    }

    overlay.addEventListener('click', () => (state === 'running' ? pause() : start()));
    const offSwipe = BB.onSwipe(wrap, steer, 16);
    const offKeys = BB.onArrowKeys(steer);
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (state === 'running') pause();
        else start();
      }
    };
    const onHide = () => { if (document.hidden) pause(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('resize', resize);

    api.toolbar.append(
      el('div', { class: 'scorebox' }, el('span', null, 'SCORE'), scoreEl),
      el('div', { class: 'scorebox' }, el('span', null, 'LEVEL'), levelEl),
      el('div', { class: 'scorebox' }, el('span', null, 'BEST'), bestEl),
      el('button', { class: 'btn', type: 'button', onclick: () => (state === 'running' ? pause() : start()) }, '⏯'),
      el('button', { class: 'btn', type: 'button', onclick: reset }, 'Restart'),
    );
    stage.append(wrap, pad);
    reset();
    requestAnimationFrame(() => {
      resize();
      raf = requestAnimationFrame(frame);
    });

    return () => {
      cancelAnimationFrame(raf);
      offSwipe();
      offKeys();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('resize', resize);
    };
  },
});
