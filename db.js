'use strict';
// Uses Node's built-in SQLite (Node 22.13+) — no native add-ons to compile, so it installs anywhere.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });

const raw = new DatabaseSync(path.join(dir, 'komal.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
let changeListener = null;
let transactionDepth = 0;
let transactionChanged = false;

function notifyChange() {
  if (transactionDepth) {
    transactionChanged = true;
  } else if (changeListener) {
    changeListener();
  }
}

const db = {
  prepare(sql) {
    const st = raw.prepare(sql);
    let pluck = false;
    const one = (r) => Object.values(r)[0];
    const api = {
      pluck() { pluck = true; return api; },
      get(...a) { const r = st.get(...a); return r === undefined ? undefined : pluck ? one(r) : r; },
      all(...a) { const rs = st.all(...a); return pluck ? rs.map(one) : rs; },
      run(...a) {
        const i = st.run(...a);
        const result = { changes: Number(i.changes), lastInsertRowid: Number(i.lastInsertRowid) };
        if (result.changes) notifyChange();
        return result;
      },
    };
    return api;
  },
  transaction(fn) {
    return (...a) => {
      raw.exec('BEGIN');
      transactionDepth++;
      try { const r = fn(...a); raw.exec('COMMIT'); return r; } catch (e) {
        raw.exec('ROLLBACK');
        if (transactionDepth === 1) transactionChanged = false;
        throw e;
      }
      finally {
        transactionDepth--;
        if (!transactionDepth && transactionChanged) {
          transactionChanged = false;
          if (changeListener) changeListener();
        }
      }
    };
  },
  onChange(fn) { changeListener = fn; },
  snapshot() {
    const tables = ['users', 'convs', 'members', 'messages', 'media', 'push_subs'];
    return Object.fromEntries(tables.map((table) => [table, raw.prepare(`SELECT * FROM ${table}`).all()]));
  },
  close() { raw.close(); },
};

raw.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT 'Hey there! I am using Komal.',
  photo TEXT,
  pass TEXT NOT NULL,
  last_seen INTEGER,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS convs(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,            -- 'direct' | 'group'
  name TEXT,
  direct_key TEXT UNIQUE,        -- "minId:maxId" for direct chats
  created_by INTEGER,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members(
  conv_id INTEGER NOT NULL REFERENCES convs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(conv_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY,
  conv_id INTEGER NOT NULL REFERENCES convs(id) ON DELETE CASCADE,
  sender INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,            -- 'text' | 'image'
  body TEXT,
  media TEXT,
  w INTEGER, h INTEGER,
  created INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(media);
CREATE TABLE IF NOT EXISTS media(
  file TEXT PRIMARY KEY,
  uploader INTEGER NOT NULL REFERENCES users(id),
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subs(
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);
`);

module.exports = db;
