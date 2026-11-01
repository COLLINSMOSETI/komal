'use strict';
/**
 * Komal server — Express (HTTP API + static app) + ws (realtime) + SQLite.
 * Run:  node server.js
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { WebSocketServer } = require('ws');
const db = require('./db');
const supabaseBackup = require('./supabase-backup');

// ───────────────────────── config & secrets ─────────────────────────
const PORT = +process.env.PORT || 3000;
const DEFAULT_CC = (process.env.DEFAULT_CC || '254').replace(/\D/g, ''); // Kenya by default
const DATA = path.join(__dirname, 'data');
const MEDIA_DIR = path.join(DATA, 'media');
const AVATAR_DIR = path.join(DATA, 'avatars');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });

function persistentSecret(file, bytes) {
  const p = path.join(DATA, file);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  const s = crypto.randomBytes(bytes).toString('hex');
  fs.writeFileSync(p, s, { mode: 0o600 });
  return s;
}
const JWT_SECRET = persistentSecret('jwt.secret', 48);
// Invite code: only people you give it to can create an account on your laptop.
const INVITE = process.env.INVITE === 'off' ? null : (process.env.INVITE || persistentSecret('invite.code', 4));
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || '';
const LOGIN_NOTIFY_EMAIL = process.env.LOGIN_NOTIFY_EMAIL || 'moseticollins20@gmail.com';
const gmailMimeTransport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
const gmailConfigured = !!(GMAIL_USER && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN);
let googleAccessToken = '';
let googleAccessTokenExpiresAt = 0;
let googleTokenRequest = null;

if ((SUPABASE_URL || SUPABASE_SERVICE_ROLE_KEY) && !(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)) {
  console.warn('Login tracking is disabled: set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}
if (!gmailConfigured) {
  console.warn('Login email alerts are disabled: set GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
}

let vapid;
{
  const p = path.join(DATA, 'vapid.json');
  if (fs.existsSync(p)) vapid = JSON.parse(fs.readFileSync(p, 'utf8'));
  else { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(p, JSON.stringify(vapid), { mode: 0o600 }); }
  webpush.setVapidDetails('mailto:komal@example.com', vapid.publicKey, vapid.privateKey);
}

// ───────────────────────── helpers ─────────────────────────
const now = () => Date.now();
const q = (sql) => db.prepare(sql);

function normPhone(raw) {
  let s = String(raw || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('0')) s = '+' + DEFAULT_CC + s.slice(1);
  else if (!s.startsWith('+')) s = '+' + s;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
function parseCookies(h = '') {
  const o = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { o[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {} }
  }
  return o;
}
const USER_COLS = 'id,phone,name,about,photo,last_seen';
function userFromToken(token) {
  try {
    const p = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return q(`SELECT ${USER_COLS} FROM users WHERE id=?`).get(p.uid) || null;
  } catch { return null; }
}
const userFromReq = (req) => userFromToken(parseCookies(req.headers.cookie).komal);

function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.subarray(0, 4).toString() === 'GIF8') return 'gif';
  return null;
}
const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
function saveImage(dir, buf) {
  const ext = sniffImage(buf);
  if (!ext) return null;
  const file = crypto.randomBytes(16).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, file), buf, { mode: 0o600 });
  return file;
}

async function writeLoginEvent(event) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/login_events`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}`);
}

async function sendLoginEmail(event) {
  const label = event.event_type === 'signup' ? 'New account registered' : 'New login';
  const message = await gmailMimeTransport.sendMail({
    from: { name: 'Komal Login Alerts', address: GMAIL_USER },
    to: LOGIN_NOTIFY_EMAIL,
    subject: `[Komal] ${label}: ${event.name}`,
    text: `${label} on Komal\n\nName: ${event.name}\nPhone: ${event.phone}\nTime (UTC): ${event.logged_in_at}`,
  });
  const accessToken = await getGoogleAccessToken();
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: message.message.toString('base64url') }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Gmail API returned HTTP ${response.status}`);
}

async function getGoogleAccessToken() {
  if (googleAccessToken && googleAccessTokenExpiresAt > Date.now() + 60000) return googleAccessToken;
  if (googleTokenRequest) return googleTokenRequest;
  googleTokenRequest = (async () => {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Google OAuth returned HTTP ${response.status}`);
    const result = await response.json();
    if (typeof result.access_token !== 'string' || !result.access_token) {
      throw new Error('Google OAuth did not return an access token');
    }
    googleAccessToken = result.access_token;
    googleAccessTokenExpiresAt = Date.now() + (Number(result.expires_in) || 3600) * 1000;
    return googleAccessToken;
  })();
  try {
    return await googleTokenRequest;
  } finally {
    googleTokenRequest = null;
  }
}

async function reportSuccessfulAuth(user, eventType) {
  const event = {
    user_id: user.id,
    name: user.name,
    phone: user.phone,
    event_type: eventType,
    logged_in_at: new Date().toISOString(),
  };
  const tasks = [];
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) tasks.push(['Supabase login record', writeLoginEvent(event)]);
  if (gmailConfigured) tasks.push(['login email alert', sendLoginEmail(event)]);
  const results = await Promise.allSettled(tasks.map(([, task]) => task));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Failed to send ${tasks[index][0]}:`, result.reason?.message || result.reason);
    }
  });
}

// ───────────────────────── presence / sockets ─────────────────────────
const sockets = new Map(); // userId -> Set<ws>
const isOnline = (uid) => (sockets.get(uid)?.size || 0) > 0;
const isVisible = (uid) => [...(sockets.get(uid) || [])].some((w) => w.visible);
function sendTo(uid, obj) {
  const set = sockets.get(uid);
  if (!set) return;
  const d = JSON.stringify(obj);
  for (const w of set) if (w.readyState === 1) w.send(d);
}
const peersOf = (uid) =>
  q(`SELECT DISTINCT user_id FROM members WHERE conv_id IN (SELECT conv_id FROM members WHERE user_id=?) AND user_id!=?`)
    .pluck().all(uid, uid);

// ───────────────────────── data views ─────────────────────────
const pubMsg = (m) => ({ id: m.id, conv: m.conv_id, sender: m.sender, kind: m.kind, body: m.body, media: m.media, w: m.w, h: m.h, created: m.created, delivered: m.delivered });
const isMember = (conv, uid) => !!q('SELECT 1 FROM members WHERE conv_id=? AND user_id=?').get(conv, uid);
const memberIds = (conv) => q('SELECT user_id FROM members WHERE conv_id=?').pluck().all(conv);

function convView(conv, uid) {
  const mem = q('SELECT last_read FROM members WHERE conv_id=? AND user_id=?').get(conv.id, uid);
  const members = q(`SELECT u.id,u.phone,u.name,u.about,u.photo,u.last_seen FROM members m JOIN users u ON u.id=m.user_id WHERE m.conv_id=?`).all(conv.id)
    .map((m) => ({ ...m, online: isOnline(m.id) }));
  const last = q('SELECT * FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 1').get(conv.id);
  const unread = q('SELECT COUNT(*) FROM messages WHERE conv_id=? AND id>? AND sender!=?').pluck().get(conv.id, mem?.last_read || 0, uid);
  let peerRead = 0;
  if (conv.type === 'direct') {
    const other = members.find((m) => m.id !== uid);
    if (other) peerRead = q('SELECT last_read FROM members WHERE conv_id=? AND user_id=?').pluck().get(conv.id, other.id) || 0;
  }
  return { id: conv.id, type: conv.type, name: conv.name, created: conv.created, members, last: last ? pubMsg(last) : null, unread, peerRead };
}
const getConv = (id) => q('SELECT * FROM convs WHERE id=?').get(id);

// ───────────────────────── express app ─────────────────────────
const app = express();
app.set('trust proxy', 1); // behind Cloudflare / ngrok tunnel
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '50kb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

// CSRF defence in depth (cookie is already SameSite=Strict): state-changing calls must be same-origin.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') {
    const o = req.headers.origin;
    if (o) { try { if (new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'Bad origin' }); } catch { return res.status(403).json({ error: 'Bad origin' }); } }
  }
  next();
});

function setSession(req, res, uid) {
  const token = jwt.sign({ uid }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '60d' });
  res.cookie('komal', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 60 * 24 * 3600 * 1000, path: '/' });
}
function auth(req, res, next) {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  req.user = u;
  next();
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// ── auth
app.post('/api/register', authLimiter, (req, res) => {
  const { phone, name, password, invite } = req.body || {};
  if (INVITE && String(invite || '').trim().toLowerCase() !== INVITE.toLowerCase()) return res.status(403).json({ error: 'Invalid invite code' });
  const p = normPhone(phone);
  if (!p) return res.status(400).json({ error: 'Enter a valid phone number with country code, e.g. +254712345678' });
  const n = clean(name, 40);
  if (!n) return res.status(400).json({ error: 'Please enter your name' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (q('SELECT 1 FROM users WHERE phone=?').get(p)) return res.status(409).json({ error: 'That number is already registered. Please log in.' });
  const hash = bcrypt.hashSync(password, 11);
  const info = q('INSERT INTO users(phone,name,pass,created,last_seen) VALUES(?,?,?,?,?)').run(p, n, hash, now(), now());
  void reportSuccessfulAuth({ id: info.lastInsertRowid, name: n, phone: p }, 'signup');
  setSession(req, res, info.lastInsertRowid);
  res.json({ ok: true });
});
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 11);
app.post('/api/login', authLimiter, (req, res) => {
  const { phone, password } = req.body || {};
  const p = normPhone(phone);
  const row = p ? q('SELECT id,name,phone,pass FROM users WHERE phone=?').get(p) : null;
  const ok = bcrypt.compareSync(String(password || ''), row ? row.pass : DUMMY_HASH); // constant-ish time
  if (!row || !ok) return res.status(401).json({ error: 'Wrong number or password' });
  void reportSuccessfulAuth(row, 'login');
  setSession(req, res, row.id);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('komal', { path: '/' }); res.json({ ok: true }); });

// ── profile
app.get('/api/me', auth, (req, res) => res.json({ me: req.user }));
app.put('/api/me', auth, (req, res) => {
  const name = clean(req.body?.name, 40) || req.user.name;
  const about = clean(req.body?.about, 140) || req.user.about;
  q('UPDATE users SET name=?, about=? WHERE id=?').run(name, about, req.user.id);
  const me = q(`SELECT ${USER_COLS} FROM users WHERE id=?`).get(req.user.id);
  for (const uid of peersOf(req.user.id)) sendTo(uid, { t: 'user', user: me });
  res.json({ me });
});
app.post('/api/me/photo', auth, avatarUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const file = saveImage(AVATAR_DIR, req.file.buffer);
  if (!file) return res.status(400).json({ error: 'Please choose a JPG, PNG, WEBP or GIF image' });
  const old = req.user.photo;
  q('UPDATE users SET photo=? WHERE id=?').run(file, req.user.id);
  if (old && FILE_RE.test(old)) fs.unlink(path.join(AVATAR_DIR, old), () => {});
  const me = q(`SELECT ${USER_COLS} FROM users WHERE id=?`).get(req.user.id);
  for (const uid of peersOf(req.user.id)) sendTo(uid, { t: 'user', user: me });
  res.json({ me });
});
app.get('/avatar/:file', auth, (req, res) => {
  if (!FILE_RE.test(req.params.file)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.join(AVATAR_DIR, req.params.file), (e) => { if (e && !res.headersSent) res.status(404).end(); });
});

// ── people lookup (exact phone number only — no browsing everyone)
app.get('/api/users/lookup', auth, (req, res) => {
  const p = normPhone(req.query.phone);
  if (!p) return res.status(400).json({ error: 'Enter a valid number with country code' });
  const u = q(`SELECT ${USER_COLS} FROM users WHERE phone=?`).get(p);
  if (!u) return res.status(404).json({ error: 'No Komal user with that number yet. Invite them!' });
  res.json({ user: { ...u, online: isOnline(u.id) } });
});

// ── conversations
app.get('/api/convs', auth, (req, res) => {
  const rows = q('SELECT c.* FROM convs c JOIN members m ON m.conv_id=c.id WHERE m.user_id=?').all(req.user.id);
  res.json({ convs: rows.map((c) => convView(c, req.user.id)) });
});
app.get('/api/convs/:id', auth, (req, res) => {
  const id = +req.params.id;
  if (!isMember(id, req.user.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ conv: convView(getConv(id), req.user.id) });
});
app.post('/api/convs/direct', auth, (req, res) => {
  const other = +req.body?.userId;
  if (!other || !q('SELECT 1 FROM users WHERE id=?').get(other)) return res.status(404).json({ error: 'User not found' });
  const key = [req.user.id, other].sort((a, b) => a - b).join(':');
  let conv = q('SELECT * FROM convs WHERE direct_key=?').get(key);
  if (!conv) {
    const tx = db.transaction(() => {
      const id = q('INSERT INTO convs(type,direct_key,created_by,created) VALUES(?,?,?,?)').run('direct', key, req.user.id, now()).lastInsertRowid;
      q('INSERT OR IGNORE INTO members(conv_id,user_id) VALUES(?,?)').run(id, req.user.id);
      q('INSERT OR IGNORE INTO members(conv_id,user_id) VALUES(?,?)').run(id, other);
      return id;
    });
    conv = getConv(tx());
  }
  res.json({ conv: convView(conv, req.user.id) });
});
app.post('/api/convs/group', auth, (req, res) => {
  const name = clean(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'Give the group a name' });
  const ids = [...new Set((Array.isArray(req.body?.memberIds) ? req.body.memberIds : []).map(Number).filter(Boolean))].slice(0, 100);
  const valid = ids.filter((id) => id !== req.user.id && q('SELECT 1 FROM users WHERE id=?').get(id));
  if (!valid.length) return res.status(400).json({ error: 'Add at least one other person' });
  const cid = db.transaction(() => {
    const id = q('INSERT INTO convs(type,name,created_by,created) VALUES(?,?,?,?)').run('group', name, req.user.id, now()).lastInsertRowid;
    for (const u of [req.user.id, ...valid]) q('INSERT INTO members(conv_id,user_id) VALUES(?,?)').run(id, u);
    return id;
  })();
  const conv = getConv(cid);
  for (const uid of memberIds(cid)) if (uid !== req.user.id) sendTo(uid, { t: 'conv', conv: convView(conv, uid) });
  res.json({ conv: convView(conv, req.user.id) });
});
app.get('/api/convs/:id/messages', auth, (req, res) => {
  const id = +req.params.id;
  if (!isMember(id, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const before = +req.query.before || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(+req.query.limit || 40, 100);
  const rows = q('SELECT * FROM messages WHERE conv_id=? AND id<? ORDER BY id DESC LIMIT ?').all(id, before, limit);
  res.json({ messages: rows.reverse().map(pubMsg), more: rows.length === limit });
});

// ── media (photos in chats): only members of the chat (or the uploader) can fetch
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const file = saveImage(MEDIA_DIR, req.file.buffer);
  if (!file) return res.status(400).json({ error: 'Only JPG, PNG, WEBP or GIF photos are allowed' });
  q('INSERT INTO media(file,uploader,created) VALUES(?,?,?)').run(file, req.user.id, now());
  res.json({ media: file });
});
app.get('/media/:file', auth, (req, res) => {
  const f = req.params.file;
  if (!FILE_RE.test(f)) return res.status(404).end();
  const uid = req.user.id;
  const allowed = q('SELECT 1 FROM media WHERE file=? AND uploader=?').get(f, uid) ||
    q('SELECT 1 FROM messages m JOIN members mem ON mem.conv_id=m.conv_id WHERE m.media=? AND mem.user_id=?').get(f, uid);
  if (!allowed) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.join(MEDIA_DIR, f), (e) => { if (e && !res.headersSent) res.status(404).end(); });
});

// ── push notifications (work even when the app is closed)
app.get('/api/push/key', auth, (req, res) => res.json({ key: vapid.publicKey }));
app.post('/api/push/subscribe', auth, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Bad subscription' });
  q('INSERT INTO push_subs(endpoint,user_id,p256dh,auth) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth')
    .run(endpoint, req.user.id, keys.p256dh, keys.auth);
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', auth, (req, res) => {
  if (typeof req.body?.endpoint === 'string') q('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(req.body.endpoint, req.user.id);
  res.json({ ok: true });
});
function pushTo(uid, payload) {
  const body = JSON.stringify(payload);
  for (const s of q('SELECT * FROM push_subs WHERE user_id=?').all(uid)) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86400, urgency: 'high' })
      .catch((e) => { if (e.statusCode === 404 || e.statusCode === 410) q('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint); });
  }
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ── static app
const PUB = path.join(__dirname, 'public');
app.use(express.static(PUB, {
  index: 'index.html',
  setHeaders: (res, p) => {
    if (/(index\.html|sw\.js|manifest\.json)$/.test(p)) res.set('Cache-Control', 'no-cache');
    else res.set('Cache-Control', 'public, max-age=3600');
  },
}));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(413).json({ error: 'That file is too large' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// ───────────────────────── websocket ─────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
supabaseBackup.start(db);

server.on('upgrade', (req, socket, head) => {
  const url = req.url.split('?')[0];
  const origin = req.headers.origin;
  let sameOrigin = false;
  try { sameOrigin = !origin || new URL(origin).host === req.headers.host; } catch {}
  const user = url === '/ws' && sameOrigin ? userFromReq(req) : null;
  if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => { ws.uid = user.id; wss.emit('connection', ws, req); });
});

function broadcastPresence(uid, online) {
  const last = q('SELECT last_seen FROM users WHERE id=?').pluck().get(uid);
  for (const p of peersOf(uid)) sendTo(p, { t: 'presence', user: uid, online, last_seen: last });
}

wss.on('connection', (ws) => {
  const uid = ws.uid;
  ws.isAlive = true; ws.visible = true; ws.budget = 40; ws.lastRefill = now();
  if (!sockets.has(uid)) sockets.set(uid, new Set());
  const firstSocket = sockets.get(uid).size === 0;
  sockets.get(uid).add(ws);

  // mark everything waiting for this user as delivered
  const pending = q(`SELECT m.id,m.conv_id,m.sender FROM messages m
      JOIN convs c ON c.id=m.conv_id AND c.type='direct'
      JOIN members mm ON mm.conv_id=m.conv_id AND mm.user_id=?
      WHERE m.sender!=? AND m.delivered=0`).all(uid, uid);
  if (pending.length) {
    q(`UPDATE messages SET delivered=1 WHERE id IN (${pending.map(() => '?').join(',')})`).run(...pending.map((p) => p.id));
    const groups = new Map();
    for (const p of pending) { const k = p.sender + ':' + p.conv_id; groups.set(k, Math.max(groups.get(k) || 0, p.id)); }
    for (const [k, upto] of groups) { const [s, c] = k.split(':').map(Number); sendTo(s, { t: 'status', conv: c, status: 'delivered', upto }); }
  }
  if (firstSocket) broadcastPresence(uid, true);

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    // simple flood control: 40 events burst, refills 4/second
    const t = now();
    ws.budget = Math.min(40, ws.budget + ((t - ws.lastRefill) / 1000) * 4); ws.lastRefill = t;
    if (ws.budget < 1) return;
    ws.budget -= 1;
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    try { handleEvent(ws, uid, m); } catch (e) { console.error('ws error', e.message); }
  });
  ws.on('close', () => {
    const set = sockets.get(uid);
    set.delete(ws);
    if (!set.size) {
      sockets.delete(uid);
      q('UPDATE users SET last_seen=? WHERE id=?').run(now(), uid);
      broadcastPresence(uid, false);
    }
  });
});

function handleEvent(ws, uid, m) {
  switch (m.t) {
    case 'vis': ws.visible = !!m.visible; break;
    case 'typing': {
      const c = +m.conv;
      if (!isMember(c, uid)) return;
      for (const o of memberIds(c)) if (o !== uid) sendTo(o, { t: 'typing', conv: c, user: uid });
      break;
    }
    case 'read': {
      const c = +m.conv;
      if (!isMember(c, uid)) return;
      const maxId = q('SELECT MAX(id) FROM messages WHERE conv_id=?').pluck().get(c) || 0;
      q('UPDATE members SET last_read=MAX(last_read,?) WHERE conv_id=? AND user_id=?').run(maxId, c, uid);
      for (const o of memberIds(c)) {
        if (o !== uid) sendTo(o, { t: 'status', conv: c, status: 'read', upto: maxId, user: uid });
      }
      sendTo(uid, { t: 'readsync', conv: c });
      break;
    }
    case 'send': {
      const c = +m.conv;
      if (!isMember(c, uid)) return;
      const conv = getConv(c);
      const kind = m.kind === 'image' ? 'image' : 'text';
      let body = String(m.body ?? '').replace(/\u0000/g, '').trim();
      let media = null, w = null, h = null;
      if (kind === 'text') {
        if (!body) return;
        body = body.slice(0, 4000);
      } else {
        media = String(m.media || '');
        if (!FILE_RE.test(media) || !q('SELECT 1 FROM media WHERE file=? AND uploader=?').get(media, uid)) return;
        body = body.slice(0, 1000);
        w = Math.max(1, Math.min(10000, +m.w || 0)) || null;
        h = Math.max(1, Math.min(10000, +m.h || 0)) || null;
      }
      const others = memberIds(c).filter((x) => x !== uid);
      const delivered = conv.type === 'direct' && others.some(isOnline) ? 1 : 0;
      const id = q('INSERT INTO messages(conv_id,sender,kind,body,media,w,h,created,delivered) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(c, uid, kind, body || null, media, w, h, now(), delivered).lastInsertRowid;
      q('UPDATE members SET last_read=MAX(last_read,?) WHERE conv_id=? AND user_id=?').run(id, c, uid); // my own message counts as read
      const msg = pubMsg(q('SELECT * FROM messages WHERE id=?').get(id));
      const tmp = typeof m.tmp === 'string' ? m.tmp.slice(0, 40) : undefined;
      sendTo(uid, { t: 'msg', msg, tmp });
      const sender = q('SELECT name FROM users WHERE id=?').pluck().get(uid);
      for (const o of others) {
        sendTo(o, { t: 'msg', msg });
        if (!isVisible(o)) {
          pushTo(o, {
            conv: c,
            title: conv.type === 'group' ? conv.name : sender,
            body: (conv.type === 'group' ? sender + ': ' : '') + (kind === 'image' ? '📷 ' + (body || 'Photo') : body.slice(0, 120)),
          });
        }
      }
      break;
    }
  }
}

// drop dead connections & keep tunnels alive
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000).unref();

// ───────────────────────── start ─────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  ✨ Komal is running\n');
  console.log(`  On this laptop : http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Same Wi-Fi     : http://${ip}:${PORT}   (no notifications/install over plain http)`);
  console.log('\n  Friends outside your Wi-Fi: run  cloudflared tunnel --url http://localhost:' + PORT + '  (see README)');
  console.log(INVITE ? `\n  🔑 Invite code for new friends: ${INVITE}\n` : '\n  ⚠️  Invite code is OFF — anyone with your link can sign up.\n');
});

process.on('SIGINT', () => { try { db.close(); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { db.close(); } catch {} process.exit(0); });
