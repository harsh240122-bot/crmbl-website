'use strict';
/**
 * Writes a real Excel workbook (.xlsx) with no dependencies.
 * An .xlsx file is a zip of a few XML files; this builds them and zips them with Node's zlib.
 *
 *   ordersWorkbook(orders) → Buffer   (sheet "Orders": one row per order, newest at the bottom,
 *                                       plus a "Daily totals" sheet)
 *   saveOrdersFile(orders)  → writes data/orders.xlsx (atomic), debounced
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ------------------------------------------------------------- zip (deflate) */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(files) {
  const local = [], central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += h.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

/* ------------------------------------------------------------- sheet XML */
const x = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// styles: 0 normal, 1 bold header, 2 money, 3 date, 4 bold money (totals), 5 number
function cell(ref, v, style = 0) {
  if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${style}"/>`;
  if (typeof v === 'number') return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
}
function sheetXml(header, rows, widths, styles) {
  const all = [header.map((h) => [h, 1]), ...rows.map((r) => r.map((v, i) => [v, styles[i] || 0]))];
  const body = all.map((r, ri) => `<row r="${ri + 1}">${r.map(([v, s], ci) => cell(col(ci) + (ri + 1), v, s)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${body}</sheetData>
${rows.length ? `<autoFilter ref="A1:${col(header.length - 1)}${rows.length + 1}"/>` : ''}
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;£&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8358A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const STATUS = { received: 'New', preparing: 'Preparing', ready: 'Ready to collect', out_for_delivery: 'Out for delivery', completed: 'Collected', cancelled: 'Cancelled' };
const london = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
// Excel stores dates as days since 1899-12-30; we write London local time
function excelDate(iso) {
  const p = london(iso); const g = (t) => Number(p.find((v) => v.type === t).value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')) - Date.UTC(1899, 11, 30)) / 86400000;
}
const dayKey = (iso) => { const p = london(iso); const g = (t) => p.find((v) => v.type === t).value; return `${g('year')}-${g('month')}-${g('day')}`; };

function ordersWorkbook(orders) {
  const list = [...orders].sort((a, b) => a.id - b.id);
  const rows = list.map((o) => [
    o.number, o.name, o.items.reduce((a, i) => a + i.qty, 0), o.total / 100,
    excelDate(o.created_at), o.slot === 'asap' ? 'ASAP' : o.slot, STATUS[o.status] || o.status,
    o.phone, o.items.map((i) => `${i.qty}× ${i.name}`).join(', '), o.notes || '', o.code,
  ]);
  const orderSheet = sheetXml(
    ['Order No', 'Customer name', 'Total items', 'Total (£)', 'Date & time', 'Collection', 'Status', 'Phone', 'Items', 'Notes', 'Tracking code'],
    rows, [10, 22, 11, 11, 17, 11, 16, 15, 50, 30, 14], [5, 0, 5, 2, 3, 0, 0, 0, 0, 0, 0]);

  const days = new Map();
  for (const o of list) {
    if (o.status === 'cancelled') continue;
    const k = dayKey(o.created_at);
    const d = days.get(k) || { orders: 0, items: 0, total: 0 };
    d.orders++; d.items += o.items.reduce((a, i) => a + i.qty, 0); d.total += o.total; days.set(k, d);
  }
  const dayRows = [...days.entries()].map(([k, d]) => { const [y, m, dd] = k.split('-'); return [`${dd}/${m}/${y}`, d.orders, d.items, d.total / 100]; });
  const daySheet = sheetXml(['Date', 'Orders', 'Items sold', 'Total (£)'], dayRows, [14, 10, 12, 12], [0, 5, 5, 4]);

  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/><sheet name="Daily totals" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', orderSheet],
    ['xl/worksheets/sheet2.xml', daySheet],
    ['xl/styles.xml', STYLES],
  ]);
}

let timer = null;
function saveOrdersFile(getOrders, dir) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      const file = path.join(dir, 'orders.xlsx');
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, ordersWorkbook(getOrders()));
      fs.renameSync(tmp, file);
    } catch (e) {
      // e.g. the file is open in Excel on Windows; it will be written on the next order
      console.error('Could not update orders.xlsx:', e.message);
    }
  }, 200);
}

module.exports = { ordersWorkbook, saveOrdersFile };
