/* Trident Brief service worker -- keeps Appalachistan working with no signal.

   Three rules, chosen so the brief can never be served stale while online:
   - The page itself: network first. Online you always get the current brief;
     only when the network fails does the last copy come out of the cache.
   - The map library and the trail data: cache first, refreshed in the
     background, so the map opens instantly on the trail.
   - USGS topo tiles: cache first, and every tile you look at is kept (up to a
     cap), so ground you have browsed is there offline even if you never pressed
     SAVE. Other tile servers are passed straight through and never stored:
     OpenTopoMap and Waymarked Trails do not allow bulk or offline copies. */
const SHELL = 'tb-shell-v1';
const TILES = 'tb-tiles-v1';      // areas saved on purpose: never trimmed
const BROWSE = 'tb-browse-v1';    // tiles kept from ordinary browsing: capped
const SHELL_FILES = ['./', 'assets/leaflet/leaflet.js', 'assets/leaflet/leaflet.css',
                     'assets/leaflet/images/layers.png', 'assets/leaflet/images/layers-2x.png',
                     'assets/appalachistan.js', 'assets/appalachia.json'];
const TILE_HOSTS = ['basemap.nationalmap.gov', 'elevation.nationalmap.gov'];
const BROWSE_CAP = 6000;          // tiles kept from ordinary browsing
const noCors = {};                // hosts that refused CORS
let sinceTrim = 0;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c =>
    Promise.all(SHELL_FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('tb-') && k !== SHELL && k !== TILES && k !== BROWSE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function shellKey(url){
  const u = new URL(url);
  u.search = ''; u.hash = '';
  return u.href;
}

/* On a ridge with one bar the phone reports "online" while every request
   stalls, so waiting on the network could leave the page blank for minutes.
   With a saved copy on hand the network gets six seconds; after that the saved
   page is shown and the fresh one still lands in the cache for next time. */
async function networkFirst(req, e){
  const cache = await caches.open(SHELL);
  const saved = await cache.match(shellKey(req.url)) || await cache.match(new URL('./', self.registration.scope).href);
  const net = fetch(req).then(res => {
    if(res.ok) return cache.put(shellKey(req.url), res.clone()).then(() => res);
    return res;
  });
  if(!saved){
    try { return await net; }
    catch(err){
      return new Response('<h1>Offline</h1><p>This page has not been saved on this device yet. Open it once with signal.</p>',
                          {status: 503, headers: {'Content-Type': 'text/html'}});
    }
  }
  e.waitUntil(net.catch(() => null));
  const timeout = new Promise(r => setTimeout(() => r(null), 6000));
  try {
    const res = await Promise.race([net, timeout]);
    return res && res.ok ? res : saved;
  } catch(err){ return saved; }
}

async function cacheFirstRefresh(req, e){
  const cache = await caches.open(SHELL);
  const key = shellKey(req.url);
  const hit = await cache.match(key);
  const net = fetch(req).then(res => { if(res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
  if(hit){ e.waitUntil(net); return hit; }
  return (await net) || new Response('', {status: 504});
}

async function trim(cache){
  const keys = await cache.keys();       // insertion order: oldest first
  const extra = keys.length - BROWSE_CAP;
  for(let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function tile(req, e){
  const saved = await caches.open(TILES);
  const hit = await saved.match(req.url);
  if(hit) return hit;
  const cache = await caches.open(BROWSE);
  const seen = await cache.match(req.url);
  if(seen) return seen;
  const host = new URL(req.url).hostname;
  if(!noCors[host]){
    try {
      const res = await fetch(req.url, {mode: 'cors', credentials: 'omit'});
      if(res.ok){
        e.waitUntil(cache.put(req.url, res.clone()).then(() => {
          if(++sinceTrim >= 250){ sinceTrim = 0; return trim(cache); }
        }));
      }
      return res;
    } catch(err){
      noCors[host] = true;   // this host will not share its tiles; stop asking
    }
  }
  try { return await fetch(req); }
  catch(err){ return new Response('', {status: 504}); }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(TILE_HOSTS.includes(url.hostname)){
    // An explicit CORS fetch is the page saving an area into its own cache;
    // only the map's image loads (no-cors) go through the browse cache.
    if(req.mode === 'cors') return;
    e.respondWith(tile(req, e));
    return;
  }
  if(url.origin !== self.location.origin) return;
  if(req.mode === 'navigate'){ e.respondWith(networkFirst(req, e)); return; }
  const p = url.pathname;
  if(p.includes('/assets/leaflet/') || p.endsWith('/assets/appalachistan.js') || p.endsWith('/assets/appalachia.json'))
    e.respondWith(cacheFirstRefresh(req, e));
});

self.addEventListener('message', e => {
  if(e.data === 'tiles-cors?') e.source && e.source.postMessage({type: 'tiles-cors', blocked: Object.keys(noCors)});
});
