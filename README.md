# crmbl® website

Animated, cinematic website for **crmbl** (Manor Park, London E12) with **order-ahead for collection** (customers **pay in store** when they collect), live order tracking and a staff dashboard. Delivery is through **Uber Eats and Just Eat** (links in `public/js/app.js` → `DELIVERY`).

**No dependencies to install.** You only need [Node.js](https://nodejs.org) 18 or newer. Version 22 or newer is recommended, because it includes a built-in SQLite database.

## Run it

```bash
cp .env.example .env      # then edit ADMIN_PASSWORD and SESSION_SECRET
npm start                 # → http://localhost:3000
```

| Page | What it is |
|---|---|
| `/` | The website: menu, basket, checkout, contact form |
| `/track?code=CR-XXXXXX` | Live order tracking for customers |
| `/admin` | Staff dashboard. The password is `ADMIN_PASSWORD` from `.env`; the default is `crmbl-admin`, so change it. |

`npm test` runs the API test suite (10 end-to-end tests). `npm run dev` restarts the server automatically when files change.

## Before going live: things to set in /admin

1. **Menu.** The menu, prices, sizes and hours come from crmbluk.com (November 2026). Update them any time in `/admin → Menu`. Drinks with two sizes have a Medium and a Large price.
2. **Hours.** These are set to 3pm–11pm daily, as listed on crmbluk.com. Change them in `/admin → Settings`.
3. **Delivery links.** These already point to crmbl's Uber Eats and Just Eat pages. They're in `public/js/app.js` → `DELIVERY`.
4. **Photos.** `cups.jpg`, `cups-custard.jpg` and `logo-white.png` are crmbl's own, from crmbluk.com. The other photos come from the design mockup. Replace them with real shop photos that use the same file names, or set a photo per item in Menu → Image path.

## Order numbers, Excel and phone alerts

- **Order numbers:** every website order gets the next number: **#1001, #1002, #1003…** The customer sees it on screen and says it at the counter. Staff see it on each order card.
- **Excel:** every order is saved automatically to **`data/orders.xlsx`**, and the file is updated again whenever an order's status changes. The **Orders** sheet has Order No, Customer name, Total items, Total (£), Date & time, Collection, Status, Phone, Items and Notes. The **Daily totals** sheet shows each day's orders, items sold and takings. Staff can download the latest copy any time with the **⬇ Excel** button in `/admin`.
- **Phone alerts:** see [PHONE-ALERTS-AND-EXCEL.md](PHONE-ALERTS-AND-EXCEL.md). This takes about 2 minutes with the free ntfy app.
- **Optional live Google Sheet** that updates row by row: see `google-sheets-script.gs`.

## How ordering works

- Customers add items, choose **ASAP or a collection time**, and **pay in store** (card or cash) when they collect. There is no online payment and no delivery through this site.
- The server **recalculates every price from the database**. It ignores any prices sent from the browser, and checks opening hours, time slots, sold-out items, UK phone numbers, postcodes and delivery areas.
- New orders appear **instantly** in `/admin`, with a chime, a browser notification and a tab badge. Staff move each order through *New → Preparing → Ready / Out for delivery → Done*, and can print a ticket.
- The customer's confirmation screen and the `/track` page **update live** as staff change the status.
- Before opening time, customers can pre-order for a slot later that day. This can be turned off in Settings.

## What's inside

```
server.js            HTTP server: API, static files, gzip, caching, security headers, rate limiting
lib/db.js            Storage: SQLite (Node 22.5+) or a JSON file (older Node). Same API either way.
lib/hours.js         Opening hours and time slots, always in London time
lib/seed.js          Starting menu and settings (used only the first time)
public/index.html    Website markup
public/css/site.css  Styles
public/js/app.js     Menu, basket, checkout, contact form and the cinematic motion engine
public/admin.html    Staff dashboard (+ js/admin.js)
public/track.html    Order tracking page
test/api.test.js     End-to-end API tests
build-preview.js     Builds preview/crmbl-preview.html, a one-file offline preview
data/                Database files (created automatically; back this folder up)
```

### API

| Method | Path | |
|---|---|---|
| GET | `/api/menu` | Menu items |
| GET | `/api/settings` | Hours, open/closed status, ordering options, time slots |
| POST | `/api/orders` | Place an order `{type, name, phone, email?, address?, postcode?, slot, notes?, items:[{id, qty}]}` |
| GET | `/api/orders/:code` · `/stream` | Order status, plus live updates (Server-Sent Events) |
| POST | `/api/contact` | Contact form |
| — | `/api/admin/*` | Login, orders, stats, menu, messages, settings (cookie session) |

### Motion

The intro, scroll scenes and parallax are written in this project's own code: a scroll-scene engine using the Web Animations API, in `app.js` section 6. They don't depend on a CDN. [Lenis](https://github.com/darkroomengineering/lenis) adds smooth inertia scrolling when it loads. The motion includes:

- a letterbox title card, then a camera push-in with a focus pull on the hero dessert
- steam rising from the dessert, custard pouring and drips falling (all looping)
- depth-of-field blur and push-in on the hero as you scroll away
- masked headline reveals, and headings that rise in letter by letter
- a pinned "step inside" scene that opens into a 2.35:1 widescreen frame, with cinema bars
- a pinned horizontal gallery reel with inner parallax and velocity skew
- 3D card fan-in, magnetic buttons, a custom cursor, film grain and a light leak

Everything respects the visitor's **reduced-motion** setting.

## Deploying

Any host that runs Node works, for example Render, Railway, Fly.io or a VPS.

- Start command: `npm start`. Set `PORT`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `NODE_ENV=production` and `TRUST_PROXY=1`.
- Use a **persistent disk** for the `data/` folder (or set `DATA_DIR`), so orders survive restarts.
- Serve it over HTTPS. Most hosts do this automatically.

Static-only hosts like Netlify can't run the ordering backend. Use `preview/crmbl-preview.html` there if you only want the showcase.

## Ideas for later

Card payments with Stripe Checkout, email or SMS receipts, a loyalty stamp card, and taking orders from Deliveroo or Uber Eats into the same dashboard.
