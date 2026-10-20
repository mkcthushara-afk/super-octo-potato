// Keeps the app installable and shows a friendly page when there is no internet.
// Data always comes from the server, so nothing private is cached.
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No internet</title><body style="font-family:system-ui,sans-serif;padding:32px;color:#16201E;background:#EEF2F0"><h2>No internet connection</h2><p>Site Bill Book needs the internet to load your bills. Check your connection and try again.</p><button onclick="location.reload()" style="padding:10px 16px;border-radius:8px;border:0;background:#0F6B5C;color:#fff;font-size:15px">Try again</button>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, {headers: {'Content-Type': 'text/html; charset=utf-8'}})));
});
