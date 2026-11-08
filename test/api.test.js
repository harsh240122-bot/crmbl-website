'use strict';
// End-to-end API tests. Run: npm test  (uses a throwaway data folder)
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crmbl-test-'));
process.env.ADMIN_PASSWORD = 'test-pass';
// fake phone-alert + Google Sheets servers to check what gets sent
const http = require('node:http');
const received = [];
const fake = http.createServer((q, r) => { let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { received.push({ url: q.url, body: JSON.parse(b || '{}') }); r.end('ok'); }); });
let fakeUrl;
const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server.js');

let base, cookie = '';
const req = async (method, p, body, auth) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};

test.before(() => new Promise((ok) => fake.listen(0, () => {
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  process.env.NTFY_TOPIC = 'crmbl-test'; process.env.NTFY_SERVER = fakeUrl;
  process.env.SHEETS_WEBHOOK_URL = fakeUrl + '/sheet'; process.env.SHEETS_SECRET = 's3cret';
  server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); });
})));
test.after(() => { server.close(); server.closeAllConnections?.(); fake.close(); });

test('health + menu + settings', async () => {
  assert.equal((await req('GET', '/api/health')).status, 200);
  const m = await req('GET', '/api/menu');
  assert.ok(m.body.items.length >= 50);
  assert.ok((await req('GET', '/api/settings')).body.ordering);
});

test('admin routes need login; wrong password rejected', async () => {
  assert.equal((await req('GET', '/api/admin/orders')).status, 401);
  assert.equal((await req('POST', '/api/admin/login', { password: 'nope' })).status, 401);
  assert.equal((await req('POST', '/api/admin/login', { password: 'test-pass' })).status, 200);
  assert.equal((await req('GET', '/api/admin/orders', null, true)).status, 200);
});

test('open 24h so orders are accepted', async () => {
  const r = await req('PUT', '/api/admin/settings', { open: '00:00', close: '00:00', closedDays: [] }, true);
  assert.equal(r.status, 200);
  assert.equal((await req('GET', '/api/settings')).body.ordering.asap, true);
});

let code, id;
test('order validation', async () => {
  const bad = await req('POST', '/api/orders', { type: 'collection', name: 'A', phone: '123', items: [] });
  assert.equal(bad.status, 422);
  for (const k of ['name', 'phone', 'items']) assert.ok(bad.body.errors[k], 'missing error for ' + k);
});

test('place collection order — server sets prices', async () => {
  const r = await req('POST', '/api/orders', { type: 'collection', name: 'Sam Smith', phone: '07700 900123', slot: 'asap', items: [{ id: 'crumble-custard', qty: 2, price: 1 }, { id: 'iced-classic-matcha', qty: 1, size: 'L' }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.order.total, 499 * 2 + 649); // client "price" ignored, Large matcha = £6.49
  assert.equal(r.body.order.items[1].name, 'Iced Classic Matcha (Large)');
  assert.equal(r.body.order.name, 'Sam'); // only first name is public
  code = r.body.order.code;
  assert.equal(r.body.order.number, 1001); // first order is #1001
});

test('order numbers count up, phone alert + sheet row are sent, Excel file is written', async () => {
  const r = await req('POST', '/api/orders', { type: 'collection', name: 'Priya K', phone: '07700900222', items: [{ id: 'bruce-cake', qty: 3 }] });
  assert.equal(r.body.order.number, 1002);
  await new Promise((ok) => setTimeout(ok, 400));
  const alert = received.find((x) => x.url === '/' && x.body.title.includes('#1002'));
  assert.ok(alert, 'ntfy alert sent'); assert.equal(alert.body.topic, 'crmbl-test'); assert.match(alert.body.message, /3 items/);
  const row = received.find((x) => x.url === '/sheet' && x.body.orderNo === 1002);
  assert.ok(row); assert.equal(row.body.totalItems, 3); assert.equal(row.body.total, 17.97); assert.equal(row.body.secret, 's3cret');
  const file = path.join(process.env.DATA_DIR, 'orders.xlsx');
  assert.ok(fs.existsSync(file)); assert.equal(fs.readFileSync(file).subarray(0, 2).toString(), 'PK');
  const dl = await fetch(base + '/api/admin/orders.xlsx', { headers: { Cookie: cookie } });
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /crmbl-orders-.*\.xlsx/);
  assert.equal((await fetch(base + '/api/admin/orders.xlsx')).status, 401); // staff only
  const t = await req('POST', '/api/admin/test-notify', {}, true);
  assert.equal(t.body.results[0].ok, true);
});

test('site is collection-only: delivery orders are refused', async () => {
  const r = await req('POST', '/api/orders', { type: 'delivery', name: 'Al', phone: '07700900124', address: '2 Fourth Ave', postcode: 'E12 6DB', items: [{ id: 'iced-latte', qty: 4 }] });
  assert.equal(r.status, 409);
  assert.equal((await req('GET', '/api/settings')).body.ordering.delivery, false);
});

test('tracking + admin status flow', async () => {
  const t = await req('GET', '/api/orders/' + code.toLowerCase());
  assert.equal(t.body.order.status, 'received');
  const list = await req('GET', '/api/admin/orders?status=received', null, true);
  id = list.body.orders.find((o) => o.code === code).id;
  assert.equal((await req('PATCH', '/api/admin/orders/' + id, { status: 'preparing' }, true)).body.order.status, 'preparing');
  assert.equal((await req('PATCH', '/api/admin/orders/' + id, { status: 'bogus' }, true)).status, 400);
  assert.equal((await req('GET', '/api/orders/' + code)).body.order.history.length, 2);
  const stats = await req('GET', '/api/admin/stats', null, true);
  assert.equal(stats.body.today.orders, 2);
});

test('sold-out items cannot be ordered; menu edits', async () => {
  await req('PATCH', '/api/admin/menu/school-cake', { available: false, price: 450, price_l: null }, true);
  const r = await req('POST', '/api/orders', { type: 'collection', name: 'Jo', phone: '07700900125', items: [{ id: 'school-cake', qty: 1 }] });
  assert.match(r.body.errors.items, /sold out/);
  const created = await req('POST', '/api/admin/menu', { name: 'Biscoff Crumble', category: 'crumble', price: 650, price_l: 750, section: 'Crumbles' }, true);
  assert.equal(created.body.item.price_l, 750);
  assert.equal(created.status, 201); assert.equal(created.body.item.id, 'biscoff-crumble');
});

test('contact form + honeypot', async () => {
  assert.equal((await req('POST', '/api/contact', { name: 'X', email: 'bad', message: '' })).status, 422);
  assert.equal((await req('POST', '/api/contact', { name: 'Priya', email: 'p@example.com', message: 'Do you do party orders?' })).status, 201);
  const msgs = await req('GET', '/api/admin/messages', null, true);
  assert.equal(msgs.body.messages.length, 1);
});

test('static files, traversal blocked, 404', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/admin')).status, 200);
  assert.equal((await fetch(base + '/js/app.js')).headers.get('content-type').includes('javascript'), true);
  const trav = await fetch(base + '/..%2fserver.js'); assert.notEqual(trav.status, 200);
  assert.equal((await fetch(base + '/nope.html')).status, 404);
});
