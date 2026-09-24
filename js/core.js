'use strict';

/*
 * BOARD//BOX core: the game registry, persistent stats and small shared helpers.
 *
 * A game is a plain object passed to BB.register():
 *
 *   {
 *     id, name, icon, tagline,
 *     mount(stage, api) -> cleanup()
 *   }
 *
 * `stage` is an empty element the game renders into. `api` gives it:
 *   api.status(text)          set the status line under the title
 *   api.toolbar               element for game-specific controls
 *   api.record(result, opts)  log a finished game ('win' | 'loss' | 'draw' | 'done')
 *   api.best(key)             read a stored best score
 *   api.toast(text)           short pop-up message
 *
 * The returned cleanup function must remove every timer and global listener
 * the game added, because the shell mounts and unmounts games freely.
 */
const BB = (() => {
  const games = [];
  const STORE_KEY = 'boardbox.v1';

  let store;
  try {
    store = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch (e) {
    store = {};
  }
  store.stats = store.stats || {};
  store.best = store.best || {};

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
    if (!store.stats[id]) store.stats[id] = { played: 0, wins: 0, losses: 0, draws: 0 };
    return store.stats[id];
  }

  function best(id, key = 'default') {
    const v = store.best[`${id}:${key}`];
    return v === undefined ? null : v;
  }

  /**
   * Record a finished game. With `score`, also tracks a best score under
   * `bestKey` (higher wins unless `lowerIsBetter`). Returns { newBest }.
   */
  function record(id, result, { score, bestKey = 'default', lowerIsBetter = false } = {}) {
    const s = stats(id);
    s.played++;
    if (result === 'win') s.wins++;
    else if (result === 'loss') s.losses++;
    else if (result === 'draw') s.draws++;

    let newBest = false;
    if (typeof score === 'number') {
      const k = `${id}:${bestKey}`;
      const prev = store.best[k];
      if (prev === undefined || (lowerIsBetter ? score < prev : score > prev)) {
        store.best[k] = score;
        newBest = true;
      }
    }
    save();
    return { newBest };
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

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
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
    el, segmented, squareGrid, onSwipe, onArrowKeys, shuffle, formatTime,
  };
})();
