'use strict';
/**
 * Storage layer.
 *  - Uses Node's built-in SQLite (node:sqlite, Node 22.5+) when available.
 *  - Falls back to a JSON file store on older Node versions.
 * Both expose exactly the same API, so the rest of the app doesn't care which one runs.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MENU, SETTINGS } = require('./seed');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Order numbers count up from here: first order is #1001, then #1002, …
const ORDER_START = Number(process.env.ORDER_START) || 1000;
const MENU_FIELDS = ['name', 'description', 'category', 'section', 'price', 'price_l', 'emoji', 'badge', 'image', 'featured', 'available', 'sort'];
const now = () => new Date().toISOString();
const orderCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'CR-' + Array.from(crypto.randomBytes(6), (b) => A[b % A.length]).join('');
};

/* ------------------------------------------------------------------ SQLite */
function sqliteStore() {
  // silence the "SQLite is experimental" warning on Node 22
  const emit = process.emitWarning;
  process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...a));
  const { DatabaseSync } = require('node:sqlite');
  process.emitWarning = emit;

  const db = new DatabaseSync(path.join(DATA_DIR, 'crmbl.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS menu (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT NOT NULL,
      section TEXT, price INTEGER NOT NULL, price_l INTEGER, emoji TEXT, badge TEXT, image TEXT,
      featured INTEGER DEFAULT 0, available INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
      address TEXT, postcode TEXT, slot TEXT, notes TEXT, items TEXT NOT NULL,
      subtotal INTEGER NOT NULL, delivery_fee INTEGER NOT NULL, total INTEGER NOT NULL, history TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, name TEXT, email TEXT, message TEXT, read INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  // upgrade databases created by older versions
  const cols = db.prepare('PRAGMA table_info(menu)').all().map((c) => c.name);
  if (!cols.includes('section')) db.exec('ALTER TABLE menu ADD COLUMN section TEXT');
  if (!cols.includes('price_l')) db.exec('ALTER TABLE menu ADD COLUMN price_l INTEGER');

  if (db.prepare('SELECT COUNT(*) n FROM menu').get().n === 0) {
    const ins = db.prepare(`INSERT INTO menu (id,${MENU_FIELDS.join(',')}) VALUES (?,${MENU_FIELDS.map(() => '?').join(',')})`);
    for (const m of MENU) ins.run(m.id, ...MENU_FIELDS.map((f) => m[f] ?? null));
  }
  if (db.prepare('SELECT COUNT(*) n FROM settings').get().n === 0) {
    const ins = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
    for (const [k, v] of Object.entries(SETTINGS)) ins.run(k, JSON.stringify(v));
  }

  const plain = (r) => (r ? { ...r } : null);
  const rowToOrder = (r) => r && ({ ...r, number: ORDER_START + Number(r.id), items: JSON.parse(r.items), history: JSON.parse(r.history) });

  return {
    kind: 'sqlite',
    menu: {
      list: () => db.prepare('SELECT * FROM menu ORDER BY sort, name').all().map(plain),
      get: (id) => plain(db.prepare('SELECT * FROM menu WHERE id=?').get(id)),
      create(item) {
        db.prepare(`INSERT INTO menu (id,${MENU_FIELDS.join(',')}) VALUES (?,${MENU_FIELDS.map(() => '?').join(',')})`)
          .run(item.id, ...MENU_FIELDS.map((f) => item[f] ?? null));
        return this.get(item.id);
      },
      update(id, patch) {
        const keys = Object.keys(patch).filter((k) => MENU_FIELDS.includes(k));
        if (keys.length) db.prepare(`UPDATE menu SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => patch[k]), id);
        return this.get(id);
      },
      remove: (id) => db.prepare('DELETE FROM menu WHERE id=?').run(id).changes > 0,
    },
    orders: {
      create(o) {
        const code = orderCode();
        const created_at = now();
        const history = JSON.stringify([{ status: 'received', at: created_at }]);
        const r = db.prepare(`INSERT INTO orders (code,created_at,status,type,name,phone,email,address,postcode,slot,notes,items,subtotal,delivery_fee,total,history)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, created_at, 'received', o.type, o.name, o.phone, o.email || null,
          o.address || null, o.postcode || null, o.slot, o.notes || null, JSON.stringify(o.items), o.subtotal, o.delivery_fee, o.total, history);
        return this.byId(Number(r.lastInsertRowid));
      },
      byId: (id) => rowToOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(id)),
      byCode: (code) => rowToOrder(db.prepare('SELECT * FROM orders WHERE code=?').get(code)),
      list({ status, since, limit = 200 } = {}) {
        const where = [], args = [];
        if (status) { where.push(`status IN (${status.map(() => '?').join(',')})`); args.push(...status); }
        if (since) { where.push('created_at >= ?'); args.push(since); }
        return db.prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
          .all(...args, limit).map(rowToOrder);
      },
      setStatus(id, status) {
        const o = this.byId(id);
        if (!o) return null;
        o.history.push({ status, at: now() });
        db.prepare('UPDATE orders SET status=?, history=? WHERE id=?').run(status, JSON.stringify(o.history), id);
        return this.byId(id);
      },
    },
    messages: {
      create: (m) => db.prepare('INSERT INTO messages (created_at,name,email,message) VALUES (?,?,?,?)').run(now(), m.name, m.email, m.message),
      list: () => db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 200').all().map(plain),
      markRead: (id) => db.prepare('UPDATE messages SET read=1 WHERE id=?').run(id).changes > 0,
    },
    settings: {
      get() {
        const out = { ...SETTINGS };
        for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = JSON.parse(r.value);
        return out;
      },
      set(patch) {
        const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
        for (const [k, v] of Object.entries(patch)) if (k in SETTINGS) up.run(k, JSON.stringify(v));
        return this.get();
      },
    },
  };
}

/* --------------------------------------------------------------- JSON file */
function jsonStore() {
  const file = path.join(DATA_DIR, 'crmbl.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = null; }
  if (!data) data = { seq: { order: 0, message: 0 }, menu: MENU.map((m) => ({ ...m })), orders: [], messages: [], settings: { ...SETTINGS } };
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file); // atomic replace
    }, 50);
  };
  save();
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  const co = (o) => (o ? { ...clone(o), number: ORDER_START + o.id } : null);
  const sortMenu = () => data.menu.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  return {
    kind: 'json',
    menu: {
      list: () => clone(sortMenu()),
      get: (id) => clone(data.menu.find((m) => m.id === id)),
      create(item) { const m = {}; m.id = item.id; for (const f of MENU_FIELDS) m[f] = item[f] ?? null; data.menu.push(m); save(); return clone(m); },
      update(id, patch) {
        const m = data.menu.find((x) => x.id === id);
        if (!m) return null;
        for (const k of Object.keys(patch)) if (MENU_FIELDS.includes(k)) m[k] = patch[k];
        save(); return clone(m);
      },
      remove(id) { const n = data.menu.length; data.menu = data.menu.filter((m) => m.id !== id); save(); return data.menu.length < n; },
    },
    orders: {
      create(o) {
        const created_at = now();
        const row = { id: ++data.seq.order, code: orderCode(), created_at, status: 'received', type: o.type, name: o.name, phone: o.phone,
          email: o.email || null, address: o.address || null, postcode: o.postcode || null, slot: o.slot, notes: o.notes || null,
          items: o.items, subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total, history: [{ status: 'received', at: created_at }] };
        data.orders.push(row); save(); return co(row);
      },
      byId: (id) => co(data.orders.find((o) => o.id === id)),
      byCode: (code) => co(data.orders.find((o) => o.code === code)),
      list({ status, since, limit = 200 } = {}) {
        return data.orders.filter((o) => (!status || status.includes(o.status)) && (!since || o.created_at >= since))
          .sort((a, b) => b.id - a.id).slice(0, limit).map(co);
      },
      setStatus(id, status) {
        const o = data.orders.find((x) => x.id === id);
        if (!o) return null;
        o.status = status; o.history.push({ status, at: now() }); save(); return co(o);
      },
    },
    messages: {
      create(m) { data.messages.push({ id: ++data.seq.message, created_at: now(), read: 0, ...m }); save(); },
      list: () => clone([...data.messages].reverse().slice(0, 200)),
      markRead(id) { const m = data.messages.find((x) => x.id === id); if (m) { m.read = 1; save(); } return !!m; },
    },
    settings: {
      get: () => ({ ...SETTINGS, ...clone(data.settings) }),
      set(patch) { for (const [k, v] of Object.entries(patch)) if (k in SETTINGS) data.settings[k] = v; save(); return this.get(); },
    },
  };
}

let store;
try {
  if (process.env.STORAGE === 'json') throw new Error('forced json');
  store = sqliteStore();
} catch (e) {
  store = jsonStore();
}
store.dataDir = DATA_DIR;
module.exports = store;
