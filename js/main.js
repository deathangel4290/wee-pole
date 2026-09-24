'use strict';

/*
 * App shell: hash routing, the home screen, game screens, daily challenges,
 * the profile page and Game Roulette.
 *
 * Routes:
 *   #/              home
 *   #/play/<id>     a game
 *   #/daily/<kind>  today's daily challenge
 *   #/profile       stats + achievements
 *   #/online, #/friends, #/leaderboard, #/match/<id>   online screens (js/online.js)
 */
(() => {
  const { el } = BB;
  const app = document.getElementById('app');
  const ROULETTE_SECONDS = 5 * 60;

  const COMING_SOON = [
    ['🧠', 'Memory'],
    ['🃏', 'Cards'],
  ];

  // How each game's best score is stored and shown on the profile page.
  const BESTS = {
    chess: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].map(([k, l]) => [k, l, (v) => `${v}-move win`]),
    reversi: [['default', 'Biggest win', (v) => `+${v}`]],
    '2048': [['default', 'High score', (v) => v.toLocaleString()]],
    minesweeper: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].map(([k, l]) => [k, l, (v) => `${v}s`]),
    snake: [['default', 'High score', (v) => `${v}`]],
  };

  let unmountGame = null;
  let rouletteRun = null; // { id, endsAt } when a game was launched from the roulette
  let timerInterval = null;
  let installPrompt = null; // Chrome/Android's deferred "install app" prompt

  // ---------- toasts (queued so they don't pile up) ----------

  const toastQueue = [];
  let toastBusy = false;

  function toast(text, kind = '') {
    toastQueue.push([text, kind]);
    if (!toastBusy) nextToast();
  }

  function nextToast() {
    const item = toastQueue.shift();
    if (!item) { toastBusy = false; return; }
    toastBusy = true;
    const t = el('div', { class: `toast ${item[1]}`.trim(), role: 'status' }, item[0]);
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { t.remove(); nextToast(); }, 250);
    }, item[1] === 'achievement' ? 2800 : 2000);
  }

  BB.toast = toast;

  function announce(unlocked) {
    for (const a of unlocked) toast(`🏆 ${a.icon} ${a.name}`, 'achievement');
  }

  // ---------- helpers ----------

  /** Same featured game for everyone on a given calendar day. */
  function dailyPick() {
    return BB.games[BB.dayNumber() % BB.games.length];
  }

  function teardown() {
    if (unmountGame) {
      unmountGame();
      unmountGame = null;
    }
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const prettyDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  function header(title, icon) {
    return el('header', { class: 'game-header' },
      el('a', { class: 'back', href: '#/', 'aria-label': 'Back to home' }, '←'),
      el('h1', { class: 'game-title' }, icon ? el('span', { 'aria-hidden': 'true' }, icon) : null, icon ? ' ' : null, title));
  }

  // ---------- install ----------

  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /** "Install" nudge: a real prompt on Android/desktop Chrome, instructions on iOS, nothing once installed. */
  function installCard() {
    if (standalone()) return null;
    if (installPrompt) {
      return el('button', {
        class: 'install', type: 'button',
        onclick: async () => {
          const p = installPrompt;
          installPrompt = null;
          p.prompt();
          await p.userChoice.catch(() => {});
          if (!location.hash || location.hash === '#/') renderHome();
        },
      }, el('strong', null, '📲 Install BOARD//BOX'), el('small', null, 'Full screen, works offline, lives on your home screen'));
    }
    if (isIOS()) {
      return el('div', { class: 'install' },
        el('strong', null, '📲 Get the app'),
        el('small', null, 'In Safari, tap the Share button, then “Add to Home Screen”.'));
    }
    return null;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (!location.hash || location.hash === '#/') renderHome();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    toast('Installed! Find BOARD//BOX on your home screen 🎉');
  });

  // ---------- home ----------

  function dailyCard() {
    const date = BB.today();
    const day = BB.dailyEntry(date);
    const streak = BB.streak();
    const doneCount = BB.dailies.filter((d) => day[d.kind]?.done).length;
    return el('section', { class: 'daily-card' },
      el('div', { class: 'daily-head' },
        el('div', null,
          el('div', { class: 'featured-label' }, 'DAILY CHALLENGE'),
          el('div', { class: 'daily-date' }, `${prettyDate(date)} · ${doneCount}/${BB.dailies.length} done`)),
        el('div', { class: `streak${streak ? ' on' : ''}`, title: 'Daily streak' }, `🔥 ${streak}`)),
      BB.dailies.map((d) => {
        const e = day[d.kind];
        const summary = e && d.summary ? d.summary(e) : null;
        return el('a', { class: `daily-row${e?.done ? ' done' : ''}`, href: `#/daily/${d.kind}` },
          el('span', { class: 'daily-icon', 'aria-hidden': 'true' }, d.icon),
          el('span', { class: 'daily-text' },
            el('strong', null, d.name),
            el('small', null, summary ? `${d.blurb} · ${summary}` : d.blurb)),
          el('span', { class: 'daily-state' }, e?.done ? '✓' : 'Play →'));
      }));
  }

  function renderHome() {
    teardown();
    rouletteRun = null;
    document.title = 'BOARD//BOX';

    const pick = dailyPick();
    const { played, wins } = BB.totals();
    // Filled in by js/online.js only if a server is reachable.
    const onlineSlot = el('div', { class: 'online-slot' });
    if (BB.onlineHomeCard) BB.onlineHomeCard(onlineSlot);
    const achieved = BB.achievements.filter((a) => BB.isUnlocked(a.id)).length;

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
        dailyCard(),
        onlineSlot,
        roulette,
        featured,
        el('h2', { class: 'section-title' }, 'QUICK GAMES'),
        grid,
        el('a', { class: 'profile-strip', href: '#/profile', 'aria-label': 'Open profile' },
          el('div', null, el('strong', null, String(played)), el('span', null, 'played')),
          el('div', null, el('strong', null, String(wins)), el('span', null, 'wins')),
          el('div', null, el('strong', null, `${achieved}/${BB.achievements.length}`), el('span', null, 'trophies')),
          el('div', { class: 'profile-go' }, el('strong', null, '→'), el('span', null, 'profile')),
        ),
        installCard(),
      ),
    );
  }

  // ---------- profile ----------

  function renderProfile() {
    teardown();
    rouletteRun = null;
    document.title = 'Profile · BOARD//BOX';

    const { played, wins } = BB.totals();
    let decided = 0;
    for (const g of BB.games) {
      const s = BB.stats(g.id);
      decided += s.wins + s.losses + s.draws;
    }
    const unlocked = BB.achievements.filter((a) => BB.isUnlocked(a.id));

    const tile = (value, label) => el('div', { class: 'tile' }, el('strong', null, value), el('span', null, label));

    // Last 14 days of dailies.
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const date = BB.today(-i);
      const e = BB.dailyEntry(date);
      const n = BB.dailies.filter((d) => e[d.kind]?.done).length;
      days.push(el('div', { class: `day lvl${n}`, title: `${prettyDate(date)}: ${n}/${BB.dailies.length}` },
        el('span', null, new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' }))));
    }

    const rows = BB.games.map((g) => {
      const s = BB.stats(g.id);
      const bests = (BESTS[g.id] || [])
        .map(([key, label, fmt]) => {
          const v = BB.best(g.id, key);
          return v === null ? null : `${label} ${fmt(v)}`;
        })
        .filter(Boolean);
      return el('tr', null,
        el('th', { scope: 'row' }, `${g.icon} ${g.name}`),
        el('td', null, String(s.played)),
        el('td', null, s.wins + s.losses + s.draws ? `${s.wins}–${s.losses}–${s.draws}` : '—'),
        el('td', { class: 'bests' }, bests.join(' · ') || '—'));
    });

    const badges = BB.achievements.map((a) => {
      const at = BB.unlockedAt(a.id);
      return el('div', { class: `badge${at ? ' got' : ''}`, title: at ? `Unlocked ${new Date(at).toLocaleDateString()}` : 'Locked' },
        el('span', { class: 'badge-icon', 'aria-hidden': 'true' }, at ? a.icon : '🔒'),
        el('strong', null, a.name),
        el('small', null, a.desc));
    });

    app.replaceChildren(
      header('Profile', '👤'),
      el('main', { class: 'profile' },
        el('div', { class: 'tiles' },
          tile(String(played), 'games played'),
          tile(String(wins), 'wins'),
          tile(decided ? `${Math.round((wins / decided) * 100)}%` : '—', 'win rate vs bots'),
          tile(`🔥 ${BB.streak()}`, 'daily streak'),
        ),
        el('h2', { class: 'section-title' }, 'LAST 14 DAYS'),
        el('div', { class: 'days' }, days),
        el('h2', { class: 'section-title' }, `ACHIEVEMENTS · ${unlocked.length}/${BB.achievements.length}`),
        el('div', { class: 'badges' }, badges),
        el('h2', { class: 'section-title' }, 'GAMES'),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'stats-table' },
            el('thead', null, el('tr', null,
              el('th', { scope: 'col' }, 'Game'),
              el('th', { scope: 'col' }, 'Played'),
              el('th', { scope: 'col' }, 'W–L–D'),
              el('th', { scope: 'col' }, 'Bests'))),
            el('tbody', null, rows))),
        el('p', { class: 'fineprint' }, 'Progress is saved on this device.'),
        el('button', {
          class: 'btn danger', type: 'button',
          onclick: () => {
            if (!confirm('Reset all stats, dailies and achievements on this device?')) return;
            try { localStorage.removeItem('boardbox.v1'); } catch (e) { /* ignore */ }
            location.hash = '#/';
            location.reload();
          },
        }, 'Reset progress'),
      ),
    );
    window.scrollTo(0, 0);
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

  // ---------- game + daily screens ----------

  /**
   * Mount something playable. `statsId` is the game whose stats results count
   * towards; `daily` is set for daily challenges.
   */
  function renderPlayable({ title, icon, statsId, mount, daily = null }) {
    rouletteRun = daily || !rouletteRun || rouletteRun.id !== statsId ? null : rouletteRun;
    teardown();
    document.title = `${title} · BOARD//BOX`;

    const status = el('div', { class: 'status', 'aria-live': 'polite' });
    const toolbar = el('div', { class: 'toolbar' });
    const stage = el('div', { class: 'stage' });
    const timer = el('div', { class: 'run-timer', hidden: true });
    const head = header(title, icon);
    head.append(timer);
    if (daily) head.append(el('div', { class: 'run-timer daily-badge' }, prettyDate(daily.date)));

    app.replaceChildren(head, el('main', { class: 'game-screen' }, status, toolbar, stage));

    if (!daily && rouletteRun && rouletteRun.id === statsId) startRunTimer(timer);

    const api = {
      toolbar,
      status: (text) => { status.textContent = text; },
      record: (result, opts = {}) => {
        const out = BB.record(statsId, result, { ...opts, roulette: !!rouletteRun });
        if (out.newBest && !daily) toast('★ New best!');
        announce(out.unlocked);
        return out;
      },
      best: (key) => BB.best(statsId, key),
      toast,
      daily: (fn) => {
        if (!daily) return null;
        const out = BB.updateDaily(daily.kind, fn, daily.date);
        announce(out.unlocked);
        if (BB.net) BB.net.submitDaily(daily.date, daily.kind, out.entry); // leaderboards
        return out.entry;
      },
    };

    unmountGame = mount(stage, api, daily ? { daily } : {}) || null;
    window.scrollTo(0, 0);
    return api;
  }

  // What the online screens (js/online.js) get to build with.
  const onlineCtx = {
    app,
    header,
    toast,
    route: () => route(),
    renderPlayable,
    setCleanup: (fn) => { unmountGame = fn; },
    addCleanup: (fn) => {
      const prev = unmountGame;
      unmountGame = () => { if (prev) prev(); fn(); };
    },
  };

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
    const hash = location.hash;
    let m = hash.match(/^#\/play\/([\w-]+)/);
    const game = m && BB.find(m[1]);
    if (game) {
      renderPlayable({ title: game.name, icon: game.icon, statsId: game.id, mount: game.mount.bind(game) });
      return;
    }
    m = hash.match(/^#\/daily\/([\w-]+)/);
    const d = m && BB.dailies.find((x) => x.kind === m[1]);
    if (d) {
      const date = BB.today();
      renderPlayable({
        title: d.name,
        icon: d.icon,
        statsId: d.gameId || `daily-${d.kind}`,
        mount: d.mount.bind(d),
        daily: { kind: d.kind, date, seed: `boardbox:${date}:${d.kind}` },
      });
      return;
    }
    if (hash.startsWith('#/profile')) { renderProfile(); return; }
    if (BB.onlineRoute) {
      teardown();
      rouletteRun = null;
      if (BB.onlineRoute(hash, onlineCtx)) return;
    }
    renderHome();
  }

  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
