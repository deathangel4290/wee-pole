'use strict';

BB.register({
  id: 'snake',
  name: 'Snake',
  icon: '🐍',
  tagline: 'Eat. Grow. Don’t bite yourself.',

  mount(stage, api) {
    const { el } = BB;
    const SIZE = 20; // cells per side
    const START_MS = 150;
    const MIN_MS = 65;
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

    let snake;
    let dir;
    let queue; // buffered turns so quick double-taps aren't lost
    let food;
    let score;
    let state; // 'ready' | 'running' | 'paused' | 'over'
    let stepMs;
    let timer = null;

    const canvas = el('canvas', { class: 'snake-canvas', 'aria-label': 'Snake board' });
    const ctx = canvas.getContext('2d');
    const scoreEl = el('strong', null, '0');
    const bestEl = el('strong', null, '0');
    const overlay = el('div', { class: 'snake-overlay' });
    const wrap = el('div', { class: 'snake-wrap' }, canvas, overlay);

    const pad = el('div', { class: 'dpad' },
      ['up', 'left', 'right', 'down'].map((d) =>
        el('button', {
          class: `dpad-${d}`, type: 'button', 'aria-label': d,
          onpointerdown: (e) => { e.preventDefault(); steer(d); },
        }, { up: '▲', down: '▼', left: '◀', right: '▶' }[d])),
    );

    function color(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function resize() {
      const px = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1));
      if (px && canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      draw();
    }

    function placeFood() {
      const taken = new Set(snake.map(([x, y]) => y * SIZE + x));
      if (taken.size >= SIZE * SIZE) return null;
      let i;
      do i = Math.floor(Math.random() * SIZE * SIZE); while (taken.has(i));
      return [i % SIZE, Math.floor(i / SIZE)];
    }

    function draw() {
      const W = canvas.width;
      if (!W) return;
      const cell = W / SIZE;
      ctx.fillStyle = color('--surface');
      ctx.fillRect(0, 0, W, W);

      ctx.fillStyle = color('--line');
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if ((x + y) % 2) ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }

      if (food) {
        ctx.fillStyle = color('--accent');
        ctx.beginPath();
        ctx.arc((food[0] + 0.5) * cell, (food[1] + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
        ctx.fill();
      }

      const inset = cell * 0.08;
      snake.forEach(([x, y], i) => {
        ctx.fillStyle = i === 0 ? color('--accent') : color('--text');
        ctx.globalAlpha = i === 0 ? 1 : Math.max(0.45, 1 - i / (snake.length + 8));
        ctx.fillRect(x * cell + inset, y * cell + inset, cell - inset * 2, cell - inset * 2);
      });
      ctx.globalAlpha = 1;
    }

    function showOverlay(title, sub) {
      overlay.replaceChildren(el('strong', null, title), el('span', null, sub));
      overlay.hidden = false;
    }

    function step() {
      if (queue.length) dir = queue.shift();
      const [dx, dy] = DIRS[dir];
      const head = [snake[0][0] + dx, snake[0][1] + dy];
      const eating = food && head[0] === food[0] && head[1] === food[1];
      // The tail moves out of the way this tick unless we're growing.
      const body = eating ? snake : snake.slice(0, -1);
      const hitWall = head[0] < 0 || head[1] < 0 || head[0] >= SIZE || head[1] >= SIZE;
      const hitSelf = body.some(([x, y]) => x === head[0] && y === head[1]);
      if (hitWall || hitSelf) {
        gameOver();
        return;
      }
      snake = [head, ...body];
      if (eating) {
        score++;
        scoreEl.textContent = score;
        food = placeFood();
        stepMs = Math.max(MIN_MS, stepMs - 4);
        if (!food) { draw(); gameOver(true); return; }
      }
      draw();
      timer = setTimeout(step, stepMs);
    }

    function start() {
      if (state === 'running') return;
      if (state === 'over') reset();
      state = 'running';
      overlay.hidden = true;
      api.status('Swipe, arrow keys, or the pad');
      timer = setTimeout(step, stepMs);
    }

    function pause() {
      if (state !== 'running') return;
      clearTimeout(timer);
      state = 'paused';
      showOverlay('Paused', 'Tap or press a direction to resume');
    }

    function gameOver(perfect) {
      clearTimeout(timer);
      state = 'over';
      const { newBest } = api.record('done', { score });
      bestEl.textContent = api.best() ?? score;
      showOverlay(perfect ? 'Perfect! 🏆' : 'Game over', `Score ${score}${newBest ? ' · new best!' : ''} — tap to play again`);
      api.status(`Final score: ${score}`);
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
      clearTimeout(timer);
      const mid = Math.floor(SIZE / 2);
      snake = [[mid, mid], [mid - 1, mid], [mid - 2, mid]];
      dir = 'right';
      queue = [];
      score = 0;
      stepMs = START_MS;
      food = placeFood();
      state = 'ready';
      scoreEl.textContent = '0';
      bestEl.textContent = api.best() ?? 0;
      showOverlay('Snake', 'Tap or press a direction to start');
      api.status('Eat the orange dots');
      draw();
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
      el('div', { class: 'scorebox' }, el('span', null, 'BEST'), bestEl),
      el('button', { class: 'btn', type: 'button', onclick: () => (state === 'running' ? pause() : start()) }, 'Pause / Play'),
      el('button', { class: 'btn', type: 'button', onclick: reset }, 'Restart'),
    );
    stage.append(wrap, pad);
    reset();
    requestAnimationFrame(resize);

    return () => {
      clearTimeout(timer);
      offSwipe();
      offKeys();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('resize', resize);
    };
  },
});
