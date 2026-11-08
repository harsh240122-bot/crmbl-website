/* crmbl admin dashboard */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (p) => '£' + (p / 100).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NEXT = { collection: { received: 'preparing', preparing: 'ready', ready: 'completed' }, delivery: { received: 'preparing', preparing: 'out_for_delivery', ready: 'out_for_delivery', out_for_delivery: 'completed' } };
const LABEL = { preparing: 'Start preparing', ready: 'Mark ready to collect', out_for_delivery: 'Out for delivery', completed: 'Collected & paid ✓' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let orders = [], sound = localStorage.getItem('crmbl_sound') !== 'off', es, unseen = 0;

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error('Please log in'); }
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
function toast(msg) { const t = document.createElement('div'); t.className = 't'; t.textContent = msg; $('#toast').appendChild(t); setTimeout(() => t.remove(), 3500); }

/* ---------- auth ---------- */
function showLogin() { $('#login').style.display = ''; $('#app').style.display = 'none'; es?.close(); setTimeout(() => $('#pw').focus(), 50); }
async function boot() {
  const me = await api('/api/admin/me').catch(() => ({}));
  if (!me.admin) return showLogin();
  $('#login').style.display = 'none'; $('#app').style.display = 'block';
  $('#pwBanner').hidden = !me.usingDefaultPassword;
  $('#alertBanner').hidden = !!(me.alerts && (me.alerts.ntfy || me.alerts.telegram));
  await Promise.all([loadOrders(), loadStats(), loadMenu(), loadMessages(), loadSettings()]);
  connect();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) }); $('#pw').value = ''; boot(); }
  catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); };

/* ---------- tabs ---------- */
$$('nav.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('nav.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.id === 'p-' + b.dataset.p));
  if (b.dataset.p === 'orders') { unseen = 0; $('#dotOrders').hidden = true; document.title = 'crmbl · Admin'; }
}));

/* ---------- orders ---------- */
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
async function loadOrders() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [open, recent] = await Promise.all([api('/api/admin/orders?status=received,preparing,ready,out_for_delivery'), api('/api/admin/orders?since=' + encodeURIComponent(since))]);
  const map = new Map(); for (const o of [...open.orders, ...recent.orders]) map.set(o.id, o);
  orders = [...map.values()]; renderOrders();
}
function card(o, fresh) {
  const nx = NEXT[o.type][o.status];
  return `<div class="order ${fresh ? 'fresh' : ''}" data-id="${o.id}">
    <div class="top"><span class="code" style="font-size:1.3rem">#${esc(o.number)}</span><span class="ago" title="${esc(o.created_at)}">${time(o.created_at)} · ${ago(o.created_at)}</span></div>
    <div style="margin-top:6px"><span class="pill ${o.type}">${o.type}</span> <b style="font-size:.85rem">${o.slot === 'asap' ? 'ASAP' : 'for ' + esc(o.slot)}</b>${o.status === 'cancelled' ? ' <span class="pill" style="background:#FDE8EC;color:#B3123F">cancelled</span>' : ''}</div>
    <div class="who">${esc(o.name)} · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></div>
    ${o.type === 'delivery' ? `<div class="meta">📍 ${esc(o.address)}, ${esc(o.postcode)}</div>` : ''}
    <ul>${o.items.map((i) => `<li><span>${i.qty}× ${esc(i.name)}</span><span>${money(i.line)}</span></li>`).join('')}</ul>
    ${o.notes ? `<div class="note">📝 ${esc(o.notes)}</div>` : ''}
    <div class="tot"><span>To pay in store</span><span>${money(o.total)}</span></div>
    <div class="acts">${nx ? `<button class="btn pink" data-act="${nx}">${LABEL[nx]} →</button>` : ''}
      ${!['completed', 'cancelled'].includes(o.status) ? '<button class="btn red" data-act="cancelled">Cancel</button>' : ''}
      <button class="btn line" data-print>Print</button></div></div>`;
}
let freshIds = new Set();
function renderOrders() {
  const cols = { received: [], preparing: [], ready: [], completed: [] };
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  for (const o of orders.sort((a, b) => a.id - b.id)) {
    if (o.status === 'received') cols.received.push(o);
    else if (o.status === 'preparing') cols.preparing.push(o);
    else if (o.status === 'ready' || o.status === 'out_for_delivery') cols.ready.push(o);
    else if (new Date(o.created_at).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) === today) cols.completed.push(o);
  }
  cols.completed.reverse();
  for (const [k, list] of Object.entries(cols)) {
    const col = $(`[data-col="${k}"]`);
    $('h3 span', col).textContent = list.length;
    $('div', col).innerHTML = list.length ? list.map((o) => card(o, freshIds.has(o.id))).join('') : '<div class="emptycol">Nothing here</div>';
  }
}
$('#p-orders').addEventListener('click', async (e) => {
  const el = e.target.closest('.order'); if (!el) return;
  const id = Number(el.dataset.id);
  if (e.target.closest('[data-print]')) { el.classList.add('printing'); window.print(); el.classList.remove('printing'); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'cancelled' && !confirm('Cancel this order? The customer will see it as cancelled.')) return;
  b.disabled = true;
  try { const { order } = await api('/api/admin/orders/' + id, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.act }) }); upsert(order); freshIds.delete(id); renderOrders(); loadStats(); }
  catch (err) { toast(err.message); b.disabled = false; }
});
function upsert(o) { const i = orders.findIndex((x) => x.id === o.id); if (i >= 0) orders[i] = o; else orders.push(o); }
setInterval(renderOrders, 60_000); // refresh "x min ago"

async function loadStats() {
  const s = await api('/api/admin/stats');
  $('#stOrders').textContent = s.today.orders; $('#stRevenue').textContent = money(s.today.revenue); $('#stAvg').textContent = money(s.today.average);
  $('#stTop').textContent = s.top[0] ? `${s.top[0].name} ×${s.top[0].qty}` : '–';
}

/* ---------- live updates ---------- */
function chime() {
  if (!sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175, 1568].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); o.start(t); o.stop(t + 0.4); });
  } catch { /* audio blocked until first click */ }
}
$('#sound').onclick = () => { sound = !sound; localStorage.setItem('crmbl_sound', sound ? 'on' : 'off'); $('#sound').textContent = sound ? '🔔 Sound on' : '🔕 Sound off'; if (sound) chime(); };
$('#sound').textContent = sound ? '🔔 Sound on' : '🔕 Sound off';

function connect() {
  es?.close();
  es = new EventSource('/api/admin/stream');
  const live = $('#live');
  es.onopen = () => { live.classList.add('on'); $('span', live).textContent = 'Live'; };
  es.onerror = () => { live.classList.remove('on'); $('span', live).textContent = 'Reconnecting…'; };
  es.addEventListener('order:new', (ev) => {
    const o = JSON.parse(ev.data); upsert(o); freshIds.add(o.id); renderOrders(); loadStats(); chime();
    toast(`New order #${o.number} · ${o.name} · ${money(o.total)}`);
    if (!$('#p-orders').classList.contains('on')) { unseen++; $('#dotOrders').hidden = false; $('#dotOrders').textContent = unseen; }
    document.title = '🔔 New order · crmbl';
    if (Notification?.permission === 'granted' && document.hidden) new Notification('New crmbl order', { body: `#${o.number} · ${o.name} · ${money(o.total)}` });
  });
  es.addEventListener('order:update', (ev) => { upsert(JSON.parse(ev.data)); renderOrders(); });
  es.addEventListener('message:new', () => { loadMessages(); toast('New message received ✉️'); });
}
document.addEventListener('click', () => { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); }, { once: true });
addEventListener('focus', () => { if (document.title.startsWith('🔔')) document.title = 'crmbl · Admin'; });

/* ---------- menu ---------- */
let menu = [];
async function loadMenu() { menu = (await api('/api/admin/menu')).items; renderMenu(); }
function renderMenu() {
  $('#menuRows').innerHTML = menu.map((m) => `<tr data-id="${esc(m.id)}">
    <td><div style="display:flex;gap:10px;align-items:center"><span style="font-size:1.5rem">${esc(m.emoji || '🍰')}</span><div style="flex:1"><input data-f="name" value="${esc(m.name)}"><input data-f="description" value="${esc(m.description || '')}" style="margin-top:4px;font-size:.85rem" placeholder="Description"></div></div></td>
    <td><select data-f="category">${['specials', 'crumble', 'cake', 'shakes', 'drinks'].map((c) => `<option ${m.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select><input data-f="section" value="${esc(m.section || '')}" placeholder="Section heading" style="margin-top:4px;font-size:.8rem"></td>
    <td><input class="price" data-f="price" type="number" step="0.01" min="0" value="${(m.price / 100).toFixed(2)}"><input class="price" data-f="price_l" type="number" step="0.01" min="0" placeholder="Large" title="Large price (leave empty if one size)" value="${m.price_l ? (m.price_l / 100).toFixed(2) : ''}" style="margin-top:4px"></td>
    <td><input data-f="badge" value="${esc(m.badge || '')}" placeholder="—" style="width:120px"></td>
    <td><button class="sw ${m.featured ? 'on' : ''}" data-t="featured" aria-label="Featured"></button></td>
    <td><button class="sw ${m.available ? 'on' : ''}" data-t="available" aria-label="On sale"></button></td>
    <td><button class="btn red" data-del>Delete</button></td></tr>`).join('');
}
async function patchItem(id, patch) {
  try { const { item } = await api('/api/admin/menu/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) }); menu[menu.findIndex((m) => m.id === id)] = item; toast('Saved ✓'); return item; }
  catch (err) { toast(err.message); }
}
$('#menuRows').addEventListener('change', (e) => {
  const f = e.target.dataset.f; if (!f) return;
  const id = e.target.closest('tr').dataset.id;
  let v = e.target.value; if (f === 'price') v = Math.round(parseFloat(v) * 100); if (f === 'price_l') v = v === '' ? null : Math.round(parseFloat(v) * 100);
  patchItem(id, { [f]: v });
});
$('#menuRows').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr'); if (!tr) return; const id = tr.dataset.id;
  const t = e.target.closest('[data-t]');
  if (t) { const on = !t.classList.contains('on'); t.classList.toggle('on', on); await patchItem(id, { [t.dataset.t]: on }); }
  if (e.target.closest('[data-del]') && confirm('Delete this item from the menu?')) { await api('/api/admin/menu/' + encodeURIComponent(id), { method: 'DELETE' }); menu = menu.filter((m) => m.id !== id); renderMenu(); toast('Deleted'); }
});
$('#newItem').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target)); d.price = Math.round(parseFloat(d.price) * 100); d.price_l = d.price_l ? Math.round(parseFloat(d.price_l) * 100) : null;
  try { const { item } = await api('/api/admin/menu', { method: 'POST', body: JSON.stringify(d) }); menu.push(item); renderMenu(); e.target.reset(); toast('Item added ✓'); }
  catch (err) { toast(err.message); }
});

/* ---------- messages ---------- */
async function loadMessages() {
  const { messages } = await api('/api/admin/messages');
  const unread = messages.filter((m) => !m.read).length;
  $('#dotMsgs').hidden = !unread; $('#dotMsgs').textContent = unread;
  $('#msgs').innerHTML = messages.length ? messages.map((m) => `<div class="msg ${m.read ? '' : 'unread'}" data-id="${m.id}"><div class="m"><b>${esc(m.name)} · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a></b><small style="color:var(--muted)">${new Date(m.created_at).toLocaleString('en-GB', { timeZone: 'Europe/London' })}</small><p>${esc(m.message)}</p></div>
    <div>${m.read ? '' : '<button class="btn line" data-read>Mark read</button>'} <a class="btn pink" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: your message to crmbl')}">Reply</a></div></div>`).join('') : '<p style="color:var(--muted)">No messages yet.</p>';
}
$('#msgs').addEventListener('click', async (e) => { const b = e.target.closest('[data-read]'); if (!b) return; await api('/api/admin/messages/' + b.closest('.msg').dataset.id, { method: 'PATCH', body: '{}' }); loadMessages(); });

/* ---------- settings ---------- */
$('#days').innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" value="${i}">${d}</label>`).join('');
async function loadSettings() {
  const { settings: s } = await api('/api/admin/settings'); const f = $('#settingsForm');
  f.open.value = s.open; f.close.value = s.close;
  $$('#days input').forEach((c) => (c.checked = s.closedDays.includes(Number(c.value))));
  for (const k of ['orderingEnabled', 'collectionEnabled', 'deliveryEnabled', 'allowPreorderWhenClosed']) f[k].checked = !!s[k];
  f.deliveryFee.value = (s.deliveryFee / 100).toFixed(2); f.minDelivery.value = (s.minDelivery / 100).toFixed(2); f.prepMinutes.value = s.prepMinutes;
  f.deliveryPostcodes.value = s.deliveryPostcodes.join(', ');
}
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  const body = { open: f.open.value, close: f.close.value, closedDays: $$('#days input:checked').map((c) => Number(c.value)),
    deliveryFee: Math.round(parseFloat(f.deliveryFee.value || 0) * 100), minDelivery: Math.round(parseFloat(f.minDelivery.value || 0) * 100),
    prepMinutes: Number(f.prepMinutes.value || 0), deliveryPostcodes: f.deliveryPostcodes.value };
  for (const k of ['orderingEnabled', 'collectionEnabled', 'deliveryEnabled', 'allowPreorderWhenClosed']) body[k] = f[k].checked;
  try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }); $('#setNote').textContent = 'Saved ✓'; setTimeout(() => ($('#setNote').textContent = ''), 2500); }
  catch (err) { $('#setNote').textContent = ''; toast(err.message); }
});

$('#testAlert').onclick = async () => {
  try { const { results } = await api('/api/admin/test-notify', { method: 'POST', body: '{}' });
    toast(results.map((r) => (r.ok ? `✓ Sent via ${r.channel}` : `✗ ${r.error}`)).join(' · ')); }
  catch (err) { toast(err.message); }
};

boot();
})();
