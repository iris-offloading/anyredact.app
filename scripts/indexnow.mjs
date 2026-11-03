// Sends every sitemap URL to IndexNow (Bing, Yandex, Seznam and others share it).
// Run after a deploy that changes pages: node scripts/indexnow.mjs
// The key file static/e11aa9c5d4faf6794ffd68d76da1b820.txt must be live on the site first.
import { SITE } from './pages.mjs';

const KEY = 'e11aa9c5d4faf6794ffd68d76da1b820';
const sitemap = await (await fetch(`${SITE.origin}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(SITE.origin).host, key: KEY, keyLocation: `${SITE.origin}/${KEY}.txt`, urlList }),
});
console.log(`IndexNow: ${res.status} for ${urlList.length} URLs`);
if (!res.ok) process.exitCode = 1;
