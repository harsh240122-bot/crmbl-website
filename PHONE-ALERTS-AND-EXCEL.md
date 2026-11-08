# Phone alerts and the Excel sheet

## 📱 Get every new order on your phone (free, about 2 minutes)

We use **ntfy**, a free notification app. You don't need an account.

1. Install **ntfy** on your phone from the App Store (iPhone) or Google Play (Android).
2. Choose a secret topic name that nobody could guess, for example `crmbl-orders-k8f2q9x`.
   Anyone who knows the name can read the alerts, so make it long and random.
3. In the ntfy app, tap **+**, type your topic name and tap **Subscribe**.
4. In the website's `.env` file, add:
   ```
   NTFY_TOPIC=crmbl-orders-k8f2q9x
   PUBLIC_URL=https://your-website-address
   ```
   On Render, add these under **Environment** instead.
5. Restart the website, open `/admin` and tap **📱 Test alert**. Your phone should buzz.

Each alert shows something like:

> **New order #1002 · £18.15**
> Aisha · 07700 900123
> 3 items: 2× Crème Brûlée Crumble, 1× Vietnamese Coffee
> Collect: ASAP · Pay in store: £18.15

Tapping the alert opens your staff dashboard. Several phones can subscribe to the same topic, so the whole team can get alerts.

**Prefer Telegram?** Message **@BotFather** on Telegram, send `/newbot` and copy the token. Send your new bot a message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the `chat` → `id` number. Add both to `.env`:
```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
```
You can use ntfy and Telegram together.

## 📊 Excel sheet

There's nothing to set up:

- Every order is added to **`data/orders.xlsx`** automatically, with Order No, Customer name, Total items, Total (£), Date & time, Status and more. A second sheet, **Daily totals**, adds up each day.
- When the site is online, download the latest copy from **`/admin` → ⬇ Excel**. This works on your phone too.
- Keep a copy saved. If you open `orders.xlsx` directly on the computer that runs the website, close it again, so Windows can let the site keep writing to it.

### Want a sheet that updates live on your phone?
Use the optional Google Sheet in `google-sheets-script.gs`. The setup steps are at the top of that file and take about 5 minutes. New orders appear as new rows straight away, and you can open the sheet in the Google Sheets app or in Excel.
