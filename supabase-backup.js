'use strict';

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'komal-backup';
const BATCH_SIZE = 200;
const DEBOUNCE_MS = 10000;
const uploadedFiles = new Map();
let database;
let timer;
let running = false;
let rerun = false;

const isConfigured = !!(SUPABASE_URL && SERVICE_KEY);

async function request(url, options, label) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${label} failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return response;
}

async function upsertRows(table, rows, conflict) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set('on_conflict', conflict);
    await request(url, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows.slice(i, i + BATCH_SIZE)),
    }, `Supabase ${table} backup`);
  }
}

function objectUrl(relativePath) {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encoded}`;
}

async function uploadDirectory(localDir, prefix, maxBytes) {
  let names;
  try {
    names = await fs.promises.readdir(localDir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const name of names) {
    if (!/^[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(name)) continue;
    const fullPath = path.join(localDir, name);
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile() || stat.size > maxBytes) continue;
    const relativePath = `${prefix}/${name}`;
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    if (uploadedFiles.get(relativePath) === stamp) continue;
    const bytes = await fs.promises.readFile(fullPath);
    const ext = path.extname(name).toLowerCase();
    const contentType = ({ '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' })[ext];
    await request(objectUrl(relativePath), {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
        'Cache-Control': '3600',
      },
      body: bytes,
    }, `Supabase image backup (${prefix})`);
    uploadedFiles.set(relativePath, stamp);
  }
}

async function syncSnapshot() {
  const snapshot = database.snapshot();
  await upsertRows('users', snapshot.users.map(({ pass, ...user }) => ({ ...user, pass_hash: pass })), 'id');
  await upsertRows('convs', snapshot.convs, 'id');
  await upsertRows('members', snapshot.members, 'conv_id,user_id');
  await upsertRows('messages', snapshot.messages, 'id');
  await upsertRows('media', snapshot.media, 'file');
  await upsertRows('push_subs', snapshot.push_subs, 'endpoint');

  const dataDir = path.join(__dirname, 'data');
  await uploadDirectory(path.join(dataDir, 'avatars'), 'avatars', 3 * 1024 * 1024);
  await uploadDirectory(path.join(dataDir, 'media'), 'media', 12 * 1024 * 1024);
}

function schedule() {
  if (!isConfigured || !database) return;
  clearTimeout(timer);
  timer = setTimeout(() => { void runSync(); }, DEBOUNCE_MS);
  timer.unref();
}

async function runSync() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    await syncSnapshot();
    console.info('Supabase backup sync completed.');
  } catch (error) {
    console.error(`Supabase backup sync failed: ${error.message}`);
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      schedule();
    }
  }
}

function start(db) {
  if (!isConfigured) {
    console.warn('Supabase backup is disabled: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return;
  }
  database = db;
  db.onChange(schedule);
  schedule();
  const interval = setInterval(() => { void runSync(); }, 5 * 60 * 1000);
  interval.unref();
}

module.exports = { start };
