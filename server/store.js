'use strict';

/*
 * Tiny persistence layer: the whole database is one JSON object kept in memory
 * and written to disk (atomically, debounced) after changes. That's plenty for a
 * hobby-sized game server; swap this module out if it ever outgrows a file.
 */
const fs = require('fs');
const path = require('path');

const DAY_MS = 86400000;
const KEEP_DAILY_DAYS = 45;
const KEEP_FINISHED_MATCH_DAYS = 30;

function emptyData() {
  return { users: {}, daily: {}, matches: {} };
}

function createStore(file, { now = () => Date.now() } = {}) {
  let data = emptyData();
  if (file && fs.existsSync(file)) {
    data = { ...emptyData(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  prune();

  let timer = null;

  // Drop old dailies and long-finished matches so the file doesn't grow forever.
  function prune() {
    const cutoff = new Date(now() - KEEP_DAILY_DAYS * DAY_MS).toISOString().slice(0, 10);
    for (const date of Object.keys(data.daily)) if (date < cutoff) delete data.daily[date];
    const matchCutoff = now() - KEEP_FINISHED_MATCH_DAYS * DAY_MS;
    for (const [id, m] of Object.entries(data.matches)) {
      if (['finished', 'declined', 'cancelled'].includes(m.status) && m.updated < matchCutoff) delete data.matches[id];
    }
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written database
  }

  function save() {
    if (!file || timer) return;
    timer = setTimeout(() => {
      try {
        flush();
      } catch (e) {
        // Never take the server down over a failed write; the next change retries.
        console.error(`Could not save ${file}: ${e.message}`);
      }
    }, 250);
  }

  return { data, save, flush, prune };
}

module.exports = { createStore };
