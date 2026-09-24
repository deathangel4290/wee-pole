'use strict';

// Checks the non-UI logic: seeded dailies, streaks, achievements and the puzzle set.
// Run: node tests/logic.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const storage = {};
const ctx = vm.createContext({
  console,
  localStorage: { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
});
for (const f of ['js/core.js', 'js/achievements.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const BB = vm.runInContext('BB', ctx);

let failed = 0;
const check = (label, cond) => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
};

// ---- seeded randomness: the daily boards must match on every device ----
const seq = (seed) => { const r = BB.rng(seed); return Array.from({ length: 5 }, r); };
check('same seed gives the same sequence', JSON.stringify(seq('boardbox:2026-01-01:2048')) === JSON.stringify(seq('boardbox:2026-01-01:2048')));
check('different days give different sequences', seq('boardbox:2026-01-01:2048')[0] !== seq('boardbox:2026-01-02:2048')[0]);
check('rng stays in [0, 1)', seq('x').every((v) => v >= 0 && v < 1));
check('seeded rng is stable across releases', seq('boardbox:2026-01-01:2048')[0].toFixed(8) === '0.69601239');
check('dayNumber counts days', BB.dayNumber('2025-01-02') - BB.dayNumber('2025-01-01') === 1 && BB.dayNumber('2026-01-01') === 365);

// ---- achievements + stats ----
for (const id of ['chess', 'snake']) BB.register({ id, name: id, mount() {} });
BB.registerDaily({ kind: 'puzzle' });
BB.registerDaily({ kind: 'sweep' });

let out = BB.record('snake', 'done', { score: 25 });
check('first game unlocks Warm-up and Long Boi', out.unlocked.map((a) => a.id).sort().join() === 'first-game,snake-20');
check('new best is reported', out.newBest === true);
out = BB.record('snake', 'done', { score: 3 });
check('unlocks only once, lower score is not a best', out.unlocked.length === 0 && !out.newBest);
out = BB.record('chess', 'win', { score: 30, level: 'hard', bestKey: 'hard', lowerIsBetter: true });
check('beating the hard chess bot unlocks its achievements (and Sampler)', ['chess-win', 'chess-hard', 'sampler'].every((id) => out.unlocked.some((a) => a.id === id)));
check('fewest-moves best is stored', BB.best('chess', 'hard') === 30);
out = BB.record('chess', 'win', { score: 22, level: 'hard', bestKey: 'hard', lowerIsBetter: true });
check('lower move count becomes the new best', out.newBest && BB.best('chess', 'hard') === 22);
check('quick win unlocks Blitzed', out.unlocked.some((a) => a.id === 'chess-quick'));
check('wins are counted by level', BB.stats('chess').winsBy.hard === 2);
check('2P wins do not count as beating the bot', !vm.runInContext("BB.achievements.find(a => a.id === 'chess-win').test({ game: 'chess', result: 'win', level: '2p' })", ctx));

// ---- dailies + streaks ----
check('no streak before any daily', BB.streak() === 0);
BB.updateDaily('puzzle', (e) => { e.tries++; e.done = true; }, BB.today(-2));
BB.updateDaily('sweep', (e) => { e.tries++; e.done = true; }, BB.today(-1));
check('streak counts up to yesterday while today is pending', BB.streak() === 2);
BB.updateDaily('sweep', (e) => { e.tries++; }, BB.today());
check('a failed attempt does not extend the streak', BB.streak() === 2);
out = BB.updateDaily('puzzle', (e) => { e.tries++; e.done = true; });
check('completing today extends the streak to 3', BB.streak() === 3);
check('streak of 3 unlocks On Fire', out.unlocked.some((a) => a.id === 'streak-3'));
check('solving a puzzle on the first try unlocked Sharp Eye', BB.isUnlocked('puzzle-first-try'));
out = BB.updateDaily('sweep', (e) => { e.tries++; e.done = true; e.time = 42; });
check('all dailies in a day unlocks Clean Sweep', out.unlocked.some((a) => a.id === 'daily-all'));
check('progress is persisted', JSON.parse(storage['boardbox.v1']).daily[BB.today()].sweep.time === 42);

// ---- puzzles: every one is a unique mate in 2 ----
const E = require('../js/games/chess-engine.js');
const PUZZLES = require('../js/games/chess-puzzles.js');
check(`at least 60 puzzles (${PUZZLES.length})`, PUZZLES.length >= 60);
const bad = PUZZLES.filter((fen) => {
  const s = E.fromFEN(fen);
  return E.canMate(s, 1) || E.matingMoves(s, 2).length !== 1;
});
check('every puzzle has exactly one mate-in-2 first move and no mate in 1', bad.length === 0);
check('no duplicate puzzles', new Set(PUZZLES).size === PUZZLES.length);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll logic checks passed');
