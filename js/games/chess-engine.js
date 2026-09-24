'use strict';

/*
 * Chess rules + a small alpha-beta bot. No DOM here, so it can be tested in Node
 * (see tests/chess-perft.js).
 *
 * Board: array of 64, index 0 = a8 ... 7 = h8, 56 = a1 ... 63 = h1.
 * Pieces: 'PNBRQK' white, 'pnbrqk' black, '' empty.
 * State: { board, turn: 'w'|'b', castle: { K, Q, k, q }, ep: square|-1, half, full }
 * Move:  { from, to, piece, captured, promo, flag: ''|'double'|'ep'|'castle' }
 */
const ChessEngine = (() => {
  const colorOf = (p) => (p ? (p === p.toUpperCase() ? 'w' : 'b') : null);
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const nameOf = (sq) => 'abcdefgh'[sq & 7] + (8 - (sq >> 3));

  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function fromFEN(fen) {
    const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
    const board = [];
    for (const ch of placement.replace(/\//g, '')) {
      if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) board.push('');
      else board.push(ch);
    }
    const epSq = ep && ep !== '-' ? (8 - +ep[1]) * 8 + 'abcdefgh'.indexOf(ep[0]) : -1;
    return {
      board,
      turn: turn || 'w',
      castle: { K: castling.includes('K'), Q: castling.includes('Q'), k: castling.includes('k'), q: castling.includes('q') },
      ep: epSq,
      half: +half || 0,
      full: +full || 1,
    };
  }

  const initial = () => fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  /** Is `sq` attacked by any piece of colour `by`? */
  function attacked(board, sq, by) {
    const r = sq >> 3;
    const c = sq & 7;
    const w = by === 'w';
    const pr = w ? r + 1 : r - 1; // attacking pawns sit one rank "behind" the square
    const pawn = w ? 'P' : 'p';
    if (inside(pr, c - 1) && board[pr * 8 + c - 1] === pawn) return true;
    if (inside(pr, c + 1) && board[pr * 8 + c + 1] === pawn) return true;
    const knight = w ? 'N' : 'n';
    for (const [dr, dc] of KNIGHT) {
      if (inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === knight) return true;
    }
    const king = w ? 'K' : 'k';
    for (const [dr, dc] of KING) {
      if (inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === king) return true;
    }
    const [bishop, rook, queen] = w ? ['B', 'R', 'Q'] : ['b', 'r', 'q'];
    for (const [dirs, slider] of [[DIAG, bishop], [ORTHO, rook]]) {
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (inside(rr, cc)) {
          const p = board[rr * 8 + cc];
          if (p) {
            if (p === slider || p === queen) return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
    }
    return false;
  }

  const kingSquare = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k');
  const inCheck = (s) => attacked(s.board, kingSquare(s.board, s.turn), other(s.turn));

  function pseudoMoves(s, capturesOnly = false) {
    const { board, turn } = s;
    const moves = [];
    const add = (from, to, flag = '', promo = '') => {
      const captured = flag === 'ep' ? (turn === 'w' ? 'p' : 'P') : board[to];
      moves.push({ from, to, piece: board[from], captured, promo, flag });
    };
    for (let from = 0; from < 64; from++) {
      const p = board[from];
      if (!p || colorOf(p) !== turn) continue;
      const r = from >> 3;
      const c = from & 7;
      const t = p.toUpperCase();

      if (t === 'P') {
        const dir = turn === 'w' ? -1 : 1;
        const startRow = turn === 'w' ? 6 : 1;
        const lastRow = turn === 'w' ? 0 : 7;
        const pushPawn = (to, flag) => {
          if ((to >> 3) === lastRow) for (const q of 'qrbn') add(from, to, flag, turn === 'w' ? q.toUpperCase() : q);
          else add(from, to, flag);
        };
        const one = from + dir * 8;
        if (!capturesOnly && inside(r + dir, c) && !board[one]) {
          pushPawn(one, '');
          const two = from + dir * 16;
          if (r === startRow && !board[two]) add(from, two, 'double');
        }
        for (const dc of [-1, 1]) {
          if (!inside(r + dir, c + dc)) continue;
          const to = (r + dir) * 8 + c + dc;
          if (board[to] && colorOf(board[to]) !== turn) pushPawn(to, '');
          else if (to === s.ep) add(from, to, 'ep');
        }
        continue;
      }

      if (t === 'N' || t === 'K') {
        for (const [dr, dc] of t === 'N' ? KNIGHT : KING) {
          if (!inside(r + dr, c + dc)) continue;
          const to = (r + dr) * 8 + c + dc;
          if (!board[to] ? !capturesOnly : colorOf(board[to]) !== turn) add(from, to);
        }
        if (t === 'K' && !capturesOnly) addCastling(s, from, add);
        continue;
      }

      const dirs = t === 'B' ? DIAG : t === 'R' ? ORTHO : [...DIAG, ...ORTHO];
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (inside(rr, cc)) {
          const to = rr * 8 + cc;
          if (board[to]) {
            if (colorOf(board[to]) !== turn) add(from, to);
            break;
          }
          if (!capturesOnly) add(from, to);
          rr += dr;
          cc += dc;
        }
      }
    }
    return moves;
  }

  function addCastling(s, from, add) {
    const { board, turn, castle } = s;
    const opp = other(turn);
    const home = turn === 'w' ? 60 : 4;
    if (from !== home || attacked(board, home, opp)) return;
    const [kSide, qSide, rook] = turn === 'w' ? ['K', 'Q', 'R'] : ['k', 'q', 'r'];
    if (castle[kSide] && board[home + 3] === rook && !board[home + 1] && !board[home + 2]
      && !attacked(board, home + 1, opp) && !attacked(board, home + 2, opp)) {
      add(from, home + 2, 'castle');
    }
    if (castle[qSide] && board[home - 4] === rook && !board[home - 1] && !board[home - 2] && !board[home - 3]
      && !attacked(board, home - 1, opp) && !attacked(board, home - 2, opp)) {
      add(from, home - 2, 'castle');
    }
  }

  // Corner square -> castling right lost when that rook moves or is captured.
  const ROOK_RIGHTS = { 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };

  function makeMove(s, m) {
    const board = s.board.slice();
    const castle = { ...s.castle };
    board[m.to] = m.promo || m.piece;
    board[m.from] = '';
    if (m.flag === 'ep') board[m.to + (s.turn === 'w' ? 8 : -8)] = '';
    if (m.flag === 'castle') {
      const kingSide = m.to > m.from;
      const rookFrom = kingSide ? m.from + 3 : m.from - 4;
      const rookTo = kingSide ? m.from + 1 : m.from - 1;
      board[rookTo] = board[rookFrom];
      board[rookFrom] = '';
    }
    if (m.piece === 'K') castle.K = castle.Q = false;
    if (m.piece === 'k') castle.k = castle.q = false;
    if (ROOK_RIGHTS[m.from]) castle[ROOK_RIGHTS[m.from]] = false;
    if (ROOK_RIGHTS[m.to]) castle[ROOK_RIGHTS[m.to]] = false;
    const pawnMove = m.piece === 'P' || m.piece === 'p';
    return {
      board,
      turn: other(s.turn),
      castle,
      ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
      half: pawnMove || m.captured ? 0 : s.half + 1,
      full: s.turn === 'b' ? s.full + 1 : s.full,
    };
  }

  /** Legal moves, each with its resulting state attached as `m.next`. */
  function legalMoves(s) {
    const out = [];
    for (const m of pseudoMoves(s)) {
      const next = makeMove(s, m);
      if (!attacked(next.board, kingSquare(next.board, s.turn), next.turn)) {
        m.next = next;
        out.push(m);
      }
    }
    return out;
  }

  /** Position key for repetition detection. */
  function key(s) {
    const c = s.castle;
    return `${s.board.map((p) => p || '.').join('')}${s.turn}${c.K ? 'K' : ''}${c.Q ? 'Q' : ''}${c.k ? 'k' : ''}${c.q ? 'q' : ''}${s.ep}`;
  }

  function insufficientMaterial(board) {
    const pieces = [];
    board.forEach((p, i) => { if (p && p.toUpperCase() !== 'K') pieces.push([p.toUpperCase(), i]); });
    if (pieces.length === 0) return true;
    if (pieces.length === 1) return pieces[0][0] === 'N' || pieces[0][0] === 'B';
    if (pieces.every(([t]) => t === 'B')) {
      const shade = (i) => ((i >> 3) + (i & 7)) % 2;
      return pieces.every(([, i]) => shade(i) === shade(pieces[0][1]));
    }
    return false;
  }

  /**
   * Game result for the side to move, or null if play continues.
   * `seen` is a Map of position key -> count for threefold repetition.
   */
  function result(s, seen) {
    if (!legalMoves(s).length) return inCheck(s) ? 'checkmate' : 'stalemate';
    if (s.half >= 100) return 'fifty';
    if (insufficientMaterial(s.board)) return 'insufficient';
    if (seen && (seen.get(key(s)) || 0) >= 3) return 'repetition';
    return null;
  }

  /** Standard algebraic notation for `m`, which must be legal in `s`. */
  function san(s, m, legal = legalMoves(s)) {
    let out;
    if (m.flag === 'castle') out = m.to > m.from ? 'O-O' : 'O-O-O';
    else {
      const t = m.piece.toUpperCase();
      const capture = m.captured ? 'x' : '';
      if (t === 'P') {
        out = `${capture ? 'abcdefgh'[m.from & 7] + 'x' : ''}${nameOf(m.to)}${m.promo ? `=${m.promo.toUpperCase()}` : ''}`;
      } else {
        const rivals = legal.filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from);
        let dis = '';
        if (rivals.length) {
          const sameFile = rivals.some((o) => (o.from & 7) === (m.from & 7));
          const sameRank = rivals.some((o) => (o.from >> 3) === (m.from >> 3));
          if (!sameFile) dis = 'abcdefgh'[m.from & 7];
          else if (!sameRank) dis = String(8 - (m.from >> 3));
          else dis = nameOf(m.from);
        }
        out = `${t}${dis}${capture}${nameOf(m.to)}`;
      }
    }
    const next = m.next || makeMove(s, m);
    if (inCheck(next)) out += legalMoves(next).length ? '+' : '#';
    return out;
  }

  // ---------- evaluation ----------

  const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  // Piece-square tables from White's point of view, a8 first ("Simplified Evaluation Function").
  const PST = {
    P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    // Endgame king: head for the centre.
    KE: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
  };

  /** Score in centipawns from the side to move's point of view. */
  function evaluate(s) {
    const { board } = s;
    let material = 0;
    for (const p of board) if (p && p.toUpperCase() !== 'P' && p.toUpperCase() !== 'K') material += VALUE[p.toUpperCase()];
    const endgame = material <= 2600;
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const t = p.toUpperCase();
      const table = t === 'K' && endgame ? PST.KE : PST[t];
      if (p === t) score += VALUE[t] + table[i];
      else score -= VALUE[t] + table[(7 - (i >> 3)) * 8 + (i & 7)];
    }
    return s.turn === 'w' ? score : -score;
  }

  // ---------- search ----------

  const MATE = 100000;
  const ABORT = {};

  const orderScore = (m) => (m.captured ? 10 * VALUE[m.captured.toUpperCase()] - VALUE[m.piece.toUpperCase()] + 1000 : 0)
    + (m.promo ? 800 : 0);

  function createSearch(deadline) {
    let nodes = 0;
    const tick = () => {
      if ((++nodes & 1023) === 0 && Date.now() > deadline) throw ABORT;
    };

    function quiesce(s, alpha, beta, depth) {
      tick();
      const stand = evaluate(s);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      if (depth >= 6) return alpha;
      const moves = pseudoMoves(s, true).sort((a, b) => orderScore(b) - orderScore(a));
      for (const m of moves) {
        const next = makeMove(s, m);
        if (attacked(next.board, kingSquare(next.board, s.turn), next.turn)) continue;
        const score = -quiesce(next, -beta, -alpha, depth + 1);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    function negamax(s, depth, alpha, beta, ply) {
      tick();
      if (s.half >= 100) return 0;
      if (depth === 0) return quiesce(s, alpha, beta, 0);
      const moves = pseudoMoves(s).sort((a, b) => orderScore(b) - orderScore(a));
      let legal = 0;
      let best = -Infinity;
      for (const m of moves) {
        const next = makeMove(s, m);
        if (attacked(next.board, kingSquare(next.board, s.turn), next.turn)) continue;
        legal++;
        const score = -negamax(next, depth - 1, -beta, -alpha, ply + 1);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      if (!legal) return inCheck(s) ? -MATE + ply : 0;
      return best;
    }

    function root(s, moves, depth) {
      let alpha = -Infinity;
      const scored = [];
      for (const m of moves) {
        const score = -negamax(m.next, depth - 1, -Infinity, -alpha + 1, 1);
        scored.push([m, score]);
        if (score > alpha) alpha = score;
      }
      return scored;
    }

    return { root, negamax };
  }

  /**
   * Scores every legal move from the side to move's point of view (centipawns;
   * ±MATE-ish for forced mates), best first. Falls back to a shallower search if
   * `timeMs` runs out. Used by the post-game review, hints and Pip's move ratings.
   */
  function scoreMoves(s, depth = 3, timeMs = 1500) {
    const moves = legalMoves(s).sort((a, b) => orderScore(b) - orderScore(a));
    for (let d = depth; d >= 1; d--) {
      const search = createSearch(d === 1 ? Infinity : Date.now() + timeMs);
      try {
        return moves
          .map((m) => ({ move: m, score: -search.negamax(m.next, d - 1, -Infinity, Infinity, 1) }))
          .sort((a, b) => b.score - a.score);
      } catch (e) {
        if (e !== ABORT) throw e;
      }
    }
    return [];
  }

  /**
   * Pick a move for the side to move.
   * opts: { depth, timeMs, randomness } — randomness (0..1) sometimes plays a random legal move.
   */
  function bestMove(s, { depth = 3, timeMs = 1500, randomness = 0 } = {}) {
    const moves = legalMoves(s);
    if (!moves.length) return null;
    if (Math.random() < randomness) return moves[Math.floor(Math.random() * moves.length)];
    moves.sort((a, b) => orderScore(b) - orderScore(a));
    const search = createSearch(Date.now() + timeMs);
    let best = moves[0];
    for (let d = 1; d <= depth; d++) {
      try {
        const scored = search.root(s, moves, d);
        const top = Math.max(...scored.map(([, sc]) => sc));
        // Break exact ties randomly so the bot doesn't play the same game every time.
        // (Only the top score is exact; the others are bounds from the narrowed window.)
        const ties = scored.filter(([, sc]) => sc === top).map(([m]) => m);
        best = ties[Math.floor(Math.random() * ties.length)];
        // Search the best move first next iteration.
        moves.sort((a, b) => (a === best ? -1 : b === best ? 1 : 0));
        if (top >= MATE - 100) break; // found a forced mate
      } catch (e) {
        if (e !== ABORT) throw e;
        break;
      }
    }
    return best;
  }

  // ---------- mate search (puzzles) ----------

  /** Can the side to move force checkmate within `n` of its own moves? */
  function canMate(s, n) {
    for (const m of legalMoves(s)) if (defenderLoses(m.next, n)) return true;
    return false;
  }

  /**
   * `s` is the position right after an attacker move, and `n` counts attacker moves
   * including that one. True if the defender is mated, or every reply still loses
   * to mate within the remaining n - 1 moves.
   */
  function defenderLoses(s, n) {
    const check = inCheck(s);
    if (n === 1 && !check) return false; // the last move has to give check to be mate
    const replies = legalMoves(s);
    if (!replies.length) return check; // mate (or stalemate, which doesn't count)
    if (n === 1) return false;
    for (const r of replies) if (!canMate(r.next, n - 1)) return false;
    return true;
  }

  /** Moves that force mate within `n` (the puzzle solutions). */
  function matingMoves(s, n) {
    return legalMoves(s).filter((m) => defenderLoses(m.next, n));
  }

  /** Converts a state back to FEN. */
  function toFEN(s) {
    let rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = s.board[r * 8 + c];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p;
      }
      rows.push(row + (empty || ''));
    }
    const c = s.castle;
    const castling = `${c.K ? 'K' : ''}${c.Q ? 'Q' : ''}${c.k ? 'k' : ''}${c.q ? 'q' : ''}` || '-';
    return `${rows.join('/')} ${s.turn} ${castling} ${s.ep >= 0 ? nameOf(s.ep) : '-'} ${s.half} ${s.full}`;
  }

  return {
    scoreMoves, evaluate, MATE,
    canMate, defenderLoses, matingMoves, toFEN,
    fromFEN, initial, legalMoves, pseudoMoves, makeMove, inCheck, result, san, key, bestMove, colorOf, nameOf,
  };
})();

if (typeof module !== 'undefined') module.exports = ChessEngine;
