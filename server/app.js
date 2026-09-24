'use strict';

/*
 * BOARD//BOX online server. Zero dependencies: plain node:http, JSON over HTTP,
 * and Server-Sent Events to push live updates (moves, challenges, friend requests).
 *
 * Accounts are a username plus a random secret token that stays on the player's
 * device (only its SHA-256 hash is stored). Matches are relayed: the server
 * enforces seats and turn order, and each client runs the game rules itself.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createStore } = require('./store');

const VERSION = 1;
const GAMES = ['chess', 'checkers', 'reversi', 'connect4', 'tictactoe'];
const DAILY_KINDS = ['puzzle', '2048', 'sweep'];
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MAX_BODY = 16 * 1024;
const MAX_MOVE_JSON = 400;
const MAX_MOVES = 600;
const LEADERBOARD_SIZE = 50;

const STATIC_ROOTS = new Set(['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newId = () => crypto.randomBytes(9).toString('base64url');
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function createApp({ dataFile = null, staticDir = null, now = () => Date.now(), registerLimit = 20 } = {}) {
  const store = createStore(dataFile, { now });
  const db = store.data;

  // Derived indexes (rebuilt from the data on start).
  const byName = new Map(); // lowercase name -> user id
  const byToken = new Map(); // token hash -> user id
  for (const u of Object.values(db.users)) {
    byName.set(u.name.toLowerCase(), u.id);
    byToken.set(u.tokenHash, u.id);
  }

  const streams = new Map(); // user id -> Set of SSE responses
  const queue = new Map(); // game -> waiting user id
  const registrations = new Map(); // ip -> [timestamps] (simple rate limit)

  // ---------- helpers ----------

  const userByName = (name) => {
    const id = typeof name === 'string' ? byName.get(name.toLowerCase()) : null;
    return id ? db.users[id] : null;
  };
  const isOnline = (id) => streams.has(id);

  function send(userId, event, payload) {
    const set = streams.get(userId);
    if (!set) return;
    const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) res.write(chunk);
  }

  const poke = (userId) => send(userId, 'me', { at: now() });

  function streak(userId) {
    const doneDays = new Set();
    for (const [date, kinds] of Object.entries(db.daily)) {
      if (Object.values(kinds).some((byUser) => byUser[userId]?.done)) doneDays.add(date);
    }
    // Count back from today (UTC), allowing today to still be pending.
    let day = now();
    if (!doneDays.has(isoDay(day))) day -= 86400000;
    let n = 0;
    while (doneDays.has(isoDay(day))) {
      n++;
      day -= 86400000;
    }
    return n;
  }

  function todayFor(userId) {
    // Most recent daily date the user submitted (their local "today").
    const dates = Object.keys(db.daily).filter((d) => Object.values(db.daily[d]).some((k) => k[userId])).sort();
    const date = dates[dates.length - 1];
    if (!date) return null;
    const out = { date };
    for (const kind of DAILY_KINDS) out[kind] = !!db.daily[date][kind]?.[userId]?.done;
    return out;
  }

  function matchView(m) {
    return {
      id: m.id,
      game: m.game,
      players: m.names,
      status: m.status,
      turn: m.moves.length % 2,
      moves: m.moves,
      winner: m.winner ?? null,
      reason: m.reason || null,
      invitedBy: m.invitedBy ? db.users[m.invitedBy]?.name || null : null,
      created: m.created,
      updated: m.updated,
    };
  }

  function touchMatch(m) {
    m.updated = now();
    store.save();
    const view = matchView(m);
    for (const id of m.players) if (id) send(id, 'match', view);
  }

  function finishMatch(m, winner, reason) {
    m.status = 'finished';
    m.winner = winner; // seat index, or null for a draw
    m.reason = reason;
    m.players.forEach((id, seat) => {
      const u = id && db.users[id];
      if (!u) return;
      u.record = u.record || { w: 0, l: 0, d: 0 };
      if (winner === null) u.record.d++;
      else if (winner === seat) u.record.w++;
      else u.record.l++;
    });
  }

  function createMatch(game, a, b) {
    // Random seats: seat 0 always moves first.
    const players = Math.random() < 0.5 ? [a, b] : [b, a];
    const m = {
      id: newId(),
      game,
      players,
      names: players.map((id) => db.users[id].name),
      status: 'active',
      moves: [],
      created: now(),
      updated: now(),
    };
    db.matches[m.id] = m;
    return m;
  }

  function meView(u) {
    const friend = (id) => {
      const f = db.users[id];
      return { name: f.name, online: isOnline(id), streak: streak(id), today: todayFor(id), record: f.record || { w: 0, l: 0, d: 0 } };
    };
    const matches = Object.values(db.matches)
      .filter((m) => m.players.includes(u.id) && (m.status !== 'finished' || now() - m.updated < 3 * 86400000))
      .filter((m) => !['declined', 'cancelled'].includes(m.status))
      .sort((x, y) => y.updated - x.updated)
      .slice(0, 30)
      .map((m) => ({ ...matchView(m), moves: undefined, moveCount: m.moves.length, seat: m.players.indexOf(u.id) }));
    let queued = null;
    for (const [game, id] of queue) if (id === u.id) queued = game;
    return {
      name: u.name,
      record: u.record || { w: 0, l: 0, d: 0 },
      streak: streak(u.id),
      friends: u.friends.filter((id) => db.users[id]).map(friend),
      incoming: u.incoming.filter((id) => db.users[id]).map((id) => db.users[id].name),
      outgoing: u.outgoing.filter((id) => db.users[id]).map((id) => db.users[id].name),
      matches,
      queued,
    };
  }

  // ---------- daily leaderboards ----------

  const RANK = {
    puzzle: {
      include: (e) => e.done,
      compare: (a, b) => a.tries - b.tries || a.at - b.at,
      label: (e) => `${e.tries} ${e.tries === 1 ? 'try' : 'tries'}`,
    },
    2048: {
      include: (e) => e.score > 0,
      compare: (a, b) => b.score - a.score || a.at - b.at,
      label: (e) => `${e.score}${e.done ? ' ✓' : ''}`,
    },
    sweep: {
      include: (e) => e.done,
      compare: (a, b) => a.time - b.time || a.at - b.at,
      label: (e) => `${e.time}s`,
    },
  };

  function validDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
    // Players submit their local date; allow for every timezone on Earth.
    const t = Date.parse(`${date}T00:00:00Z`);
    return Math.abs(t - now()) <= 2 * 86400000;
  }

  const num = (v, max) => (Number.isFinite(v) && v >= 0 && v <= max ? v : null);

  function submitDaily(u, body) {
    const { date, kind } = body;
    if (!validDate(date)) throw new HttpError(400, 'Bad date');
    if (!DAILY_KINDS.includes(kind)) throw new HttpError(400, 'Bad kind');
    const tries = num(body.tries, 10000);
    const score = num(body.score, 1e8);
    const time = num(body.time, 86400);
    const byKind = (db.daily[date] = db.daily[date] || {});
    const byUser = (byKind[kind] = byKind[kind] || {});
    const prev = byUser[u.id] || { done: false, tries: 0, score: 0, time: null, at: now() };
    const next = { ...prev };
    if (!prev.done && tries !== null) next.tries = Math.floor(tries);
    if (score !== null && score > prev.score) { next.score = Math.floor(score); next.at = now(); }
    if (time !== null && body.done && (prev.time === null || time < prev.time)) { next.time = Math.round(time * 10) / 10; next.at = now(); }
    if (body.done && !prev.done) { next.done = true; next.at = now(); }
    byUser[u.id] = next;
    store.save();
    for (const id of u.friends) poke(id); // friends see your daily progress live
    return next;
  }

  function leaderboard(u, { kind, date, scope }) {
    if (!DAILY_KINDS.includes(kind)) throw new HttpError(400, 'Bad kind');
    if (!validDate(date)) throw new HttpError(400, 'Bad date');
    const rule = RANK[kind];
    let rows = Object.entries(db.daily[date]?.[kind] || {})
      .filter(([id, e]) => db.users[id] && rule.include(e))
      .map(([id, e]) => ({ id, ...e }));
    if (scope === 'friends') {
      const circle = new Set([u.id, ...u.friends]);
      rows = rows.filter((r) => circle.has(r.id));
    }
    rows.sort(rule.compare);
    const view = (r, i) => ({ rank: i + 1, name: db.users[r.id].name, value: rule.label(r), you: r.id === u.id });
    const mine = rows.findIndex((r) => r.id === u.id);
    return {
      kind,
      date,
      scope: scope === 'friends' ? 'friends' : 'global',
      total: rows.length,
      entries: rows.slice(0, LEADERBOARD_SIZE).map(view),
      you: mine >= 0 ? view(rows[mine], mine) : null,
    };
  }

  // ---------- routes ----------

  function register(body, ip) {
    const recent = (registrations.get(ip) || []).filter((t) => now() - t < 3600000);
    if (recent.length >= registerLimit) throw new HttpError(429, 'Too many new accounts from here. Try again later.');
    const name = String(body.name || '').trim();
    if (!NAME_RE.test(name)) throw new HttpError(400, 'Usernames are 3–16 letters, numbers or _');
    if (byName.has(name.toLowerCase())) throw new HttpError(409, 'That username is taken');
    const token = crypto.randomBytes(24).toString('base64url');
    const u = { id: newId(), name, tokenHash: sha256(token), created: now(), friends: [], incoming: [], outgoing: [], record: { w: 0, l: 0, d: 0 } };
    db.users[u.id] = u;
    byName.set(name.toLowerCase(), u.id);
    byToken.set(u.tokenHash, u.id);
    recent.push(now());
    registrations.set(ip, recent);
    store.save();
    return { token, name };
  }

  function deleteAccount(u) {
    for (const other of Object.values(db.users)) {
      for (const list of ['friends', 'incoming', 'outgoing']) {
        const i = other[list].indexOf(u.id);
        if (i >= 0) { other[list].splice(i, 1); poke(other.id); }
      }
    }
    for (const m of Object.values(db.matches)) {
      if (!m.players.includes(u.id)) continue;
      if (m.status === 'active') finishMatch(m, 1 - m.players.indexOf(u.id), 'resigned');
      else if (m.status === 'invited') m.status = 'cancelled';
      m.players = m.players.map((id) => (id === u.id ? null : id));
      touchMatch(m);
    }
    for (const [game, id] of queue) if (id === u.id) queue.delete(game);
    for (const kinds of Object.values(db.daily)) for (const byUser of Object.values(kinds)) delete byUser[u.id];
    byName.delete(u.name.toLowerCase());
    byToken.delete(u.tokenHash);
    delete db.users[u.id];
    for (const res of streams.get(u.id) || []) res.end();
    streams.delete(u.id);
    store.save();
  }

  function addFriend(u, name) {
    const f = userByName(name);
    if (!f) throw new HttpError(404, 'No player with that name');
    if (f.id === u.id) throw new HttpError(400, 'That’s you!');
    if (u.friends.includes(f.id)) return { status: 'friends' };
    if (u.incoming.includes(f.id)) {
      // They already asked: accept.
      u.incoming.splice(u.incoming.indexOf(f.id), 1);
      f.outgoing.splice(f.outgoing.indexOf(u.id), 1);
      u.friends.push(f.id);
      f.friends.push(u.id);
      store.save();
      poke(f.id);
      return { status: 'friends' };
    }
    if (!u.outgoing.includes(f.id)) {
      if (u.outgoing.length >= 100) throw new HttpError(400, 'Too many pending requests');
      u.outgoing.push(f.id);
      f.incoming.push(u.id);
      store.save();
      send(f.id, 'notice', { text: `👋 ${u.name} wants to be friends` });
      poke(f.id);
    }
    return { status: 'requested' };
  }

  function respondFriend(u, name, accept) {
    const f = userByName(name);
    if (!f || !u.incoming.includes(f.id)) throw new HttpError(404, 'No request from that player');
    u.incoming.splice(u.incoming.indexOf(f.id), 1);
    f.outgoing.splice(f.outgoing.indexOf(u.id), 1);
    if (accept) {
      u.friends.push(f.id);
      f.friends.push(u.id);
      send(f.id, 'notice', { text: `🤝 ${u.name} accepted your friend request` });
    }
    store.save();
    poke(f.id);
    return { status: accept ? 'friends' : 'declined' };
  }

  function removeFriend(u, name) {
    const f = userByName(name);
    if (!f) throw new HttpError(404, 'No player with that name');
    for (const [a, b] of [[u, f], [f, u]]) {
      for (const list of ['friends', 'incoming', 'outgoing']) {
        const i = a[list].indexOf(b.id);
        if (i >= 0) a[list].splice(i, 1);
      }
    }
    store.save();
    poke(f.id);
    return { status: 'removed' };
  }

  function challenge(u, { game, opponent }) {
    if (!GAMES.includes(game)) throw new HttpError(400, 'Unknown game');
    const f = userByName(opponent);
    if (!f || !u.friends.includes(f.id)) throw new HttpError(403, 'You can only challenge friends');
    const open = Object.values(db.matches).filter((m) => m.status === 'invited' && m.invitedBy === u.id);
    if (open.length >= 20) throw new HttpError(400, 'Too many open challenges');
    const m = createMatch(game, u.id, f.id);
    m.status = 'invited';
    m.invitedBy = u.id;
    touchMatch(m);
    send(f.id, 'notice', { text: `⚔️ ${u.name} challenged you to ${game}`, match: m.id });
    poke(f.id);
    poke(u.id);
    return matchView(m);
  }

  function getMatch(u, id) {
    const m = db.matches[id];
    if (!m || !m.players.includes(u.id)) throw new HttpError(404, 'No such match');
    return m;
  }

  function respondChallenge(u, m, action) {
    if (m.status !== 'invited') throw new HttpError(409, 'This challenge is no longer open');
    const invitee = m.players.find((id) => id !== m.invitedBy);
    if (action === 'cancel') {
      if (u.id !== m.invitedBy) throw new HttpError(403, 'Only the challenger can cancel');
      m.status = 'cancelled';
    } else {
      if (u.id !== invitee) throw new HttpError(403, 'Only the invited player can respond');
      m.status = action === 'accept' ? 'active' : 'declined';
    }
    touchMatch(m);
    for (const id of m.players) poke(id);
    return matchView(m);
  }

  function move(u, m, { seq, move: mv, final }) {
    if (m.status !== 'active') throw new HttpError(409, 'This match is over');
    const seat = m.players.indexOf(u.id);
    if (seq !== m.moves.length) throw new HttpError(409, 'Out of sync — reload the match');
    if (seat !== m.moves.length % 2) throw new HttpError(409, 'Not your turn');
    if (m.moves.length >= MAX_MOVES) throw new HttpError(400, 'Match too long');
    if (mv === undefined || JSON.stringify(mv).length > MAX_MOVE_JSON) throw new HttpError(400, 'Bad move');
    m.moves.push(mv);
    if (final) {
      const w = final.winner;
      if (!(w === null || w === 0 || w === 1)) throw new HttpError(400, 'Bad result');
      finishMatch(m, w, String(final.reason || 'end').slice(0, 30));
    }
    touchMatch(m);
    return matchView(m);
  }

  function resign(u, m) {
    if (m.status !== 'active') throw new HttpError(409, 'This match is over');
    finishMatch(m, 1 - m.players.indexOf(u.id), 'resigned');
    touchMatch(m);
    for (const id of m.players) poke(id);
    return matchView(m);
  }

  function joinQueue(u, game) {
    if (!GAMES.includes(game)) throw new HttpError(400, 'Unknown game');
    leaveQueue(u);
    const waiting = queue.get(game);
    if (waiting && waiting !== u.id && isOnline(waiting) && db.users[waiting]) {
      queue.delete(game);
      const m = createMatch(game, waiting, u.id);
      touchMatch(m);
      send(waiting, 'notice', { text: `🎲 Matched with ${u.name}!`, match: m.id, open: true });
      poke(waiting);
      return { status: 'matched', match: matchView(m) };
    }
    queue.set(game, u.id);
    return { status: 'waiting', game };
  }

  function leaveQueue(u) {
    for (const [game, id] of queue) if (id === u.id) queue.delete(game);
    return { status: 'left' };
  }

  // ---------- HTTP plumbing ----------

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, 'Request too large'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch (e) {
          reject(new HttpError(400, 'Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  function auth(req, url) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    const id = token && byToken.get(sha256(token));
    if (!id || !db.users[id]) throw new HttpError(401, 'Sign in again');
    return db.users[id];
  }

  function cors(res) {
    // Auth uses a bearer token (not cookies), so allowing any origin is safe and lets
    // a statically hosted frontend (e.g. GitHub Pages) talk to this server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  function json(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  }

  function events(req, res, u) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // don't let proxies buffer the stream
    });
    res.write('retry: 3000\n\n');
    const set = streams.get(u.id) || new Set();
    const wasOffline = set.size === 0;
    set.add(res);
    streams.set(u.id, set);
    send(u.id, 'hello', { name: u.name });
    if (wasOffline) for (const id of u.friends) poke(id); // friends see you come online
    req.on('close', () => {
      set.delete(res);
      if (set.size) return;
      streams.delete(u.id);
      for (const [game, id] of queue) if (id === u.id) queue.delete(game);
      for (const id of u.friends) poke(id);
    });
  }

  function serveStatic(req, res, pathname) {
    if (!staticDir || req.method !== 'GET') return false;
    let rel;
    try {
      rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch (e) {
      return false;
    }
    const root = path.resolve(staticDir);
    const file = path.resolve(root, rel);
    // Check the *resolved* path, so "js/../server/app.js" can't escape the allow-list.
    const inside = path.relative(root, file);
    if (inside.startsWith('..') || path.isAbsolute(inside) || !STATIC_ROOTS.has(inside.split(path.sep)[0])) return false;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (e) {
      return false;
    }
    if (!stat.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, version: VERSION, games: GAMES }), { auth: false }],
    ['POST', /^\/api\/register$/, (c) => register(c.body, c.ip), { auth: false }],
    ['GET', /^\/api\/me$/, (c) => meView(c.user)],
    ['DELETE', /^\/api\/me$/, (c) => { deleteAccount(c.user); return { status: 'deleted' }; }],
    ['POST', /^\/api\/friends$/, (c) => addFriend(c.user, c.body.name)],
    ['POST', /^\/api\/friends\/respond$/, (c) => respondFriend(c.user, c.body.name, !!c.body.accept)],
    ['DELETE', /^\/api\/friends\/([\w]+)$/, (c) => removeFriend(c.user, c.params[0])],
    ['POST', /^\/api\/daily$/, (c) => submitDaily(c.user, c.body)],
    ['GET', /^\/api\/leaderboard$/, (c) => leaderboard(c.user, Object.fromEntries(c.url.searchParams))],
    ['POST', /^\/api\/matches$/, (c) => challenge(c.user, c.body)],
    ['GET', /^\/api\/matches\/([\w-]+)$/, (c) => matchView(getMatch(c.user, c.params[0]))],
    ['POST', /^\/api\/matches\/([\w-]+)\/(accept|decline|cancel)$/, (c) => respondChallenge(c.user, getMatch(c.user, c.params[0]), c.params[1])],
    ['POST', /^\/api\/matches\/([\w-]+)\/move$/, (c) => move(c.user, getMatch(c.user, c.params[0]), c.body)],
    ['POST', /^\/api\/matches\/([\w-]+)\/resign$/, (c) => resign(c.user, getMatch(c.user, c.params[0]))],
    ['POST', /^\/api\/queue$/, (c) => joinQueue(c.user, c.body.game)],
    ['DELETE', /^\/api\/queue$/, (c) => leaveQueue(c.user)],
  ];

  async function handle(req, res) {
    cors(res);
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      if (url.pathname === '/api/events' && req.method === 'GET') {
        events(req, res, auth(req, url));
        return;
      }
      for (const [method, re, fn, opts = {}] of routes) {
        if (method !== req.method) continue;
        const match = url.pathname.match(re);
        if (!match) continue;
        const ctx = {
          url,
          params: match.slice(1),
          ip: req.socket.remoteAddress,
          body: method === 'POST' ? await readBody(req) : {},
        };
        if (opts.auth !== false) ctx.user = auth(req, url);
        json(res, 200, fn(ctx));
        return;
      }
      if (serveStatic(req, res, url.pathname)) return;
      throw new HttpError(404, 'Not found');
    } catch (e) {
      if (e instanceof HttpError) json(res, e.status, { error: e.message });
      else {
        console.error(e);
        json(res, 500, { error: 'Server error' });
      }
    }
  }

  const server = http.createServer(handle);
  // Keep SSE connections alive through proxies.
  const heartbeat = setInterval(() => {
    for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
  }, 25000);
  heartbeat.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    store.flush();
  });

  return {
    server,
    store,
    close: () => new Promise((resolve) => {
      for (const set of streams.values()) for (const res of set) res.end();
      server.close(() => resolve());
    }),
  };
}

module.exports = { createApp, GAMES, DAILY_KINDS };
