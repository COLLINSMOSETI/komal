(() => {
'use strict';

/* ───────────── tiny helpers ───────────── */
const root = document.getElementById('app');
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
const ICON = {
  send: 'M2 21l21-9L2 3v7l15 2-15 2z',
  clip: 'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z',
  more: 'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  chat: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6zm8 5H6v-2h8zm4-6H6V6h12z',
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  group: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
};
const iconBtn = (d, title, onclick) => h('button', { class: 'icon-btn', title, 'aria-label': title, onclick }, svg(ICON[d]));

function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}
async function api(path, opts = {}) {
  const o = { credentials: 'same-origin', ...opts };
  if (o.json !== undefined) { o.method = o.method || 'POST'; o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(o.json); delete o.json; }
  let r;
  try { r = await fetch('/api' + path, o); } catch { throw new Error('No connection to Komal server'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || 'Something went wrong'); e.status = r.status; throw e; }
  return d;
}
const hue = (id) => (id * 67) % 360;
const initials = (n) => (String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || '').join('') || '?').toUpperCase();
function avatar(user, cls = '') {
  const a = h('div', { class: 'av ' + cls });
  if (user && user.photo) a.append(h('img', { src: '/avatar/' + user.photo, alt: '', loading: 'lazy' }));
  else { a.style.background = `hsl(${hue(user?.id || 0)} 45% 48%)`; a.textContent = initials(user?.name); }
  return a;
}
function groupAvatar(cls = '') { const a = h('div', { class: 'av ' + cls }, svg(ICON.group)); a.style.background = '#6b7c85'; return a; }
const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(t) {
  const d = new Date(t), n = new Date();
  if (sameDay(t, n)) return 'Today';
  if (sameDay(t, n.getTime() - 864e5)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}
function listTime(t) {
  const n = new Date();
  if (sameDay(t, n)) return hm(t);
  if (sameDay(t, n.getTime() - 864e5)) return 'Yesterday';
  const d = new Date(t);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function seenText(t) {
  if (!t) return '';
  const n = new Date();
  if (sameDay(t, n)) return 'last seen today at ' + hm(t);
  if (sameDay(t, n.getTime() - 864e5)) return 'last seen yesterday at ' + hm(t);
  const d = new Date(t);
  return `last seen ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function linkify(text) {
  return text.split(/(https?:\/\/[^\s<>"']+)/g).map((p, i) =>
    i % 2 ? h('a', { href: p, target: '_blank', rel: 'noopener noreferrer nofollow' }, p) : p);
}

/* image → small JPEG (fast uploads, less data) */
async function shrink(file, max, quality, square) {
  const bmp = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; }
  const k = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), hh = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hh);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not read that image');
  return { blob, w, h: hh };
}

/* ───────────── state ───────────── */
const S = {
  me: null, convs: new Map(), msgs: new Map(), more: new Map(),
  active: null, typing: new Map(), ws: null, wsOk: false, retry: 0,
  pushOn: false, installEvt: null, outbox: [], seq: 0,
};
let els = {};
const isTouch = matchMedia('(pointer:coarse)').matches;

/* ───────────── auth screen ───────────── */
function showAuth(mode = 'login') {
  root.replaceChildren();
  let photoBlob = null;
  const params = new URLSearchParams(location.search);
  const err = h('div', { class: 'err' });
  const phone = h('input', { type: 'tel', placeholder: '+254 712 345 678', autocomplete: 'tel', required: true });
  const pass = h('input', { type: 'password', placeholder: mode === 'login' ? 'Your password' : 'At least 8 characters', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
  const name = h('input', { type: 'text', placeholder: 'Your name', maxlength: 40, autocomplete: 'name' });
  const invite = h('input', { type: 'text', placeholder: 'Code from your friend', autocapitalize: 'off', autocomplete: 'off', value: params.get('invite') || '' });
  const circle = h('div', { class: 'circle' }, '📷');
  const pick = h('label', { class: 'photo-pick' }, circle, h('span', {}, 'Add your profile photo', h('br'), 'Use the same one as on WhatsApp'),
    h('input', {
      type: 'file', accept: 'image/*', onchange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { const r = await shrink(f, 400, 0.85, true); photoBlob = r.blob; circle.replaceChildren(h('img', { src: URL.createObjectURL(r.blob), alt: '' })); }
        catch (x) { err.textContent = x.message; }
      },
    }));
  const btn = h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Log in' : 'Create my Komal account');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try {
        if (mode === 'login') await api('/login', { json: { phone: phone.value, password: pass.value } });
        else {
          await api('/register', { json: { phone: phone.value, password: pass.value, name: name.value, invite: invite.value } });
          if (photoBlob) { const fd = new FormData(); fd.append('file', photoBlob, 'p.jpg'); await api('/me/photo', { method: 'POST', body: fd }).catch(() => {}); }
        }
        boot();
      } catch (x) { err.textContent = x.message; btn.disabled = false; }
    },
  },
    mode === 'register' && pick,
    h('label', { class: 'field' }, h('span', {}, 'Phone number'), phone),
    mode === 'register' && h('label', { class: 'field' }, h('span', {}, 'Your name'), name),
    h('label', { class: 'field' }, h('span', {}, 'Password'), pass),
    mode === 'register' && h('label', { class: 'field' }, h('span', {}, 'Invite code'), invite),
    err, btn,
    h('button', { class: 'btn ghost', type: 'button', onclick: () => showAuth(mode === 'login' ? 'register' : 'login') },
      mode === 'login' ? 'New here? Create an account' : 'I already have an account'));
  root.append(h('div', { class: 'auth' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, 'K'), 'Komal'),
    h('div', { class: 'card' },
      h('h1', {}, mode === 'login' ? 'Welcome back' : 'Join Komal'),
      h('p', { class: 'sub' }, mode === 'login' ? 'Log in with your phone number.' : 'Your phone number is your Komal ID — friends find you with it.'),
      form)));
  (mode === 'login' ? phone : name).focus();
}

/* ───────────── boot ───────────── */
async function boot() {
  try {
    const { me } = await api('/me');
    S.me = me;
  } catch { return showAuth('login'); }
  const { convs } = await api('/convs');
  S.convs = new Map(convs.map((c) => [c.id, c]));
  buildMain();
  renderList();
  connect();
  registerSW();
  const c = +new URLSearchParams(location.search).get('c');
  if (c && S.convs.has(c)) openConv(c);
}

/* ───────────── main layout ───────────── */
function buildMain() {
  root.replaceChildren();
  els.search = h('input', { type: 'search', placeholder: 'Search chats', oninput: renderList, 'aria-label': 'Search chats' });
  els.list = h('div', { class: 'list' });
  els.banner = h('div');
  els.conn = h('div', { class: 'banner hidden' }, 'Connecting…');
  const side = h('aside', { class: 'side' },
    h('div', { class: 'side-head' },
      h('div', { onclick: openProfile, style: 'cursor:pointer' }, avatar(S.me, 'sm')),
      h('div', { class: 'title' }, 'Komal'),
      iconBtn('chat', 'New chat', openNewChat),
      iconBtn('more', 'Menu', (e) => openMenu(e.currentTarget))),
    els.conn, els.banner,
    h('div', { class: 'searchbox' }, els.search),
    els.list);
  els.chat = h('main', { class: 'chat' });
  els.shell = h('div', { class: 'shell' }, side, els.chat);
  root.append(els.shell);
  showEmpty();
  updateBanner();
}
function showEmpty() {
  S.active = null;
  els.chat.replaceChildren(h('div', { class: 'chat-empty' }, h('div', { class: 'logo-big' }, 'K'),
    h('h2', {}, 'Komal for friends'), h('div', {}, 'Send photos and messages privately.', h('br'), 'Tap the chat icon and enter a friend’s number to begin.')));
  els.shell.classList.remove('chat-open');
}
function updateBanner() {
  els.banner.replaceChildren();
  if (!window.isSecureContext) {
    els.banner.append(h('div', { class: 'banner' }, 'Open Komal through the secure https link to get notifications and install the app.'));
  } else if ('Notification' in window && Notification.permission === 'default') {
    els.banner.append(h('div', { class: 'banner' }, h('span', { style: 'flex:1' }, 'Get notified when friends message you.'),
      h('button', { onclick: askNotifications }, 'Turn on')));
  }
}
async function askNotifications() {
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted') await setupPush();
    else toast('Notifications are off. You can turn them on in your browser settings.');
  } catch {}
  updateBanner();
}
function closeMenus() { document.querySelectorAll('.menu').forEach((m) => m.remove()); }
document.addEventListener('click', (e) => { if (!e.target.closest('.menu') && !e.target.closest('[data-menu]')) closeMenus(); });
function popMenu(anchor, items, up) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  const m = h('div', { class: 'menu' }, items.filter(Boolean).map(([label, fn]) => h('button', { onclick: () => { closeMenus(); fn(); } }, label)));
  anchor.setAttribute('data-menu', '');
  document.body.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.left)) + 'px';
  m.style.top = (up ? Math.max(8, r.top - mh - 8) : Math.min(innerHeight - mh - 8, r.bottom + 4)) + 'px';
}
function openMenu(anchor) {
  popMenu(anchor, [
    ['New chat', openNewChat], ['New group', openNewGroup], ['Profile', openProfile],
    S.installEvt && ['Install Komal app', async () => { S.installEvt.prompt(); S.installEvt = null; }],
    ['Log out', logout],
  ]);
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });

async function logout() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await api('/push/unsubscribe', { json: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
  } catch {}
  await api('/logout', { method: 'POST', json: {} }).catch(() => {});
  location.href = '/';
}

/* ───────────── conversation list ───────────── */
const peer = (c) => c.members.find((m) => m.id !== S.me.id) || S.me;
const convTitle = (c) => (c.type === 'group' ? c.name : peer(c).name);
const convTime = (c) => (c.last ? c.last.created : c.created);
const userIn = (c, id) => c.members.find((m) => m.id === id) || { id, name: 'Someone' };
function preview(c) {
  const l = c.last; if (!l) return '';
  const who = l.sender === S.me.id ? 'You: ' : c.type === 'group' ? userIn(c, l.sender).name.split(' ')[0] + ': ' : '';
  return who + (l.kind === 'image' ? '📷 ' + (l.body || 'Photo') : l.body);
}
function renderList() {
  const qy = els.search.value.trim().toLowerCase();
  const arr = [...S.convs.values()].filter((c) => !qy || convTitle(c).toLowerCase().includes(qy)).sort((a, b) => convTime(b) - convTime(a));
  els.list.replaceChildren(...arr.map((c) => {
    const typing = isTyping(c);
    return h('div', { class: 'item' + (S.active === c.id ? ' active' : ''), onclick: () => openConv(c.id) },
      c.type === 'group' ? groupAvatar() : avatar(peer(c)),
      h('div', { class: 'mid' },
        h('div', { class: 'row1' }, h('div', { class: 'nm' }, convTitle(c)), h('div', { class: 'tm' + (c.unread ? ' unread' : '') }, c.last ? listTime(c.last.created) : '')),
        h('div', { class: 'row2' },
          h('div', { class: 'pv' }, typing ? h('span', { style: 'color:var(--green)' }, 'typing…') : h('span', { class: 't' }, preview(c))),
          c.unread ? h('div', { class: 'badge' }, c.unread > 99 ? '99+' : c.unread) : null)));
  }));
  if (!arr.length) els.list.append(h('div', { class: 'empty-list' }, qy ? 'No chats found.' : 'No chats yet. Tap the chat icon at the top to message a friend by their phone number.'));
  const total = [...S.convs.values()].reduce((n, c) => n + c.unread, 0);
  document.title = (total ? `(${total}) ` : '') + 'Komal';
  if (navigator.setAppBadge) (total ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => {});
}
function isTyping(c) {
  for (const u of c.members) if (u.id !== S.me.id && S.typing.has(c.id + ':' + u.id)) return u;
  return null;
}

/* ───────────── chat pane ───────────── */
async function openConv(id) {
  const c = S.convs.get(id); if (!c) return;
  closeMenus();
  const wasActive = S.active === id;
  S.active = id;
  els.shell.classList.add('chat-open');
  if (!wasActive && matchMedia('(max-width:760px)').matches) history.pushState({ chat: id }, '');
  buildChat(c);
  renderList();
  if (!S.msgs.has(id)) {
    try {
      const { messages, more } = await api(`/convs/${id}/messages`);
      S.msgs.set(id, messages); S.more.set(id, more);
    } catch (e) { toast(e.message); return; }
  }
  if (S.active === id) { renderMessages(true); markRead(id); }
}
window.addEventListener('popstate', () => { if (S.active && els.shell) { showEmpty(); renderList(); } });

function convStatus(c) {
  const t = isTyping(c);
  if (t) return [c.type === 'group' ? `${t.name.split(' ')[0]} is typing…` : 'typing…', true];
  if (c.type === 'group') return [c.members.map((m) => (m.id === S.me.id ? 'You' : m.name.split(' ')[0])).join(', '), false];
  const p = peer(c);
  if (p.id === S.me.id) return ['Message yourself', false];
  return p.online ? ['online', true] : [seenText(p.last_seen), false];
}
function buildChat(c) {
  const stat = h('div', { class: 'st' });
  const nm = h('div', { class: 'nm' }, convTitle(c));
  els.status = stat;
  els.msgs = h('div', { class: 'msgs' });
  els.msgs.addEventListener('scroll', async () => {
    if (els.msgs.scrollTop < 60 && S.more.get(c.id) && !S.loadingMore) {
      S.loadingMore = true;
      const arr = S.msgs.get(c.id) || [];
      const first = arr.find((m) => typeof m.id === 'number');
      if (first) {
        try {
          const { messages, more } = await api(`/convs/${c.id}/messages?before=${first.id}`);
          S.more.set(c.id, more);
          const prevH = els.msgs.scrollHeight;
          S.msgs.set(c.id, [...messages, ...arr]);
          renderMessages(false);
          els.msgs.scrollTop = els.msgs.scrollHeight - prevH;
        } catch {}
      }
      S.loadingMore = false;
    }
  });
  const ta = h('textarea', { rows: 1, placeholder: 'Type a message', maxlength: 4000, 'aria-label': 'Message' });
  els.input = ta;
  let lastTyping = 0;
  ta.addEventListener('input', () => {
    ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
    const t = Date.now();
    if (t - lastTyping > 2500 && ta.value) { lastTyping = t; wsSend({ t: 'typing', conv: c.id }); }
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); sendText(); }
  });
  ta.addEventListener('focus', () => markRead(c.id));
  const fileLib = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', onchange: (e) => { handleFiles(e.target.files); e.target.value = ''; } });
  const fileCam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: (e) => { handleFiles(e.target.files); e.target.value = ''; } });
  const clipBtn = h('button', { class: 'icon-btn', title: 'Attach photo', 'aria-label': 'Attach photo', onclick: (e) => popMenu(e.currentTarget, [['🖼️  Photo library', () => fileLib.click()], ['📷  Camera', () => fileCam.click()]], true) }, svg(ICON.clip));
  const head = h('div', { class: 'chat-head', onclick: () => openInfo(c.id) },
    h('button', { class: 'icon-btn back', 'aria-label': 'Back', onclick: (e) => { e.stopPropagation(); history.state && history.state.chat ? history.back() : (showEmpty(), renderList()); } }, svg(ICON.back)),
    c.type === 'group' ? groupAvatar('sm') : avatar(peer(c), 'sm'),
    h('div', { class: 'who' }, nm, stat));
  els.chat.replaceChildren(head, els.msgs,
    h('div', { class: 'composer' }, clipBtn, fileLib, fileCam, ta,
      h('button', { class: 'send', 'aria-label': 'Send', onclick: sendText }, svg(ICON.send))));
  els.msgs.addEventListener('dragover', (e) => e.preventDefault());
  els.msgs.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  document.addEventListener('paste', pasteHandler);
  updateStatus();
  if (!isTouch) ta.focus();
}
function pasteHandler(e) {
  if (!S.active) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); handleFiles(files); }
}
function updateStatus() {
  const c = S.convs.get(S.active); if (!c || !els.status) return;
  const [txt, live] = convStatus(c);
  els.status.textContent = txt; els.status.className = 'st' + (live ? ' live' : '');
}

function tickNode(m, c) {
  if (m.sender !== S.me.id) return null;
  if (m.pending) return h('span', { class: 'tick' }, '🕓');
  if (c.type === 'direct' && peer(c).id !== S.me.id) {
    if (c.peerRead >= m.id) return h('span', { class: 'tick read' }, '✓✓');
    return h('span', { class: 'tick' }, m.delivered ? '✓✓' : '✓');
  }
  return h('span', { class: 'tick' }, '✓');
}
function msgNode(m, c) {
  const mine = m.sender === S.me.id;
  const meta = h('span', { class: 'meta' + (m.kind === 'image' && !m.body ? ' over' : '') }, hm(m.created), tickNode(m, c));
  const b = h('div', { class: 'bubble ' + (mine ? 'out' : 'in') + (m.kind === 'image' ? ' has-img' : '') });
  if (c.type === 'group' && !mine) {
    const u = userIn(c, m.sender);
    const w = h('div', { class: 'who' }, u.name); w.style.color = `hsl(${hue(u.id)} 55% 45%)`; b.append(w);
  }
  if (m.kind === 'image') {
    const src = m.local || '/media/' + m.media;
    const img = h('img', { class: 'photo', src, alt: 'Photo', loading: 'lazy', onclick: () => viewImage(src) });
    if (m.w && m.h) img.style.aspectRatio = `${m.w} / ${m.h}`;
    b.append(h('span', { class: 'img-wrap' }, img, m.pending ? h('div', { class: 'spinner' }, h('i')) : null, !m.body ? meta : null));
    if (m.body) b.append(h('span', { class: 'txt' }, linkify(m.body)), meta);
  } else b.append(h('span', { class: 'txt' }, linkify(m.body || '')), meta);
  return h('div', { class: 'row ' + (mine ? 'out' : 'in') + (m.pending ? ' pending' : '') }, b);
}
function renderMessages(stick) {
  const c = S.convs.get(S.active); if (!c || !els.msgs) return;
  const arr = S.msgs.get(c.id) || [];
  const nearBottom = els.msgs.scrollHeight - els.msgs.scrollTop - els.msgs.clientHeight < 140;
  const nodes = [];
  let prev = null;
  if (S.more.get(c.id)) nodes.push(h('div', { class: 'load-more' }, 'Scroll up for older messages'));
  for (const m of arr) {
    if (!prev || !sameDay(prev.created, m.created)) nodes.push(h('div', { class: 'day' }, dayLabel(m.created)));
    nodes.push(msgNode(m, c)); prev = m;
  }
  els.msgs.replaceChildren(...nodes);
  if (stick || nearBottom) els.msgs.scrollTop = els.msgs.scrollHeight;
}
function viewImage(src) {
  const v = h('div', { class: 'viewer', onclick: () => v.remove() }, h('img', { src, alt: 'Photo' }));
  document.body.append(v);
}

/* ───────────── sending ───────────── */
function wsSend(o) { if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(o)); return true; } return false; }
function addLocal(convId, m) {
  const arr = S.msgs.get(convId) || []; arr.push(m); S.msgs.set(convId, arr);
  const c = S.convs.get(convId); if (c) c.last = { ...m, id: m.id }; // for preview
  renderMessages(true); renderList();
}
function sendText() {
  const c = S.convs.get(S.active); if (!c) return;
  const body = els.input.value.trim(); if (!body) return;
  els.input.value = ''; els.input.style.height = 'auto';
  const tmp = 't' + Date.now() + '_' + (++S.seq);
  const m = { id: tmp, tmp, conv: c.id, sender: S.me.id, kind: 'text', body, created: Date.now(), pending: true };
  addLocal(c.id, m);
  const payload = { t: 'send', conv: c.id, kind: 'text', body, tmp };
  if (!wsSend(payload)) S.outbox.push(payload);
  if (!isTouch) els.input.focus();
}
async function handleFiles(list) {
  const files = [...list].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return toast('Please choose a photo');
  for (const f of files.slice(0, 10)) await previewAndSend(f);
}
function previewAndSend(file) {
  return new Promise(async (resolve) => {
    const c = S.convs.get(S.active); if (!c) return resolve();
    let r;
    try { r = await shrink(file, 1600, 0.82, false); } catch (e) { toast(e.message); return resolve(); }
    const url = URL.createObjectURL(r.blob);
    const cap = h('input', { type: 'text', placeholder: 'Add a caption…', maxlength: 1000, style: 'width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--input);outline:none' });
    const close = () => { ov.remove(); resolve(); };
    const go = () => { ov.remove(); sendImage(c.id, r, url, cap.value.trim()); resolve(); };
    cap.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
      h('div', { class: 'modal preview' }, h('h3', {}, 'Send photo'), h('img', { src: url, alt: 'Preview' }), cap,
        h('button', { class: 'btn', onclick: go }, 'Send'), h('button', { class: 'btn ghost', onclick: close }, 'Cancel')));
    document.body.append(ov); cap.focus();
  });
}
async function sendImage(convId, r, url, body) {
  const tmp = 't' + Date.now() + '_' + (++S.seq);
  const m = { id: tmp, tmp, conv: convId, sender: S.me.id, kind: 'image', body, local: url, w: r.w, h: r.h, created: Date.now(), pending: true };
  addLocal(convId, m);
  try {
    const fd = new FormData(); fd.append('file', r.blob, 'photo.jpg');
    const { media } = await api('/upload', { method: 'POST', body: fd });
    const payload = { t: 'send', conv: convId, kind: 'image', media, w: r.w, h: r.h, body, tmp };
    if (!wsSend(payload)) S.outbox.push(payload);
  } catch (e) {
    S.msgs.set(convId, (S.msgs.get(convId) || []).filter((x) => x.tmp !== tmp));
    renderMessages(false); toast('Photo failed to send: ' + e.message);
  }
}
function markRead(convId) {
  const c = S.convs.get(convId); if (!c) return;
  if (document.visibilityState === 'visible' && (c.unread || true)) {
    if (c.unread) { c.unread = 0; renderList(); }
    wsSend({ t: 'read', conv: convId });
  }
}

/* ───────────── realtime ───────────── */
function connect() {
  clearTimeout(S.reconnectTimer);
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  S.ws = ws;
  ws.onopen = () => {
    S.wsOk = true; S.retry = 0; els.conn.classList.add('hidden');
    wsSend({ t: 'vis', visible: document.visibilityState === 'visible' });
    for (const p of S.outbox.splice(0)) wsSend(p);
    refreshAll();
  };
  ws.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (x) { console.error(x); } };
  ws.onclose = async () => {
    if (S.ws !== ws) return;
    S.wsOk = false; els.conn.classList.remove('hidden');
    // if the session expired, go to login
    try { await api('/me'); } catch (e) { if (e.status === 401) return showAuth('login'); }
    S.reconnectTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** S.retry++));
  };
}
async function refreshAll() { // after (re)connect, catch up on anything missed
  try {
    const { convs } = await api('/convs');
    for (const c of convs) {
      const old = S.convs.get(c.id);
      S.convs.set(c.id, c);
      if (old && S.msgs.has(c.id)) {
        const have = S.msgs.get(c.id).filter((m) => typeof m.id === 'number');
        const lastId = have.length ? have[have.length - 1].id : 0;
        if (c.last && c.last.id > lastId) {
          const { messages } = await api(`/convs/${c.id}/messages?limit=100`);
          const pend = S.msgs.get(c.id).filter((m) => m.pending);
          S.msgs.set(c.id, [...messages, ...pend]);
        }
      }
    }
    renderList(); renderMessages(false); updateStatus();
    if (S.active) markRead(S.active);
  } catch {}
}
async function ensureConv(id) {
  if (S.convs.has(id)) return S.convs.get(id);
  try { const { conv } = await api('/convs/' + id); S.convs.set(id, conv); return conv; } catch { return null; }
}
async function onEvent(ev) {
  switch (ev.t) {
    case 'msg': {
      const m = ev.msg;
      const c = await ensureConv(m.conv); if (!c) return;
      const mine = m.sender === S.me.id;
      const arr = S.msgs.get(m.conv);
      if (arr) {
        const i = ev.tmp ? arr.findIndex((x) => x.tmp === ev.tmp) : -1;
        if (i >= 0) { if (arr[i].local) { /* keep decrypted local preview out; server copy used */ } arr[i] = m; }
        else if (!arr.some((x) => x.id === m.id)) arr.push(m);
      }
      c.last = m;
      for (const k of [...S.typing.keys()]) if (k === m.conv + ':' + m.sender) { clearTimeout(S.typing.get(k)); S.typing.delete(k); }
      const viewing = S.active === m.conv && document.visibilityState === 'visible';
      if (!mine) {
        if (viewing) { wsSend({ t: 'read', conv: m.conv }); } else { c.unread++; notify(c, m); }
        beep();
      }
      if (S.active === m.conv) { renderMessages(mine); updateStatus(); }
      renderList();
      break;
    }
    case 'status': {
      const c = S.convs.get(ev.conv); if (!c) return;
      const arr = S.msgs.get(ev.conv) || [];
      if (ev.status === 'delivered') { for (const m of arr) if (m.sender === S.me.id && m.id <= ev.upto) m.delivered = 1; }
      if (ev.status === 'read' && c.type === 'direct') { c.peerRead = Math.max(c.peerRead, ev.upto); for (const m of arr) if (m.sender === S.me.id && m.id <= ev.upto) m.delivered = 1; }
      if (S.active === ev.conv) renderMessages(false);
      break;
    }
    case 'readsync': { const c = S.convs.get(ev.conv); if (c) { c.unread = 0; renderList(); } break; }
    case 'typing': {
      const k = ev.conv + ':' + ev.user;
      clearTimeout(S.typing.get(k));
      S.typing.set(k, setTimeout(() => { S.typing.delete(k); updateStatus(); renderList(); }, 4000));
      if (S.convs.has(ev.conv)) { updateStatus(); renderList(); }
      break;
    }
    case 'presence': {
      for (const c of S.convs.values()) for (const u of c.members) if (u.id === ev.user) { u.online = ev.online; u.last_seen = ev.last_seen; }
      updateStatus(); break;
    }
    case 'user': {
      for (const c of S.convs.values()) c.members = c.members.map((u) => (u.id === ev.user.id ? { ...u, ...ev.user } : u));
      renderList(); if (S.active) { const c = S.convs.get(S.active); if (c) { buildChat(c); renderMessages(true); } }
      break;
    }
    case 'conv': S.convs.set(ev.conv.id, ev.conv); renderList(); break;
  }
}
document.addEventListener('visibilitychange', () => {
  wsSend({ t: 'vis', visible: document.visibilityState === 'visible' });
  if (document.visibilityState === 'visible') {
    if (S.ws && S.ws.readyState > 1) connect();
    if (S.active) markRead(S.active);
  }
});
window.addEventListener('online', () => { if (!S.wsOk) connect(); });

/* ───────────── sound & notifications ───────────── */
let actx;
function beep() {
  try {
    if (document.visibilityState !== 'visible') return;
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.04;
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.09);
  } catch {}
}
async function notify(c, m) {
  if (S.pushOn || !('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  const sender = userIn(c, m.sender).name;
  const title = c.type === 'group' ? c.name : sender;
  const body = (c.type === 'group' ? sender + ': ' : '') + (m.kind === 'image' ? '📷 ' + (m.body || 'Photo') : m.body.slice(0, 120));
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: '/icons/icon-192.png', tag: 'c' + c.id, data: { conv: c.id } });
    else new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'c' + c.id });
  } catch {}
}
function b64ToU8(s) {
  const p = '='.repeat((4 - (s.length % 4)) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...b].map((ch) => ch.charCodeAt(0)));
}
async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) { const { key } = await api('/push/key'); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) }); }
    await api('/push/subscribe', { json: sub.toJSON() });
    S.pushOn = true;
  } catch (e) { console.warn('push setup failed', e); }
}
async function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.t === 'open' && S.convs.has(e.data.conv)) openConv(e.data.conv); });
    await setupPush();
  } catch (e) { console.warn('SW failed', e); }
}

/* ───────────── modals ───────────── */
function modal(content) {
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) ov.remove(); } }, h('div', { class: 'modal' }, content));
  document.body.append(ov); return ov;
}
async function lookup(phoneVal) {
  const { user } = await api('/users/lookup?phone=' + encodeURIComponent(phoneVal));
  return user;
}
function openNewChat() {
  const phone = h('input', { type: 'tel', placeholder: '+254 712 345 678', autocomplete: 'off' });
  const out = h('div'); const err = h('div', { class: 'err' });
  let ov;
  const find = async (e) => {
    e && e.preventDefault(); err.textContent = ''; out.replaceChildren();
    try {
      const u = await lookup(phone.value);
      out.append(h('div', { class: 'found' }, avatar(u), h('div', { class: 'info' }, h('b', {}, u.id === S.me.id ? u.name + ' (You)' : u.name), h('small', {}, u.phone)),
        h('button', { class: 'btn', style: 'width:auto;padding:8px 16px;margin:0', type: 'button', onclick: async () => {
          try { const { conv } = await api('/convs/direct', { json: { userId: u.id } }); S.convs.set(conv.id, conv); ov.remove(); renderList(); openConv(conv.id); } catch (x) { err.textContent = x.message; }
        } }, 'Message')));
    } catch (x) { err.textContent = x.message; }
  };
  ov = modal(h('form', { onsubmit: find }, h('h3', {}, 'New chat'),
    h('label', { class: 'field' }, h('span', {}, 'Friend’s phone number'), phone), err, out,
    h('button', { class: 'btn', type: 'submit' }, 'Find friend'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { ov.remove(); openNewGroup(); } }, 'Create a group instead')));
  phone.focus();
}
function openNewGroup() {
  const members = new Map();
  const name = h('input', { type: 'text', maxlength: 40, placeholder: 'Group name' });
  const phone = h('input', { type: 'tel', placeholder: 'Add by phone number' });
  const chips = h('div', { class: 'chips' }); const err = h('div', { class: 'err' });
  let ov;
  const drawChips = () => chips.replaceChildren(...[...members.values()].map((u) => h('span', { class: 'chip' }, u.name, h('button', { type: 'button', 'aria-label': 'Remove', onclick: () => { members.delete(u.id); drawChips(); } }, '×'))));
  const add = async () => {
    err.textContent = '';
    try { const u = await lookup(phone.value); if (u.id === S.me.id) throw new Error('You are already in the group'); members.set(u.id, u); phone.value = ''; drawChips(); } catch (x) { err.textContent = x.message; }
  };
  ov = modal(h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      const { conv } = await api('/convs/group', { json: { name: name.value, memberIds: [...members.keys()] } });
      S.convs.set(conv.id, conv); ov.remove(); renderList(); openConv(conv.id);
    } catch (x) { err.textContent = x.message; }
  } }, h('h3', {}, 'New group'),
    h('label', { class: 'field' }, h('span', {}, 'Group name'), name),
    h('label', { class: 'field' }, h('span', {}, 'Members'), phone),
    h('button', { class: 'btn ghost', type: 'button', style: 'margin:-6px 0 6px', onclick: add }, '+ Add person'),
    chips, err, h('button', { class: 'btn', type: 'submit' }, 'Create group')));
  name.focus();
}
function openInfo(id) {
  const c = S.convs.get(id); if (!c) return;
  if (c.type === 'direct') {
    const u = peer(c);
    modal(h('div', {}, h('div', { class: 'center' }, avatar(u, 'lg'), h('h3', { style: 'margin:4px 0 0' }, u.name), h('div', { style: 'color:var(--muted)' }, u.phone)),
      h('div', { class: 'field' }, h('span', {}, 'About'), h('div', {}, u.about))));
  } else {
    modal(h('div', {}, h('div', { class: 'center' }, groupAvatar('lg'), h('h3', { style: 'margin:4px 0 0' }, c.name), h('div', { style: 'color:var(--muted)' }, `${c.members.length} members`)),
      c.members.map((u) => h('div', { class: 'found', style: 'margin:6px 0' }, avatar(u, 'sm'), h('div', { class: 'info' }, h('b', {}, u.id === S.me.id ? u.name + ' (You)' : u.name), h('small', {}, u.phone))))));
  }
}
function openProfile() {
  const name = h('input', { type: 'text', value: S.me.name, maxlength: 40 });
  const about = h('input', { type: 'text', value: S.me.about, maxlength: 140 });
  const err = h('div', { class: 'err' });
  const av = h('div', { class: 'center' });
  const drawAv = () => av.replaceChildren(h('label', { style: 'cursor:pointer;position:relative', title: 'Change photo' }, avatar(S.me, 'lg'),
    h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const r = await shrink(f, 400, 0.85, true); const fd = new FormData(); fd.append('file', r.blob, 'p.jpg'); const { me } = await api('/me/photo', { method: 'POST', body: fd }); S.me = me; drawAv(); toast('Profile photo updated'); }
      catch (x) { err.textContent = x.message; }
    } })), h('small', { style: 'color:var(--muted)' }, 'Tap to change photo'), h('div', { style: 'color:var(--muted)' }, S.me.phone));
  drawAv();
  const ov = modal(h('form', { onsubmit: async (e) => {
    e.preventDefault();
    try { const { me } = await api('/me', { method: 'PUT', json: { name: name.value, about: about.value } }); S.me = me; ov.remove(); toast('Saved'); } catch (x) { err.textContent = x.message; }
  } }, h('h3', {}, 'Profile'), av,
    h('label', { class: 'field' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'About'), about),
    err, h('button', { class: 'btn', type: 'submit' }, 'Save'), h('button', { class: 'btn danger', type: 'button', onclick: logout }, 'Log out')));
}

boot();
})();
