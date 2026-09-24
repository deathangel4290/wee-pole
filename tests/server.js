'use strict';

// End-to-end tests for the online server: starts it on a random port and talks
// to it over real HTTP + Server-Sent Events. Run: node tests/server.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server/app');

let failed = 0;
const check = (label, cond) => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardbox-'));
  const dataFile = path.join(dir, 'db.json');
  let app = createApp({ dataFile, staticDir: path.join(__dirname, '..'), registerLimit: 1000 });
  await new Promise((r) => app.server.listen(0, r));
  let base = `http://127.0.0.1:${app.server.address().port}`;

  const call = async (method, url, { token, body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };

  // Minimal SSE client: collects events so tests can wait for them.
  function listen(token) {
    const events = [];
    const waiters = [];
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${base}/api/events?token=${token}`, { signal: ctrl.signal });
        const decoder = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(block);
            const data = /^data: (.*)$/m.exec(block);
            if (!ev || !data) continue;
            const e = { event: ev[1], data: JSON.parse(data[1]) };
            events.push(e);
            for (const w of [...waiters]) if (w.test(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
          }
        }
      } catch (e) { /* aborted */ }
    })();
    return {
      events,
      next: (test, ms = 2000) => {
        const hit = events.find(test);
        if (hit) { events.splice(events.indexOf(hit), 1); return Promise.resolve(hit); }
        return new Promise((resolve, reject) => {
          const w = { test, resolve: (e) => { events.splice(events.indexOf(e), 1); resolve(e); } };
          waiters.push(w);
          setTimeout(() => reject(new Error('timed out waiting for event')), ms);
        });
      },
      close: () => ctrl.abort(),
    };
  }
  const today = new Date().toISOString().slice(0, 10);

  // ---- health + static ----
  check('health', (await call('GET', '/api/health')).data.ok === true);
  const page = await fetch(`${base}/`);
  check('serves the app', page.status === 200 && (await page.text()).includes('BOARD//BOX'));
  check('does not serve server code', (await fetch(`${base}/server/app.js`)).status === 404);
  check('blocks path traversal', (await fetch(`${base}/js/..%2Fserver%2Fapp.js`)).status === 404);
  check('does not serve the database', (await fetch(`${base}/data/boardbox.json`)).status === 404);

  // ---- accounts ----
  const alice = (await call('POST', '/api/register', { body: { name: 'alice' } })).data;
  const bob = (await call('POST', '/api/register', { body: { name: 'Bob_99' } })).data;
  const carol = (await call('POST', '/api/register', { body: { name: 'carol' } })).data;
  check('register returns a token', typeof alice.token === 'string' && alice.token.length > 20);
  check('names are unique (case-insensitive)', (await call('POST', '/api/register', { body: { name: 'ALICE' } })).status === 409);
  check('bad names rejected', (await call('POST', '/api/register', { body: { name: 'a b' } })).status === 400);
  check('auth required', (await call('GET', '/api/me')).status === 401);
  check('bad token rejected', (await call('GET', '/api/me', { token: 'nope' })).status === 401);
  check('me works', (await call('GET', '/api/me', { token: alice.token })).data.name === 'alice');
  check('token is not stored in plain text', !fs.existsSync(dataFile) || !fs.readFileSync(dataFile, 'utf8').includes(alice.token));

  const aliceEvents = listen(alice.token);
  const bobEvents = listen(bob.token);
  await aliceEvents.next((e) => e.event === 'hello');
  await bobEvents.next((e) => e.event === 'hello');

  // ---- friends ----
  check('request needs a real player', (await call('POST', '/api/friends', { token: alice.token, body: { name: 'nobody' } })).status === 404);
  check('send request', (await call('POST', '/api/friends', { token: alice.token, body: { name: 'bob_99' } })).data.status === 'requested');
  const notice = await bobEvents.next((e) => e.event === 'notice');
  check('bob is notified live', /alice/.test(notice.data.text));
  check('bob sees incoming request', (await call('GET', '/api/me', { token: bob.token })).data.incoming[0] === 'alice');
  check('accept request', (await call('POST', '/api/friends/respond', { token: bob.token, body: { name: 'alice', accept: true } })).data.status === 'friends');
  let me = (await call('GET', '/api/me', { token: alice.token })).data;
  check('now friends, and bob shows online', me.friends.length === 1 && me.friends[0].name === 'Bob_99' && me.friends[0].online);
  check('can only challenge friends', (await call('POST', '/api/matches', { token: alice.token, body: { game: 'chess', opponent: 'carol' } })).status === 403);

  // ---- daily leaderboards ----
  await call('POST', '/api/daily', { token: alice.token, body: { date: today, kind: 'sweep', done: true, tries: 2, time: 61.2 } });
  await call('POST', '/api/daily', { token: bob.token, body: { date: today, kind: 'sweep', done: true, tries: 1, time: 45.5 } });
  await call('POST', '/api/daily', { token: carol.token, body: { date: today, kind: 'sweep', done: true, tries: 1, time: 30 } });
  await call('POST', '/api/daily', { token: alice.token, body: { date: today, kind: 'sweep', done: true, tries: 3, time: 99 } });
  let lb = (await call('GET', `/api/leaderboard?kind=sweep&date=${today}&scope=global`, { token: alice.token })).data;
  check('global leaderboard ranks by time', lb.entries.map((e) => e.name).join() === 'carol,Bob_99,alice');
  check('worse time does not overwrite a best', lb.you.value === '61.2s' && lb.you.rank === 3);
  lb = (await call('GET', `/api/leaderboard?kind=sweep&date=${today}&scope=friends`, { token: alice.token })).data;
  check('friends leaderboard only has friends', lb.entries.map((e) => e.name).join() === 'Bob_99,alice');
  await call('POST', '/api/daily', { token: alice.token, body: { date: today, kind: '2048', done: false, tries: 1, score: 3000 } });
  await call('POST', '/api/daily', { token: bob.token, body: { date: today, kind: '2048', done: true, tries: 1, score: 5200 } });
  lb = (await call('GET', `/api/leaderboard?kind=2048&date=${today}`, { token: bob.token })).data;
  check('2048 ranks by score', lb.entries[0].name === 'Bob_99' && lb.entries[1].value === '3000');
  check('far-off dates rejected', (await call('POST', '/api/daily', { token: alice.token, body: { date: '2020-01-01', kind: 'sweep', done: true, time: 1 } })).status === 400);
  me = (await call('GET', '/api/me', { token: alice.token })).data;
  check('streak and friend daily status', me.streak === 1 && me.friends[0].today.sweep === true);

  // ---- challenge + a full game of tic-tac-toe ----
  const ch = (await call('POST', '/api/matches', { token: alice.token, body: { game: 'tictactoe', opponent: 'bob_99' } })).data;
  check('challenge created', ch.status === 'invited');
  await bobEvents.next((e) => e.event === 'notice' && e.data.match === ch.id);
  check('only the invitee can accept', (await call('POST', `/api/matches/${ch.id}/accept`, { token: alice.token })).status === 403);
  const accepted = (await call('POST', `/api/matches/${ch.id}/accept`, { token: bob.token })).data;
  check('challenge accepted', accepted.status === 'active');
  const seatOf = (name) => accepted.players.indexOf(name);
  const tokens = [];
  tokens[seatOf('alice')] = alice.token;
  tokens[seatOf('Bob_99')] = bob.token;
  const streamOf = [];
  streamOf[seatOf('alice')] = aliceEvents;
  streamOf[seatOf('Bob_99')] = bobEvents;

  check('wrong player cannot move', (await call('POST', `/api/matches/${ch.id}/move`, { token: tokens[1], body: { seq: 0, move: 4 } })).status === 409);
  check('stale seq rejected', (await call('POST', `/api/matches/${ch.id}/move`, { token: tokens[0], body: { seq: 3, move: 4 } })).status === 409);
  // Seat 0: 0, 1, 2 (wins on the top row); seat 1: 3, 4.
  const script = [0, 3, 1, 4, 2];
  for (let i = 0; i < script.length; i++) {
    const seat = i % 2;
    const final = i === script.length - 1 ? { winner: 0, reason: 'line' } : undefined;
    const r = await call('POST', `/api/matches/${ch.id}/move`, { token: tokens[seat], body: { seq: i, move: script[i], final } });
    if (r.status !== 200) check(`move ${i} accepted`, false);
    const got = await streamOf[1 - seat].next((e) => e.event === 'match' && e.data.id === ch.id && e.data.moves.length === i + 1);
    if (got.data.moves[i] !== script[i]) check(`opponent receives move ${i}`, false);
  }
  const done = (await call('GET', `/api/matches/${ch.id}`, { token: alice.token })).data;
  check('both players received every move; match finished', done.status === 'finished' && done.winner === 0 && done.moves.join() === script.join());
  check('no moves after the end', (await call('POST', `/api/matches/${ch.id}/move`, { token: tokens[1], body: { seq: 5, move: 8 } })).status === 409);
  me = (await call('GET', '/api/me', { token: tokens[0] })).data;
  check('winner record updated', me.record.w === 1);
  check('outsiders cannot see a match', (await call('GET', `/api/matches/${ch.id}`, { token: carol.token })).status === 404);

  // ---- quick match + resign ----
  check('queue waits for an opponent', (await call('POST', '/api/queue', { token: alice.token, body: { game: 'connect4' } })).data.status === 'waiting');
  const qm = (await call('POST', '/api/queue', { token: bob.token, body: { game: 'connect4' } })).data;
  check('second player gets matched', qm.status === 'matched' && qm.match.game === 'connect4');
  const n = await aliceEvents.next((e) => e.event === 'notice' && e.data.match === qm.match.id);
  check('first player is told to open the match', n.data.open === true);
  const res = (await call('POST', `/api/matches/${qm.match.id}/resign`, { token: alice.token })).data;
  check('resign gives the win to the other seat', res.status === 'finished' && res.players[res.winner] === 'Bob_99');
  check('offline players are not matched', (await call('POST', '/api/queue', { token: carol.token, body: { game: 'reversi' } })).data.status === 'waiting');

  // ---- persistence across restarts ----
  aliceEvents.close();
  bobEvents.close();
  await app.close();
  app = createApp({ dataFile, staticDir: null });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  me = (await call('GET', '/api/me', { token: alice.token })).data;
  // Seats are random, so alice may have won or lost the tic-tac-toe game; she resigned connect 4.
  check('data survives a restart', me && me.friends.length === 1 && me.record.w + me.record.l === 2 && me.record.l >= 1);
  lb = (await call('GET', `/api/leaderboard?kind=sweep&date=${today}`, { token: alice.token })).data;
  check('leaderboard survives a restart', lb.total === 3);

  // ---- account deletion ----
  check('delete account', (await call('DELETE', '/api/me', { token: carol.token })).status === 200);
  check('deleted token no longer works', (await call('GET', '/api/me', { token: carol.token })).status === 401);
  lb = (await call('GET', `/api/leaderboard?kind=sweep&date=${today}`, { token: alice.token })).data;
  check('deleted player leaves the leaderboard', lb.total === 2);

  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll server checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
