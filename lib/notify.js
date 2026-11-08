'use strict';
/**
 * Sends new-order alerts to your phone, and (optionally) adds each order to a live Google Sheet.
 * Everything is optional: set the values in .env for the ones you want.
 *
 *  1. ntfy (easiest, free, no account): install the "ntfy" app, subscribe to your topic name.
 *       NTFY_TOPIC=crmbl-orders-7f3k2      ← pick something long and hard to guess
 *       NTFY_SERVER=https://ntfy.sh        ← default
 *  2. Telegram: create a bot with @BotFather, then message your bot once.
 *       TELEGRAM_BOT_TOKEN=123456:ABC...   TELEGRAM_CHAT_ID=123456789
 *  3. Live Google Sheet (opens in Excel too): see google-sheets-script.gs
 *       SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/…/exec   SHEETS_SECRET=same-as-in-script
 *
 * Alerts never slow down or break an order: they run in the background and failures are only logged.
 */
const money = (p) => '£' + (p / 100).toFixed(2);
const itemCount = (o) => o.items.reduce((a, i) => a + i.qty, 0);

function message(o) {
  const lines = o.items.map((i) => `${i.qty}× ${i.name}`).join('\n');
  return {
    title: `New order #${o.number} · ${money(o.total)}`,
    text: `${o.name} · ${o.phone}\n${itemCount(o)} item${itemCount(o) === 1 ? '' : 's'}:\n${lines}\nCollect: ${o.slot === 'asap' ? 'ASAP' : o.slot}${o.notes ? `\nNote: ${o.notes}` : ''}\nPay in store: ${money(o.total)}`,
  };
}

async function post(url, body, label) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: 'follow' });
  if (!r.ok) throw new Error(`${label} responded ${r.status}`);
  return label;
}

function channels() {
  const env = process.env;
  return {
    ntfy: !!env.NTFY_TOPIC,
    telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    sheets: !!env.SHEETS_WEBHOOK_URL,
  };
}

/** Phone alert for a new order (ntfy and/or Telegram). */
function phoneAlerts(o, { test = false } = {}) {
  const env = process.env;
  const { title, text } = message(o);
  const jobs = [];
  if (env.NTFY_TOPIC) {
    jobs.push(post((env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '') + '/', {
      topic: env.NTFY_TOPIC, title: (test ? '[TEST] ' : '') + title, message: text,
      tags: ['cake', 'bell'], priority: 5,
      ...(env.PUBLIC_URL ? { click: env.PUBLIC_URL.replace(/\/$/, '') + '/admin' } : {}),
    }, 'ntfy'));
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    jobs.push(post(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: env.TELEGRAM_CHAT_ID, text: `🔔 ${test ? '[TEST] ' : ''}${title}\n\n${text}`, disable_web_page_preview: true,
    }, 'telegram'));
  }
  return jobs;
}

/** Row for the live Google Sheet. event: "new" adds a row, "status" updates the Status column. */
function sheetRow(o, event) {
  const env = process.env;
  if (!env.SHEETS_WEBHOOK_URL) return [];
  return [post(env.SHEETS_WEBHOOK_URL, {
    secret: env.SHEETS_SECRET || '', event,
    orderNo: o.number, date: new Date(o.created_at).toLocaleString('en-GB', { timeZone: 'Europe/London' }),
    name: o.name, phone: o.phone, totalItems: itemCount(o), items: o.items.map((i) => `${i.qty}× ${i.name}`).join(', '),
    total: o.total / 100, collection: o.slot === 'asap' ? 'ASAP' : o.slot, status: o.status, notes: o.notes || '',
  }, 'google-sheets')];
}

async function settle(jobs, what) {
  const res = await Promise.allSettled(jobs);
  for (const r of res) if (r.status === 'rejected') console.error(`⚠ ${what} failed:`, r.reason?.message || r.reason);
  return res.map((r) => (r.status === 'fulfilled' ? { ok: true, channel: r.value } : { ok: false, error: String(r.reason?.message || r.reason) }));
}

const onNewOrder = (o) => settle([...phoneAlerts(o), ...sheetRow(o, 'new')], 'Order alert');
const onStatusChange = (o) => settle(sheetRow(o, 'status'), 'Sheet update');
const sendTest = (o) => settle(phoneAlerts(o, { test: true }), 'Test alert');

module.exports = { onNewOrder, onStatusChange, sendTest, channels };
