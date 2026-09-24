'use strict';

/*
 * Daily challenges built on existing games. Each gets a seed from the date, so
 * everyone playing on the same day gets the same board. (The chess puzzle lives
 * in js/games/chess-puzzle.js.)
 */
BB.registerDaily({
  kind: '2048',
  name: 'Daily 2048',
  icon: '🔢',
  blurb: 'Reach the 512 tile',
  gameId: '2048',
  summary: (e) => (e.score ? `Best ${e.score}` : null),
  mount: (stage, api, opts) => BB.find('2048').mount(stage, api, opts),
});

BB.registerDaily({
  kind: 'sweep',
  name: 'Daily Sweep',
  icon: '💣',
  blurb: 'Clear today’s board',
  gameId: 'minesweeper',
  summary: (e) => (e.done ? `${e.time}s` : e.tries ? `${e.tries} tries` : null),
  mount: (stage, api, opts) => BB.find('minesweeper').mount(stage, api, opts),
});
