'use strict';

// Verifies chess move generation against well-known perft counts
// (https://www.chessprogramming.org/Perft_Results). Run: node tests/chess-perft.js
const E = require('../js/games/chess-engine.js');

function perft(s, depth) {
  const moves = E.legalMoves(s);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(m.next, depth - 1);
  return n;
}

const CASES = [
  ['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];

let failed = 0;
for (const [name, fen, expected] of CASES) {
  const s = E.fromFEN(fen);
  expected.forEach((want, i) => {
    const got = perft(s, i + 1);
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} depth ${i + 1}: ${got}${ok ? '' : ` (expected ${want})`}`);
  });
}

// A few rule checks on top of perft.
const check = (label, cond) => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
};
const mate = E.fromFEN('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
check("fool's mate is checkmate", E.result(mate) === 'checkmate');
check('stalemate detected', E.result(E.fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')) === 'stalemate');
check('K+B vs K is a draw', E.result(E.fromFEN('8/8/4k3/8/8/3BK3/8/8 w - - 0 1')) === 'insufficient');
const start = E.initial();
const nf3 = E.legalMoves(start).find((m) => m.from === 62 && m.to === 45);
check('SAN Nf3', E.san(start, nf3) === 'Nf3');
const mateIn1 = E.fromFEN('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
const bm = E.bestMove(mateIn1, { depth: 3, timeMs: 3000 });
check('bot finds back-rank mate', E.san(mateIn1, bm) === 'Rd8#');

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll chess checks passed');
