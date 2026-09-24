'use strict';

/*
 * Starts the BOARD//BOX server: the online API plus the app itself.
 *
 *   PORT=8080 DATA_FILE=./data/boardbox.json node server/index.js
 */
const path = require('path');
const { createApp } = require('./app');

const port = +process.env.PORT || 8080;
const dataFile = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'boardbox.json');
const app = createApp({ dataFile, staticDir: path.join(__dirname, '..') });

app.server.listen(port, () => {
  console.log(`BOARD//BOX server on http://localhost:${port} (data: ${dataFile})`);
});

// Save the database before exiting (e.g. on redeploy).
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    app.store.flush();
    process.exit(0);
  });
}
