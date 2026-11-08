'use strict';
// Builds preview/crmbl-preview.html: the whole site in ONE file (CSS, JS and photos inlined)
// so it can be opened by double-clicking, without the server. Orders aren't sent in this mode.
const fs = require('node:fs'), path = require('node:path');
const pub = path.join(__dirname, 'public');
let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'css/site.css'), 'utf8');
let js = fs.readFileSync(path.join(pub, 'js/app.js'), 'utf8');
html = html.replace('<link rel="stylesheet" href="/css/site.css" />', () => `<style>\n${css}\n</style>`);
html = html.replace('<script src="/js/app.js" defer></script>', '');
js = js.replace("if (location.protocol === 'file:') throw new Error('offline preview');", "throw new Error('offline preview');");
const { MENU } = require('./lib/seed');
html = html.replace('</body>', () => `<script>window.CRMBL_FALLBACK_MENU = ${JSON.stringify(MENU)};</script>\n<script>\n${js}\n</script>\n</body>`);
const uri = (f) => `data:${f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(path.join(pub, f)).toString('base64')}`;
html = html.replace(/\/img\/[a-z0-9-]+\.(?:jpg|svg|png)/g, (m) => uri(m.slice(1)));
html = html.replace(/href="\/track"/g, 'href="#contact"');
fs.mkdirSync(path.join(__dirname, 'preview'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'preview', 'crmbl-preview.html'), html);
console.log('Built preview/crmbl-preview.html', (html.length / 1024 / 1024).toFixed(2) + ' MB');
