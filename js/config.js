'use strict';

/*
 * Where the BOARD//BOX online server lives.
 *
 * - Leave `server` empty when the server hosts the app itself (the usual setup:
 *   `npm run server`, or deploying the repo to Render/Fly/Railway).
 * - When the app is hosted somewhere static (e.g. GitHub Pages), set it to the
 *   server's address, e.g. 'https://boardbox.onrender.com'.
 *
 * With no reachable server the app still works fully offline; online features hide.
 */
window.BB_CONFIG = {
  server: '',
};
