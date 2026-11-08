'use strict';
/**
 * crmbl website server — zero dependencies, just Node.js (v18+; v22.5+ uses built-in SQLite).
 *
 *   npm start            → http://localhost:3000
 *   /admin               → orders dashboard (password from ADMIN_PASSWORD)
 *
 * Features: static site with caching + gzip, menu API, order API with server-side price checks,
 * live order tracking (Server-Sent Events), contact form, admin auth with signed cookies,
 * rate limiting, security headers.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

loadDotEnv();
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'crmbl-admin';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('crmbl:' + ADMIN_PASSWORD).digest('hex');
const PUBLIC = path.join(__dirname, 'public');
const IS_PROD = process.env.NODE_ENV === 'production';

const db = require('./lib/db');
const hours = require('./lib/hours');
const excel = require('./lib/excel');
const notify = require('./lib/notify');

/* Every new order / status change: refresh data/orders.xlsx (+ optional live Google Sheet) */
const allOrders = () => db.orders.list({ limit: 1_000_000 });
const refreshExcel = () => excel.saveOrdersFile(allOrders, db.dataDir);

const CATEGORIES = ['specials', 'crumble', 'cake', 'shakes', 'drinks'];
const STATUSES = ['received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];

/* =============================================================== helpers */
function loadDotEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env file — fine */ }
}

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string';
  const payload = json ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

async function readJson(req, limit = 32 * 1024) {
  if (!/application\/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected JSON');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Request too large'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

const clientIp = (req) => (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress;

/* simple fixed-window rate limiter */
const buckets = new Map();
function rateLimit(req, key, max, windowMs) {
  const k = key + ':' + clientIp(req);
  const t = Date.now();
  const b = buckets.get(k);
  if (!b || t > b.reset) { buckets.set(k, { n: 1, reset: t + windowMs }); return; }
  if (++b.n > max) throw new HttpError(429, 'Too many requests — please try again in a few minutes.');
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 60_000).unref();

/* signed session cookie for admin */
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 3600_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function isAdmin(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)crmbl_admin=([^;]+)/);
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return false;
  const good = sign(payload);
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
const cookie = (v, maxAge) => `crmbl_admin=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${IS_PROD ? '; Secure' : ''}`;
function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, 'Please log in');
  // CSRF defence in depth: mutating admin calls must come from our own origin
  if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Bad origin');
}

/* validation */
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const UK_PHONE = /^(?:\+44\s?|0)(?:\d\s?){9,10}$/;
const POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* =============================================================== live events (SSE) */
const adminStreams = new Set();
const orderStreams = new Map(); // code -> Set<res>
function sse(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => clearInterval(ping));
}
const emit = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function broadcastOrder(event, order) {
  for (const r of adminStreams) emit(r, event, order);
  for (const r of orderStreams.get(order.code) || []) emit(r, 'status', publicOrder(order));
}

/* =============================================================== domain */
const publicMenuItem = (m) => ({ id: m.id, name: m.name, description: m.description, category: m.category, section: m.section, price: m.price, price_l: m.price_l || null, emoji: m.emoji, badge: m.badge, image: m.image, featured: !!m.featured, available: !!m.available });

function publicSettings() {
  const s = db.settings.get();
  const st = hours.publicStatus(s);
  const slots = hours.slots(s, { prepMinutes: s.prepMinutes });
  return {
    open: s.open, close: s.close, closedDays: s.closedDays, status: st,
    ordering: {
      enabled: s.orderingEnabled && (st.open || (s.allowPreorderWhenClosed && slots.length > 0)),
      asap: s.orderingEnabled && st.open,
      collection: s.collectionEnabled, delivery: s.deliveryEnabled,
      deliveryFee: s.deliveryFee, minDelivery: s.minDelivery, deliveryPostcodes: s.deliveryPostcodes,
      slots, prepMinutes: s.prepMinutes,
    },
  };
}

function publicOrder(o) {
  return { number: o.number, code: o.code, status: o.status, type: o.type, name: o.name.split(' ')[0], slot: o.slot, created_at: o.created_at,
    items: o.items, subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total, history: o.history };
}

function createOrder(body) {
  const s = db.settings.get();
  const pub = publicSettings();
  if (!pub.ordering.enabled) throw new HttpError(409, 'Online ordering is closed right now. Please check our opening hours.');

  const type = body.type === 'delivery' ? 'delivery' : 'collection'; // site is collection-only by default (deliveryEnabled = false)
  if (type === 'delivery' && !s.deliveryEnabled) throw new HttpError(409, 'Delivery is not available right now.');
  if (type === 'collection' && !s.collectionEnabled) throw new HttpError(409, 'Collection is not available right now.');

  const errors = {};
  const name = str(body.name, 80);
  const phone = str(body.phone, 20);
  const email = str(body.email, 120);
  const notes = str(body.notes, 300);
  if (name.length < 2) errors.name = 'Please enter your name';
  if (!UK_PHONE.test(phone)) errors.phone = 'Please enter a valid UK phone number';
  if (email && !EMAIL.test(email)) errors.email = 'Please check your email address';

  let address = null, postcode = null;
  if (type === 'delivery') {
    address = str(body.address, 200);
    const pc = str(body.postcode, 10).toUpperCase().match(POSTCODE);
    if (address.length < 5) errors.address = 'Please enter your delivery address';
    if (!pc) errors.postcode = 'Please enter a valid UK postcode';
    else {
      postcode = `${pc[1]} ${pc[2]}`;
      const outward = pc[1].toUpperCase();
      if (s.deliveryPostcodes?.length && !s.deliveryPostcodes.includes(outward)) errors.postcode = `Sorry, we don't deliver to ${outward} yet`;
    }
  }

  const slot = body.slot === 'asap' || !body.slot ? 'asap' : str(body.slot, 5);
  if (slot === 'asap' && !pub.ordering.asap) errors.slot = 'Please choose a time';
  if (slot !== 'asap' && !pub.ordering.slots.includes(slot)) errors.slot = 'That time is no longer available, please pick another';

  // items: trust only ids + quantities from the browser; prices come from the database
  if (!Array.isArray(body.items) || body.items.length === 0) errors.items = 'Your basket is empty';
  const items = [];
  for (const it of (Array.isArray(body.items) ? body.items : []).slice(0, 30)) {
    const m = db.menu.get(String(it.id));
    const qty = Math.floor(Number(it.qty));
    if (!m) { errors.items = 'An item in your basket is no longer on the menu'; continue; }
    if (!m.available) { errors.items = `${m.name} is sold out — please remove it`; continue; }
    if (!(qty >= 1 && qty <= 20)) { errors.items = 'Please check quantities'; continue; }
    // drinks sold in Medium / Large: size "L" uses the Large price
    const large = it.size === 'L' && m.price_l;
    const price = large ? m.price_l : m.price;
    const name = m.price_l ? `${m.name} (${large ? 'Large' : 'Medium'})` : m.name;
    const existing = items.find((x) => x.id === m.id && x.size === (large ? 'L' : 'M'));
    if (existing) { existing.qty += qty; existing.line = existing.price * existing.qty; continue; }
    items.push({ id: m.id, size: large ? 'L' : 'M', name, price, qty, line: price * qty });
  }
  const subtotal = items.reduce((a, i) => a + i.line, 0);
  const delivery_fee = type === 'delivery' ? s.deliveryFee : 0;
  if (type === 'delivery' && subtotal < s.minDelivery && !errors.items) errors.items = `Minimum order for delivery is £${(s.minDelivery / 100).toFixed(2)}`;

  if (Object.keys(errors).length) throw new HttpError(422, 'Please check your details', { errors });

  return db.orders.create({ type, name, phone, email, address, postcode, slot, notes, items, subtotal, delivery_fee, total: subtotal + delivery_fee });
}

/* =============================================================== router */
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/health', () => ({ ok: true, storage: db.kind, time: new Date().toISOString() }));
route('GET', '/api/menu', () => ({ items: db.menu.list().map(publicMenuItem) }));
route('GET', '/api/settings', () => publicSettings());

route('POST', '/api/orders', async (req) => {
  rateLimit(req, 'order', 8, 10 * 60_000);
  const order = createOrder(await readJson(req));
  broadcastOrder('order:new', order);
  refreshExcel();
  notify.onNewOrder(order); // phone alert + Google Sheet row, in the background
  return [201, { order: publicOrder(order) }];
});
route('GET', '/api/orders/:code', (req, p) => {
  const o = db.orders.byCode(p.code.toUpperCase());
  if (!o) throw new HttpError(404, 'Order not found');
  return { order: publicOrder(o) };
});
route('GET', '/api/orders/:code/stream', (req, p, res) => {
  const code = p.code.toUpperCase();
  const o = db.orders.byCode(code);
  if (!o) throw new HttpError(404, 'Order not found');
  sse(req, res);
  emit(res, 'status', publicOrder(o));
  if (!orderStreams.has(code)) orderStreams.set(code, new Set());
  orderStreams.get(code).add(res);
  req.on('close', () => { orderStreams.get(code)?.delete(res); if (!orderStreams.get(code)?.size) orderStreams.delete(code); });
  return null; // streaming
});

route('POST', '/api/contact', async (req) => {
  rateLimit(req, 'contact', 5, 10 * 60_000);
  const b = await readJson(req);
  if (b.website) return { ok: true }; // honeypot: bots fill hidden fields
  const m = { name: str(b.name, 80), email: str(b.email, 120), message: str(b.message, 2000) };
  const errors = {};
  if (m.name.length < 2) errors.name = 'Please enter your name';
  if (!EMAIL.test(m.email)) errors.email = 'Please enter a valid email';
  if (m.message.length < 5) errors.message = 'Please write a message';
  if (Object.keys(errors).length) throw new HttpError(422, 'Please check the form', { errors });
  db.messages.create(m);
  for (const r of adminStreams) emit(r, 'message:new', m);
  return [201, { ok: true }];
});

/* ---- admin ---- */
route('POST', '/api/admin/login', async (req, p, res) => {
  rateLimit(req, 'login', 10, 15 * 60_000);
  const { password } = await readJson(req);
  const a = crypto.createHash('sha256').update(String(password || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Wrong password');
  res.setHeader('Set-Cookie', cookie(makeSession(), 12 * 3600));
  return { ok: true };
});
route('POST', '/api/admin/logout', (req, p, res) => { res.setHeader('Set-Cookie', cookie('', 0)); return { ok: true }; });
route('GET', '/api/admin/me', (req) => ({ admin: isAdmin(req), usingDefaultPassword: isAdmin(req) && !process.env.ADMIN_PASSWORD, alerts: isAdmin(req) ? notify.channels() : undefined }));

/* Download all orders as an Excel file */
route('GET', '/api/admin/orders.xlsx', (req, p, res) => {
  requireAdmin(req);
  const day = hours.londonNow().date;
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="crmbl-orders-${day}.xlsx"`,
    'Cache-Control': 'no-store',
  });
  res.end(excel.ordersWorkbook(allOrders()));
  return null;
});

/* Send a test alert to your phone */
route('POST', '/api/admin/test-notify', async (req) => {
  requireAdmin(req);
  const ch = notify.channels();
  if (!ch.ntfy && !ch.telegram) throw new HttpError(400, 'No phone alerts set up yet. Add NTFY_TOPIC (or Telegram details) to .env and restart.');
  const sample = { number: 1000, code: 'CR-TEST', name: 'Test Customer', phone: '07700 900000', slot: 'asap', notes: '', total: 1190,
    created_at: new Date().toISOString(), status: 'received', items: [{ name: 'Crumble with Custard', qty: 2, price: 595, line: 1190 }] };
  return { results: await notify.sendTest(sample) };
});

route('GET', '/api/admin/orders', (req, p, res, url) => {
  requireAdmin(req);
  const status = url.searchParams.get('status');
  const since = url.searchParams.get('since');
  return { orders: db.orders.list({ status: status ? status.split(',') : undefined, since: since || undefined }) };
});
route('PATCH', '/api/admin/orders/:id', async (req, p) => {
  requireAdmin(req);
  const { status } = await readJson(req);
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
  const o = db.orders.setStatus(Number(p.id), status);
  if (!o) throw new HttpError(404, 'Order not found');
  broadcastOrder('order:update', o);
  refreshExcel();
  notify.onStatusChange(o);
  return { order: o };
});
route('GET', '/api/admin/stream', (req, p, res) => {
  requireAdmin(req);
  sse(req, res);
  adminStreams.add(res);
  req.on('close', () => adminStreams.delete(res));
  return null;
});
route('GET', '/api/admin/stats', (req) => {
  requireAdmin(req);
  const today = hours.londonNow().date;
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const orders = db.orders.list({ since, limit: 5000 }).filter((o) => hours.londonNow(new Date(o.created_at)).date === today && o.status !== 'cancelled');
  const revenue = orders.reduce((a, o) => a + o.total, 0);
  const counts = {};
  for (const o of orders) for (const i of o.items) counts[i.name] = (counts[i.name] || 0) + i.qty;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));
  return { today: { orders: orders.length, revenue, average: orders.length ? Math.round(revenue / orders.length) : 0, open: orders.filter((o) => !['completed'].includes(o.status)).length }, top, storage: db.kind };
});

route('GET', '/api/admin/menu', (req) => { requireAdmin(req); return { items: db.menu.list() }; });
function cleanMenu(b, partial) {
  const out = {};
  if (!partial || 'name' in b) { out.name = str(b.name, 80); if (out.name.length < 2) throw new HttpError(422, 'Name is required'); }
  if ('description' in b) out.description = str(b.description, 240);
  if (!partial || 'category' in b) { out.category = CATEGORIES.includes(b.category) ? b.category : 'specials'; }
  if ('section' in b) out.section = str(b.section, 80) || null;
  if ('price_l' in b) { const v = b.price_l === null || b.price_l === '' ? null : Math.round(Number(b.price_l)); if (v !== null && !(v >= 0 && v < 100000)) throw new HttpError(422, 'Large price must be in pence'); out.price_l = v; }
  if (!partial || 'price' in b) { out.price = Math.round(Number(b.price)); if (!(out.price >= 0 && out.price < 100000)) throw new HttpError(422, 'Price must be in pence, e.g. 595'); }
  if ('emoji' in b) out.emoji = str(b.emoji, 8);
  if ('badge' in b) out.badge = str(b.badge, 24) || null;
  if ('image' in b) out.image = str(b.image, 200) || null;
  if ('featured' in b) out.featured = b.featured ? 1 : 0;
  if ('available' in b) out.available = b.available ? 1 : 0;
  if ('sort' in b) out.sort = Math.round(Number(b.sort)) || 0;
  return out;
}
route('POST', '/api/admin/menu', async (req) => {
  requireAdmin(req);
  const b = await readJson(req);
  const item = cleanMenu(b, false);
  item.id = (str(b.id, 60) || item.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (db.menu.get(item.id)) item.id += '-' + crypto.randomBytes(2).toString('hex');
  item.available = item.available ?? 1; item.featured = item.featured ?? 0; item.sort = item.sort ?? 99;
  return [201, { item: db.menu.create(item) }];
});
route('PATCH', '/api/admin/menu/:id', async (req, p) => {
  requireAdmin(req);
  const item = db.menu.update(p.id, cleanMenu(await readJson(req), true));
  if (!item) throw new HttpError(404, 'Item not found');
  return { item };
});
route('DELETE', '/api/admin/menu/:id', (req, p) => { requireAdmin(req); if (!db.menu.remove(p.id)) throw new HttpError(404, 'Item not found'); return { ok: true }; });

route('GET', '/api/admin/messages', (req) => { requireAdmin(req); return { messages: db.messages.list() }; });
route('PATCH', '/api/admin/messages/:id', (req, p) => { requireAdmin(req); db.messages.markRead(Number(p.id)); return { ok: true }; });

route('GET', '/api/admin/settings', (req) => { requireAdmin(req); return { settings: db.settings.get() }; });
route('PUT', '/api/admin/settings', async (req) => {
  requireAdmin(req);
  const b = await readJson(req);
  const patch = {};
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if ('open' in b) { if (!hhmm.test(b.open)) throw new HttpError(422, 'Opening time must be HH:MM'); patch.open = b.open; }
  if ('close' in b) { if (!hhmm.test(b.close)) throw new HttpError(422, 'Closing time must be HH:MM'); patch.close = b.close; }
  if ('closedDays' in b) patch.closedDays = (Array.isArray(b.closedDays) ? b.closedDays : []).map(Number).filter((d) => d >= 0 && d <= 6);
  for (const k of ['orderingEnabled', 'collectionEnabled', 'deliveryEnabled', 'allowPreorderWhenClosed']) if (k in b) patch[k] = !!b[k];
  for (const k of ['deliveryFee', 'minDelivery', 'prepMinutes']) if (k in b) { const n = Math.round(Number(b[k])); if (!(n >= 0 && n < 100000)) throw new HttpError(422, `${k} is invalid`); patch[k] = n; }
  if ('deliveryPostcodes' in b) patch.deliveryPostcodes = String(b.deliveryPostcodes).toUpperCase().split(/[\s,]+/).filter(Boolean).slice(0, 60);
  return { settings: db.settings.set(patch) };
});

/* =============================================================== static files */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const PAGES = { '/': 'index.html', '/admin': 'admin.html', '/track': 'track.html' };
const cache = new Map();

function serveStatic(req, res, url) {
  let rel = PAGES[url.pathname] || decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      return fs.readFile(path.join(PUBLIC, '404.html'), (e, buf) => send(res, 404, e ? 'Not found' : buf.toString(), { 'Content-Type': 'text/html; charset=utf-8' }));
    }
    const ext = path.extname(file).toLowerCase();
    const etag = `"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream', ETag: etag,
      'Cache-Control': ext === '.html' ? 'no-cache' : (/\.(jpg|jpeg|png|webp|svg)$/.test(ext) ? 'public, max-age=604800' : 'public, max-age=3600'),
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    const gzipOk = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /text|javascript|json|svg/.test(headers['Content-Type']);
    const key = file + etag + gzipOk;
    const done = (buf) => { if (gzipOk) headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : buf); };
    if (cache.has(key)) return done(cache.get(key));
    fs.readFile(file, (e, buf) => {
      if (e) return send(res, 500, 'Error');
      const out = gzipOk ? zlib.gzipSync(buf) : buf;
      if (out.length < 2_000_000) cache.set(key, out);
      done(out);
    });
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "frame-src https://maps.google.com https://www.google.com",
    "connect-src 'self'",
  ].join('; '),
};

/* =============================================================== server */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const t0 = Date.now();
  res.on('finish', () => { if (url.pathname.startsWith('/api/') && !url.pathname.endsWith('/stream')) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms`); });

  try {
    if (url.pathname.startsWith('/api/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) {
        const exists = routes.some((x) => x.re.test(url.pathname));
        throw new HttpError(exists ? 405 : 404, exists ? 'Method not allowed' : 'Not found');
      }
      const m = url.pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.handler(req, params, res, url);
      if (out === null) return; // streaming response
      const [status, body] = Array.isArray(out) ? out : [200, out];
      return send(res, status, body);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    serveStatic(req, res, url);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.end();
    const status = e instanceof HttpError ? e.status : 500;
    send(res, status, { error: status === 500 ? 'Something went wrong' : e.message, ...(e.extra || {}) });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n  🍮 crmbl is running → http://localhost:${PORT}`);
    console.log(`     Admin dashboard  → http://localhost:${PORT}/admin`);
    refreshExcel();
    const ch = notify.channels();
    console.log(`     Excel file       → ${require('node:path').join(db.dataDir, 'orders.xlsx')}`);
    console.log(`     Phone alerts     → ${[ch.ntfy && 'ntfy', ch.telegram && 'Telegram'].filter(Boolean).join(' + ') || 'not set up (see .env.example)'}${ch.sheets ? '   · Google Sheet: on' : ''}`);
    console.log(`     Storage: ${db.kind}${process.env.ADMIN_PASSWORD ? '' : '   ⚠  Using default admin password "crmbl-admin" — set ADMIN_PASSWORD in .env'}\n`);
  });
  const stop = () => { console.log('\nShutting down…'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); for (const r of adminStreams) r.end(); for (const s of orderStreams.values()) for (const r of s) r.end(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

module.exports = { server, createOrder };
