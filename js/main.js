'use strict';

/*
 * App shell: hash routing, the home screen, the game screen and Game Roulette.
 *
 * Routes:
 *   #/            home
 *   #/play/<id>   a game
 */
(() => {
  const { el } = BB;
  const app = document.getElementById('app');
  const ROULETTE_SECONDS = 5 * 60;

  const COMING_SOON = [
    ['🧠', 'Memory'],
    ['🃏', 'Cards'],
  ];

  let unmountGame = null;
  let rouletteRun = null; // { id, endsAt } when a game was launched from the roulette
  let timerInterval = null;

  // ---------- helpers ----------

  function toast(text) {
    const t = el('div', { class: 'toast', role: 'status' }, text);
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2200);
  }

  /** Same game for everyone on a given calendar day. */
  function dailyPick() {
    const d = new Date();
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return BB.games[h % BB.games.length];
  }

  function teardown() {
    if (unmountGame) {
      unmountGame();
      unmountGame = null;
    }
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // ---------- home ----------

  function renderHome() {
    teardown();
    rouletteRun = null;
    document.title = 'BOARD//BOX';

    const pick = dailyPick();
    const { played, wins } = BB.totals();

    const featured = el('a', { class: 'featured', href: `#/play/${pick.id}` },
      el('div', { class: 'featured-label' }, "TODAY'S PICK"),
      el('div', { class: 'featured-icon', 'aria-hidden': 'true' }, pick.icon),
      el('div', { class: 'featured-name' }, pick.name.toUpperCase()),
      el('div', { class: 'featured-cta' }, 'Play now →'),
    );

    const roulette = el('button', { class: 'roulette-btn', type: 'button', onclick: spinRoulette },
      el('span', { class: 'roulette-dice', 'aria-hidden': 'true' }, '🎰'),
      el('span', null,
        el('strong', null, 'PLAY SOMETHING'),
        el('small', null, 'Random game · 5 minute run'),
      ),
    );

    const grid = el('div', { class: 'game-grid' },
      BB.games.map((g) => {
        const s = BB.stats(g.id);
        return el('a', { class: 'game-card', href: `#/play/${g.id}` },
          el('span', { class: 'game-card-icon', 'aria-hidden': 'true' }, g.icon),
          el('span', { class: 'game-card-name' }, g.name),
          el('span', { class: 'game-card-tag' }, g.tagline),
          el('span', { class: 'game-card-meta' }, s.played ? `${s.played} played` : 'New'),
        );
      }),
      COMING_SOON.map(([icon, name]) =>
        el('div', { class: 'game-card soon', 'aria-disabled': 'true' },
          el('span', { class: 'game-card-icon', 'aria-hidden': 'true' }, icon),
          el('span', { class: 'game-card-name' }, name),
          el('span', { class: 'game-card-meta' }, 'Coming soon'),
        )),
    );

    app.replaceChildren(
      el('header', { class: 'home-header' },
        el('h1', { class: 'logo' }, 'BOARD', el('span', { class: 'logo-slash' }, '//'), 'BOX'),
        el('p', { class: 'slogan' }, 'One app. Every game.'),
      ),
      el('main', { class: 'home' },
        featured,
        roulette,
        el('h2', { class: 'section-title' }, 'QUICK GAMES'),
        grid,
        el('section', { class: 'profile-strip' },
          el('div', null, el('strong', null, String(played)), el('span', null, 'games played')),
          el('div', null, el('strong', null, String(wins)), el('span', null, 'wins')),
          el('div', null, el('strong', null, String(BB.games.length)), el('span', null, 'games')),
        ),
      ),
    );
  }

  // ---------- roulette ----------

  function spinRoulette() {
    const pool = BB.games;
    const target = pool[Math.floor(Math.random() * pool.length)];

    const reel = el('div', { class: 'reel-name' }, '');
    const caption = el('div', { class: 'reel-caption' }, 'Spinning…');
    const actions = el('div', { class: 'reel-actions' });
    const overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Game roulette' },
      el('div', { class: 'reel' },
        el('div', { class: 'reel-label' }, '🎰 GAME ROULETTE'),
        reel,
        caption,
        actions,
      ),
    );
    document.body.append(overlay);

    let closed = false;
    const close = () => {
      closed = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Tick through names with a slowing interval, then land on the target.
    const steps = 18 + Math.floor(Math.random() * 6);
    let i = Math.floor(Math.random() * pool.length);
    let step = 0;
    const tick = () => {
      if (closed) return;
      step++;
      const g = step === steps ? target : pool[i++ % pool.length];
      reel.textContent = `${g.icon} ${g.name.toUpperCase()}`;
      reel.classList.remove('bump');
      void reel.offsetWidth; // restart the CSS animation
      reel.classList.add('bump');
      if (step < steps) {
        setTimeout(tick, 45 + step * step * 0.9);
        return;
      }
      reel.classList.add('landed');
      caption.textContent = 'You have 5 minutes.';
      const go = el('button', { class: 'btn primary', type: 'button', onclick: () => {
        close();
        rouletteRun = { id: target.id, endsAt: Date.now() + ROULETTE_SECONDS * 1000 };
        if (location.hash === `#/play/${target.id}`) route();
        else location.hash = `#/play/${target.id}`;
      } }, 'GO →');
      const again = el('button', { class: 'btn', type: 'button', onclick: () => { close(); spinRoulette(); } }, 'Spin again');
      actions.append(again, go);
      go.focus();
    };
    tick();
  }

  // ---------- game screen ----------

  function renderGame(game) {
    teardown();
    document.title = `${game.name} · BOARD//BOX`;

    const status = el('div', { class: 'status', 'aria-live': 'polite' });
    const toolbar = el('div', { class: 'toolbar' });
    const stage = el('div', { class: 'stage' });
    const timer = el('div', { class: 'run-timer', hidden: true });

    app.replaceChildren(
      el('header', { class: 'game-header' },
        el('a', { class: 'back', href: '#/', 'aria-label': 'Back to home' }, '←'),
        el('h1', { class: 'game-title' }, el('span', { 'aria-hidden': 'true' }, game.icon), ' ', game.name),
        timer,
      ),
      el('main', { class: 'game-screen' }, status, toolbar, stage),
    );

    if (rouletteRun && rouletteRun.id === game.id) startRunTimer(timer);
    else rouletteRun = null;

    const api = {
      toolbar,
      status: (text) => { status.textContent = text; },
      record: (result, opts) => {
        const out = BB.record(game.id, result, opts);
        if (out.newBest) toast('★ New best!');
        return out;
      },
      best: (key) => BB.best(game.id, key),
      toast,
    };

    unmountGame = game.mount(stage, api) || null;
    window.scrollTo(0, 0);
  }

  function startRunTimer(timer) {
    timer.hidden = false;
    const update = () => {
      const left = (rouletteRun.endsAt - Date.now()) / 1000;
      timer.textContent = `⏱ ${BB.formatTime(left)}`;
      if (left <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        timer.textContent = "⏱ TIME'S UP";
        timer.classList.add('done');
        rouletteRun = null;
        toast("Time's up! Spin again from home 🎰");
      }
    };
    update();
    timerInterval = setInterval(update, 250);
  }

  // ---------- router ----------

  function route() {
    const m = location.hash.match(/^#\/play\/([\w-]+)/);
    const game = m && BB.find(m[1]);
    if (game) renderGame(game);
    else renderHome();
  }

  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
