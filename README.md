# BOARD//BOX

**One app. Every game.** A mobile-first hub of quick board and arcade games. It's plain HTML, CSS and JavaScript, with no build step and no dependencies. You can install it on your phone as a PWA, and it works offline.

## Play

Serve the folder with any static server and open it on your phone or desktop:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly also works, but offline/install support needs http(s).)

## What's in it (Phase 1)

| Game | Modes |
|------|-------|
| ❌ Tic-Tac-Toe | Bot (easy / unbeatable minimax), 2 players |
| 🔴 Connect 4 | Bot (easy / medium / hard alpha-beta search), 2 players |
| 🔢 2048 | Swipe or arrow keys, best score |
| 💣 Minesweeper | Easy / medium / hard, safe first tap, long-press or flag mode, chording, best times |
| 🐍 Snake | Swipe, arrows/WASD or on-screen pad, speeds up as you grow |

Hub features:

- **Today's Pick**: the same featured game for everyone each day.
- **🎰 Play Something (Game Roulette)**: spins through the games and picks one at random. You get a 5-minute run.
- **Stats**: games played, wins and best scores are saved on the device in `localStorage`.
- Black/white UI with orange accents. It follows the system light or dark theme.

## Project layout

```
index.html              app shell + script order
css/style.css           all styles (design tokens at the top)
js/core.js              BB: game registry, stats, DOM + input helpers
js/main.js              routing, home screen, game screen, roulette
js/games/*.js           one file per game
sw.js                   offline cache (bump VERSION when files change)
manifest.webmanifest    PWA install metadata
```

## Adding a game

Create `js/games/<name>.js`:

```js
BB.register({
  id: 'reversi',
  name: 'Reversi',
  icon: '⚫',
  tagline: 'Flip them all.',
  mount(stage, api) {
    // render into `stage`, put controls in `api.toolbar`
    api.status('Your move');
    // when a game ends: api.record('win' | 'loss' | 'draw' | 'done', { score })
    return () => { /* clear timers + global listeners */ };
  },
});
```

Then add a `<script>` tag in `index.html` and the path to `FILES` in `sw.js`. It shows up on the home screen and in the roulette automatically.

## Roadmap

- **Phase 2**: Chess, Checkers, Reversi
- **Phase 3**: more bots and difficulty levels, a stats page, achievements, daily challenges
- **Phase 4**: accounts, friends, online multiplayer, leaderboards
