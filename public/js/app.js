/* crmbl — site script
 * 1. Data (API with offline fallback)   2. Menu + favourites rendering
 * 3. Basket, checkout, live order status 4. Contact form
 * 5. UI bits (nav, cursor, lightbox…)    6. Cinematic motion engine
 */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (p) => '£' + (p / 100).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/* ================================================================ 1. DATA */
// Used only when the backend isn't reachable (e.g. opening index.html directly as a preview).
// Used only for the offline preview file (build-preview.js fills this from lib/seed.js).
const FALLBACK_MENU = (window.CRMBL_FALLBACK_MENU || []).map((m) => ({ ...m, featured: !!m.featured, available: m.available !== 0 && m.available !== false }));

function fallbackSettings() {
  const s = { open: '15:00', close: '23:00', closedDays: [] };
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  const mins = (+g('hour') % 24) * 60 + +g('minute');
  const o = 900, c = 1380, open = mins >= o && mins < c;
  const slots = [];
  for (let m = Math.ceil(Math.max(o, mins + 20) / 15) * 15; m <= c - 15; m += 15) slots.push(`${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return { ...s, status: { open, day, label: open ? 'Open now · until 11pm' : mins < o ? 'Opens 3pm today' : 'Closed · opens 3pm' },
    ordering: { enabled: open || slots.length > 0, asap: open, collection: true, delivery: false, deliveryFee: 0, minDelivery: 0, deliveryPostcodes: [], slots, prepMinutes: 20 } };
}

/* Delivery partner links — paste crmbl's own store pages here (in each app: open crmbl → Share → Copy link). */
const DELIVERY = { uberEats: 'https://www.ubereats.com/gb/store/crmbl/JmzW91QJSwSY9KtANXI8qw', justEat: 'https://www.just-eat.co.uk/restaurants-crmbl-manor-park/menu' };
$$('[data-delivery]').forEach((a) => { if (DELIVERY[a.dataset.delivery]) a.href = DELIVERY[a.dataset.delivery]; });

const state = { menu: [], settings: null, demo: false, filter: 'all', type: 'collection', view: 'basket', cart: loadCart(), lastOrder: null };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; e.data = data; throw e; }
  return data;
}

async function loadData() {
  try {
    if (location.protocol === 'file:') throw new Error('offline preview');
    const [m, s] = await Promise.all([api('/api/menu'), api('/api/settings')]);
    state.menu = m.items; state.settings = s;
  } catch {
    state.demo = true; state.menu = FALLBACK_MENU; state.settings = fallbackSettings();
    const b = document.createElement('div'); b.className = 'demo-banner'; b.textContent = 'Preview mode · orders are not sent';
    document.body.appendChild(b);
  }
  renderAll();
}

/* ================================================================ 2. MENU */
const item = (id) => state.menu.find((m) => m.id === id);
const thumb = (m) => (m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy">` : esc(m.emoji || '🍰'));

const priceLabel = (m) => (m.price_l ? `M ${money(m.price)} · L ${money(m.price_l)}` : money(m.price));
const addButtons = (m) => {
  if (!m.available) return `<button class="add" disabled aria-label="Sold out">–</button>`;
  if (!m.price_l) return `<button class="add" data-add="${esc(m.id)}" aria-label="Add ${esc(m.name)} to basket">+</button>`;
  return `<span class="sizes"><button class="add sz" data-add="${esc(m.id)}" data-size="M" aria-label="Add medium ${esc(m.name)}"><small>M</small>${money(m.price)}</button><button class="add sz" data-add="${esc(m.id)}" data-size="L" aria-label="Add large ${esc(m.name)}"><small>L</small>${money(m.price_l)}</button></span>`;
};
const FAV_BG = ['#FCE6EF', '#FFF0D9', '#E8F1FA', '#EAF5E6', '#F3E8FA'];

function renderFavs() {
  const favs = state.menu.filter((m) => m.featured);
  $('#track').innerHTML = favs.map((m, i) => `
    <article class="fav" style="--i:${i}">
      <div class="ph">${m.badge ? `<span class="badge">${esc(m.badge)}</span>` : ''}${m.image ? `<img src="${esc(m.image)}" alt="${esc(m.name)}" loading="lazy">` : `<div class="emo" style="background:${FAV_BG[i % FAV_BG.length]}">${esc(m.emoji || '🍰')}</div>`}</div>
      <div class="bd"><div><h3>${esc(m.name)}</h3><p>${esc(m.description || '')}</p>${m.price_l ? '' : `<div class="price">${money(m.price)}</div>`}</div>
        ${addButtons(m)}</div>
    </article>`).join('');
  observe($('#track'));
}

// extra info shown at the end of a category
const CATEGORY_NOTES = {
  specials: '✨ Specials change every month. Follow <a href="https://www.instagram.com/crmbl.london" target="_blank" rel="noopener">@crmbl.london</a> for the latest.',
  crumble: '<b>Add-ons (+29p each):</b> Crûmbrûlée, blowtorched marshmallow, vanilla whipped cream, drizzled dark or white chocolate, crushed meringue & rose, nuts.<br><b>Loaded crumble (+99p):</b> Biscoff, Oreo, Ferrero Rocher, Bueno.<br>Want an add-on? Write it in your order notes and pay for it in store.',
  drinks: '<b>Drink add-ons:</b> espresso ice cubes 99p · vanilla whipped cream 29p · water bottle 99p · syrups (caramel, hazelnut, vanilla) · milk alternatives (oat, coconut, soy, almond).<br><b>Matcha extras:</b> matcha ice +50p · Crûmbrûlée + cold foam 99p · cold foam 49p · matcha ice cream scoop 29p.<br>Add them in your order notes and pay in store.',
};

function renderMenu() {
  let i = 0, html = '', last = null;
  const list = state.menu.filter((m) => state.filter === 'all' || m.category === state.filter);
  const notes = new Set();
  for (const m of list) {
    const sec = m.section || '';
    if (sec !== last) { html += `<h5 class="msec">${esc(sec)}</h5>`; last = sec; }
    notes.add(m.category);
    html += `
    <div class="mi pop ${m.available ? '' : 'soldout'}" style="animation-delay:${Math.min(i++, 14) * 45}ms">
      <div class="e">${thumb(m)}</div>
      <div class="tx"><h4>${esc(m.name)}${m.badge ? `<span class="t">${esc(m.badge)}</span>` : ''}${m.available ? '' : '<span class="t">Sold out</span>'}</h4>${m.description ? `<p>${esc(m.description)}</p>` : ''}</div>
      ${m.price_l ? '' : `<span class="pr">${money(m.price)}</span>`}
      ${addButtons(m)}
    </div>`;
  }
  const extra = [...notes].filter((c) => CATEGORY_NOTES[c] && state.filter !== 'all').map((c) => `<div class="mnote">${CATEGORY_NOTES[c]}</div>`).join('');
  $('#mlist').innerHTML = html + extra;
}

function renderHours() {
  const s = state.settings;
  const st = $('#status'); st.classList.toggle('open', s.status.open); st.querySelector('em').textContent = s.status.label;
  const pretty = (t) => { let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (m ? ':' + String(m).padStart(2, '0') : '') + ap; };
  const N = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  $('#hours').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<li class="${d === s.status.day ? 'today' : ''}"><span>${N[d]}</span><span>${s.closedDays.includes(d) ? 'Closed' : pretty(s.open) + ' – ' + pretty(s.close)}</span></li>`).join('');
}

function renderAll() { renderFavs(); renderMenu(); renderHours(); renderCart(); }

const tabs = $$('#tabs button'), ind = $('#ind');
const moveInd = (b) => { ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px'; };
tabs.forEach((b) => b.addEventListener('click', () => { tabs.forEach((x) => x.classList.remove('on')); b.classList.add('on'); moveInd(b); state.filter = b.dataset.f; renderMenu(); }));
addEventListener('load', () => moveInd(tabs[0]));
addEventListener('resize', () => moveInd($('#tabs .on')));
$('#prev').onclick = () => $('#track').scrollBy({ left: -$('#track').clientWidth / 2, behavior: 'smooth' });
$('#next').onclick = () => $('#track').scrollBy({ left: $('#track').clientWidth / 2, behavior: 'smooth' });

/* ================================================================ 3. BASKET + CHECKOUT */
function loadCart() { try { return JSON.parse(localStorage.getItem('crmbl_cart')) || {}; } catch { return {}; } }
function saveCart() { try { localStorage.setItem('crmbl_cart', JSON.stringify(state.cart)); } catch { /* private mode */ } }
// basket keys look like "iced-latte|L" (size is M or L for drinks with two sizes)
const cartLines = () => Object.entries(state.cart).map(([key, qty]) => {
  const [id, size = 'M'] = key.split('|'); const m = item(id);
  if (!m) return null;
  const large = size === 'L' && m.price_l;
  return { key, m, qty, size: large ? 'L' : 'M', price: large ? m.price_l : m.price, label: m.price_l ? `${m.name} (${large ? 'Large' : 'Medium'})` : m.name };
}).filter((l) => l && l.qty > 0);
const subtotal = () => cartLines().reduce((a, l) => a + l.price * l.qty, 0);
const deliveryFee = () => (state.type === 'delivery' ? state.settings.ordering.deliveryFee : 0);
const count = () => cartLines().reduce((a, l) => a + l.qty, 0);

function addToCart(id, from, size = 'M') {
  const m = item(id); if (!m || !m.available) return;
  const key = m.price_l ? `${id}|${size}` : id;
  state.cart[key] = Math.min(20, (state.cart[key] || 0) + 1); saveCart(); renderCart();
  toast(`${m.emoji || '🍰'} ${m.name}${m.price_l ? (size === 'L' ? ' (Large)' : ' (Medium)') : ''} added`);
  flyTo(from, m);
  const c = $('#cartCount'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
}
function setQty(id, q) { if (q <= 0) delete state.cart[id]; else state.cart[id] = Math.min(20, q); saveCart(); renderCart(); }

function renderCart() {
  if (!state.settings) return;
  const n = count(), sub = subtotal(), del = deliveryFee(), o = state.settings.ordering;
  $('#cartCount').textContent = n; $('#cartCount').style.display = n ? '' : 'none';
  $$('[data-cart-total]').forEach((e) => (e.textContent = money(sub)));
  $('#sSub').textContent = money(sub); $('#sDel').textContent = money(del); $('#sTot').textContent = money(sub + del);
  $('#sDelRow').hidden = state.type !== 'delivery';

  const lines = cartLines();
  $('#cartItems').innerHTML = lines.length ? lines.map(({ key, m, qty, price, label }) => `
    <div class="ci"><div class="e">${thumb(m)}</div>
      <div class="n">${esc(label)}<small>${money(price)}</small></div>
      <div class="qty"><button data-q="${esc(key)}" data-d="-1" aria-label="Remove one">−</button><span>${qty}</span><button data-q="${esc(key)}" data-d="1" aria-label="Add one">+</button></div>
    </div>`).join('') + (o.enabled ? '' : `<p class="notice" style="margin-top:16px">Online ordering is closed right now. ${esc(state.settings.status.label)}.</p>`)
    : `<div class="empty"><b>🥄</b><p>Your basket is empty.<br>Add a warm crumble to get started.</p><a href="#menu" class="btn btn-pink" style="margin-top:18px" id="browse">Browse the menu</a></div>`;
  $('#browse')?.addEventListener('click', closeCart);

  const pb = $('#primaryBtn');
  $('#backBtn').hidden = state.view !== 'checkout';
  $('#drawerFoot').querySelectorAll('.sum').forEach((e) => (e.style.display = state.view === 'done' ? 'none' : ''));
  if (state.view === 'basket') { pb.textContent = `Checkout · ${money(sub)}`; pb.disabled = !n || !o.enabled; }
  if (state.view === 'checkout') { pb.textContent = `Place order · ${money(sub + del)}`; pb.disabled = !n; }
  if (state.view === 'done') { pb.textContent = 'Back to the site'; pb.disabled = false; }
}

function show(view) {
  state.view = view;
  $$('.drawer .view').forEach((v) => v.classList.remove('on'));
  $({ basket: '#vBasket', checkout: '#vCheckout', done: '#vDone' }[view]).classList.add('on');
  $('#drawerTitle').textContent = { basket: 'Your basket', checkout: 'Checkout', done: 'Order placed' }[view];
  if (view === 'checkout') prepCheckout();
  renderCart();
}

function prepCheckout() {
  const o = state.settings.ordering;
  state.type = 'collection';
  $('#slotLabel').textContent = 'Collection time';
  const sel = $('#o_slot'), prev = sel.value;
  const opts = (o.asap ? [`<option value="asap">As soon as possible (~${o.prepMinutes} min)</option>`] : []).concat(o.slots.map((s) => `<option value="${s}">Today at ${s}</option>`));
  sel.innerHTML = opts.join('') || '<option value="">No times left today</option>';
  if ([...sel.options].some((x) => x.value === prev)) sel.value = prev;
  const nt = $('#coNotice');
  const msgs = [];
  if (!o.asap && o.slots.length) msgs.push(`We're closed right now, but you can order ahead for later today.`);
  nt.hidden = !msgs.length; nt.innerHTML = msgs.map(esc).join('<br>');
  // remember customer details between orders
  try { const saved = JSON.parse(localStorage.getItem('crmbl_customer') || '{}'); for (const k of ['name', 'phone', 'email']) { const f = $('#o_' + k); if (f && !f.value && saved[k]) f.value = saved[k]; } } catch { /* ignore */ }
}

function fieldErrors(form, errors = {}) {
  $$('.field', form).forEach((f) => { const inp = $('input,textarea,select', f); const e = errors[inp?.name]; f.classList.toggle('err', !!e); $('.e', f).textContent = e || ''; });
}

document.addEventListener('input', (e) => { const f = e.target.closest('.field.err'); if (f) { f.classList.remove('err'); $('.e', f).textContent = ''; } });

function validateCheckout(d) {
  const e = {}, o = state.settings.ordering;
  if (d.name.trim().length < 2) e.name = 'Please enter your name';
  if (!/^(?:\+44\s?|0)(?:\d\s?){9,10}$/.test(d.phone.trim())) e.phone = 'Please enter a valid UK phone number';
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) e.email = 'Please check your email address';
  if (state.type === 'delivery') {
    if (d.address.trim().length < 5) e.address = 'Please enter your delivery address';
    const pc = d.postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/);
    if (!pc) e.postcode = 'Please enter a valid UK postcode';
    else if (o.deliveryPostcodes.length && !o.deliveryPostcodes.includes(pc[1])) e.postcode = `Sorry, we don't deliver to ${pc[1]} yet`;
    if (subtotal() < o.minDelivery) e.notes = `Minimum order for delivery is ${money(o.minDelivery)}`;
  }
  if (!d.slot) e.slot = 'Please choose a time';
  return e;
}

async function placeOrder() {
  const form = $('#checkoutForm');
  const d = Object.fromEntries(new FormData(form));
  d.email = d.email || ''; d.address = d.address || ''; d.postcode = d.postcode || '';
  const errs = validateCheckout(d);
  fieldErrors(form, errs); $('#coError').textContent = '';
  if (Object.keys(errs).length) { $('.field.err input, .field.err select, .field.err textarea', form)?.focus(); return; }
  try { localStorage.setItem('crmbl_customer', JSON.stringify({ name: d.name, phone: d.phone, email: d.email, address: d.address, postcode: d.postcode })); } catch { /* ignore */ }

  const pb = $('#primaryBtn'); pb.disabled = true; pb.textContent = 'Placing order…';
  const payload = { ...d, type: state.type, items: cartLines().map((l) => ({ id: l.m.id, size: l.size, qty: l.qty })) };
  try {
    let order;
    if (state.demo) {
      await new Promise((r) => setTimeout(r, 900));
      const items = cartLines().map((l) => ({ name: l.label, qty: l.qty, line: l.price * l.qty }));
      order = { number: 1001, code: 'CR-PREVIEW', status: 'received', type: state.type, slot: d.slot, items, total: subtotal() + deliveryFee(), name: d.name.split(' ')[0] };
    } else {
      order = (await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) })).order;
    }
    state.cart = {}; saveCart(); state.lastOrder = order;
    showDone(order);
  } catch (e) {
    if (e.data?.errors) fieldErrors(form, e.data.errors);
    $('#coError').textContent = e.data?.errors?.items || e.data?.errors?.slot || e.message || 'Something went wrong, please try again.';
    pb.disabled = false; renderCart();
  }
}

const STATUS_LABEL = { received: 'Order received', preparing: 'Being prepared 👩‍🍳', ready: 'Ready to collect 🎉', out_for_delivery: 'Out for delivery 🛵', completed: 'Collected 💗', cancelled: 'Cancelled' };
let orderStream;
function showDone(o) {
  $('#doneBox').innerHTML = `
    <div class="tick"><svg viewBox="0 0 40 40"><path d="M9 21l7 7 15-16"/></svg></div>
    <h3>Thank you, ${esc(o.name)}!</h3>
    <p style="color:var(--muted);margin-top:6px">Your collection order is in. ${o.slot === 'asap' ? "We're on it, and we'll have it ready in about 20 minutes." : `It'll be ready at ${esc(o.slot)}.`}</p>
    <div class="code">Order #${esc(o.number)}</div>
    <p style="font-weight:800;color:var(--plum)" id="liveStatus">● ${STATUS_LABEL[o.status]}</p>
    <div style="text-align:left;margin:22px 0 10px">${o.items.map((i) => `<div class="sum"><span>${i.qty}× ${esc(i.name)}</span><span>${money(i.line)}</span></div>`).join('')}
      <div class="sum tot"><span>Pay in store</span><span>${money(o.total)}</span></div></div>
    <p class="notice">Say your order number <b>#${esc(o.number)}</b> at the counter and pay by card or cash.</p>
    ${state.demo ? '<p class="notice">This is a preview, so the order was not sent. Run the server to take real orders.</p>' : `<a class="btn btn-outline" href="/track?code=${encodeURIComponent(o.code)}" target="_blank" rel="noopener">Track your order →</a>`}`;
  show('done');
  if (!state.demo && 'EventSource' in window) {
    orderStream?.close();
    orderStream = new EventSource(`/api/orders/${encodeURIComponent(o.code)}/stream`);
    orderStream.addEventListener('status', (ev) => { const u = JSON.parse(ev.data); const el = $('#liveStatus'); if (el) el.textContent = '● ' + STATUS_LABEL[u.status]; if (['completed', 'cancelled'].includes(u.status)) orderStream.close(); });
  }
}

let lenis = null;
function openCart() { $('#drawer').classList.add('on'); $('#shade').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); document.body.classList.add('lock'); lenis?.stop(); if (state.view === 'done') show('basket'); else renderCart(); }
function closeCart() { $('#drawer').classList.remove('on'); $('#shade').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); document.body.classList.remove('lock'); lenis?.start(); }
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]'); if (add) { addToCart(add.dataset.add, add, add.dataset.size || 'M'); return; }
  const q = e.target.closest('[data-q]'); if (q) { setQty(q.dataset.q, (state.cart[q.dataset.q] || 0) + Number(q.dataset.d)); return; }
  const oc = e.target.closest('[data-open-cart]'); if (oc) { e.preventDefault(); openCart(); }
});
$('#cartBtn').onclick = openCart; $('#closeCart').onclick = closeCart; $('#shade').onclick = closeCart;
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeCart(); $('#lb').classList.remove('on'); } });
$('#backBtn').onclick = () => show('basket');
$('#primaryBtn').onclick = () => { if (state.view === 'basket') show('checkout'); else if (state.view === 'checkout') placeOrder(); else { closeCart(); show('basket'); } };
$('#checkoutForm').addEventListener('submit', (e) => { e.preventDefault(); placeOrder(); });

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 2700); }

function flyTo(from, m) {
  if (REDUCED || !from) return;
  const a = from.getBoundingClientRect(), b = $('#cartBtn').getBoundingClientRect();
  const f = document.createElement('div'); f.className = 'fly'; f.innerHTML = thumb(m); document.body.appendChild(f);
  const x0 = a.left + a.width / 2 - 32, y0 = a.top + a.height / 2 - 32, x1 = b.left + b.width / 2 - 32, y1 = b.top + b.height / 2 - 32;
  f.animate([
    { transform: `translate(${x0}px,${y0}px) scale(.4)`, opacity: 0 },
    { transform: `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - 140}px) scale(1.1)`, opacity: 1, offset: .45 },
    { transform: `translate(${x1}px,${y1}px) scale(.2)`, opacity: .6 },
  ], { duration: 850, easing: 'cubic-bezier(.5,0,.3,1)' }).onfinish = () => f.remove();
}

/* ================================================================ 4. CONTACT */
$('#contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target, note = $('#contactNote'), btn = $('button', form);
  const d = Object.fromEntries(new FormData(form));
  const errs = {};
  if ((d.name || '').trim().length < 2) errs.name = 'Please enter your name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '')) errs.email = 'Please enter a valid email';
  if ((d.message || '').trim().length < 5) errs.message = 'Please write a message';
  fieldErrors(form, errs); note.textContent = ''; note.className = 'form-note';
  if (Object.keys(errs).length) return;
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    if (state.demo) await new Promise((r) => setTimeout(r, 700));
    else await api('/api/contact', { method: 'POST', body: JSON.stringify(d) });
    form.reset(); note.classList.add('ok');
    note.textContent = state.demo ? 'Preview mode: the message was not sent. It will be once the server is running.' : "Thanks! We've got your message and will reply soon 💗";
  } catch (err) {
    if (err.data?.errors) fieldErrors(form, err.data.errors);
    note.classList.add('bad'); note.textContent = err.message;
  } finally { btn.disabled = false; btn.textContent = 'Send message'; }
});

/* ================================================================ 5. UI */
$('#yr').textContent = new Date().getFullYear();
const nav = $('#nav'), links = $$('.links a');
$('#burger').onclick = () => $('#mob').classList.toggle('on');
$$('#mob a').forEach((a) => a.addEventListener('click', () => $('#mob').classList.remove('on')));

// smooth anchor links (via Lenis when present)
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]'); if (!a) return;
  const t = a.getAttribute('href') === '#home' ? document.body : $(a.getAttribute('href')); if (!t) return;
  e.preventDefault();
  if (lenis) lenis.scrollTo(t === document.body ? 0 : t, { duration: 1.6, offset: -70 }); else (t === document.body ? scrollTo({ top: 0, behavior: 'smooth' }) : t.scrollIntoView({ behavior: 'smooth' }));
});

// lightbox
const lb = $('#lb');
$$('.shot').forEach((s) => s.addEventListener('click', () => { $('img', lb).src = $('img', s).src; $('img', lb).alt = $('img', s).alt; lb.classList.add('on'); }));
lb.addEventListener('click', () => lb.classList.remove('on'));

// cursor + magnetic buttons
const cur = $('#cursor');
let mx = innerWidth / 2, my = innerHeight / 2;
addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; cur.style.opacity = 1; cur.style.left = mx + 'px'; cur.style.top = my + 'px'; });
document.addEventListener('pointerover', (e) => cur.classList.toggle('big', !!e.target.closest('a,button,.fav,.shot')));
$$('.magnetic').forEach((b) => {
  b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px,${(e.clientY - r.top - r.height / 2) * 0.3}px)`; });
  b.addEventListener('pointerleave', () => (b.style.transform = ''));
});

// split headings into characters
$$('.split').forEach((h) => {
  let i = 0;
  h.innerHTML = h.textContent.split(' ').map((w) => `<span class="wd">${[...w].map((c) => `<span class="ch" style="--i:${i++}">${esc(c)}</span>`).join('')}</span>`).join(' ');
});

// reveal on enter
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); $$('.split', e.target).forEach((s) => s.classList.add('in')); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
function observe(el) { if (el) io.observe(el); }
$$('.reveal, .split, #feat, #revs').forEach(observe);
$$('#feat div').forEach((d, i) => d.style.setProperty('--i', i));

// sparkles in hero
(() => {
  const c = $('#sparkles'), x = c.getContext('2d'); let W, H; const dpr = Math.min(devicePixelRatio, 2);
  const rs = () => { W = c.width = c.offsetWidth * dpr; H = c.height = c.offsetHeight * dpr; }; rs(); addEventListener('resize', rs);
  const P = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 2 + 0.6, v: Math.random() * 0.0006 + 0.0002, tw: Math.random() * 6, c: Math.random() < 0.5 ? '255,95,168' : '255,214,140' }));
  (function t() {
    if (scrollY < innerHeight * 1.2) {
      x.clearRect(0, 0, W, H);
      for (const p of P) {
        p.y -= p.v; p.tw += 0.04; if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        const a = 0.25 + 0.35 * Math.sin(p.tw);
        x.beginPath(); x.arc(p.x * W, p.y * H, p.r * dpr, 0, 7); x.fillStyle = `rgba(${p.c},${Math.max(a, 0)})`; x.shadowBlur = 8 * dpr; x.shadowColor = `rgba(${p.c},.9)`; x.fill();
      }
    }
    requestAnimationFrame(t);
  })();
})();

/* ================================================================ 6. CINEMATIC MOTION */
const heroPhoto = $('#heroPhoto'), cam = $('#heroCam'), copy = $('#heroCopy'), leak = $('#leak');
const scene = $('#about'), frame = $('#sceneFrame'), sImg = $('#sceneImg'), sLabel = $('#sceneLabel'), sStory = $('#sceneStory');
const reel = $('#gallery'), strip = $('#reelStrip'), prog = $('#reelProg');
const boxes = $$('.letterbox');
const isDesktop = () => innerWidth > 900;
let lastY = scrollY, skew = 0;

function progressOf(el) { const r = el.getBoundingClientRect(); return clamp(-r.top / (r.height - innerHeight)); }
const ease = (t) => 1 - Math.pow(1 - t, 3);
const st0 = (sp) => clamp((sp - 0.55) / 0.25) * 0.9;
const lerp = (a, b, t) => a + (b - a) * t;

function frameTick() {
  const y = scrollY, vh = innerHeight;
  // velocity → skew (film "motion blur" feel)
  const v = y - lastY; lastY = y;
  skew = lerp(skew, clamp(v * 0.12, -5, 5), 0.12);

  // 1) hero: camera pushes in and racks focus as you scroll away
  if (y < vh * 1.3 && isDesktop()) {
    const p = clamp(y / vh);
    cam.style.transform = `scale(${1 + p * 0.22}) translateY(${p * 6}%)`;
    cam.style.filter = p > 0.01 ? `blur(${p * 7}px) brightness(${1 - p * 0.35})` : '';
    copy.style.transform = `translateY(${-p * 160}px)`;
    copy.style.opacity = 1 - p * 1.4;
  }

  // 2) nav hides while scrolling down, comes back on scroll up
  nav.classList.toggle('solid', y > 40);
  nav.classList.toggle('away', v > 2 && y > vh && !$('#drawer').classList.contains('on'));
  if (v < -2) nav.classList.remove('away');

  // 3) pinned "step inside" scene: window opens to full screen, then the story fades in
  const sp = progressOf(scene);
  if (!REDUCED) {
    const open = ease(clamp(sp / 0.6));
    // desktop ends as a full-width 2.35:1 widescreen frame; mobile ends full screen
    const endY = isDesktop() ? Math.max(0, (vh - innerWidth / 2.363) / 2 / vh * 100) : 0;
    const ins = isDesktop() ? [30, 32] : [24, 10];
    frame.style.clipPath = `inset(${lerp(ins[0], endY, open)}% ${lerp(ins[1], 0, open)}% ${lerp(ins[0], endY, open)}% ${lerp(ins[1], 0, open)}% round ${lerp(32, 0, open)}px)`;
    sImg.style.transform = (isDesktop() ? 'translateY(-50%) ' : '') + `scale(${lerp(1.25, 1, open)})`;
    $('#sceneCap').style.opacity = st0(sp);
    sLabel.style.opacity = 1 - clamp(sp / 0.25);
    sLabel.style.transform = `scale(${1 - clamp(sp / 0.25) * 0.2}) translateY(${-clamp(sp / 0.25) * 40}px)`;
    const st = clamp((sp - 0.55) / 0.25);
    frame.style.setProperty('--shade', st);
    sStory.style.opacity = st; sStory.style.transform = `translateY(${(1 - st) * 50}px)`;
  }
  // cinema letterbox bars while inside the pinned scenes
  const rp = progressOf(reel);
  const inScene = (sp > 0.02 && sp < 0.98) || (rp > 0.02 && rp < 0.98);
  boxes.forEach((b) => b.classList.toggle('on', inScene && !REDUCED));
  nav.classList.toggle('hide-in-scene', inScene && !REDUCED && !$('#drawer').classList.contains('on'));
  $('.fab').style.opacity = inScene ? 0 : ''; $('.fab').style.pointerEvents = inScene ? 'none' : '';

  // 4) horizontal gallery reel
  if (!REDUCED) {
    const dist = strip.scrollWidth - innerWidth;
    strip.style.transform = `translateX(${-rp * dist}px) skewX(${-skew * 0.6}deg)`;
    prog.style.width = rp * 100 + '%';
    $$('img', strip).forEach((img) => { const r = img.parentElement.getBoundingClientRect(); const o = (r.left + r.width / 2 - innerWidth / 2) / innerWidth; img.style.transform = `translateX(${-10 - o * 12}%)`; });
  }

  // 5) depth parallax on reviews + skew on favourites
  $$('.rev').forEach((r, i) => { const b = r.getBoundingClientRect(); if (b.bottom > 0 && b.top < vh) r.style.transform = `translateY(${(b.top - vh / 2) * [0.06, -0.04, 0.09][i % 3]}px)`; });
  $('#track').style.transform = `skewY(${skew * 0.25}deg)`;

  // 6) final CTA scales up into place
  const fin = $('.final'); const fb = fin.getBoundingClientRect();
  const fp = clamp(1 - (fb.top - vh * 0.35) / (vh * 0.65));
  fin.style.transform = `scale(${lerp(0.86, 1, ease(fp))})`;

  // active nav link
  let curId = 'home';
  for (const id of ['home', 'menu', 'delivery', 'about', 'reviews', 'gallery', 'contact']) { const s = document.getElementById(id); if (s && s.getBoundingClientRect().top < vh * 0.4) curId = id; }
  links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + curId));

  // hero mouse parallax
  if (y < vh && isDesktop()) heroPhoto.style.translate = `${(mx / innerWidth - 0.5) * -18}px ${(my / innerHeight - 0.5) * -12}px`;
}

function loop(t) { lenis?.raf(t); frameTick(); requestAnimationFrame(loop); }

/* opening sequence — letterbox title card → bars split → camera push-in → title rises */
function intro() {
  const root = document.documentElement;
  if (!root.classList.contains('intro')) return Promise.resolve();
  const seen = sessionStorage.getItem('crmbl_intro');
  const T = seen ? 0.45 : 1; // shorter on repeat visits in the same session
  const letters = $$('#intro .word span'), counter = $('#introCount');
  const t0 = performance.now();
  (function c(t) { const k = clamp((t - t0) / (1300 * T)); counter.textContent = String(Math.round(k * 100)).padStart(3, '0'); if (k < 1) requestAnimationFrame(c); })(t0);
  const EZ = 'cubic-bezier(.77,0,.18,1)', OUT = 'cubic-bezier(.16,1,.3,1)';
  letters.forEach((l, i) => l.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], { duration: 800 * T, delay: (120 + i * 70) * T, easing: OUT, fill: 'forwards' }));
  return new Promise((resolve) => setTimeout(() => {
    letters.forEach((l, i) => l.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-110%)' }], { duration: 600, delay: i * 40, easing: EZ, fill: 'forwards' }));
    $('#intro .bar.t').animate([{ transform: 'none' }, { transform: 'translateY(-100%)' }], { duration: 1300, delay: 350, easing: EZ, fill: 'forwards' });
    $('#intro .bar.b').animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 1300, delay: 350, easing: EZ, fill: 'forwards' });
    $$('#intro .tag, #intro .count').forEach((e) => e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }));
    // camera: push in from a wide, out-of-focus, dark frame
    heroPhoto.animate([{ scale: '1.38', filter: 'blur(16px) brightness(.35) saturate(.6)' }, { scale: '1', filter: 'blur(0) brightness(1) saturate(1)' }], { duration: 2800, delay: 300, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
    leak.animate([{ opacity: 0, transform: 'translateX(-30%)' }, { opacity: 0.9, offset: 0.4 }, { opacity: 0, transform: 'translateX(25%)' }], { duration: 2600, delay: 700, easing: 'ease-in-out' });
    $$('#h1 .mask>span').forEach((s, i) => s.animate([{ transform: 'translateY(115%) rotate(6deg)' }, { transform: 'none' }], { duration: 1200, delay: 900 + i * 110, easing: OUT, fill: 'forwards' }));
    $$('.hf').forEach((e, i) => e.animate([{ opacity: 0, transform: 'translateY(30px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 1000, delay: 1250 + i * 120, easing: OUT, fill: 'forwards' }));
    [nav, $('.scroll-cue')].forEach((e, i) => e.animate([{ opacity: 0, transform: i ? 'translate(-50%,20px)' : 'translateY(-30px)' }, { opacity: 1, transform: i ? 'translate(-50%,0)' : 'none' }], { duration: 900, delay: 1500 + i * 200, easing: OUT, fill: 'forwards' }));
    setTimeout(() => {
      $('#intro').remove();
      document.getAnimations().forEach((a) => { const el = a.effect?.target; if (el && (el.matches?.('#h1 .mask>span, .hf, .nav, .scroll-cue'))) { a.cancel(); el.style.removeProperty('transform'); el.style.removeProperty('opacity'); el.style.removeProperty('filter'); } });
      root.classList.remove('intro');
      sessionStorage.setItem('crmbl_intro', '1');
      resolve();
    }, 3000);
  }, 1500 * T));
}

/* boot */
loadData();
addEventListener('load', () => {
  if (window.Lenis && !REDUCED) { lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.9 }); document.documentElement.classList.add('lenis'); }
  requestAnimationFrame(loop);
});
// start the intro as soon as fonts are ready (or after 1.2s, whichever is first)
Promise.race([document.fonts?.ready || Promise.resolve(), new Promise((r) => setTimeout(r, 1200))]).then(intro);
})();
