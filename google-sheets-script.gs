/**
 * OPTIONAL: live Google Sheet of crmbl orders (you can open it in Excel or the Google Sheets phone app).
 *
 * Setup (5 minutes):
 *  1. Create a new Google Sheet (sheets.new). Name it "crmbl orders".
 *  2. Extensions → Apps Script. Delete what's there and paste this whole file.
 *  3. Change SECRET below to any password-like text, then click Save.
 *  4. Deploy → New deployment → type "Web app".
 *       Execute as: Me   ·   Who has access: Anyone
 *     Click Deploy, allow access, and copy the "Web app URL".
 *  5. In your website's .env file add:
 *       SHEETS_WEBHOOK_URL=<the Web app URL>
 *       SHEETS_SECRET=<the same SECRET as below>
 *  6. Restart the website. New orders now appear as new rows, and the Status column updates
 *     when staff change an order in /admin.
 */
const SECRET = 'change-me-to-something-secret';
const HEADERS = ['Order No', 'Customer name', 'Total items', 'Total (£)', 'Date & time', 'Collection', 'Status', 'Phone', 'Items', 'Notes'];
const STATUS = { received: 'New', preparing: 'Preparing', ready: 'Ready to collect', completed: 'Collected', cancelled: 'Cancelled' };

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.secret !== SECRET) return ContentService.createTextOutput('forbidden');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Orders') || ss.insertSheet('Orders');
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS);
      sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#E8358A').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      sh.getRange('D:D').setNumberFormat('£#,##0.00');
    }
    const status = STATUS[d.status] || d.status;
    if (d.event === 'new') {
      sh.appendRow([d.orderNo, d.name, d.totalItems, d.total, d.date, d.collection, status, d.phone, d.items, d.notes]);
    } else if (d.event === 'status') {
      const nums = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
      for (let i = nums.length - 1; i >= 0; i--) {
        if (String(nums[i][0]) === String(d.orderNo)) { sh.getRange(i + 2, 7).setValue(status); break; }
      }
    }
    return ContentService.createTextOutput('ok');
  } finally {
    lock.releaseLock();
  }
}
