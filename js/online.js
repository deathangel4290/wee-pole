'use strict';

/*
 * Online features: account, live events, friends, daily leaderboards and matches.
 *
 * BB.net is the client for server/app.js. The screens (Online lobby, Friends,
 * Leaderboard, Match) are routed from main.js through BB.onlineRoute(). If no
 * server is reachable, every online entry point stays hidden and the app works
 * exactly as it does offline.
 */
BB.net = (() => {
  const ACCOUNT_KEY = 'boardbox.account';
  const PENDING_KEY = 'boardbox.pendingDaily';
  const base = ((window.BB_CONFIG && window.BB_CONFIG.server) || '').replace(/\/+$/, '');

  const read = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch (e) {
      return null;
    }
  };
  const write = (k, v) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* storage unavailable */ }
  };

  let account = read(ACCOUNT_KEY); // { token, name }
  let available = null; // null = not checked yet
  let checking = null;
  let me = null;
  let source = null;
  const listeners = { me: new Set(), match: new Set(), notice: new Set() };

  function on(event, fn) {
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  }
  const emit = (event, data) => { for (const fn of [...listeners[event]]) fn(data); };

  async function request(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(account ? { Authorization: `Bearer ${account.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401 && account) signOut();
      const err = new Error((data && data.error) || `Something went wrong (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Is a server reachable? Cached after the first answer. */
  function check() {
    if (available !== null) return Promise.resolve(available);
    if (!checking) {
      const timeout = new Promise((r) => setTimeout(() => r(false), 4000));
      const probe = fetch(`${base}/api/health`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => !!(d && d.ok))
        .catch(() => false);
      checking = Promise.race([probe, timeout]).then((ok) => {
        available = ok;
        checking = null;
        if (ok && account) {
          connect();
          refreshMe().catch(() => {});
          flushPending();
        }
        return ok;
      });
    }
    return checking;
  }

  function connect() {
    if (!account || source || typeof EventSource === 'undefined') return;
    source = new EventSource(`${base}/api/events?token=${encodeURIComponent(account.token)}`);
    source.addEventListener('match', (e) => emit('match', JSON.parse(e.data)));
    source.addEventListener('me', () => refreshMe().catch(() => {}));
    source.addEventListener('notice', (e) => emit('notice', JSON.parse(e.data)));
    // EventSource reconnects by itself; refresh state when it does.
    source.addEventListener('hello', () => refreshMe().catch(() => {}));
  }

  function disconnect() {
    if (source) source.close();
    source = null;
  }

  async function refreshMe() {
    if (!account) return null;
    me = await request('GET', '/api/me');
    emit('me', me);
    return me;
  }

  function setAccount(a) {
    account = a;
    write(ACCOUNT_KEY, a);
  }

  async function register(name) {
    const r = await request('POST', '/api/register', { name });
    setAccount({ token: r.token, name: r.name });
    connect();
    await refreshMe();
    flushPending();
    return r;
  }

  /** Sign in on another device with the code shown under "Sign-in code". */
  async function signInWithCode(code) {
    const prev = account;
    account = { token: code.trim(), name: '' };
    try {
      const m = await request('GET', '/api/me');
      setAccount({ token: account.token, name: m.name });
      connect();
      me = m;
      emit('me', me);
      return m;
    } catch (e) {
      account = prev;
      throw e.status === 401 ? new Error('That code didn’t work') : e;
    }
  }

  function signOut() {
    disconnect();
    setAccount(null);
    me = null;
    emit('me', null);
  }

  async function deleteAccount() {
    await request('DELETE', '/api/me');
    signOut();
  }

  // ---- daily results: submitted on every update; queued while offline ----

  function submitDaily(date, kind, entry) {
    if (!account) return;
    const body = { date, kind, done: !!entry.done, tries: entry.tries, score: entry.score, time: entry.time };
    request('POST', '/api/daily', body).catch(() => {
      const pending = read(PENDING_KEY) || {};
      pending[`${date}:${kind}`] = body;
      write(PENDING_KEY, pending);
    });
  }

  async function flushPending() {
    const pending = read(PENDING_KEY);
    if (!pending || !account) return;
    for (const [k, body] of Object.entries(pending)) {
      try {
        await request('POST', '/api/daily', body);
        delete pending[k];
      } catch (e) {
        if (e.status === 400) delete pending[k]; // too old: drop it
      }
    }
    write(PENDING_KEY, Object.keys(pending).length ? pending : null);
  }

  window.addEventListener('online', () => {
    if (available === false) available = null;
    check();
  });

  return {
    check,
    on,
    refreshMe,
    register,
    signInWithCode,
    signOut,
    deleteAccount,
    submitDaily,
    get account() { return account; },
    get me() { return me; },
    get available() { return available; },
    addFriend: (name) => request('POST', '/api/friends', { name }),
    respondFriend: (name, accept) => request('POST', '/api/friends/respond', { name, accept }),
    removeFriend: (name) => request('DELETE', `/api/friends/${encodeURIComponent(name)}`),
    leaderboard: (kind, date, scope) => request('GET', `/api/leaderboard?kind=${kind}&date=${date}&scope=${scope}`),
    challenge: (game, opponent) => request('POST', '/api/matches', { game, opponent }),
    respondMatch: (id, action) => request('POST', `/api/matches/${id}/${action}`),
    getMatch: (id) => request('GET', `/api/matches/${id}`),
    move: (id, seq, move, final) => request('POST', `/api/matches/${id}/move`, { seq, move, final }),
    resign: (id) => request('POST', `/api/matches/${id}/resign`),
    queue: (game) => request('POST', '/api/queue', { game }),
    leaveQueue: () => request('DELETE', '/api/queue'),
  };
})();

(() => {
  const { el } = BB;
  const net = BB.net;
  // Like node.replaceChildren(), but flattens arrays and skips null/false (like BB.el does).
  const fill = (node, ...children) => node.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  const ONLINE_GAMES = ['chess', 'checkers', 'reversi', 'connect4', 'tictactoe'];
  const gameOf = (id) => BB.find(id) || { id, name: id, icon: '🎲' };
  // An array, not an object: object keys like '2048' would be sorted first.
  const KINDS = [['puzzle', '♟️ Puzzle'], ['2048', '🔢 2048'], ['sweep', '💣 Sweep']];

  // ---------- shared bits ----------

  function matchState(m) {
    if (m.status === 'invited') return m.invitedBy === net.account.name ? 'Waiting for them to accept' : 'Challenged you!';
    if (m.status === 'finished') {
      if (m.winner === null) return 'Draw';
      return m.winner === m.seat ? 'You won' : 'You lost';
    }
    return m.turn === m.seat ? 'Your move' : 'Their move';
  }

  const opponentOf = (m) => m.players[1 - m.seat] || 'deleted player';

  function spinner(text) {
    return el('div', { class: 'online-empty' }, el('span', { class: 'dots', 'aria-hidden': 'true' }), text);
  }

  function errorBox(err, retry) {
    return el('div', { class: 'online-empty' },
      el('strong', null, 'Couldn’t reach the server'),
      el('small', null, err.message),
      retry ? el('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again') : null);
  }

  /** Small modal to pick a game; resolves with the id, or null. */
  function pickGame(title) {
    return new Promise((resolve) => {
      const box = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
      const close = (v) => { box.remove(); resolve(v); };
      box.addEventListener('click', (e) => { if (e.target === box) close(null); });
      box.append(el('div', { class: 'reel' },
        el('div', { class: 'reel-label' }, title.toUpperCase()),
        el('div', { class: 'pick-list' },
          ONLINE_GAMES.map((id) => el('button', { class: 'pick-btn', type: 'button', onclick: () => close(id) },
            el('span', { 'aria-hidden': 'true' }, gameOf(id).icon), gameOf(id).name))),
        el('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'Cancel')));
      document.body.append(box);
    });
  }

  // ---------- home card ----------

  /** Fills `slot` on the home screen once we know a server is reachable. */
  function homeCard(slot) {
    net.check().then((ok) => {
      if (!ok || !slot.isConnected) return;
      const update = () => {
        if (!slot.isConnected) return;
        if (!net.account) {
          fill(slot, el('a', { class: 'online-card', href: '#/online' },
            el('span', { class: 'online-icon', 'aria-hidden': 'true' }, '⚔️'),
            el('span', { class: 'online-text' }, el('strong', null, 'Play online'), el('small', null, 'Friends, leaderboards and live matches')),
            el('span', { class: 'daily-state' }, 'Join →')));
          return;
        }
        const me = net.me;
        const yourTurn = me ? me.matches.filter((m) => m.status === 'active' && m.turn === m.seat).length : 0;
        const invites = me ? me.matches.filter((m) => m.status === 'invited' && m.invitedBy !== net.account.name).length + me.incoming.length : 0;
        const bits = [];
        if (yourTurn) bits.push(`${yourTurn} your turn`);
        if (invites) bits.push(`${invites} new`);
        fill(slot, el('a', { class: `online-card${yourTurn || invites ? ' hot' : ''}`, href: '#/online' },
          el('span', { class: 'online-icon', 'aria-hidden': 'true' }, '⚔️'),
          el('span', { class: 'online-text' },
            el('strong', null, 'Online'),
            el('small', null, `@${net.account.name}${bits.length ? ` · ${bits.join(' · ')}` : ' · Play friends or anyone'}`)),
          el('span', { class: 'daily-state' }, 'Open →')),
        el('a', { class: 'leader-link', href: '#/leaderboard' }, '🏆 Today’s leaderboards →'));
      };
      update();
      const off = net.on('me', update);
      // Stop listening once the home screen goes away.
      const obs = new MutationObserver(() => { if (!slot.isConnected) { off(); obs.disconnect(); } });
      obs.observe(document.getElementById('app'), { childList: true });
    });
  }

  // ---------- screens ----------

  function screen(ctx, title, icon) {
    const body = el('main', { class: 'online' });
    ctx.app.replaceChildren(ctx.header(title, icon), body);
    window.scrollTo(0, 0);
    return body;
  }

  /** Sign-up / sign-in screen, or "online isn't available". */
  function renderJoin(ctx, body) {
    const input = el('input', {
      class: 'field', type: 'text', maxlength: '16', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false',
      placeholder: 'username', 'aria-label': 'Username',
    });
    const msg = el('p', { class: 'form-msg', role: 'alert' });
    const code = el('input', { class: 'field', type: 'password', autocomplete: 'off', placeholder: 'sign-in code', 'aria-label': 'Sign-in code' });
    const codeMsg = el('p', { class: 'form-msg', role: 'alert' });

    const submit = async (e) => {
      e.preventDefault();
      msg.textContent = '';
      try {
        await net.register(input.value.trim());
        ctx.toast(`Welcome, ${net.account.name}! 🎉`);
        ctx.route();
      } catch (err) {
        msg.textContent = err.message;
      }
    };
    const signIn = async (e) => {
      e.preventDefault();
      codeMsg.textContent = '';
      try {
        await net.signInWithCode(code.value);
        ctx.toast(`Signed in as ${net.account.name}`);
        ctx.route();
      } catch (err) {
        codeMsg.textContent = err.message;
      }
    };

    fill(body, 
      el('section', { class: 'panel' },
        el('h2', { class: 'panel-title' }, 'Pick a username'),
        el('p', { class: 'muted' }, 'That’s all you need: no email, no password. Your account lives on this device.'),
        el('form', { class: 'row-form', onsubmit: submit }, input, el('button', { class: 'btn primary', type: 'submit' }, 'Join')),
        msg,
        el('p', { class: 'fineprint' }, '3–16 letters, numbers or _. Other players will see it on leaderboards.')),
      el('section', { class: 'panel' },
        el('h2', { class: 'panel-title' }, 'Already playing on another device?'),
        el('p', { class: 'muted' }, 'On that device open Online → Account → Sign-in code, and paste it here.'),
        el('form', { class: 'row-form', onsubmit: signIn }, code, el('button', { class: 'btn', type: 'submit' }, 'Sign in')),
        codeMsg));
    input.focus();
  }

  function renderOnline(ctx) {
    const body = screen(ctx, 'Online', '⚔️');
    body.append(spinner('Connecting…'));
    let offs = [];
    ctx.setCleanup(() => offs.forEach((f) => f()));

    net.check().then((ok) => {
      if (!ok) {
        fill(body, el('div', { class: 'online-empty' },
          el('strong', null, 'Online play isn’t set up here'),
          el('small', null, 'This copy of the app isn’t connected to a BOARD//BOX server. Everything else works offline. (Setting one up: docs/ONLINE.md)')));
        return;
      }
      if (!net.account) { renderJoin(ctx, body); return; }

      const draw = (me) => {
        if (!me) return;
        const invites = me.matches.filter((m) => m.status === 'invited');
        const active = me.matches.filter((m) => m.status === 'active').sort((a, b) => (b.turn === b.seat) - (a.turn === a.seat));
        const finished = me.matches.filter((m) => m.status === 'finished').slice(0, 5);

        const row = (m, actions) => el('div', { class: `match-row${m.status === 'active' && m.turn === m.seat ? ' hot' : ''}` },
          el('a', { class: 'match-main', href: `#/match/${m.id}` },
            el('span', { class: 'match-icon', 'aria-hidden': 'true' }, gameOf(m.game).icon),
            el('span', { class: 'match-text' },
              el('strong', null, `${gameOf(m.game).name} vs ${opponentOf(m)}`),
              el('small', null, matchState(m)))),
          actions);

        const act = (label, fn, cls = 'btn') => el('button', {
          class: cls, type: 'button',
          onclick: async () => {
            try { await fn(); await net.refreshMe(); } catch (e) { ctx.toast(e.message); }
          },
        }, label);

        const quick = el('div', { class: 'quick-grid' },
          ONLINE_GAMES.map((id) => el('button', {
            class: `quick-btn${me.queued === id ? ' on' : ''}`, type: 'button',
            onclick: async () => {
              try {
                if (me.queued === id) { await net.leaveQueue(); await net.refreshMe(); return; }
                const r = await net.queue(id);
                if (r.status === 'matched') location.hash = `#/match/${r.match.id}`;
                else await net.refreshMe();
              } catch (e) { ctx.toast(e.message); }
            },
          }, el('span', { 'aria-hidden': 'true' }, gameOf(id).icon), gameOf(id).name)));

        fill(body, 
          el('div', { class: 'tiles' },
            el('div', { class: 'tile' }, el('strong', null, `@${me.name}`), el('span', null, 'signed in')),
            el('div', { class: 'tile' }, el('strong', null, `${me.record.w}–${me.record.l}–${me.record.d}`), el('span', null, 'online W–L–D'))),
          invites.length ? el('h2', { class: 'section-title' }, 'CHALLENGES') : null,
          invites.map((m) => row(m, m.invitedBy === me.name
            ? el('div', { class: 'row-actions' }, act('Cancel', () => net.respondMatch(m.id, 'cancel')))
            : el('div', { class: 'row-actions' },
              act('Decline', () => net.respondMatch(m.id, 'decline')),
              act('Accept', async () => { await net.respondMatch(m.id, 'accept'); location.hash = `#/match/${m.id}`; }, 'btn primary')))),
          el('h2', { class: 'section-title' }, 'YOUR GAMES'),
          active.length ? active.map((m) => row(m, null)) : el('p', { class: 'muted' }, 'No games going. Start one below!'),
          el('h2', { class: 'section-title' }, me.queued ? `QUICK MATCH · SEARCHING FOR ${gameOf(me.queued).name.toUpperCase()}…` : 'QUICK MATCH'),
          el('p', { class: 'muted' }, me.queued ? 'Keep this app open. Tap the game again to stop searching.' : 'Get paired with anyone who’s online right now.'),
          quick,
          el('div', { class: 'link-row' },
            el('a', { class: 'btn', href: '#/friends' }, `👥 Friends${me.incoming.length ? ` (${me.incoming.length} new)` : ''}`),
            el('a', { class: 'btn', href: '#/leaderboard' }, '🏆 Leaderboards')),
          finished.length ? el('h2', { class: 'section-title' }, 'RECENT') : null,
          finished.map((m) => row(m, null)),
          accountPanel(ctx));
      };

      draw(net.me);
      offs.push(net.on('me', draw));
      offs.push(net.on('notice', (n) => { if (n.open && n.match) location.hash = `#/match/${n.match}`; }));
      net.refreshMe().catch((e) => fill(body, errorBox(e, () => ctx.route())));
    });
  }

  function accountPanel(ctx) {
    const codeEl = el('code', { class: 'code' }, '••••••••••••');
    let shown = false;
    return el('details', { class: 'panel account' },
      el('summary', null, 'Account'),
      el('p', { class: 'muted' }, 'Your sign-in code lets you use this account on another device. Treat it like a password.'),
      el('div', { class: 'row-actions' },
        codeEl,
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => { shown = !shown; codeEl.textContent = shown ? net.account.token : '••••••••••••'; },
        }, 'Show'),
        el('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            try { await navigator.clipboard.writeText(net.account.token); ctx.toast('Sign-in code copied'); } catch (e) { ctx.toast('Couldn’t copy — tap Show instead'); }
          },
        }, 'Copy')),
      el('div', { class: 'row-actions' },
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => {
            if (!confirm('Sign out on this device? You’ll need your sign-in code to get back in.')) return;
            net.signOut();
            ctx.route();
          },
        }, 'Sign out'),
        el('button', {
          class: 'btn danger', type: 'button',
          onclick: async () => {
            if (!confirm('Delete your online account for good? Friends, online games and leaderboard entries will be removed.')) return;
            try { await net.deleteAccount(); ctx.toast('Account deleted'); ctx.route(); } catch (e) { ctx.toast(e.message); }
          },
        }, 'Delete account')));
  }

  function renderFriends(ctx) {
    const body = screen(ctx, 'Friends', '👥');
    body.append(spinner('Loading…'));
    const offs = [];
    ctx.setCleanup(() => offs.forEach((f) => f()));

    net.check().then((ok) => {
      if (!ok || !net.account) { location.hash = '#/online'; return; }
      const input = el('input', { class: 'field', type: 'text', maxlength: '16', autocapitalize: 'off', spellcheck: 'false', placeholder: 'friend’s username', 'aria-label': 'Friend’s username' });
      const msg = el('p', { class: 'form-msg', role: 'alert' });
      const list = el('div');

      const add = async (e) => {
        e.preventDefault();
        msg.textContent = '';
        try {
          const r = await net.addFriend(input.value.trim());
          ctx.toast(r.status === 'friends' ? 'You’re now friends 🤝' : 'Request sent 👋');
          input.value = '';
          await net.refreshMe();
        } catch (err) {
          msg.textContent = err.message;
        }
      };

      const act = (label, fn, cls = 'btn') => el('button', {
        class: cls, type: 'button',
        onclick: async () => { try { await fn(); await net.refreshMe(); } catch (e) { ctx.toast(e.message); } },
      }, label);

      const draw = (me) => {
        if (!me) return;
        fill(list, 
          me.incoming.length ? el('h2', { class: 'section-title' }, 'REQUESTS') : null,
          me.incoming.map((name) => el('div', { class: 'match-row' },
            el('div', { class: 'match-main' }, el('span', { class: 'match-icon' }, '👋'), el('span', { class: 'match-text' }, el('strong', null, name), el('small', null, 'wants to be friends'))),
            el('div', { class: 'row-actions' }, act('Decline', () => net.respondFriend(name, false)), act('Accept', () => net.respondFriend(name, true), 'btn primary')))),
          el('h2', { class: 'section-title' }, `FRIENDS · ${me.friends.length}`),
          me.friends.length ? null : el('p', { class: 'muted' }, 'Add a friend by their username above.'),
          me.friends
            .sort((a, b) => b.online - a.online || a.name.localeCompare(b.name))
            .map((f) => {
              const today = f.today && f.today.date === BB.today() ? f.today : null;
              const dailies = BB.dailies.filter((d) => today && today[d.kind]).length;
              return el('div', { class: 'match-row' },
                el('div', { class: 'match-main' },
                  el('span', { class: `presence${f.online ? ' on' : ''}`, title: f.online ? 'Online' : 'Offline' }),
                  el('span', { class: 'match-text' },
                    el('strong', null, f.name),
                    el('small', null, `🔥 ${f.streak} · dailies ${dailies}/${BB.dailies.length} · ${f.record.w}–${f.record.l}–${f.record.d} online`))),
                el('div', { class: 'row-actions' },
                  act('⚔️ Challenge', async () => {
                    const game = await pickGame(`Challenge ${f.name}`);
                    if (!game) return;
                    await net.challenge(game, f.name);
                    ctx.toast(`Challenge sent to ${f.name}`);
                  }, 'btn primary'),
                  act('✕', async () => {
                    if (confirm(`Remove ${f.name} from your friends?`)) await net.removeFriend(f.name);
                  })));
            }),
          me.outgoing.length ? el('h2', { class: 'section-title' }, 'SENT') : null,
          me.outgoing.map((name) => el('div', { class: 'match-row' },
            el('div', { class: 'match-main' }, el('span', { class: 'match-icon' }, '⏳'), el('span', { class: 'match-text' }, el('strong', null, name), el('small', null, 'request pending'))),
            el('div', { class: 'row-actions' }, act('Cancel', () => net.removeFriend(name))))));
      };

      fill(body, 
        el('section', { class: 'panel' },
          el('form', { class: 'row-form', onsubmit: add }, input, el('button', { class: 'btn primary', type: 'submit' }, 'Add')),
          msg,
          el('p', { class: 'fineprint' }, `Your username is @${net.account.name}. Share it so friends can add you.`)),
        list);
      draw(net.me);
      offs.push(net.on('me', draw));
      net.refreshMe().catch((e) => ctx.toast(e.message));
    });
  }

  function renderLeaderboard(ctx, kind = 'puzzle') {
    const body = screen(ctx, 'Leaderboards', '🏆');
    let scope = 'global';
    const date = BB.today();
    const list = el('div', { class: 'board-list' });
    const playLink = el('a', { class: 'btn', href: `#/daily/${kind}` }, 'Play today’s challenge →');

    const load = async () => {
      fill(list, spinner('Loading…'));
      try {
        const lb = await net.leaderboard(kind, date, scope);
        const row = (e) => el('div', { class: `lb-row${e.you ? ' you' : ''}` },
          el('span', { class: 'lb-rank' }, e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : `${e.rank}`),
          el('span', { class: 'lb-name' }, e.name),
          el('span', { class: 'lb-value' }, e.value));
        fill(list, 
          lb.entries.length ? lb.entries.map(row) : el('p', { class: 'muted' }, scope === 'friends' ? 'None of your friends have finished this one yet today.' : 'Nobody’s on the board yet. Be the first!'),
          lb.you && lb.you.rank > lb.entries.length ? el('div', { class: 'lb-gap' }, '⋯') : null,
          lb.you && lb.you.rank > lb.entries.length ? row(lb.you) : null,
          el('p', { class: 'fineprint' }, `${lb.total} player${lb.total === 1 ? '' : 's'} today · resets at midnight (your time)`));
      } catch (e) {
        fill(list, errorBox(e, load));
      }
    };

    net.check().then((ok) => {
      if (!ok || !net.account) { location.hash = '#/online'; return; }
      fill(body, 
        el('div', { class: 'lb-controls' },
          BB.segmented(KINDS, kind, (k) => {
            kind = k;
            history.replaceState(null, '', `#/leaderboard/${k}`);
            playLink.href = `#/daily/${k}`;
            load();
          }),
          BB.segmented([['global', 'Everyone'], ['friends', 'Friends']], scope, (s) => { scope = s; load(); })),
        playLink,
        list);
      load();
    });
  }

  function renderMatch(ctx, id) {
    const body = screen(ctx, 'Match', '⚔️');
    body.append(spinner('Loading match…'));

    net.check().then(async (ok) => {
      if (!ok || !net.account) { location.hash = '#/online'; return; }
      let m;
      try {
        m = await net.getMatch(id);
      } catch (e) {
        fill(body, errorBox(e, () => ctx.route()));
        return;
      }
      if (location.hash !== `#/match/${id}`) return; // navigated away while loading
      const seat = m.players.indexOf(net.account.name);
      const game = BB.find(m.game);
      const opp = m.players[1 - seat] || 'deleted player';

      if (m.status === 'invited' || m.status === 'declined' || m.status === 'cancelled') {
        const mine = m.invitedBy === net.account.name;
        fill(body, el('div', { class: 'online-empty' },
          el('span', { class: 'featured-icon' }, game.icon),
          el('strong', null, `${game.name} vs ${opp}`),
          el('small', null, m.status === 'invited' ? (mine ? 'Waiting for them to accept…' : `${opp} challenged you!`) : `This challenge was ${m.status}.`),
          m.status === 'invited' && !mine
            ? el('div', { class: 'row-actions' },
              el('button', { class: 'btn', type: 'button', onclick: async () => { await net.respondMatch(id, 'decline'); location.hash = '#/online'; } }, 'Decline'),
              el('button', { class: 'btn primary', type: 'button', onclick: async () => { await net.respondMatch(id, 'accept'); ctx.route(); } }, 'Accept'))
            : el('a', { class: 'btn', href: '#/online' }, 'Back to Online')));
        const off = net.on('match', (u) => { if (u.id === id && u.status !== m.status) ctx.route(); });
        ctx.setCleanup(off);
        return;
      }

      // Live match: mount the real game in online mode.
      let known = m.moves.length; // moves the game has seen
      const moveHandlers = [];
      const online = {
        seat,
        names: m.players,
        moves: m.moves.slice(),
        closed: m.status === 'finished',
        onMove: (fn) => moveHandlers.push(fn),
        send: async (move, final) => {
          const seq = known;
          known++;
          try {
            await net.move(id, seq, move, final);
          } catch (e) {
            ctx.toast(e.status === 409 ? 'Out of sync — reloading the match' : `Move not sent: ${e.message}`);
            setTimeout(() => ctx.route(), 700);
          }
        },
      };

      const api = ctx.renderPlayable({
        title: `${game.name} vs ${opp}`,
        icon: game.icon,
        statsId: game.id,
        online: true,
        mount: (stage, gameApi, opts) => game.mount(stage, gameApi, { ...opts, online }),
      });

      const resignBtn = el('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          if (!confirm(`Resign this game against ${opp}?`)) return;
          try { await net.resign(id); } catch (e) { ctx.toast(e.message); }
        },
      }, '🏳️ Resign');
      const again = el('button', {
        class: 'btn primary', type: 'button',
        onclick: async () => {
          try {
            const friends = net.me ? net.me.friends.map((f) => f.name) : [];
            if (friends.includes(opp)) {
              const c = await net.challenge(m.game, opp);
              ctx.toast(`Rematch sent to ${opp}`);
              location.hash = `#/match/${c.id}`;
            } else {
              const r = await net.queue(m.game);
              if (r.status === 'matched') location.hash = `#/match/${r.match.id}`;
              else { ctx.toast('Searching for an opponent…'); location.hash = '#/online'; }
            }
          } catch (e) { ctx.toast(e.message); }
        },
      }, '↻ Play again');
      const showEnd = (u) => {
        resignBtn.remove();
        if (!again.isConnected) api.toolbar.append(again);
        if (u && u.reason === 'resigned') {
          api.status(u.winner === seat ? `${opp} resigned — you win! 🎉` : 'You resigned.');
        }
      };
      api.toolbar.append(m.status === 'active' ? resignBtn : again);
      if (m.status === 'finished') showEnd(m);

      const onUpdate = (u) => {
        if (u.id !== id) return;
        // Deliver moves we haven't seen (our own moves come back too — skip those).
        for (let i = known; i < u.moves.length; i++) {
          known = i + 1;
          if (i % 2 !== seat) for (const fn of moveHandlers) fn(u.moves[i]);
        }
        if (u.status === 'finished' && !online.closed) {
          online.closed = true;
          if (u.reason === 'resigned' && u.winner === seat) api.record('win', { level: 'online' });
          if (u.reason === 'resigned' && u.winner !== seat) api.record('loss', { level: 'online' });
          showEnd(u);
        }
      };
      ctx.addCleanup(net.on('match', onUpdate));
      // Catch up on anything that happened while the game was loading.
      net.getMatch(id).then(onUpdate).catch(() => {});
    });
  }

  /** Route hook used by main.js. Returns true when it handled the hash. */
  BB.onlineRoute = (hash, ctx) => {
    let m;
    if (hash.startsWith('#/online')) renderOnline(ctx);
    else if (hash.startsWith('#/friends')) renderFriends(ctx);
    else if ((m = hash.match(/^#\/leaderboard(?:\/([\w]+))?/))) renderLeaderboard(ctx, KINDS.some(([k]) => k === m[1]) ? m[1] : 'puzzle');
    else if ((m = hash.match(/^#\/match\/([\w-]+)/))) renderMatch(ctx, m[1]);
    else return false;
    return true;
  };

  BB.onlineHomeCard = homeCard;

  // Global notices (challenges, friend requests, quick-match found) as toasts.
  net.on('notice', (n) => {
    if (BB.toast) BB.toast(n.text);
  });

  net.check();
})();
