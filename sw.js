'use strict';

// Offline support: cache the app shell, serve cache-first, refresh in the background.
// Bump VERSION whenever you add or rename a file so old caches get dropped.
const VERSION = 'boardbox-v2';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'css/style.css',
  'js/core.js',
  'js/main.js',
  'js/games/chess-engine.js',
  'js/games/chess.js',
  'js/games/checkers.js',
  'js/games/reversi.js',
  'js/games/tictactoe.js',
  'js/games/connect4.js',
  'js/games/g2048.js',
  'js/games/minesweeper.js',
  'js/games/snake.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
