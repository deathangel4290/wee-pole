'use strict';

/*
 * BOARD//BOX core: the game registry, persistent stats, daily challenges,
 * achievements and small shared helpers.
 *
 * A game is a plain object passed to BB.register():
 *
 *   {
 *     id, name, icon, tagline,
 *     mount(stage, api, opts) -> cleanup()
 *   }
 *
 * `stage` is an empty element the game renders into. `api` gives it:
 *   api.status(text)          set the status line under the title
 *   api.toolbar               element for game-specific controls
 *   api.record(result, opts)  log a finished game ('win' | 'loss' | 'draw' | 'done');
 *                             opts: { score, bestKey, lowerIsBetter, level }
 *   api.best(key)             read a stored best score
 *   api.toast(text)           short pop-up message
 *   api.daily(fn)             (daily challenges only) update today's entry: fn(entry)
 *
 * `opts.daily` is set when the game is launched as a daily challenge:
 *   { date: 'YYYY-MM-DD', seed: string } — use BB.rng(seed) for the shared layout.
 *
 * The returned cleanup function must remove every timer and global listener
 * the game added, because the shell mounts and unmounts games freely.
 */
const BB = (() => {
  const games = [];
  const dailies = [];
  const achievements = [];
  const STORE_KEY = 'boardbox.v1';

  let store;
  try {
    store = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch (e) {
    store = {};
  }
  store.stats = store.stats || {};
  store.best = store.best || {};
  store.daily = store.daily || {}; // date -> kind -> entry
  store.ach = store.ach || {}; // achievement id -> unlock timestamp
  store.counters = store.counters || {};
  store.settings = { coach: true, hints: true, anim: 'normal', ...(store.settings || {}) };

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) {
      // Private mode or storage disabled: stats just won't persist.
    }
  }

  function register(game) {
    games.push(game);
  }

  function find(id) {
    return games.find((g) => g.id === id);
  }

  function stats(id) {
    const s = store.stats[id] || (store.stats[id] = { played: 0, wins: 0, losses: 0, draws: 0 });
    s.winsBy = s.winsBy || {};
    return s;
  }

  function best(id, key = 'default') {
    const v = store.best[`${id}:${key}`];
    return v === undefined ? null : v;
  }

  // ---------- settings ----------

  const settings = {
    get: (k) => store.settings[k],
    set(k, v) {
      store.settings[k] = v;
      save();
      applyAnimSetting();
    },
  };

  const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Scales an animation duration by the user's speed setting (0 = no animation). */
  function animMs(ms) {
    if (reducedMotion()) return 0;
    return { normal: 1, fast: 0.5, off: 0 }[store.settings.anim] * ms;
  }

  function applyAnimSetting() {
    if (typeof document !== 'undefined') document.documentElement.dataset.anim = store.settings.anim;
  }
  applyAnimSetting();

  /**
   * Plays a movement animation on `node`: it starts at the given offsets (in px,
   * relative to where it now is) and travels through them to its real position.
   * `points` is a list of [dx, dy]; several points make a multi-hop path.
   */
  function travel(node, points, ms, easing = 'cubic-bezier(.25,.8,.25,1)') {
    const duration = animMs(ms);
    if (!duration || !node || !node.animate || !points.length) return Promise.resolve();
    const frames = [...points.map(([dx, dy]) => ({ transform: `translate(${dx}px, ${dy}px)` })), { transform: 'translate(0, 0)' }];
    const a = node.animate(frames, { duration, easing });
    return a.finished.catch(() => {});
  }

  /** Offset of element `from` relative to element `to` (both on screen). */
  function offset(from, to) {
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    return [a.left - b.left, a.top - b.top];
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- achievements ----------

  /** Achievement: { id, icon, name, desc, test(event, ctx) -> bool }. */
  function defineAchievement(a) {
    achievements.push(a);
  }

  /** Evaluate every locked achievement against an event; returns the newly unlocked ones. */
  function checkAchievements(event) {
    const ctx = { stats, best, totals, streak, today: dailyEntry(today()), counters: store.counters, games, dailies };
    const unlocked = [];
    for (const a of achievements) {
      if (store.ach[a.id]) continue;
      let ok = false;
      try {
        ok = a.test(event, ctx);
      } catch (e) {
        ok = false;
      }
      if (ok) {
        store.ach[a.id] = Date.now();
        unlocked.push(a);
      }
    }
    return unlocked;
  }

  const isUnlocked = (id) => !!store.ach[id];

  // ---------- results ----------

  /**
   * Record a finished game. With `score`, also tracks a best score under
   * `bestKey` (higher wins unless `lowerIsBetter`). Returns { newBest, unlocked }.
   */
  function record(id, result, { score, bestKey = 'default', lowerIsBetter = false, level, roulette = false } = {}) {
    const s = stats(id);
    s.played++;
    if (result === 'win') {
      s.wins++;
      if (level) s.winsBy[level] = (s.winsBy[level] || 0) + 1;
    } else if (result === 'loss') s.losses++;
    else if (result === 'draw') s.draws++;
    if (roulette) store.counters.roulette = (store.counters.roulette || 0) + 1;

    let newBest = false;
    if (typeof score === 'number' && (lowerIsBetter || score > 0)) {
      const k = `${id}:${bestKey}`;
      const prev = store.best[k];
      if (prev === undefined || (lowerIsBetter ? score < prev : score > prev)) {
        store.best[k] = score;
        newBest = true;
      }
    }
    const unlocked = checkAchievements({ game: id, result, score, level, roulette });
    save();
    return { newBest, unlocked };
  }

  function totals() {
    let played = 0;
    let wins = 0;
    for (const id in store.stats) {
      played += store.stats[id].played;
      wins += store.stats[id].wins;
    }
    return { played, wins };
  }

  // ---------- daily challenges ----------

  /** Local calendar date as YYYY-MM-DD (offset in days from today). */
  function today(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Days since 2025-01-01 for a YYYY-MM-DD date — handy for picking "today's" item from a list. */
  function dayNumber(date = today()) {
    const [y, m, d] = date.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2025, 0, 1)) / 86400000);
  }

  /** Daily challenge: { kind, name, icon, blurb, mount(stage, api, opts) }. */
  function registerDaily(d) {
    dailies.push(d);
  }

  function dailyEntry(date) {
    return store.daily[date] || {};
  }

  /** Update today's entry for a daily kind; fn mutates the entry. Returns { entry, unlocked }. */
  function updateDaily(kind, fn, date = today()) {
    const day = store.daily[date] || (store.daily[date] = {});
    const entry = day[kind] || (day[kind] = { tries: 0, done: false });
    const wasDone = entry.done;
    fn(entry);
    const unlocked = checkAchievements({ daily: kind, entry, justCompleted: entry.done && !wasDone });
    save();
    return { entry, unlocked };
  }

  const dayDone = (date) => Object.values(dailyEntry(date)).some((e) => e.done);

  /** Consecutive days with at least one completed daily, ending today (or yesterday, if today isn't done yet). */
  function streak() {
    let n = 0;
    let offset = dayDone(today()) ? 0 : -1;
    while (dayDone(today(offset))) {
      n++;
      offset--;
    }
    return n;
  }

  // ---------- randomness ----------

  /** Seeded PRNG (mulberry32 over a string hash): same seed, same sequence, on every device. */
  function rng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Tiny DOM builder: el('div', { class: 'x', onclick: fn }, child, 'text') */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  /**
   * A row of mutually exclusive options. Returns the element; calls
   * onChange(value) when the selection changes.
   */
  function segmented(options, value, onChange) {
    const wrap = el('div', { class: 'seg', role: 'radiogroup' });
    const buttons = options.map(([v, label]) => {
      const b = el('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(v === value),
        onclick: () => {
          if (v === value) return;
          value = v;
          for (const other of buttons) other.setAttribute('aria-checked', String(other === b));
          onChange(v);
        },
      }, label);
      return b;
    });
    wrap.append(...buttons);
    return wrap;
  }

  /**
   * Detect swipes on `target`. cb receives 'up' | 'down' | 'left' | 'right'.
   * Returns a function that removes the listeners.
   */
  function onSwipe(target, cb, minDist = 24) {
    let sx = 0;
    let sy = 0;
    let active = false;
    const down = (e) => {
      active = true;
      sx = e.clientX;
      sy = e.clientY;
    };
    const up = (e) => {
      if (!active) return;
      active = false;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < minDist) return;
      if (Math.abs(dx) > Math.abs(dy)) cb(dx > 0 ? 'right' : 'left');
      else cb(dy > 0 ? 'down' : 'up');
    };
    const cancel = () => { active = false; };
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', cancel);
    return () => {
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', cancel);
    };
  }

  /** Map arrow keys / WASD to directions. Returns a remover. */
  function onArrowKeys(cb) {
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right',
    };
    const handler = (e) => {
      const dir = map[e.key];
      if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      cb(dir);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }

  /**
   * A square grid of tappable cells, shared by the board games.
   * onTap(r, c) receives display coordinates (row 0 at the top).
   * Returns { el, at(r, c) } where at() gives the cell button.
   */
  function squareGrid(rows, cols, onTap, className = '') {
    const grid = el('div', { class: `board-grid ${className}`.trim(), role: 'grid' });
    grid.style.setProperty('--cols', cols);
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push(el('button', {
          type: 'button',
          class: `sq ${(r + c) % 2 ? 'dark' : 'light'}`,
          onclick: () => onTap(r, c),
        }));
      }
    }
    grid.append(...cells);
    return { el: grid, at: (r, c) => cells[r * cols + c] };
  }

  /**
   * Online-play glue shared by the board games. `online` is opts.online from the
   * match screen (undefined offline, in which case this returns null):
   *   { seat, names, moves, send(move, final), onMove(cb), closed }
   * Seat 0 always moves first (X / orange / White).
   */
  function onlineGame(online, api) {
    if (!online) return null;
    let replaying = false;
    const opponent = online.names[1 - online.seat];
    return {
      seat: online.seat,
      opponent,
      /** Replays the match so far through apply(move), then applies live moves as they arrive. */
      start(apply) {
        replaying = true;
        try {
          for (const m of online.moves) apply(m);
        } finally {
          replaying = false;
        }
        online.onMove(apply);
      },
      myTurn: (seatToMove) => !online.closed && !replaying && seatToMove === online.seat,
      /** Send a local move; `winner` is undefined while the game goes on, else a seat or null (draw). */
      send(move, winner) {
        if (!replaying) online.send(move, winner === undefined ? undefined : { winner });
      },
      /** Status text for the end of the game; records the result (not while replaying history). */
      finish(winner) {
        if (!replaying) api.record(winner === null ? 'draw' : winner === online.seat ? 'win' : 'loss', { level: 'online' });
        if (winner === null) return `Draw with ${opponent}.`;
        return winner === online.seat ? `You beat ${opponent}! 🎉` : `${opponent} wins.`;
      },
      turnText: (seatToMove) => (seatToMove === online.seat ? 'Your move' : `Waiting for ${opponent}…`),
    };
  }

  function shuffle(arr, random = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    games, register, find, stats, best, record, totals,
    dailies, registerDaily, dailyEntry, updateDaily, streak, today, dayNumber, rng,
    achievements, defineAchievement, isUnlocked, unlockedAt: (id) => store.ach[id] || null,
    el, segmented, squareGrid, onSwipe, onArrowKeys, shuffle, formatTime, onlineGame,
    settings, animMs, travel, offset, wait,
  };
})();
