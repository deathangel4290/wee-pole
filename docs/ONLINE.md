# Online play: accounts, friends, leaderboards, multiplayer

Phase 4 adds a small server (`server/`) that powers:

- **Accounts:** a username, nothing else. The device keeps a secret sign-in token, and the server stores only its SHA-256 hash. A *sign-in code* moves the account to another device.
- **Friends:** requests by username, accept or decline, online presence, and each friend's streak and daily progress.
- **Daily leaderboards:** global and friends-only boards for the chess puzzle, Daily 2048 and Daily Sweep. Scores are sent automatically as you play, and saved to retry later if you're offline.
- **Online multiplayer:** Chess, Checkers, Reversi, Connect 4 and Tic-Tac-Toe. You can **challenge a friend** or use **Quick Match** against anyone online. Matches persist, so you can close the app and pick the game up later. Resigning and "Play again" are included.

Without a server, the app hides every online feature and works exactly as before.

## Run it locally

```sh
npm start            # http://localhost:8080. The server also serves the app itself.
```

Data is saved to `data/boardbox.json` (set `DATA_FILE` to change it, and `PORT` for the port). To try multiplayer, open the site in two different browsers, or one normal window plus one private window, and sign up twice.

## How it works

```
 phone A ──POST /api/matches/:id/move──▶  server  ──SSE "match" event──▶ phone B
 phone A ◀──────── SSE (live updates) ───  server  ◀─────── POST ──────── phone B
```

- **Plain HTTP + Server-Sent Events:** every game here is turn-based, so the server only has to push updates to phones. That keeps the server free of dependencies: it's just `node:http`, with nothing to `npm install`.
- **Relay model:** the server enforces seats and **strict turn order** (Reversi passes are explicit "pass" moves). Each phone runs the game rules itself, as the offline games already do. That's fine for playing friends, but a modified client could send an illegal move. The server doesn't check the rules, so don't put prizes on it.
- **Leaderboards trust the client**, for the same reason. The server does validate dates and number ranges, and keeps only your best result.
- **Storage** is one JSON file, written atomically. It comfortably handles thousands of players. Old dailies (over 45 days) and finished matches (over 30 days) are pruned automatically. If it ever outgrows that, only `server/store.js` needs replacing.

API summary (all JSON; sign-in via `Authorization: Bearer <token>`):

| Method | Path | What |
|---|---|---|
| GET | `/api/health` | Is the server up? |
| POST | `/api/register` | `{ name }` → `{ token, name }` |
| GET / DELETE | `/api/me` | Your profile, friends, requests and matches / delete your account |
| POST | `/api/friends` | `{ name }` send a request (or accept theirs) |
| POST | `/api/friends/respond` | `{ name, accept }` |
| DELETE | `/api/friends/:name` | Unfriend or cancel a request |
| POST | `/api/daily` | `{ date, kind, done, tries, score, time }` |
| GET | `/api/leaderboard?kind&date&scope` | `scope` = `global` or `friends` |
| POST | `/api/matches` | `{ game, opponent }` challenge a friend |
| POST | `/api/matches/:id/accept`, `decline` or `cancel` | Answer a challenge |
| GET | `/api/matches/:id` | Match state, including every move |
| POST | `/api/matches/:id/move` | `{ seq, move, final? }` |
| POST | `/api/matches/:id/resign` | Resign |
| POST / DELETE | `/api/queue` | `{ game }` join or leave Quick Match |
| GET | `/api/events?token=` | Server-Sent Events: `match`, `me`, `notice` |

`npm test` includes `tests/server.js`, which starts a real server and checks accounts, friends, leaderboards, a full match over live events, Quick Match, resigning, restarts and account deletion.

## Put it online

The server hosts the app too, so **one deploy gives you the whole thing**. Share its URL and install it from there as described in [MAKING-IT-AN-APP.md](MAKING-IT-AN-APP.md).

You need a host that keeps a **persistent disk**. Otherwise accounts and leaderboards reset every time the server restarts.

### Option A: Render (easiest)

1. Push this repo to GitHub, then on **render.com**: *New → Blueprint →* pick the repo. It reads `render.yaml`.
2. Render asks you to confirm the **Starter** plan (about $7/month). That plan is needed for the 1 GB disk that keeps your data. (For a quick free test, remove the `disk:` block from `render.yaml`. Everything works, but data resets on each restart.)
3. You get a URL like `https://boardbox.onrender.com`. Open it on your phone and install it.

### Option B: Fly.io, Railway, or any server with Docker

The `Dockerfile` runs anywhere. Mount a volume at `/data`:

```sh
docker build -t boardbox .
docker run -p 8080:8080 -v boardbox-data:/data boardbox
```

- **Fly.io:** `fly launch` (it detects the Dockerfile), then `fly volumes create boardbox_data --size 1` and mount it at `/data` in `fly.toml`.
- **Railway:** *New Project → Deploy from GitHub*, then add a *Volume* mounted at `/data`.

### Keeping the app on GitHub Pages instead

If you'd rather keep serving the app from GitHub Pages and run only the API elsewhere, set the server address in **`js/config.js`**:

```js
window.BB_CONFIG = { server: 'https://boardbox.onrender.com' };
```

The server allows requests from any website (sign-in uses a token, not cookies), so this works without any extra setup.

## Privacy and safety notes

- The server stores usernames, token hashes, friend lists, daily results and match moves. It stores no emails, passwords or IP logs.
- Anyone can pick any unused username. There's no chat, so the only user-written text is usernames (letters, numbers and `_`, 3–16 characters).
- **Delete account** (Online → Account) removes the user, their friendships and their leaderboard entries.
- A sign-in code is as good as a password. If someone else gets it, **Delete account** and make a new one.
