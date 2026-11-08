'use strict';
/**
 * Opening-hours helpers. All times are evaluated in the shop's timezone (Europe/London),
 * regardless of where the server is hosted.
 */
const TZ = 'Europe/London';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function londonNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return {
    day: DAYS.indexOf(g('weekday')),
    minutes: (Number(g('hour')) % 24) * 60 + Number(g('minute')),
    date: `${g('year')}-${g('month')}-${g('day')}`,
  };
}

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** close may be after midnight, e.g. open 15:00 close 01:00 */
function window_(s) {
  const o = toMin(s.open);
  let c = toMin(s.close);
  if (c <= o) c += 24 * 60;
  return { o, c };
}

function isOpen(settings, date = new Date()) {
  const now = londonNow(date);
  const { o, c } = window_(settings);
  const closedToday = (settings.closedDays || []).includes(now.day);
  if (!closedToday && now.minutes >= o && now.minutes < c) return true;
  // still inside yesterday's late-night window?
  const yesterday = (now.day + 6) % 7;
  if (c > 1440 && !(settings.closedDays || []).includes(yesterday) && now.minutes + 1440 < c) return true;
  return false;
}

/** Collection / delivery time slots for the rest of today (15-minute steps). */
function slots(settings, { prepMinutes = 20, step = 15 } = {}, date = new Date()) {
  const now = londonNow(date);
  if ((settings.closedDays || []).includes(now.day)) return [];
  const { o, c } = window_(settings);
  let start = Math.max(o, now.minutes + prepMinutes);
  start = Math.ceil(start / step) * step;
  const out = [];
  for (let m = start; m <= c - step; m += step) out.push(toHHMM(m));
  return out;
}

function publicStatus(settings, date = new Date()) {
  const open = isOpen(settings, date);
  const now = londonNow(date);
  const closedToday = (settings.closedDays || []).includes(now.day);
  let label;
  if (open) label = `Open now · until ${pretty(settings.close)}`;
  else if (closedToday) label = 'Closed today';
  else if (now.minutes < toMin(settings.open)) label = `Opens ${pretty(settings.open)} today`;
  else label = `Closed · opens ${pretty(settings.open)}`;
  return { open, label, day: now.day };
}

function pretty(hhmm) {
  let [h, m] = String(hhmm).split(':').map(Number);
  const ap = h >= 12 && h < 24 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}

module.exports = { londonNow, isOpen, slots, publicStatus, pretty, toMin };
