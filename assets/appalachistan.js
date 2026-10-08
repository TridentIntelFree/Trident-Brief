/* =====================================================================
   APPALACHISTAN -- a trail map meant to be carried

   Everything here has to keep working on a ridge with no signal, so:
   - the map library, this file, the page and the trail data are kept on the
     phone by the service worker (sw.js);
   - the topo tiles for any area can be saved ahead of time (OFFLINE tab), and
     every USGS tile looked at is kept as well;
   - GPS, trail miles, distances, bearings, coordinates, sunrise and sunset are
     all computed on the phone -- none of them needs a network.
   Only the weather, OpenTopoMap and the hiking-route overlay need a signal,
   and they say so.
   ===================================================================== */
(function(){
'use strict';
var BAND = document.getElementById('appBand');
if(!BAND) return;
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function store(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(_){ return false; } }
function load(k, d){ try{ var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(_){ return d; } }

/* ------------------------------------------------------------- sources */
var USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services/';
var BASES = {
  topo:    {name:'USGS Topo', url:USGS + 'USGSTopo/MapServer/tile/{z}/{y}/{x}', max:16, save:true, kb:22,
            attr:'<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>'},
  imagery: {name:'USGS Imagery + Topo', url:USGS + 'USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', max:16, save:true, kb:38,
            attr:'USGS The National Map'},
  relief:  {name:'USGS Shaded Relief', url:USGS + 'USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}', max:13, save:true, kb:14,
            attr:'USGS The National Map'},
  otm:     {name:'OpenTopoMap (online only)', url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', max:17, save:false, kb:0,
            attr:'&copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA) &copy; OpenStreetMap contributors'},
  osm:     {name:'OpenStreetMap, footpaths to z19 (online only)', url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max:19, save:false, kb:0,
            attr:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'},
  esri:    {name:'Esri World Imagery, sub-metre (online only)', url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max:19, save:false, kb:0,
            attr:'Imagery &copy; Esri, Maxar, Earthstar Geographics'}
};
/* USGS 3DEP lidar hillshade: the bare-earth surface at about a metre. It is
   the finest detail anywhere on this map -- switchbacks, the bench a trail is
   cut into, old logging grades, stream cuts under the canopy that no topo
   draws. An ArcGIS image service rather than a tile cache, so each tile is a
   rendered request; public domain, so it can be saved offline like the topo. */
var LIDAR = {name:'Lidar hillshade, ~1 m (USGS 3DEP)', max:17, kb:18,
             attr:'<a href="https://www.usgs.gov/3d-elevation-program" target="_blank" rel="noopener">USGS 3DEP</a> lidar'};
function lidarUrl(z, x, y){
  var o = 20037508.342789244, s = 2*o/Math.pow(2, z);
  var x0 = -o + x*s, y1 = o - y*s;
  return 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=' +
    x0.toFixed(2) + ',' + (y1 - s).toFixed(2) + ',' + (x0 + s).toFixed(2) + ',' + y1.toFixed(2) +
    '&bboxSR=3857&imageSR=3857&size=256,256&format=png&renderingRule=' +
    encodeURIComponent('{"rasterFunction":"Hillshade Gray"}') + '&f=image';
}
var KINDS = {
  shelter:  {c:'#f97316', l:'Shelters',    z:9,  r:5.5},
  water:    {c:'#38bdf8', l:'Water',       z:11, r:4.5},
  camp:     {c:'#22c55e', l:'Campsites',   z:10, r:4.5},
  peak:     {c:'#e2e8f0', l:'Peaks',       z:10, r:4.5},
  view:     {c:'#facc15', l:'Viewpoints',  z:11, r:4.5},
  trailhead:{c:'#a78bfa', l:'Trailheads',  z:10, r:4.5},
  falls:    {c:'#67e8f9', l:'Waterfalls',  z:11, r:4.5},
  town:     {c:'#f472b6', l:'Trail towns', z:6,  r:6.5}
};
var KIND_ONE = {shelter:'Shelter', water:'Water source', camp:'Campsite', peak:'Peak', view:'Viewpoint',
                trailhead:'Trailhead', falls:'Waterfall', town:'Trail town'};
/* Where to look, not where things are: these only move the view. */
var PRESETS = [
  ['whole',  'Whole trail, Georgia to Maine'],
  ['va-nc',  'Virginia and North Carolina', [[35.0,-84.3],[39.4,-77.6]]],
  ['springer','Springer Mountain, GA (southern terminus)', [34.627,-84.194], 13],
  ['smokies','Great Smoky Mountains, NC/TN', [35.56,-83.50], 11],
  ['maxpatch','Max Patch, NC', [35.796,-82.959], 14],
  ['hotsprings','Hot Springs, NC', [35.894,-82.826], 14],
  ['roan','Roan Highlands, NC/TN', [36.104,-82.122], 13],
  ['damascus','Damascus, VA', [36.633,-81.784], 14],
  ['grayson','Grayson Highlands and Mount Rogers, VA', [36.645,-81.52], 13],
  ['triple','Dragon’s Tooth, McAfee Knob, Tinker Cliffs, VA', [37.40,-80.05], 12],
  ['shenandoah','Shenandoah National Park, VA', [38.50,-78.45], 10],
  ['harpers','Harpers Ferry, WV', [39.325,-77.739], 14],
  ['katahdin','Katahdin, ME (northern terminus)', [45.904,-68.921], 13]
];

/* ------------------------------------------------------------ geometry */
var D = Math.PI / 180, RE = 6371008.8;
function dist(a, b){                                    // metres
  var p1 = a[0]*D, p2 = b[0]*D, dp = p2 - p1, dl = (b[1]-a[1])*D;
  var h = Math.sin(dp/2)*Math.sin(dp/2) + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
  return 2*RE*Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b){                                 // degrees true
  var p1 = a[0]*D, p2 = b[0]*D, dl = (b[1]-a[1])*D;
  var y = Math.sin(dl)*Math.cos(p2), x = Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y, x)/D + 360) % 360;
}
function card(deg){
  return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg/22.5) % 16];
}
function fmtDist(m){
  if(m == null || !isFinite(m)) return '—';
  if(m < 300) return Math.round(m*3.28084) + ' ft (' + Math.round(m) + ' m)';
  var mi = m/1609.344;
  return mi.toFixed(mi < 10 ? 2 : 1) + ' mi (' + (m/1000).toFixed(m < 10000 ? 2 : 1) + ' km)';
}
function fmtEle(m){ return m == null ? '—' : Math.round(m*3.28084).toLocaleString() + ' ft (' + Math.round(m).toLocaleString() + ' m)'; }
function fmtDur(ms){
  if(!isFinite(ms) || ms < 0) return '—';
  var m = Math.round(ms/60000), h = Math.floor(m/60);
  return h ? h + ' h ' + (m % 60) + ' m' : m + ' min';
}

/* Coordinates, in the forms a map, a GPS unit or a rescuer will ask for. */
function dms(v, pos, neg){
  var h = v >= 0 ? pos : neg; v = Math.abs(v);
  var d = Math.floor(v), mf = (v - d)*60, m = Math.floor(mf), s = (mf - m)*60;
  if(s >= 59.95){ s = 0; m++; } if(m >= 60){ m = 0; d++; }
  return d + '° ' + String(m).padStart(2,'0') + '′ ' + s.toFixed(1).padStart(4,'0') + '″ ' + h;
}
function ddm(v, pos, neg, w){
  var h = v >= 0 ? pos : neg; v = Math.abs(v);
  var d = Math.floor(v), m = (v - d)*60;
  if(m >= 59.9995){ m = 0; d++; }
  return h + ' ' + String(d).padStart(w,'0') + '° ' + m.toFixed(3).padStart(6,'0') + '′';
}
function utm(lat, lon){
  var zone = Math.floor((lon + 180)/6) + 1;
  if(lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  var a = 6378137, f = 1/298.257223563, k0 = 0.9996, e2 = f*(2-f), ep2 = e2/(1-e2);
  var lon0 = ((zone - 1)*6 - 180 + 3)*D, phi = lat*D, lam = lon*D;
  var s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  var N = a/Math.sqrt(1 - e2*s*s), T = t*t, C = ep2*c*c, A = c*(lam - lon0);
  var M = a*((1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256)*phi
           - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024)*Math.sin(2*phi)
           + (15*e2*e2/256 + 45*e2*e2*e2/1024)*Math.sin(4*phi)
           - (35*e2*e2*e2/3072)*Math.sin(6*phi));
  var E = k0*N*(A + (1 - T + C)*A*A*A/6 + (5 - 18*T + T*T + 72*C - 58*ep2)*Math.pow(A,5)/120) + 500000;
  var No = k0*(M + N*t*(A*A/2 + (5 - T + 9*C + 4*C*C)*Math.pow(A,4)/24
                      + (61 - 58*T + T*T + 600*C - 330*ep2)*Math.pow(A,6)/720));
  if(lat < 0) No += 10000000;
  return {zone:zone, E:E, N:No, band:'CDEFGHJKLMNPQRSTUVWXX'.charAt(Math.floor((lat + 80)/8))};
}
function usng(lat, lon){
  if(lat < -80 || lat > 84) return '—';
  var u = utm(lat, lon), set = u.zone % 6 || 6;
  var col = ['ABCDEFGH','JKLMNPQR','STUVWXYZ'][(set - 1) % 3].charAt(Math.floor(u.E/100000) - 1);
  var r = Math.floor(u.N/100000) % 20;
  if(set % 2 === 0) r = (r + 5) % 20;
  var row = 'ABCDEFGHJKLMNPQRSTUV'.charAt(r);
  var e = String(Math.floor(u.E) % 100000).padStart(5,'0'), n = String(Math.floor(u.N) % 100000).padStart(5,'0');
  return u.zone + u.band + ' ' + col + row + ' ' + e + ' ' + n;
}
function coordRows(lat, lon){
  var u = utm(lat, lon);
  return [
    ['DECIMAL', lat.toFixed(5) + ', ' + lon.toFixed(5)],
    ['DEG MIN', ddm(lat,'N','S',2) + '  ' + ddm(lon,'E','W',3)],
    ['DEG MIN SEC', dms(lat,'N','S') + '  ' + dms(lon,'E','W')],
    ['USNG / MGRS', usng(lat, lon)],
    ['UTM', u.zone + u.band + ' ' + Math.round(u.E) + 'mE ' + Math.round(u.N) + 'mN']
  ];
}

/* Sunrise and sunset, computed here (NOAA's almanac method). Good to a minute
   or two, which is all anyone deciding whether to push on needs. */
function sunEvent(dateUTC, lat, lon, rising, zenith){
  var y = dateUTC.getUTCFullYear(), mo = dateUTC.getUTCMonth(), dd = dateUTC.getUTCDate();
  var N = Math.round((Date.UTC(y, mo, dd) - Date.UTC(y, 0, 0))/864e5);
  var lngHour = lon/15, t = N + ((rising ? 6 : 18) - lngHour)/24;
  var M = 0.9856*t - 3.289;
  var L = (M + 1.916*Math.sin(M*D) + 0.020*Math.sin(2*M*D) + 282.634 + 720) % 360;
  var RA = (Math.atan(0.91764*Math.tan(L*D))/D + 720) % 360;
  RA = (RA + (Math.floor(L/90)*90 - Math.floor(RA/90)*90))/15;
  var sinDec = 0.39782*Math.sin(L*D), cosDec = Math.cos(Math.asin(sinDec));
  var cosH = (Math.cos(zenith*D) - sinDec*Math.sin(lat*D))/(cosDec*Math.cos(lat*D));
  if(cosH > 1 || cosH < -1) return null;
  var H = (rising ? 360 - Math.acos(cosH)/D : Math.acos(cosH)/D)/15;
  var UT = ((H + RA - 0.06571*t - 6.622 - lngHour) % 24 + 24) % 24;
  return Date.UTC(y, mo, dd) + UT*3600e3;
}
function sunDay(lat, lon, when){
  var d = new Date(when || Date.now());
  var rise = sunEvent(d, lat, lon, true, 90.833), set = sunEvent(d, lat, lon, false, 90.833);
  var dusk = sunEvent(d, lat, lon, false, 96);
  // west of Greenwich the evening falls on the next UTC day
  if(rise && set && set < rise) set += 864e5;
  if(set && dusk && dusk < set) dusk += 864e5;
  return {rise:rise, set:set, dusk:dusk};
}
function clock(ms){
  if(!ms) return '—';
  var d = new Date(ms);
  return d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) + ' (' + d.toISOString().slice(11,16) + 'Z)';
}

/* -------------------------------------------------------------- state */
var map = null, baseKey = load('ap_base', 'topo'), baseLayer = null, hikingLayer = null, lidarLayer = null;
var atLayer = null, poiLayers = {}, kindOn = load('ap_kinds', null);
var DATA = null, PATH = null, CUM = null, POIS = [];
var me = null, watchId = null, follow = false, meMarker = null, accCircle = null;
var compassOn = false, compassDeg = null, wakeLock = null;
var target = null, targetLine = null;
var TRACK = load('ap_track', {on:false, pts:[]});
var trackLine = null;
var WPTS = load('ap_wpts', []), wptLayer = null;
var GPX = load('ap_gpx', []), gpxLayer = null;
var measure = {on:false, pts:[], line:null, marks:null};
var tab = 'here';
if(!kindOn){ kindOn = {}; Object.keys(KINDS).forEach(function(k){ kindOn[k] = true; }); }

/* ----------------------------------------------------------- bootstrap */
var started = false;
function start(){
  if(started) return;
  started = true;
  var boot = $('apBoot');
  if(boot) boot.textContent = 'loading map…';
  if(window.L){ init(); return; }
  var css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'assets/leaflet/leaflet.css';
  document.head.appendChild(css);
  var sc = document.createElement('script');
  sc.src = 'assets/leaflet/leaflet.js';
  sc.onload = init;
  sc.onerror = function(){ if(boot) boot.textContent = 'The map library could not be loaded. Online: reload the page. Offline: this device has not saved the map yet.'; };
  document.head.appendChild(sc);
}
if(window.TB_PRIVATE){
  // private mode: no tile server is asked for anything until the button is pressed
  var bt = $('apBoot');
  if(bt) bt.firstChild.textContent = 'private mode: the map loads USGS tiles when you press \u00b7 ';
} else if('IntersectionObserver' in window){
  var io = new IntersectionObserver(function(es){
    if(es.some(function(e){ return e.isIntersecting; })){ io.disconnect(); start(); }
  }, {rootMargin:'400px'});
  io.observe(BAND);
}
var sb = $('apStart'); if(sb) sb.onclick = start;
if(location.hash === '#appBand') start();
/* The home-screen shortcut "Emergency" lands here: map open, EMERGENCY tab, section unfolded. */
function openSos(){
  var fb = BAND.querySelector('.fold-btn');
  if(BAND.classList.contains('folded') && fb) fb.click();
  start(); showTab('sos');
  setTimeout(function(){ $('apTabs').scrollIntoView({block:'start'}); }, 400);
}
if(location.hash === '#apSos') setTimeout(openSos, 300);
addEventListener('hashchange', function(){ if(location.hash === '#apSos') openSos(); });

function init(){
  var L = window.L;
  $('apMap').innerHTML = '';
  map = L.map('apMap', {preferCanvas:true, zoomControl:true, minZoom:5, maxZoom:19, worldCopyJump:false,
                        tap:true, attributionControl:true});
  var view = load('ap_view', null);
  if(view && view.c && isFinite(view.z)) map.setView(view.c, view.z);
  else map.fitBounds([[35.0,-84.3],[39.4,-77.6]]);
  /* Touching the map to look around stops FOLLOW, so the next GPS fix does
     not snap the view back; the FOLLOW button turns it on again. */
  var el = map.getContainer();
  map.on('dragstart', stopFollow);
  el.addEventListener('wheel', stopFollow, {passive:true});
  el.addEventListener('touchstart', function(e){ if(e.touches.length > 1) stopFollow(); }, {passive:true});
  el.addEventListener('dblclick', stopFollow);
  el.querySelectorAll('.leaflet-control-zoom a').forEach(function(a){ a.addEventListener('click', stopFollow); });
  map.on('moveend', function(){ store('ap_view', {c:[map.getCenter().lat, map.getCenter().lng], z:map.getZoom()}); refreshKinds(); if(tab === 'offline') paintPanel(); });

  var bases = {}, baseObjs = {};
  Object.keys(BASES).forEach(function(k){
    var b = BASES[k];
    baseObjs[k] = L.tileLayer(b.url, {maxNativeZoom:b.max, maxZoom:19, subdomains:'abc', attribution:b.attr,
                                      keepBuffer:3, crossOrigin: false,
                                      // the page sends no referrer; OSM-based servers refuse tiles without one, so they get the site name only
                                      referrerPolicy: /openstreetmap|opentopomap/.test(b.url) ? 'strict-origin' : 'no-referrer'});
    bases[b.name] = baseObjs[k];
  });
  if(!BASES[baseKey]) baseKey = 'topo';
  baseLayer = baseObjs[baseKey].addTo(map);
  map.on('baselayerchange', function(e){
    Object.keys(baseObjs).forEach(function(k){ if(baseObjs[k] === e.layer){ baseKey = k; store('ap_base', k); } });
    baseLayer = e.layer;
    if(tab === 'offline') paintPanel();
  });
  var Lidar = L.TileLayer.extend({getTileUrl:function(c){ return lidarUrl(c.z, c.x, c.y); }});
  lidarLayer = new Lidar('', {maxNativeZoom:LIDAR.max, maxZoom:19, minZoom:11, opacity:.5, attribution:LIDAR.attr});
  if(load('ap_lidar', false)) lidarLayer.addTo(map);
  map.on('overlayadd overlayremove', function(e){
    if(e.layer === lidarLayer){ store('ap_lidar', e.type === 'overlayadd'); if(tab === 'offline') paintPanel(); }
  });
  hikingLayer = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    {maxZoom:19, maxNativeZoom:17, opacity:.85, referrerPolicy:'strict-origin',
     attribution:'<a href="https://hiking.waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a> (CC-BY-SA)'});
  atLayer = L.layerGroup().addTo(map);
  wptLayer = L.layerGroup().addTo(map);
  gpxLayer = L.layerGroup().addTo(map);
  trackLine = L.polyline([], {color:'#ec4899', weight:4, opacity:.9}).addTo(map);   // pink: orange is the AT, red the GO TO line
  var overlays = {'Appalachian Trail': atLayer, 'Lidar hillshade, ~1 m (from zoom 11)': lidarLayer,
                  'Hiking routes (online only)': hikingLayer,
                  'My track': trackLine, 'Waypoints': wptLayer, 'Imported GPX': gpxLayer};
  L.control.layers(bases, overlays, {collapsed:true}).addTo(map);
  L.control.scale({imperial:true, metric:true}).addTo(map);
  map.attributionControl.addAttribution('Trail data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>');
  map.on('click', onMapClick);

  buildKinds();
  buildJump();
  drawTrack(); drawWpts(); drawGpx(); drawRoutes(); drawTarget(); drawHud();   // a destination chosen earlier is shown, named, from the start
  netStatus();
  addEventListener('online', netStatus); addEventListener('offline', netStatus);
  if(TRACK.on) startLocate();       // a track left running keeps recording on reload
  loadData();
  paintPanel();
}

function netStatus(){
  var el = $('apNet'); if(!el) return;
  var on = navigator.onLine;
  el.className = 'ap-net' + (on ? '' : ' off');
  el.textContent = on ? 'ONLINE' : 'OFFLINE · saved maps and trail data only';
}

/* --------------------------------------------------------- trail data */
function decode(a){
  var out = [], la = 0, lo = 0;
  for(var i = 0; i + 1 < a.length; i += 2){ la += a[i]; lo += a[i+1]; out.push([la/1e5, lo/1e5]); }
  return out;
}
function loadData(){
  fetch('assets/appalachia.json').then(function(r){
    if(r.status === 404) throw new Error('not built yet');
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(d){
    if(!d.segs || !d.segs.length)
      throw new Error(d.failed_at ? 'the last build attempt failed at ' + String(d.failed_at).slice(0, 16).replace('T', ' ') +
                                    'Z; it is retried automatically' : 'not built yet');
    DATA = d;
    var L = window.L, ren = L.canvas({padding:.3});
    (d.segs || []).forEach(function(s){
      var pts = decode(s);
      L.polyline(pts, {renderer:ren, color:'#1c1917', weight:6, opacity:.55, interactive:false}).addTo(atLayer);
      L.polyline(pts, {renderer:ren, color:'#f97316', weight:3, opacity:.95, interactive:false}).addTo(atLayer);
    });
    if(d.path){
      PATH = decode(d.path);
      /* Trail miles come from the build, measured on OpenStreetMap's full line.
         Measuring the simplified drawing instead loses every switchback --
         about 120 miles over the whole trail. */
      if(d.path_cum && d.path_cum.length === PATH.length) CUM = d.path_cum.map(function(c){ return c/100; });
      else {
        CUM = [0];
        for(var i = 1; i < PATH.length; i++) CUM.push(CUM[i-1] + dist(PATH[i-1], PATH[i])/1609.344);
      }
    }
    POIS = (d.pois || []).map(function(p){
      return {lat:p[0], lon:p[1], k:p[2], name:p[3] || '', mile:p[4], ele:p[5]};
    });
    buildPois();
    buildKinds();
    paintPanel();
  }).catch(function(e){
    DATA = {error:String(e.message || e)};
    paintPanel();
  });
}

/* Nearest point on the trail to p: trail mile and distance off the trail. */
function onTrail(p){
  if(!PATH) return null;
  var best = Infinity, bi = 0, bt = 0, kx = Math.cos(p[0]*D)*111320, ky = 110540;
  for(var i = 1; i < PATH.length; i++){
    var a = PATH[i-1], b = PATH[i];
    if(Math.abs(a[0]-p[0]) > 0.3 && Math.abs(b[0]-p[0]) > 0.3) continue;
    var ax = (a[1]-p[1])*kx, ay = (a[0]-p[0])*ky, bx = (b[1]-p[1])*kx, by = (b[0]-p[0])*ky;
    var dx = bx-ax, dy = by-ay, L2 = dx*dx + dy*dy;
    var t = L2 ? Math.max(0, Math.min(1, -(ax*dx + ay*dy)/L2)) : 0;
    var x = ax + t*dx, y = ay + t*dy, d2 = x*x + y*y;
    if(d2 < best){ best = d2; bi = i; bt = t; }
  }
  if(!isFinite(best)) return null;
  return {mile: CUM[bi-1] + bt*(CUM[bi]-CUM[bi-1]), off: Math.sqrt(best)};
}

/* ----------------------------------------------------------- POIs */
function popupFor(p){
  var rows = '<div class="k">' + esc(KIND_ONE[p.k] || p.k) + '</div><b>' + esc(p.name || ('Unnamed ' + (KIND_ONE[p.k] || p.k).toLowerCase())) + '</b>';
  if(p.mile != null) rows += '<div>AT mile ≈ ' + p.mile.toFixed(1) + ' from Springer</div>';
  if(p.ele != null) rows += '<div>Elevation ' + fmtEle(p.ele) + '</div>';
  if(me) rows += '<div>From you: ' + fmtDist(dist([me.lat, me.lon], [p.lat, p.lon])) + ' ' +
                 card(bearing([me.lat, me.lon], [p.lat, p.lon])) + ' (straight line)</div>';
  rows += '<div style="font-family:ui-monospace,monospace;font-size:11px;color:#475569">' + usng(p.lat, p.lon) + '</div>';
  rows += '<div class="row"><button data-ap-goto="' + p.lat + ',' + p.lon + '" data-ap-name="' + esc(p.name || KIND_ONE[p.k]) + '">GO TO</button>' +
          '<button data-terrain="' + p.lat + ',' + p.lon + '">TERRAIN + WEATHER</button>' +
          '<a class="b" href="https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lon + '#map=16/' + p.lat + '/' + p.lon +
          '" target="_blank" rel="noopener">OSM ↗</a></div>';
  return '<div class="ap-pop">' + rows + '</div>';
}
function buildPois(){
  var L = window.L, ren = L.canvas({padding:.3});
  Object.keys(poiLayers).forEach(function(k){ map.removeLayer(poiLayers[k]); });
  poiLayers = {};
  Object.keys(KINDS).forEach(function(k){ poiLayers[k] = L.layerGroup(); });
  POIS.forEach(function(p){
    var K = KINDS[p.k]; if(!K) return;
    var m = L.circleMarker([p.lat, p.lon], {renderer:ren, radius:K.r, color:'#0f172a', weight:1.5,
                                            fillColor:K.c, fillOpacity:.95});
    m.bindPopup(function(){ return popupFor(p); }, {maxWidth:280});
    p.marker = m;
    poiLayers[p.k].addLayer(m);
  });
  refreshKinds();
}
function refreshKinds(){
  if(!map) return;
  var z = map.getZoom();
  Object.keys(poiLayers).forEach(function(k){
    var want = kindOn[k] && z >= KINDS[k].z;
    var has = map.hasLayer(poiLayers[k]);
    if(want && !has) poiLayers[k].addTo(map);
    if(!want && has) map.removeLayer(poiLayers[k]);
  });
}
function buildKinds(){
  var box = $('apKinds'); if(!box) return;
  var n = {};
  POIS.forEach(function(p){ n[p.k] = (n[p.k] || 0) + 1; });
  box.innerHTML = '';
  Object.keys(KINDS).forEach(function(k){
    var b = document.createElement('button');
    b.className = 'ev-f' + (kindOn[k] ? ' on' : '');
    b.innerHTML = '<i style="background:' + KINDS[k].c + '"></i>' + esc(KINDS[k].l) + (n[k] ? ' (' + n[k].toLocaleString() + ')' : '');
    b.title = 'shown from zoom ' + KINDS[k].z;
    b.onclick = function(){ kindOn[k] = !kindOn[k]; store('ap_kinds', kindOn); buildKinds(); refreshKinds(); };
    box.appendChild(b);
  });
}
function buildJump(){
  var sel = $('apJump'); if(!sel || sel.options.length > 1) return;
  PRESETS.forEach(function(p){ var o = document.createElement('option'); o.value = p[0]; o.textContent = p[1]; sel.appendChild(o); });
  sel.onchange = function(){
    var p = PRESETS.filter(function(x){ return x[0] === sel.value; })[0];
    sel.value = '';
    if(!p || !map) return;
    if(p[0] === 'whole'){
      if(PATH) map.fitBounds(window.L.latLngBounds(PATH));
      else map.fitBounds([[34.5,-84.4],[46.0,-68.8]]);
    } else if(Array.isArray(p[2][0])) map.fitBounds(p[2]);
    else map.setView(p[2], p[3]);
  };
}

/* ------------------------------------------------------------- search */
(function(){
  var inp = $('apFind'), hits = $('apHits');
  if(!inp) return;
  inp.addEventListener('input', function(){
    var q = inp.value.trim().toLowerCase();
    if(q.length < 2){ hits.style.display = 'none'; return; }
    var rows = [];
    POIS.forEach(function(p){ if(p.name && p.name.toLowerCase().indexOf(q) > -1) rows.push({p:p, t:KIND_ONE[p.k]}); });
    WPTS.forEach(function(w){ if(w.n.toLowerCase().indexOf(q) > -1) rows.push({p:{lat:w.lat, lon:w.lon, name:w.n}, t:'Waypoint'}); });
    rows.sort(function(a, b){ return (a.p.name.toLowerCase().indexOf(q)) - (b.p.name.toLowerCase().indexOf(q)); });
    hits.innerHTML = rows.slice(0, 14).map(function(r, i){
      return '<button data-i="' + i + '">' + esc(r.p.name) + '<small>' + esc(r.t) +
             (r.p.mile != null ? ' · mile ' + r.p.mile.toFixed(1) : '') + '</small></button>';
    }).join('') || '<button disabled>' + (POIS.length ? 'nothing by that name' : 'trail data not loaded yet') + '</button>';
    hits.style.display = 'block';
    hits.querySelectorAll('button[data-i]').forEach(function(b){
      b.onclick = function(){
        var r = rows[+b.dataset.i];
        hits.style.display = 'none'; inp.value = r.p.name;
        start();
        var go = function(){
          map.setView([r.p.lat, r.p.lon], Math.max(map.getZoom(), 14));
          if(r.p.marker){ refreshKinds(); setTimeout(function(){ r.p.marker.openPopup(); }, 250); }
        };
        map ? go() : setTimeout(go, 800);
      };
    });
  });
  document.addEventListener('click', function(e){ if(!e.target.closest('.ap-search')) hits.style.display = 'none'; });
})();

/* ---------------------------------------------------------------- GPS */
function startLocate(){
  if(!('geolocation' in navigator)){ alert('This browser has no GPS access.'); return; }
  if(watchId != null) return;
  watchId = navigator.geolocation.watchPosition(onFix, onFixErr,
    {enableHighAccuracy:true, maximumAge:5000, timeout:30000});
  $('apLocate').classList.add('on'); $('apLocate').innerHTML = '&#9678; GPS ON';
  follow = true; $('apFollow').classList.add('on');
  keepAwake(true);
  paintPanel();
}
function stopLocate(){
  if(watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  $('apLocate').classList.remove('on'); $('apLocate').innerHTML = '&#9678; START GPS';
  keepAwake(false);
  paintPanel();
}
function onFixErr(err){
  me = me || null;
  var msg = err.code === 1 ? 'Location permission was refused. Allow it for this site in the browser settings.'
          : err.code === 2 ? 'No GPS fix yet. Step into the open and give it a minute.'
          : 'GPS timed out; still trying.';
  lastGpsErr = msg;
  if(err.code === 1) stopLocate();
  paintPanel();
}
var lastGpsErr = '';
function onFix(pos){
  var c = pos.coords;
  var prev = me;
  me = {lat:c.latitude, lon:c.longitude, acc:c.accuracy, alt:c.altitude, altAcc:c.altitudeAccuracy,
        spd:c.speed, hdg:c.heading, t:pos.timestamp || Date.now()};
  lastGpsErr = '';
  sigMaybe();
  if(pocket){ if(TRACK.on) addTrackPoint(me, prev); pocketTick(); return; }   // nothing to draw under a black screen
  var L = window.L, ll = [me.lat, me.lon];
  if(!meMarker){
    accCircle = L.circle(ll, {radius:me.acc, color:'#3b82f6', weight:1, fillColor:'#3b82f6', fillOpacity:.12, interactive:false}).addTo(map);
    meMarker = L.marker(ll, {icon:L.divIcon({className:'ap-me', iconSize:[30,30], iconAnchor:[15,15],
      html:'<svg id="apMeSvg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="7.5" fill="#3b82f6" stroke="#fff" stroke-width="2.5"/>' +
           '<path id="apMeArrow" d="M15 1 L20 10 L15 8 L10 10 Z" fill="#3b82f6" stroke="#fff" stroke-width="1.2" style="display:none"/></svg>'}),
      interactive:false, zIndexOffset:1000}).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 14));
  } else {
    meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(me.acc);
    if(follow) map.panTo(ll, {animate:true});
  }
  pointArrow();
  if(TRACK.on) addTrackPoint(me, prev);
  if(target) drawTarget();
  paintPanel();
}
function heading(){
  if(compassOn && compassDeg != null) return compassDeg;
  if(me && me.hdg != null && isFinite(me.hdg) && (me.spd || 0) > 0.6) return me.hdg;
  return null;
}
function pointArrow(){
  var a = document.getElementById('apMeArrow'), h = heading();
  if(!a) return;
  a.style.display = h == null ? 'none' : '';
  if(h != null) a.setAttribute('transform', 'rotate(' + h.toFixed(0) + ' 15 15)');
}
function keepAwake(on){
  if(!('wakeLock' in navigator)) return;
  if(on && !wakeLock){
    navigator.wakeLock.request('screen').then(function(l){ wakeLock = l; l.addEventListener('release', function(){ wakeLock = null; paintPanel(); }); paintPanel(); }).catch(function(){});
  } else if(!on && wakeLock){ wakeLock.release().catch(function(){}); wakeLock = null; }
}
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'visible' && watchId != null && !wakeLock) keepAwake(true);
});
/* ------------------------------------------------------------ pocket
   A web page cannot use GPS with the screen off: iPhone and Android both stop
   it when the screen locks. Pocket mode is the nearest thing. The screen stays
   on but goes pure black (OLED pixels showing black are off), touches are
   locked so a pocket cannot press anything, and GPS keeps recording. Holding
   anywhere for a second and a half shows the way out. */
var pocket = null;
function pocketOn(tries){
  if(pocket) return;
  if(!tries){
    try{ var de = document.documentElement; if(de.requestFullscreen) de.requestFullscreen({navigationUI:'hide'}).catch(function(){}); }catch(_){}
  }
  start();
  if(!map){ if((tries || 0) < 20) setTimeout(function(){ pocketOn((tries || 0) + 1); }, 500); return; }
  if(!TRACK.on){ TRACK.on = true; saveTrack(); }
  if(watchId == null) startLocate();
  keepAwake(true);
  var o = document.createElement('div');
  o.id = 'apPocket';
  o.innerHTML = '<div class="pk-hint" id="pkHint"></div><div class="pk-line" id="pkLine"></div>' +
                '<button class="pk-exit" id="pkExit" type="button" hidden>LEAVE POCKET MODE</button>';
  document.body.appendChild(o);
  document.documentElement.classList.add('ap-pocketed');
  pocket = {el:o, hold:null, moved:0, since:Date.now(), timer:setInterval(pocketTick, 60000)};
  var hint = 'POCKET MODE \u00b7 GPS keeps recording.<br><br>Don\u2019t press the power button: locking the phone stops the page and the track.' +
             '<br><br>Hold anywhere for 2 seconds to come back.' +
             (!('wakeLock' in navigator) ? '<br><br><b>This phone won\u2019t let a web page keep the screen on.</b> Set Auto-Lock to Never while you track (iPhone: Settings \u2192 Display &amp; Brightness \u2192 Auto-Lock).' : '') +
             '<br><br>To save battery with no signal, airplane mode is fine: GPS still works in it.';
  $('pkHint').innerHTML = hint;
  setTimeout(function(){ var h = $('pkHint'); if(h) h.style.opacity = '0'; }, 9000);
  setTimeout(function(){ if(pocket && 'wakeLock' in navigator && !wakeLock){ var h = $('pkHint');
    if(h){ h.innerHTML = 'The phone refused to keep the screen on. Set Auto-Lock to Never while you track, or the track stops when it locks.' +
                 '<br><br>Hold anywhere for 2 seconds to come back.'; h.style.opacity = '1'; } } }, 2500);
  var exit = $('pkExit');
  o.addEventListener('pointerdown', function(e){
    if(e.target === exit) return;
    e.preventDefault();
    clearTimeout(pocket.hold);
    pocket.hold = setTimeout(function(){
      exit.hidden = false;
      clearTimeout(pocket.hide); pocket.hide = setTimeout(function(){ exit.hidden = true; }, 5000);
    }, 1500);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(ev){ o.addEventListener(ev, function(){ if(pocket) clearTimeout(pocket.hold); }); });
  o.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  exit.addEventListener('click', function(e){ e.stopPropagation(); pocketOff(); });
  pocketTick();
}
function pocketOff(){
  if(!pocket) return;
  clearInterval(pocket.timer); clearTimeout(pocket.hold); clearTimeout(pocket.hide);
  pocket.el.remove(); pocket = null;
  document.documentElement.classList.remove('ap-pocketed');
  try{ if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){}); }catch(_){}
  saveTrack(); drawTrack();
  if(me) onFix({coords:{latitude:me.lat, longitude:me.lon, accuracy:me.acc, altitude:me.alt, altitudeAccuracy:me.altAcc,
                        speed:me.spd, heading:me.hdg}, timestamp:me.t});
  paintPanel();
}
/* One dim line, moved now and then so nothing burns into the screen. */
function pocketTick(){
  if(!pocket) return;
  var el = $('pkLine'); if(!el) return;
  var st = trackStats(), now = new Date();
  el.textContent = (TRACK.on ? '\u25cf REC ' : '') + fmtDist(st.d) + ' \u00b7 ' +
    (me ? '\u00b1' + Math.round(me.acc) + ' m' : (lastGpsErr ? 'no GPS fix' : 'waiting for GPS')) + ' \u00b7 ' +
    now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) +
    (routeFix() ? (routeFix().offRoute ? ' \u00b7 OFF ROUTE ' + fmtDist(routeFix().off) : ' \u00b7 on route') + ', ' + fmtMi(routeFix().left) + ' left' :
     target && me ? ' \u00b7 \u2192 ' + target.name + ' ' + fmtDist(dist([me.lat, me.lon], [target.lat, target.lon])) + ' ' +
                    Math.round(bearing([me.lat, me.lon], [target.lat, target.lon])) + '\u00b0' : '');
  if(Date.now() - pocket.moved > 60000){
    pocket.moved = Date.now();
    el.style.left = (5 + Math.random()*45) + '%'; el.style.top = (8 + Math.random()*80) + '%';
  }
}
/* If the phone locked anyway, say so on return rather than pretend the track is whole. */
var hiddenAt = 0;
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'hidden'){ hiddenAt = Date.now(); return; }
  if(pocket && hiddenAt && Date.now() - hiddenAt > 60000){
    var h = $('pkHint');
    if(h){ h.innerHTML = 'The screen was locked from ' + new Date(hiddenAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) +
             ' to ' + new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) + ', so nothing was recorded in that time. Tracking again now.';
           h.style.opacity = '1'; setTimeout(function(){ if($('pkHint')) $('pkHint').style.opacity = '0'; }, 12000); }
  }
  hiddenAt = 0;
});
function toggleCompass(){
  if(compassOn){ compassOn = false; compassDeg = null; pointArrow(); paintPanel(); return; }
  var go = function(){
    compassOn = true;
    var abs = 'ondeviceorientationabsolute' in window;
    addEventListener(abs ? 'deviceorientationabsolute' : 'deviceorientation', function(e){
      if(!compassOn) return;
      var h = e.webkitCompassHeading != null ? e.webkitCompassHeading
            : (e.absolute || abs) && e.alpha != null ? (360 - e.alpha) % 360 : null;
      if(h == null) return;
      compassDeg = h;
      pointArrow();
      if(tab === 'goto') drawArrow();
      drawHud();
    });
    paintPanel();
  };
  if(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function'){
    DeviceOrientationEvent.requestPermission().then(function(r){ if(r === 'granted') go(); else alert('Compass permission was refused.'); })
      .catch(function(){ alert('Compass is not available.'); });
  } else go();
}
$('apLocate').onclick = function(){ start(); var f = function(){ watchId == null ? startLocate() : stopLocate(); }; map ? f() : setTimeout(f, 900); };
if($('apPocketBtn')) $('apPocketBtn').onclick = function(){ pocketOn(); };
$('apFollow').onclick = function(){
  follow = !follow; this.classList.toggle('on', follow);
  if(follow && me && map) map.panTo([me.lat, me.lon]);
};

/* ------------------------------------------------------ next on trail */
function alongTrail(mile, kind){
  var nobo = null, sobo = null;
  POIS.forEach(function(p){
    if(p.k !== kind || p.mile == null) return;
    if(p.mile > mile + 0.05 && (!nobo || p.mile < nobo.mile)) nobo = p;
    if(p.mile < mile - 0.05 && (!sobo || p.mile > sobo.mile)) sobo = p;
  });
  return {nobo:nobo, sobo:sobo};
}
function nearest(pt, kind, n){
  return POIS.filter(function(p){ return p.k === kind; })
    .map(function(p){ return {p:p, d:dist(pt, [p.lat, p.lon])}; })
    .sort(function(a, b){ return a.d - b.d; }).slice(0, n || 1);
}

/* ------------------------------------------------------------ go to */
function setTarget(lat, lon, name){
  target = {lat:lat, lon:lon, name:name || 'Selected point'};
  store('ap_target', target);
  plan = null; drawRoutes();
  drawTarget();
  showTab('goto');
}
target = load('ap_target', null);
function drawTarget(){
  if(!map || !target) return;
  var L = window.L;
  if(targetLine){ map.removeLayer(targetLine); targetLine = null; }
  var pts = me ? [[me.lat, me.lon], [target.lat, target.lon]] : [[target.lat, target.lon]];
  targetLine = L.layerGroup([
    L.circleMarker([target.lat, target.lon], {radius:9, color:'#ef4444', weight:3, fill:false})
      .bindTooltip('GO TO: ' + esc(target.name), {permanent:true, direction:'right', offset:[10, 0], className:'ap-tgt-tip'}),
    me && !routeActive() ? L.polyline(pts, {color:'#ef4444', weight:2, dashArray:'6 6', interactive:false}) : L.layerGroup()
  ]).addTo(map);
  drawHud();
}
/* The bar over the map while going somewhere: where, how far, which way. */
function drawHud(){
  var el = $('apHud'); if(!el) return;
  if(!target){ el.hidden = true; return; }
  el.hidden = false;
  var line = '<b>' + esc(target.name) + '</b>';
  if(!me) line += ' &middot; <span class="ap-warn">turn GPS on to be guided</span>';
  else {
    var d = dist([me.lat, me.lon], [target.lat, target.lon]), b = bearing([me.lat, me.lon], [target.lat, target.lon]), h = heading();
    var rf = routeFix();
    if(d <= Math.max(25, me.acc)) line += ' &middot; <span class="ap-good">YOU ARE THERE</span> <small>(within GPS accuracy, \u00b1' + Math.round(me.acc) + ' m)</small>';
    else if(rf){
      var aim = rf.offRoute ? rf.near : rf.ahead, ab = bearing([me.lat, me.lon], aim);
      line = '<svg class="ap-hud-arrow" viewBox="0 0 64 64"><g transform="rotate(' + (h == null ? ab : ab - h).toFixed(0) + ' 32 32)">' +
             '<path d="M32 6 L46 46 L32 37 L18 46 Z" fill="' + (rf.offRoute ? '#fbbf24' : '#22c55e') + '"/></g></svg>' + line + ' &middot; ' +
             (rf.offRoute ? '<span class="ap-warn">OFF ROUTE ' + fmtDist(rf.off) + '</span> &middot; back to it ' + Math.round(ab) + '\u00b0 ' + card(ab)
                          : '<span class="ap-good">on route</span> &middot; follow ' + Math.round(ab) + '\u00b0 ' + card(ab)) +
             ' &middot; <b>' + fmtMi(rf.left) + '</b> left, ~' + fmtDur(rf.tl*1000) + ' <small>' + (h == null ? '(north-up)' : '(ahead-up)') + '</small>';
    }
    else line = '<svg class="ap-hud-arrow" viewBox="0 0 64 64"><g transform="rotate(' + (h == null ? b : b - h).toFixed(0) + ' 32 32)">' +
                '<path d="M32 6 L46 46 L32 37 L18 46 Z" fill="#ef4444"/></g></svg>' + line + ' &middot; <b>' + fmtDist(d) + '</b> &middot; ' +
                Math.round(b) + '\u00b0 ' + card(b) + ' <small>' + (h == null ? '(arrow is north-up)' : '(arrow is ahead-up)') + '</small>';
  }
  el.innerHTML = '<span class="ap-hud-go">' + line + '</span><button class="ap-hud-x" data-hud="x" title="stop going there">&times;</button>';
}
document.addEventListener('click', function(e){
  var hb = e.target.closest && e.target.closest('#apHud');
  if(!hb) return;
  if(e.target.closest('[data-hud="x"]')){ target = null; store('ap_target', null); if(targetLine){ map.removeLayer(targetLine); targetLine = null; } plan = null; drawRoutes(); drawHud(); paintPanel(); }
  else { start(); showTab('goto'); }
});
function drawArrow(){
  var a = document.getElementById('apGoArrow');
  if(!a || !me || !target) return;
  var b = bearing([me.lat, me.lon], [target.lat, target.lon]), h = heading();
  a.setAttribute('transform', 'rotate(' + ((h == null ? b : b - h)).toFixed(0) + ' 32 32)');
}
document.addEventListener('click', function(e){
  var g = e.target.closest && e.target.closest('[data-ap-goto]');
  if(g){
    var p = g.dataset.apGoto.split(',');
    setTarget(parseFloat(p[0]), parseFloat(p[1]), g.dataset.apName);
    if(map) map.closePopup();
    return;
  }
  var w = e.target.closest && e.target.closest('[data-ap-wpt]');
  if(w){
    var q = w.dataset.apWpt.split(',');
    if(map) map.closePopup();
    var made = addWpt(parseFloat(q[0]), parseFloat(q[1]));
    if(made && confirm('Saved "' + made.n + '". Navigate to it now?')) setTarget(made.lat, made.lon, made.n);
  }
});

/* -------------------------------------------------------------- track */
function addTrackPoint(f, prev){
  if(f.acc > 50) return;                       // a wild fix is worse than none
  var pts = TRACK.pts, last = pts[pts.length - 1];
  if(last && dist([last[1], last[2]], [f.lat, f.lon]) < Math.max(5, f.acc/2)) return;
  pts.push([Math.round(f.t/1000), +f.lat.toFixed(6), +f.lon.toFixed(6), f.alt == null ? null : Math.round(f.alt*10)/10]);
  if(pts.length % 5 === 0 || pts.length < 5 || pocket) saveTrack();
  if(!pocket) drawTrack();
}
function saveTrack(){
  if(!store('ap_track', TRACK)) lastGpsErr = 'Track too large to save on this device; export it as GPX.';
}
/* A track is drawn in pieces: a gap of ten minutes or more, or a jump no
   walker could make, starts a new piece, so a track left recording across
   days is never joined up into a straight line that looks like a route. */
function trackBreak(a, b){
  var dt = b[0] - a[0], s = dist([a[1], a[2]], [b[1], b[2]]);
  return dt > 600 || s > 1000 || (dt > 0 && s/dt > 4);   // 4 m/s is a fast run
}
function trackSegs(){
  var segs = [], cur = [];
  TRACK.pts.forEach(function(p, i){
    if(i && trackBreak(TRACK.pts[i-1], p)){ if(cur.length) segs.push(cur); cur = []; }
    cur.push(p);
  });
  if(cur.length) segs.push(cur);
  return segs;
}
function drawTrack(){
  if(trackLine) trackLine.setLatLngs(trackSegs().map(function(sg){ return sg.map(function(p){ return [p[1], p[2]]; }); }));
}
function trackStats(){
  var pts = TRACK.pts, d = 0, moving = 0, gain = 0, loss = 0, ref = null;
  for(var i = 1; i < pts.length; i++){
    var s = dist([pts[i-1][1], pts[i-1][2]], [pts[i][1], pts[i][2]]), dt = pts[i][0] - pts[i-1][0];
    if(trackBreak(pts[i-1], pts[i])) continue;      // a gap is not distance walked
    d += s;
    if(dt > 0 && dt < 600 && s/dt > 0.3) moving += dt;
  }
  pts.forEach(function(p){                      // 5 m hysteresis: GPS altitude is noisy
    if(p[3] == null) return;
    if(ref == null){ ref = p[3]; return; }
    if(p[3] - ref >= 5){ gain += p[3] - ref; ref = p[3]; }
    else if(ref - p[3] >= 5){ loss += ref - p[3]; ref = p[3]; }
  });
  var el = pts.length > 1 ? (pts[pts.length-1][0] - pts[0][0])*1000 : 0;
  return {d:d, el:el, moving:moving*1000, gain:gain, loss:loss, n:pts.length};
}

/* ---------------------------------------------------------- waypoints */
function addWpt(lat, lon, name){
  var n = name || prompt('Name this waypoint', 'Waypoint ' + (WPTS.length + 1));
  if(n == null) return;
  var w = {n:String(n).slice(0, 60) || 'Waypoint', lat:+lat.toFixed(6), lon:+lon.toFixed(6), t:Date.now()};
  WPTS.push(w);
  store('ap_wpts', WPTS);
  drawWpts();
  if(tab === 'wpt') paintPanel();
  return w;
}
function drawWpts(){
  if(!wptLayer) return;
  var L = window.L;
  wptLayer.clearLayers();
  WPTS.forEach(function(w){
    L.marker([w.lat, w.lon], {icon:L.divIcon({className:'', iconSize:[18,18], iconAnchor:[9,18],
      html:'<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 17 L3 7 A6 6 0 1 1 15 7 Z" fill="#fbbf24" stroke="#1e293b" stroke-width="1.4"/></svg>'})})
      .bindPopup(function(){
        return '<div class="ap-pop"><div class="k">Waypoint</div><b>' + esc(w.n) + '</b><div style="font:11px ui-monospace,monospace">' +
          usng(w.lat, w.lon) + '</div><div class="row"><button data-ap-goto="' + w.lat + ',' + w.lon + '" data-ap-name="' + esc(w.n) +
          '">GO TO</button><button data-terrain="' + w.lat + ',' + w.lon + '">TERRAIN + WEATHER</button></div></div>';
      }).addTo(wptLayer);
  });
}

/* ---------------------------------------------------------------- GPX */
function gpxText(){
  var x = function(s){ return esc(s); };
  var out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Appalachian Intel - Appalachistan" xmlns="http://www.topografix.com/GPX/1/1">'];
  WPTS.forEach(function(w){
    out.push('<wpt lat="' + w.lat + '" lon="' + w.lon + '"><time>' + new Date(w.t).toISOString() + '</time><name>' + x(w.n) + '</name></wpt>');
  });
  if(TRACK.pts.length){
    out.push('<trk><name>Track ' + new Date(TRACK.pts[0][0]*1000).toISOString().slice(0,10) + '</name>');
    trackSegs().forEach(function(sg){
      out.push('<trkseg>');
      sg.forEach(function(p){
        out.push('<trkpt lat="' + p[1] + '" lon="' + p[2] + '">' + (p[3] != null ? '<ele>' + p[3] + '</ele>' : '') +
                 '<time>' + new Date(p[0]*1000).toISOString() + '</time></trkpt>');
      });
      out.push('</trkseg>');
    });
    out.push('</trk>');
  }
  out.push('</gpx>');
  return out.join('\n');
}
function download(name, text){
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type:'application/gpx+xml'}));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function importGpx(file){
  var r = new FileReader();
  r.onload = function(){
    try{
      var doc = new DOMParser().parseFromString(String(r.result), 'application/xml');
      if(doc.getElementsByTagName('parsererror').length) throw new Error('not a GPX file');
      var lines = [], wp = [];
      ['trkseg', 'rte'].forEach(function(tag){
        Array.prototype.forEach.call(doc.getElementsByTagName(tag), function(seg){
          var pts = [];
          Array.prototype.forEach.call(seg.getElementsByTagName(tag === 'rte' ? 'rtept' : 'trkpt'), function(p){
            var la = parseFloat(p.getAttribute('lat')), lo = parseFloat(p.getAttribute('lon'));
            if(isFinite(la) && isFinite(lo)) pts.push([+la.toFixed(6), +lo.toFixed(6)]);
          });
          if(pts.length > 1) lines.push(pts);
        });
      });
      Array.prototype.forEach.call(doc.getElementsByTagName('wpt'), function(p){
        var la = parseFloat(p.getAttribute('lat')), lo = parseFloat(p.getAttribute('lon'));
        var nm = (p.getElementsByTagName('name')[0] || {}).textContent || 'GPX point';
        if(isFinite(la) && isFinite(lo)) wp.push([+la.toFixed(6), +lo.toFixed(6), String(nm).slice(0, 60)]);
      });
      if(!lines.length && !wp.length) throw new Error('no track, route or waypoint in it');
      GPX.push({name:file.name.slice(0, 60), lines:lines, wpts:wp});
      if(!store('ap_gpx', GPX)){ GPX.pop(); throw new Error('too large to keep on this device'); }
      drawGpx(true);
      paintPanel();
    }catch(err){ alert('Could not import ' + file.name + ': ' + err.message); }
  };
  r.readAsText(file);
}
function drawGpx(fit){
  if(!gpxLayer) return;
  var L = window.L, all = [];
  gpxLayer.clearLayers();
  GPX.forEach(function(g){
    g.lines.forEach(function(l){ L.polyline(l, {color:'#a855f7', weight:3.5, opacity:.9}).addTo(gpxLayer); all = all.concat(l); });
    g.wpts.forEach(function(w){
      L.circleMarker([w[0], w[1]], {radius:5, color:'#1e1b4b', weight:1.5, fillColor:'#c084fc', fillOpacity:1})
        .bindPopup('<div class="ap-pop"><div class="k">' + esc(g.name) + '</div><b>' + esc(w[2]) + '</b><div class="row">' +
                   '<button data-ap-goto="' + w[0] + ',' + w[1] + '" data-ap-name="' + esc(w[2]) + '">GO TO</button></div></div>')
        .addTo(gpxLayer);
      all.push([w[0], w[1]]);
    });
  });
  if(fit && all.length) map.fitBounds(L.latLngBounds(all), {maxZoom:15});
}

/* ------------------------------------------------------------ measure */
function measureClick(ll){
  var L = window.L;
  measure.pts.push([ll.lat, ll.lng]);
  if(!measure.line){
    measure.line = L.polyline([], {color:'#fbbf24', weight:3, dashArray:'4 6'}).addTo(map);
    measure.marks = L.layerGroup().addTo(map);
  }
  measure.line.setLatLngs(measure.pts);
  L.circleMarker(ll, {radius:4, color:'#fbbf24', weight:2, fillColor:'#0f172a', fillOpacity:1}).addTo(measure.marks);
  paintPanel();
}
function measureLen(){
  var d = 0;
  for(var i = 1; i < measure.pts.length; i++) d += dist(measure.pts[i-1], measure.pts[i]);
  return d;
}
function measureClear(){
  measure.pts = [];
  if(measure.line){ map.removeLayer(measure.line); map.removeLayer(measure.marks); measure.line = measure.marks = null; }
}

/* ------------------------------------------------------ map clicks */
function stopFollow(){
  if(!follow) return;
  follow = false;
  var b = $('apFollow'); if(b) b.classList.remove('on');
}
function onMapClick(e){
  stopFollow();
  if(measure.on){ measureClick(e.latlng); return; }
  var la = e.latlng.lat, lo = e.latlng.lng, t = onTrail([la, lo]);
  var html = '<div class="ap-pop"><div class="k">Point</div><b>' + ddm(la,'N','S',2) + ' ' + ddm(lo,'E','W',3) + '</b>' +
    '<div style="font:11px ui-monospace,monospace">' + usng(la, lo) + '</div>';
  if(t) html += '<div>Nearest trail: mile ≈ ' + t.mile.toFixed(1) + ', ' + fmtDist(t.off) + ' away</div>';
  if(me) html += '<div>From you: ' + fmtDist(dist([me.lat, me.lon], [la, lo])) + ' ' + card(bearing([me.lat, me.lon], [la, lo])) + '</div>';
  html += '<div class="row"><button data-ap-goto="' + la.toFixed(6) + ',' + lo.toFixed(6) + '" data-ap-name="Map point">GO TO</button>' +
          '<button data-ap-wpt="' + la.toFixed(6) + ',' + lo.toFixed(6) + '">SAVE WAYPOINT</button>' +
          '<button data-terrain="' + la.toFixed(5) + ',' + lo.toFixed(5) + '">TERRAIN + WEATHER</button></div></div>';
  window.L.popup({maxWidth:290}).setLatLng(e.latlng).setContent(html).openOn(map);
}

/* ----------------------------------------------------- offline maps */
var TILE_CACHE = 'tb-tiles-v1', SHELL_CACHE = 'tb-shell-v1';
var SHELL_FILES = ['./', 'assets/leaflet/leaflet.js', 'assets/leaflet/leaflet.css', 'assets/leaflet/images/layers.png',
                   'assets/leaflet/images/layers-2x.png', 'assets/appalachistan.js', 'assets/appalachia.json'];
var SAVED = load('ap_saved', []);
var job = null;
var MAX_TILES = 6000;
function lon2x(lon, z){ return Math.floor((lon + 180)/360*Math.pow(2, z)); }
function lat2y(lat, z){
  var r = lat*D;
  return Math.floor((1 - Math.log(Math.tan(r) + 1/Math.cos(r))/Math.PI)/2*Math.pow(2, z));
}
function tileUrl(tpl, z, x, y){ return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); }
function tilesForBounds(b, z0, z1){
  var out = [];
  for(var z = z0; z <= z1; z++){
    var x0 = lon2x(b[1], z), x1 = lon2x(b[3], z), y0 = lat2y(b[2], z), y1 = lat2y(b[0], z);
    for(var x = x0; x <= x1; x++) for(var y = y0; y <= y1; y++) out.push([z, x, y]);
    if(out.length > MAX_TILES*3) break;
  }
  return out;
}
/* A corridor either side of the trail between two miles, at every zoom. */
function tilesForCorridor(m0, m1, halfKm, z0, z1){
  if(!PATH) return [];
  var seen = {}, out = [];
  for(var z = z0; z <= z1; z++){
    for(var i = 0; i < PATH.length; i++){
      if(CUM[i] < m0 || CUM[i] > m1) continue;
      var p = PATH[i], dLat = halfKm/110.54, dLon = halfKm/(111.32*Math.cos(p[0]*D));
      var x0 = lon2x(p[1] - dLon, z), x1 = lon2x(p[1] + dLon, z), y0 = lat2y(p[0] + dLat, z), y1 = lat2y(p[0] - dLat, z);
      for(var x = x0; x <= x1; x++) for(var y = y0; y <= y1; y++){
        var k = z + '/' + x + '/' + y;
        if(!seen[k]){ seen[k] = 1; out.push([z, x, y]); }
      }
    }
    if(out.length > MAX_TILES*3) break;
  }
  return out;
}
function saveShell(){
  if(!('caches' in window)) return Promise.resolve();
  return caches.open(SHELL_CACHE).then(function(c){
    return Promise.all(SHELL_FILES.map(function(f){ return c.add(f).catch(function(){}); }));
  });
}
/* What a save downloads: the base map if it may be saved, plus the lidar
   hillshade when it is switched on. Each source stops at its own finest zoom. */
function saveSources(){
  var out = [], B = BASES[baseKey];
  if(B.save) out.push({name:B.name, max:B.max, kb:B.kb, url:function(z, x, y){ return tileUrl(B.url, z, x, y); }});
  if(lidarLayer && map && map.hasLayer(lidarLayer)) out.push({name:LIDAR.name, max:LIDAR.max, min:11, kb:LIDAR.kb, url:lidarUrl});
  return out;
}
function expand(tiles){
  var src = saveSources(), out = [];
  src.forEach(function(s){ tiles.forEach(function(t){ if(t[0] <= s.max && t[0] >= (s.min || 0)) out.push({s:s, t:t}); }); });
  return out;
}
function sizeOf(tiles){
  var src = saveSources(), n = 0, kb = 0;
  src.forEach(function(s){ tiles.forEach(function(t){ if(t[0] <= s.max && t[0] >= (s.min || 0)){ n++; kb += s.kb; } }); });
  return {n:n, mb:Math.round(kb/1024)};
}
function runSave(label, tiles0, bounds, zr){
  var src = saveSources();
  if(!src.length){ alert(BASES[baseKey].name + ' cannot be saved for offline use (its terms do not allow it). Switch to a USGS map, or turn on the lidar hillshade, with the layers button at the top right of the map.'); return; }
  var tiles = expand(tiles0);
  if(!('caches' in window)){ alert('This browser cannot store maps for offline use.'); return; }
  if(!tiles.length){ alert('Nothing to save here.'); return; }
  if(tiles.length > MAX_TILES){ alert(tiles.length.toLocaleString() + ' tiles is too many for one save (limit ' + MAX_TILES.toLocaleString() + '). Zoom in, lower the detail, or save a shorter stretch.'); return; }
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function(){});
  job = {label:label, total:tiles.length, done:0, ok:0, fail:0, cancel:false, err:''};
  paintPanel();
  saveShell().then(function(){ return caches.open(TILE_CACHE); }).then(function(cache){
    var i = 0;
    function worker(){
      if(job.cancel || i >= tiles.length) return Promise.resolve();
      var it = tiles[i++], t = it.t, url = it.s.url(t[0], t[1], t[2]);
      return caches.match(url).then(function(hit){
        if(hit){ job.ok++; return cache.put(url, hit); }    // move a browsed tile into the saved set
        return fetch(url, {mode:'cors', credentials:'omit'}).then(function(r){
          if(!r.ok) throw new Error('HTTP ' + r.status);
          job.ok++;
          return cache.put(url, r);
        });
      }).catch(function(e){
        job.fail++;
        if(job.ok === 0 && job.fail >= 12){
          job.cancel = true;
          job.err = navigator.onLine ? 'The map server refused the download (' + (e.message || e) + '). Try a different USGS map.'
                                     : 'No connection. Save maps while you still have signal.';
        }
      }).then(function(){ job.done++; if(job.done % 20 === 0 || job.done === job.total) paintPanel(); }).then(worker);
    }
    return Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  }).then(function(){
    if(job.ok){
      SAVED.push({label:label, layer:src.map(function(s){ return s.name; }).join(' + '), b:bounds, z:zr, n:job.ok, at:Date.now()});
      store('ap_saved', SAVED);
    }
    job.finished = true;
    paintPanel();
  });
}
/* --------------------------------------------------- signal catcher
   Out of signal, the page leans on what it saved. When a bar or two comes
   back it takes what it can, cheaply: the weather alerts and the next twelve
   hours' forecast for where you are (position rounded to about a kilometre,
   two small requests), and the USGS map for a few kilometres around you if
   that ground was never saved (about 1 MB). It asks only when the phone says
   it is connected, at most every 30 minutes after a success and every 10
   after a failure, never in data-saver mode, and in private mode only when
   you press CHECK NOW. The radio's own hunt for a tower is the phone's
   business; airplane mode is the way to stop that. */
var SIG = load('ap_sig', null), sigBusy = false, sigNext = 0, sigNote = '';
function sigMaybe(){
  if(sigBusy || Date.now() < sigNext || !navigator.onLine || !me) return;
  if(window.TB_PRIVATE || (navigator.connection && navigator.connection.saveData)) return;
  if(SIG && Date.now() - SIG.at < 30*60000 && dist([SIG.lat, SIG.lon], [me.lat, me.lon]) < 5000){ sigNext = SIG.at + 30*60000; return; }
  signalCheck(false);
}
function signalCheck(asked){
  if(sigBusy) return;
  var p = me ? [me.lat, me.lon] : (map ? [map.getCenter().lat, map.getCenter().lng] : null);
  if(!p){ sigNote = 'Open the map or turn on GPS first.'; paintPanel(); return; }
  if(!navigator.onLine){ sigNote = 'The phone reports no connection.'; paintPanel(); return; }
  var la = +p[0].toFixed(2), lo = +p[1].toFixed(2);
  sigBusy = true; sigNote = 'Checking\u2026'; if(asked) paintPanel();
  function get(u){
    var c = new AbortController(), t = setTimeout(function(){ c.abort(); }, 15000);
    return fetch(u, {signal:c.signal, credentials:'omit'}).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(function(){ clearTimeout(t); });
  }
  var nws = get('https://api.weather.gov/alerts/active?point=' + la + ',' + lo).then(function(d){
    return (d.features || []).map(function(f){ var q = f.properties || {}; return {e:q.event, h:q.headline, ends:q.ends || q.expires}; }).slice(0, 6);
  }).catch(function(){ return null; });
  var om = get('https://api.open-meteo.com/v1/forecast?latitude=' + la + '&longitude=' + lo +
               '&current=temperature_2m,weather_code,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,weather_code,wind_gusts_10m' +
               '&daily=sunset&forecast_hours=12&forecast_days=1&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto')
    .then(function(d){ return {now:d.current, hours:d.hourly, sunset:(d.daily && d.daily.sunset || [])[0]}; }).catch(function(){ return null; });
  Promise.all([nws, om]).then(function(r){
    sigBusy = false;
    if(r[0] == null && r[1] == null){
      sigNext = Date.now() + 10*60000;
      sigNote = 'The signal was too weak to fetch anything. It will try again when it can.';
      paintPanel(); return;
    }
    var old = SIG || {};
    SIG = {at:Date.now(), lat:la, lon:lo, alerts:r[0] != null ? r[0] : old.alerts, wx:r[1] || old.wx, part:r[0] == null || r[1] == null};
    store('ap_sig', SIG);
    sigNext = Date.now() + 30*60000;
    sigNote = '';
    grabAround(p);
    paintPanel();
  });
}
addEventListener('online', function(){ sigNext = 0; sigMaybe(); });

/* The USGS topo for about 6 km square around you, zoom 10-15, once per area. */
function grabAround(p){
  if((job && !job.finished) || !('caches' in window)) return;
  if(SAVED.filter(function(s){ return s.auto; }).length >= 20) return;     // about 25 MB of these is plenty
  var covered = SAVED.some(function(s){
    var m = /^AT miles (\d+)\D+(\d+)/.exec(s.label || '');
    if(m){ var t = onTrail(p); return t && t.off < 1200 && t.mile >= +m[1] && t.mile <= +m[2]; }
    return s.b && s.z && s.z[1] >= 14 && p[0] > s.b[0] && p[0] < s.b[2] && p[1] > s.b[1] && p[1] < s.b[3];
  });
  if(covered) return;
  var dLat = 3/110.54, dLon = 3/(111.32*Math.cos(p[0]*D)), T = BASES.topo;
  var b = [p[0] - dLat, p[1] - dLon, p[0] + dLat, p[1] + dLon], tiles = tilesForBounds(b, 10, 15), ok = 0, i = 0;
  caches.open(TILE_CACHE).then(function(cache){
    function worker(){
      if(i >= tiles.length) return Promise.resolve();
      var t = tiles[i++], url = tileUrl(T.url, t[0], t[1], t[2]);
      return caches.match(url).then(function(hit){
        if(hit){ ok++; return cache.put(url, hit); }
        return fetch(url, {mode:'cors', credentials:'omit'}).then(function(r){ if(!r.ok) throw 0; ok++; return cache.put(url, r); });
      }).catch(function(){}).then(worker);
    }
    return Promise.all([worker(), worker(), worker()]);
  }).then(function(){
    if(ok < tiles.length*0.8) return;              // a half-saved square would only mislead
    SAVED.push({label:'Around you, saved when signal appeared', layer:T.name, b:b, z:[10, 15], n:ok, at:Date.now(), auto:true});
    store('ap_saved', SAVED);
    paintPanel();
  }).catch(function(){});
}
function sigBlock(){
  var h = '<h4>FROM THE OUTSIDE</h4>';
  if(!SIG) h += '<div class="ap-dim">Nothing fetched yet. When the phone has signal, the page picks up weather alerts and a forecast for where you are, and saves the map around you.</div>';
  else {
    var age = Math.round((Date.now() - SIG.at)/60000);
    h += '<div class="ap-dim">Last heard ' + (age < 60 ? age + ' min' : Math.round(age/60) + ' h') + ' ago, for about ' + SIG.lat.toFixed(2) + ', ' + SIG.lon.toFixed(2) +
         (SIG.part ? ' (partly: one source did not answer)' : '') + '.</div>';
    if(SIG.alerts && SIG.alerts.length){
      h += '<div class="ap-list">' + SIG.alerts.map(function(a){
        return '<div class="ap-li"><span><b class="ap-bad">' + esc(a.e || 'Alert') + '</b> <small>' + esc((a.h || '').slice(0, 140)) + '</small></span></div>'; }).join('') + '</div>';
    } else if(SIG.alerts) h += '<div>No weather alerts here (National Weather Service).</div>';
    var w = SIG.wx;
    if(w && w.now){
      var hrs = w.hours || {}, rows = [];
      (hrs.time || []).forEach(function(t, k){ if(k % 3 === 0) rows.push(t.slice(11, 16) + ' ' + Math.round(hrs.temperature_2m[k]) + '\u00b0F ' +
        (hrs.precipitation_probability[k] != null ? hrs.precipitation_probability[k] + '% rain' : '') + (hrs.wind_gusts_10m[k] > 25 ? ', gusts ' + Math.round(hrs.wind_gusts_10m[k]) + ' mph' : '')); });
      h += '<div>Then: ' + Math.round(w.now.temperature_2m) + '\u00b0F, gusts ' + Math.round(w.now.wind_gusts_10m) + ' mph' +
           (w.sunset ? ' &middot; sunset ' + esc(String(w.sunset).slice(11, 16)) : '') + ' <small class="ap-dim">(local time, Open-Meteo)</small></div>';
      if(rows.length) h += '<div class="ap-dim">' + rows.map(esc).join(' &middot; ') + '</div>';
    }
  }
  h += '<div class="ap-row"><button class="ap-btn" data-act="sig-check"' + (sigBusy ? ' disabled' : '') + '>CHECK NOW</button>' +
       '<span class="ap-dim">' + esc(sigNote || (navigator.onLine ? 'The phone reports a connection.' : 'The phone reports no connection.')) + '</span></div>';
  return h;
}
function storageLine(el){
  if(!navigator.storage || !navigator.storage.estimate){ el.textContent = ''; return; }
  navigator.storage.estimate().then(function(e){
    var used = (e.usage || 0)/1048576, q = (e.quota || 0)/1048576;
    var persisted = navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(null);
    persisted.then(function(p){
      el.innerHTML = 'Using <b>' + used.toFixed(0) + ' MB</b> of ' + (q > 10240 ? (q/1024).toFixed(0) + ' GB' : q.toFixed(0) + ' MB') +
        ' allowed on this device' + (p === true ? ' &middot; <b>protected from automatic clean-up</b>'
          : p === false ? ' &middot; <span class="ap-warn">the browser may clear it if the device runs low on space</span>' : '');
    });
  }).catch(function(){});
}

/* ------------------------------------------------------------ routes
   PLAN A WALKING ROUTE to the GO TO destination. Planning needs signal once:
   the paths, roads and streams for the area come from OpenStreetMap
   (Overpass), and the ground's height from the AWS terrain tiles. Two routes
   are worked out on the phone, with no model and no server of ours:
   - TRAILS AND ROADS: a shortest-time path over the mapped network, with
     straight off-trail legs only to reach it from a start or end that is not
     on a path;
   - OVER THE GROUND: the quickest way across a ~30 m grid of the terrain,
     using paths where they help and cutting across where the slope allows.
   Walking speed is Tobler's hiking function on the slope, times 0.6 off
   trail. Off-trail ground steeper than 30 degrees and rivers without a bridge
   are treated as impassable. What no data can see -- rhododendron thickets,
   blowdowns, posted land -- is said plainly, not guessed at.
   The chosen route, its analysis and the map along it are kept on the phone. */
var ROUTE = load('ap_route', null), routeLayer = null, plan = null;
var OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
                'https://overpass.private.coffee/api/interpreter'];
var ELEV = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';
var CLS_NAME = ['trail', 'forest road or track', 'road', 'quiet road', 'off-trail', 'drive'];
var CLS_SPEED = [0.9, 1.0, 1.0, 1.0, 0.6, 1.0];
var CLS_COLOR = ['#22c55e', '#a3e635', '#94a3b8', '#cbd5e1', '#facc15', '#60a5fa'];
var OFF = 4, MAX_OFF_SLOPE = 0.58;                       // tan 30 degrees
function tobler(S){ return 6*Math.exp(-3.5*Math.abs(S + 0.05))/3.6; }   // metres a second on a path
function hwClass(h){
  if(/^(path|footway|bridleway|steps|pedestrian)$/.test(h)) return 0;
  if(h === 'track') return 1;
  if(/^(primary|secondary|tertiary)(_link)?$/.test(h)) return 2;
  if(/^(unclassified|residential|service|living_street|road)$/.test(h)) return 3;
  return -1;
}
function planNote(t){ if(plan) plan.note = t; paintPanel(); }
function timed(u, opt, ms){
  var c = new AbortController(), t = setTimeout(function(){ c.abort(); }, ms);
  return fetch(u, Object.assign({signal:c.signal, credentials:'omit'}, opt || {})).finally(function(){ clearTimeout(t); });
}

/* OpenStreetMap paths, roads, streams, springs and shelters in the box. */
function osmBox(b, wide){
  var bb = '(' + [b[0], b[1], b[2], b[3]].map(function(v){ return v.toFixed(5); }).join(',') + ')';
  var q = '[out:json][timeout:' + (wide ? 120 : 60) + '];(' +
    'way["highway"~"^(path|footway|bridleway|' + (wide ? '' : 'steps|pedestrian|service|living_street|') + 'track|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|road)$"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"]' + bb + ';' +
    'way["waterway"~"^(' + (wide ? 'river' : 'river|stream|canal') + ')$"]' + bb + ';' +
    'node["natural"="spring"]' + bb + ';node["amenity"~"^(drinking_water|shelter)$"]' + bb + ';' +
    'node["barrier"~"^(gate|lift_gate|swing_gate|chain)$"]' + bb + ';' +
    ');out tags geom qt;';
  var i = 0;
  function next(){
    if(i >= OVERPASS.length) return Promise.reject(new Error('no OpenStreetMap server answered'));
    var u = OVERPASS[i++];
    return timed(u, {method:'POST', body:'data=' + encodeURIComponent(q), headers:{'Content-Type':'application/x-www-form-urlencoded'}}, 70000)
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(next);
  }
  return next();
}

/* Terrain heights for the box from the terrarium tiles, decoded on the phone. */
function lon2px(lon, z){ return (lon + 180)/360*Math.pow(2, z)*256; }
function lat2px(lat, z){ var r = lat*D; return (1 - Math.log(Math.tan(r) + 1/Math.cos(r))/Math.PI)/2*Math.pow(2, z)*256; }
function demFor(b){
  var z = 14;
  while(z > 10 && (lon2x(b[3], z) - lon2x(b[1], z) + 1)*(lat2y(b[0], z) - lat2y(b[2], z) + 1) > 30) z--;
  var x0 = lon2x(b[1], z), x1 = lon2x(b[3], z), y0 = lat2y(b[2], z), y1 = lat2y(b[0], z);
  var W = (x1 - x0 + 1)*256, H = (y1 - y0 + 1)*256, data = new Float32Array(W*H).fill(NaN);
  var jobs = [], done = 0, total = (x1 - x0 + 1)*(y1 - y0 + 1);
  for(var x = x0; x <= x1; x++) for(var y = y0; y <= y1; y++) jobs.push([x, y]);
  var cv = document.createElement('canvas'); cv.width = cv.height = 256;
  var cx = cv.getContext('2d', {willReadFrequently:true});
  function one(j){
    return new Promise(function(res){
      var im = new Image(), t = setTimeout(function(){ res(); }, 15000);
      im.crossOrigin = 'anonymous';
      im.onload = function(){
        clearTimeout(t);
        try{
          cx.clearRect(0, 0, 256, 256); cx.drawImage(im, 0, 0);
          var px = cx.getImageData(0, 0, 256, 256).data, ox = (j[0] - x0)*256, oy = (j[1] - y0)*256;
          for(var r = 0; r < 256; r++) for(var c = 0; c < 256; c++){
            var k = (r*256 + c)*4;
            data[(oy + r)*W + ox + c] = px[k]*256 + px[k+1] + px[k+2]/256 - 32768;
          }
        }catch(_){}
        res();
      };
      im.onerror = function(){ clearTimeout(t); res(); };
      im.src = ELEV + z + '/' + j[0] + '/' + j[1] + '.png';
    }).then(function(){ done++; if(done % 4 === 0 || done === total) planNote('Getting the lie of the land: ' + done + ' of ' + total + ' terrain tiles…'); });
  }
  var k = 0;
  function worker(){ return k >= jobs.length ? Promise.resolve() : one(jobs[k++]).then(worker); }
  return Promise.all([worker(), worker(), worker(), worker()]).then(function(){
    var have = 0; for(var i = 0; i < data.length; i += 997) if(data[i] === data[i]) have++;
    if(!have) throw new Error('no terrain tiles arrived');
    return {z:z, ox:x0*256, oy:y0*256, W:W, H:H, data:data, sample:function(lat, lon){
      var fx = lon2px(lon, z) - this.ox, fy = lat2px(lat, z) - this.oy;
      var ix = Math.floor(fx), iy = Math.floor(fy);
      if(ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) return null;
      var a = data[iy*W + ix], bq = data[iy*W + ix + 1], c = data[(iy + 1)*W + ix], d = data[(iy + 1)*W + ix + 1];
      if(a !== a || bq !== bq || c !== c || d !== d) return null;
      var tx = fx - ix, ty = fy - iy;
      return a*(1 - tx)*(1 - ty) + bq*tx*(1 - ty) + c*(1 - tx)*ty + d*tx*ty;
    }};
  });
}

/* A small binary heap of [priority, value]. */
function Heap(){ this.p = []; this.v = []; }
Heap.prototype.push = function(pr, val){
  var p = this.p, v = this.v, i = p.length; p.push(pr); v.push(val);
  while(i > 0){ var j = (i - 1) >> 1; if(p[j] <= pr) break; p[i] = p[j]; v[i] = v[j]; i = j; }
  p[i] = pr; v[i] = val;
};
Heap.prototype.pop = function(){
  var p = this.p, v = this.v, top = v[0], lp = p.pop(), lv = v.pop(), n = p.length;
  if(n){
    var i = 0;
    while(true){
      var l = 2*i + 1, r = l + 1, m = i, mp = lp;
      if(l < n && p[l] < mp){ m = l; mp = p[l]; }
      if(r < n && p[r] < mp){ m = r; mp = p[r]; }
      if(m === i) break;
      p[i] = p[m]; v[i] = v[m]; i = m;
    }
    p[i] = lp; v[i] = lv;
  }
  return top;
};
Heap.prototype.size = function(){ return this.p.length; };

/* Seconds to walk a to b (each [lat, lon]) on class cls, sampling the ground
   every ~25 m; Infinity where the ground is too steep to walk off trail. */
function legTime(a, b, cls, dem, pl){
  var d = dist(a, b), n = Math.max(1, Math.ceil(d/25)), t = 0, prev = dem.sample(a[0], a[1]);
  for(var i = 1; i <= n; i++){
    var la = a[0] + (b[0] - a[0])*i/n, lo = a[1] + (b[1] - a[1])*i/n, h = dem.sample(la, lo), s = d/n;
    var S = (h != null && prev != null) ? (h - prev)/s : 0;
    if(cls === OFF && Math.abs(S) > MAX_OFF_SLOPE) return Infinity;
    var tier = pl && cls === OFF ? pubAt(pl, la, lo) : 2;
    if(tier === 0 && !nearEnd(la, lo)) return Infinity;
    t += s/(tobler(S)*CLS_SPEED[cls])*COST[tier];
    if(h != null) prev = h;
  }
  return t;
}

/* Route 1: over the mapped network. */
function netRoute(A, B, osm, dem, pl){
  var key = {}, lat = [], lon = [], adj = [], WAYS = [], NP = [];
  function np(i){ if(NP[i] == null) NP[i] = landAt(pl, lat[i], lon[i]); return NP[i]; }
  function node(p){
    var k = p.lat.toFixed(6) + ',' + p.lon.toFixed(6);
    if(key[k] == null){ key[k] = lat.length; lat.push(p.lat); lon.push(p.lon); adj.push([]); }
    return key[k];
  }
  osm.elements.forEach(function(e){
    if(e.type !== 'way' || !e.geometry || !e.tags || !e.tags.highway) return;
    var cls = hwClass(e.tags.highway); if(cls < 0) return;
    var wi = WAYS.length;
    var wt = wayTier(e.tags);
    WAYS.push({cls:cls, name:e.tags.name || e.tags.ref || '', bridge:!!e.tags.bridge && e.tags.bridge !== 'no', ford:e.tags.ford === 'yes', wt:wt});
    for(var i = 1; i < e.geometry.length; i++){
      var u = node(e.geometry[i-1]), v = node(e.geometry[i]);
      if(u === v) continue;
      var a = [lat[u], lon[u]], b = [lat[v], lon[v]], tr = pl ? Math.max(Math.min(np(u).t, np(v).t), wt.t) : 2;
      if(tr === 0 && !nearEnd(a[0], a[1]) && !nearEnd(b[0], b[1])) continue;     // private: not walkable
      var pen = COST[tr];
      adj[u].push([v, legTime(a, b, cls, dem)*pen, wi]); adj[v].push([u, legTime(b, a, cls, dem)*pen, wi]);
    }
  });
  if(!lat.length) return null;
  /* the ends: straight off-trail legs to the 8 nearest path points within 1.5 km */
  function ends(P, toward){
    var c = [];
    for(var i = 0; i < lat.length; i++){ var d = dist(P, [lat[i], lon[i]]); if(d < 1500) c.push([d, i]); }
    c.sort(function(x, y){ return x[0] - y[0]; });
    return c.slice(0, 8).map(function(x){
      var t = x[0] < 15 ? 0 : (toward ? legTime(P, [lat[x[1]], lon[x[1]]], OFF, dem, pl) : legTime([lat[x[1]], lon[x[1]]], P, OFF, dem, pl));
      return [x[1], t];
    }).filter(function(x){ return isFinite(x[1]); });
  }
  var sa = ends(A, true), sb = ends(B, false);
  if(!sa.length || !sb.length) return {fail:!sa.length ? 'start' : 'end'};
  var N = lat.length, best = new Float64Array(N + 1).fill(Infinity), from = new Int32Array(N + 1).fill(-1), via = new Int32Array(N + 1).fill(-1);
  var GOAL = N, endT = {}; sb.forEach(function(x){ endT[x[0]] = x[1]; });
  var h = new Heap();
  sa.forEach(function(x){ best[x[0]] = x[1]; from[x[0]] = -2; h.push(x[1], x[0]); });
  while(h.size()){
    var u = h.pop();
    if(u === GOAL) break;
    var bu = best[u];
    if(endT[u] != null && bu + endT[u] < best[GOAL]){ best[GOAL] = bu + endT[u]; from[GOAL] = u; h.push(best[GOAL], GOAL); }
    var ed = adj[u];
    for(var k = 0; k < ed.length; k++){
      var v = ed[k][0], nt = bu + ed[k][1];
      if(nt < best[v]){ best[v] = nt; from[v] = u; via[v] = ed[k][2]; h.push(nt, v); }
    }
  }
  if(!isFinite(best[GOAL])) return {fail:'link'};
  var seq = [], cur = from[GOAL];
  while(cur >= 0){ seq.push(cur); cur = from[cur]; }
  seq.reverse();
  var pts = [[A[0], A[1], null, OFF, '']];
  seq.forEach(function(n, i){
    var w = via[n] >= 0 && i > 0 ? WAYS[via[n]] : null;
    if(i > 0 && w){
      var ln = pl ? np(n) : LAND_ANY, lvl = pl ? 2 - Math.max(ln.t, w.wt.t) : 0;
      pts.push([lat[n], lon[n], null, w.cls, w.name, w.bridge, w.ford, lvl, lvl ? (w.wt.t >= ln.t && w.wt.why ? w.wt.why : ln.why) : '']);
    }
    else pts.push([lat[n], lon[n], null, OFF, '']);
  });
  pts.push([B[0], B[1], null, OFF, '']);
  return {kind:'net', pts:densify(pts, dem, pl)};
}
/* Off-trail legs are drawn straight; give them points every ~25 m so the
   profile and the steepness checks see the ground they cross. */
function densify(pts, dem, pl){
  var out = [];
  pts.forEach(function(p, i){
    if(i){
      var q = pts[i-1], d = dist([q[0], q[1]], [p[0], p[1]]), n = Math.floor(d/25);
      for(var k = 1; k < n; k++) out.push([q[0] + (p[0] - q[0])*k/n, q[1] + (p[1] - q[1])*k/n, null, p[3], p[4], p[5], p[6], Math.min(p[7] || 0, q[7] || 0), p[8] || '']);
    }
    out.push(p);
  });
  out.forEach(function(p){ p[2] = dem.sample(p[0], p[1]); if(pl && p[3] === OFF){ var l = landAt(pl, p[0], p[1]); p[7] = 2 - l.t; p[8] = p[7] ? l.why : ''; } });
  return out;
}

/* Route 2: over the ground, on a grid of ~30 m cells. */
function gridRoute(A, B, b, osm, dem, pl){
  var lat0 = (b[0] + b[2])/2, mx = 111320*Math.cos(lat0*D), my = 110540;
  var Wm = (b[3] - b[1])*mx, Hm = (b[2] - b[0])*my, cs = Math.max(25, Math.sqrt(Wm*Hm/160000));
  var nx = Math.ceil(Wm/cs), ny = Math.ceil(Hm/cs), n = nx*ny;
  var E = new Float32Array(n), P = new Int8Array(n).fill(-1), WT = new Uint8Array(n), BR = new Uint8Array(n), OKP = new Uint8Array(n), OKW = {};
  function cell(la, lo){ var i = Math.floor((lo - b[1])*mx/cs), j = Math.floor((la - b[0])*my/cs); return (i < 0 || j < 0 || i >= nx || j >= ny) ? -1 : j*nx + i; }
  function cLat(c){ return b[0] + (Math.floor(c/nx) + 0.5)*cs/my; }
  function cLon(c){ return b[1] + (c%nx + 0.5)*cs/mx; }
  for(var c = 0; c < n; c++){ var e = dem.sample(cLat(c), cLon(c)); E[c] = e == null ? NaN : e; }
  var names = {};
  (osm ? osm.elements : []).forEach(function(e){
    if(e.type !== 'way' || !e.geometry || !e.tags) return;
    var cls = e.tags.highway ? hwClass(e.tags.highway) : -1, wt = e.tags.waterway === 'river' ? 2 : e.tags.waterway ? 1 : 0;
    if(cls < 0 && !wt) return;
    var br = e.tags.bridge && e.tags.bridge !== 'no', wtr = cls >= 0 ? wayTier(e.tags) : null;
    for(var i = 1; i < e.geometry.length; i++){
      var a = e.geometry[i-1], q = e.geometry[i], d = dist([a.lat, a.lon], [q.lat, q.lon]), k = Math.max(1, Math.ceil(d/(cs/2)));
      for(var s = 0; s <= k; s++){
        var cc = cell(a.lat + (q.lat - a.lat)*s/k, a.lon + (q.lon - a.lon)*s/k); if(cc < 0) continue;
        if(cls >= 0){ if(P[cc] < 0 || cls < P[cc]) { P[cc] = cls; if(e.tags.name || e.tags.ref) names[cc] = e.tags.name || e.tags.ref; } if(br) BR[cc] = 1; if(wtr && wtr.t >= OKP[cc]){ OKP[cc] = wtr.t; if(wtr.why) OKW[cc] = wtr.why; } }
        if(wt && wt > WT[cc]) WT[cc] = wt;
      }
    }
  });
  var s0 = cell(A[0], A[1]), g = cell(B[0], B[1]);
  if(s0 < 0 || g < 0) return null;
  var PR = pl ? pubRaster(pl, b, nx, ny, cs, mx, my) : null, PUB = PR && PR.t;
  function lvl(c, on){ return PUB ? 2 - Math.max(PUB[c], on ? OKP[c] : 0) : 0; }
  var NEAR = new Uint8Array(n), rc = Math.ceil(END_R/cs);
  [A, B].forEach(function(P){
    var c0 = cell(P[0], P[1]); if(c0 < 0) return;
    var ci = c0%nx, cj = Math.floor(c0/nx);
    for(var dj = -rc; dj <= rc; dj++) for(var di = -rc; di <= rc; di++){
      var ii = ci + di, jj = cj + dj; if(ii < 0 || jj < 0 || ii >= nx || jj >= ny || di*di + dj*dj > rc*rc) continue;
      NEAR[jj*nx + ii] = 1;
    }
  });
  var G = new Float64Array(n).fill(Infinity), FROM = new Int32Array(n).fill(-1), CLOSED = new Uint8Array(n);
  var gi = g%nx, gj = Math.floor(g/nx), VMAX = tobler(-0.05);
  var h = new Heap(); G[s0] = 0; h.push(0, s0);
  var DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  while(h.size()){
    var u = h.pop(); if(CLOSED[u]) continue; CLOSED[u] = 1;
    if(u === g) break;
    var ui = u%nx, uj = Math.floor(u/nx);
    for(var k = 0; k < 8; k++){
      var vi = ui + DI[k], vj = uj + DJ[k]; if(vi < 0 || vj < 0 || vi >= nx || vj >= ny) continue;
      var v = vj*nx + vi; if(CLOSED[v]) continue;
      var onPath = P[u] >= 0 && P[v] >= 0, cls = onPath ? Math.max(P[u], P[v]) : OFF;
      if(WT[v] === 2 && !(P[v] >= 0 && BR[v])) continue;           // a river: only on a bridge
      var d = k < 4 ? cs : cs*Math.SQRT2, S = (E[v] === E[v] && E[u] === E[u]) ? (E[v] - E[u])/d : 0;
      if(!onPath && Math.abs(S) > MAX_OFF_SLOPE) continue;
      var lv = PUB ? lvl(v, onPath) : 0;
      if(lv === 2 && STRICT && !NEAR[v]) continue;                 // private: not walkable
      var t = G[u] + d/(tobler(S)*CLS_SPEED[cls])*COST[2 - lv] + (WT[v] === 1 && !onPath ? 20 : 0);
      if(t < G[v]){ G[v] = t; FROM[v] = u;
        var hx = (vi - gi)*cs, hy = (vj - gj)*cs; h.push(t + Math.sqrt(hx*hx + hy*hy)/VMAX, v); }
    }
  }
  if(!isFinite(G[g])) return {fail:'link'};
  var seq = [], cur = g; while(cur >= 0){ seq.push(cur); cur = FROM[cur]; } seq.reverse();
  var pts = seq.map(function(c, i){
    var on = P[c] >= 0 && (i === 0 || P[seq[i-1]] >= 0);
    var lv = lvl(c, on), why = '';
    if(lv) why = on && OKP[c] >= PUB[c] && OKW[c] ? OKW[c] : PR.w[c] >= 0 ? pl.polys[PR.w[c]].why : LAND0.why;
    return [cLat(c), cLon(c), E[c] === E[c] ? E[c] : null, on ? P[c] : OFF, on ? (names[c] || '') : '', !!BR[c], false, lv, why];
  });
  pts[0][0] = A[0]; pts[0][1] = A[1]; pts[pts.length-1][0] = B[0]; pts[pts.length-1][1] = B[1];
  return {kind:'grid', pts:thin(pts, cs*0.4), cell:Math.round(cs)};
}
/* Drop grid points that add nothing, but never across a change of class. */
function thin(pts, tol){
  var keep = [pts[0]];
  for(var i = 1; i < pts.length - 1; i++){
    var a = keep[keep.length-1], p = pts[i], q = pts[i+1];
    if(p[3] !== a[3] || q[3] !== p[3] || p[4] !== a[4] || (p[7] || 0) !== (a[7] || 0) || (q[7] || 0) !== (p[7] || 0)){ keep.push(p); continue; }
    var dx = q[1] - a[1], dy = q[0] - a[0], L2 = dx*dx + dy*dy;
    var t = L2 ? ((p[1] - a[1])*dx + (p[0] - a[0])*dy)/L2 : 0;
    var off = dist([p[0], p[1]], [a[0] + dy*t, a[1] + dx*t]);
    if(off > tol || dist([a[0], a[1]], [p[0], p[1]]) > 150) keep.push(p);
  }
  keep.push(pts[pts.length-1]);
  return keep;
}

/* Everything worth knowing about a route, worked out once and kept. */
function analyse(r, osm, dem, to){
  var pts = r.pts, n = pts.length, cum = [0], tcum = [0], up = 0, down = 0, ref = null, lo = Infinity, hi = -Infinity;
  var byCls = [0, 0, 0, 0, 0, 0], steep = [], cue = [], crossings = [], near = [], priv = [], privM = 0, ques = [], quesM = 0;
  for(var i = 1; i < n; i++){
    var a = pts[i-1], b = pts[i], d = dist([a[0], a[1]], [b[0], b[1]]);
    var S = (a[2] != null && b[2] != null && d > 0) ? (b[2] - a[2])/d : 0;
    cum.push(cum[i-1] + d);
    tcum.push(tcum[i-1] + (d ? d/(tobler(S)*CLS_SPEED[b[3]]) : 0));
    byCls[b[3]] += d;
    if(b[7] === 2 || b[7] === true){ privM += d; var lp = priv[priv.length-1]; if(lp && cum[i-1] - lp.b < 60) lp.b = cum[i]; else priv.push({a:cum[i-1], b:cum[i], why:b[8] || ''}); }
    else if(b[7] === 1){ quesM += d; var lq = ques[ques.length-1]; if(lq && cum[i-1] - lq.b < 60 && lq.why === (b[8] || '')) lq.b = cum[i]; else ques.push({a:cum[i-1], b:cum[i], why:b[8] || ''}); }
  }
  priv = priv.filter(function(x){ return x.b - x.a >= 20; });
  ques = ques.filter(function(x){ return x.b - x.a >= 20; });
  pts.forEach(function(p){
    if(p[2] == null) return;
    lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]);
    if(ref == null){ ref = p[2]; return; }
    if(p[2] - ref >= 3){ up += p[2] - ref; ref = p[2]; } else if(ref - p[2] >= 3){ down += ref - p[2]; ref = p[2]; }
  });
  /* grade over ~100 m windows, and stretches steeper than 25 degrees */
  var maxUp = 0, maxDn = 0, atUp = 0, atDn = 0, j = 0, run = null;
  for(var i2 = 0; i2 < n; i2++){
    while(j < n - 1 && cum[j] - cum[i2] < 100) j++;
    if(pts[i2][2] == null || pts[j][2] == null || cum[j] - cum[i2] < 50) continue;
    var gr = (pts[j][2] - pts[i2][2])/(cum[j] - cum[i2]);
    if(gr > maxUp){ maxUp = gr; atUp = cum[i2]; }
    if(-gr > maxDn){ maxDn = -gr; atDn = cum[i2]; }
    if(Math.abs(gr) > 0.47){ if(!run) run = {a:cum[i2], b:cum[j], g:Math.abs(gr), cls:pts[j][3]}; else { run.b = cum[j]; run.g = Math.max(run.g, Math.abs(gr)); } }
    else if(run && cum[i2] > run.b){ steep.push(run); run = null; }
  }
  if(run) steep.push(run);
  /* the cue sheet: runs of one way */
  var c0 = 0;
  for(var i3 = 1; i3 <= n; i3++){
    if(i3 === n || pts[i3][3] !== pts[c0 + 1 < n ? c0 + 1 : c0][3] || (pts[i3][4] || '') !== (pts[Math.min(c0 + 1, n - 1)][4] || '')){
      var seg = pts[Math.min(c0 + 1, n - 1)], len = cum[i3 - 1] - cum[c0];
      if(len > 30){
        var last = cue[cue.length-1];
        if(last && last.cls === seg[3] && last.name === (seg[4] || '')) last.len += len;
        else cue.push({at:cum[c0], len:len, cls:seg[3], name:seg[4] || ''});
      }
      c0 = i3 - 1;
    }
  }
  /* stream crossings: route segments that cross a mapped waterway */
  if(osm){
    var buckets = {}, BK = 0.004;
    osm.elements.forEach(function(e){
      if(e.type !== 'way' || !e.tags || !e.tags.waterway || !e.geometry) return;
      for(var k = 1; k < e.geometry.length; k++){
        var p = e.geometry[k-1], q = e.geometry[k], key = Math.floor(p.lat/BK) + ',' + Math.floor(p.lon/BK);
        (buckets[key] = buckets[key] || []).push([p.lat, p.lon, q.lat, q.lon, e.tags.waterway, e.tags.name || '']);
      }
    });
    var seen = {};
    for(var i4 = 1; i4 < n; i4++){
      var A1 = pts[i4-1], B1 = pts[i4];
      for(var di = -1; di <= 1; di++) for(var dj = -1; dj <= 1; dj++){
        var list = buckets[(Math.floor(B1[0]/BK) + di) + ',' + (Math.floor(B1[1]/BK) + dj)]; if(!list) continue;
        list.forEach(function(w){
          if(segX(A1[0], A1[1], B1[0], B1[1], w[0], w[1], w[2], w[3])){
            var mile = Math.round(cum[i4]/160.9344)/10, k2 = w[5] + '@' + mile;
            if(seen[k2]) return; seen[k2] = 1;
            crossings.push({at:cum[i4], kind:w[4], name:w[5], bridge:!!B1[5], ford:!!B1[6]});
          }
        });
      }
    }
  }
  /* water, shelters, trailheads and roads near the line */
  var cand = POIS.filter(function(p){ return /^(water|shelter|trailhead|camp|town)$/.test(p.k); })
    .map(function(p){ return {lat:p.lat, lon:p.lon, k:p.k, name:p.name}; });
  if(osm) osm.elements.forEach(function(e){
    if(e.type !== 'node' || !e.tags) return;
    var k = e.tags.natural === 'spring' ? 'water' : e.tags.amenity === 'drinking_water' ? 'water' : e.tags.amenity === 'shelter' ? 'shelter' : null;
    if(k) cand.push({lat:e.lat, lon:e.lon, k:k, name:e.tags.name || (k === 'water' ? 'spring' : 'shelter')});
  });
  cand.forEach(function(p){
    var bd = Infinity, bi = 0;
    for(var i5 = 0; i5 < n; i5 += 2){ var d5 = dist([p.lat, p.lon], [pts[i5][0], pts[i5][1]]); if(d5 < bd){ bd = d5; bi = i5; } }
    if(bd < 250) near.push({at:cum[bi], off:bd, k:p.k, name:p.name});
  });
  near.sort(function(x, y){ return x.at - y.at; });
  var gates = [];
  if(osm) osm.elements.forEach(function(e){
    if(e.type !== 'node' || !e.tags || !e.tags.barrier) return;
    for(var ig = 0; ig < n; ig++) if(dist([e.lat, e.lon], [pts[ig][0], pts[ig][1]]) < 12){
      gates.push({at:cum[ig], closed:/^(private|no)$/.test(e.tags.access || '') || e.tags.locked === 'yes'}); break;
    }
  });
  near = near.filter(function(x, i){ return !i || x.name !== near[i-1].name || x.at - near[i-1].at > 200; });
  var roads = [];
  for(var i6 = 1; i6 < n; i6++) if((pts[i6][3] === 2 || pts[i6][3] === 3) && pts[i6-1][3] !== 2 && pts[i6-1][3] !== 3)
    roads.push({at:cum[i6], name:pts[i6][4] || 'a road', busy:pts[i6][3] === 2});
  /* drop-offs: ground over 45 degrees within ~30 m of the line */
  var cliffs = [], lastCliff = -1e9;
  for(var i7 = 0; i7 < n; i7 += 2){
    var p7 = pts[i7], h0 = p7[2]; if(h0 == null) continue;
    var dl = 30/110540, dk = 30/(111320*Math.cos(p7[0]*D));
    [[dl, 0], [-dl, 0], [0, dk], [0, -dk]].some(function(o){
      var h1 = dem.sample(p7[0] + o[0], p7[1] + o[1]);
      if(h1 != null && Math.abs(h1 - h0)/30 > 1 && cum[i7] - lastCliff > 300){ cliffs.push({at:cum[i7]}); lastCliff = cum[i7]; return true; }
      return false;
    });
  }
  var total = cum[n-1], secs = tcum[n-1], sun = sunDay(to[0], to[1]), eta = Date.now() + secs*1000;
  return {gates:gates, priv:priv, privM:privM, ques:ques, quesM:quesM, d:total, t:secs, up:up, down:down, lo:isFinite(lo) ? lo : null, hi:isFinite(hi) ? hi : null,
          maxUp:maxUp, atUp:atUp, maxDn:maxDn, atDn:atDn, byCls:byCls, steep:steep, cue:cue, crossings:crossings,
          near:near, roads:roads, cliffs:cliffs, cum:cum, tcum:tcum, sunset:sun.set, dusk:sun.dusk, eta:eta};
}
function segX(a1, b1, a2, b2, c1, d1, c2, d2){
  function o(p1, q1, p2, q2, r1, s1){ return (p2 - p1)*(s1 - q1) - (q2 - q1)*(r1 - p1); }
  var o1 = o(a1, b1, a2, b2, c1, d1), o2 = o(a1, b1, a2, b2, c2, d2), o3 = o(c1, d1, c2, d2, a1, b1), o4 = o(c1, d1, c2, d2, a2, b2);
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/* --------------------------------------------------- route settings
   ON FOOT: ANYWHERE ignores who owns the land. PUBLIC LAND ONLY keeps to land
   the public may walk: Forest Service land (its own ownership map, which
   shows the private inholdings inside a national forest) and areas PAD-US
   lists as open access, plus public roads and paths marked open. Off-trail
   is fine there. Private land costs forty times the time, so a route crosses
   it only where there is no way round, and then says where.
   GETTING THERE: DRIVE, THEN WALK drives public roads (OpenStreetMap, worked
   out on the phone) to the best place to leave the car, then walks in. */
var RMODE = load('ap_rmode', {pub:false, drive:false});
/* Three levels, not two. 2 = truly public: Forest Service-owned land, PAD-US
   open-access land owned by a government, public roads, paths tagged for the
   public. 1 = questionable: PAD-US restricted (permit, season, fee) or
   unknown access, easements and open access on private or NGO-owned land,
   paths tagged permissive or with no access tags. 0 = private or closed.
   PAD-US "Proclamation" areas (a national forest's outer boundary, private
   inholdings and all) are never counted. Each level has its cost: */
var COST = [40, 6, 1];
/* PUBLIC LAND ONLY is strict: private land cannot be walked at all, except
   within 250 m of the start or the destination (your own land, where you
   parked). Public roads across private land stay walkable. */
var END = [], END_R = 250, STRICT = true;
function nearEnd(la, lo){ if(!STRICT) return true; for(var i = 0; i < END.length; i++) if(dist(END[i], [la, lo]) < END_R) return true; return false; }
function padTier(p){
  var acc = String(p.Pub_Access || p.PUB_ACCESS || p.pub_access || ''), cat = String(p.Category || p.CATEGORY || p.category || ''),
      own = String(p.Own_Type || p.OWN_TYPE || p.own_type || ''), nm = p.Unit_Nm || p.Loc_Nm || p.Mang_Name || 'public land';
  if(/^proclamation/i.test(cat) || /^(XA|closed)/i.test(acc)) return null;
  if(/^(OA|open)/i.test(acc)){
    if(/easement/i.test(cat)) return {t:1, why:nm + ': a conservation easement on private land (PAD-US); public access often limited'};
    if(/^(PVT|NGO|UNK)$/i.test(own)) return {t:1, why:nm + ': listed open, but ' + (/^NGO$/i.test(own) ? 'owned by a nonprofit' : /^PVT$/i.test(own) ? 'privately owned' : 'owner unknown') + ' (PAD-US)'};
    return {t:2, why:nm};
  }
  if(/^(RA|restricted)/i.test(acc)) return RMODE.permit ? {t:2, why:nm + ' (needs a permit or licence; you said you have it)'}
                                                          : {t:1, why:nm + ': restricted access (permit, season or fee) in PAD-US. Virginia WMAs need a DWR Access Permit at 17+ unless you hold a hunting or fishing licence'};
  return {t:1, why:nm + ': public access unknown in PAD-US'};
}
var PUB_SRC = [
  {name:'US Forest Service ownership', url:'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_BasicOwnership_01/MapServer/0/query',
   where:"OWNERCLASSIFICATION='USDA FOREST SERVICE'", fields:'OWNERCLASSIFICATION', pages:1,
   tier:function(){ return {t:2, why:'National Forest (Forest Service-owned)'}; }},
  {name:'PAD-US', url:'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Public_Access/FeatureServer/0/query',
   where:'1=1', fields:'*', pages:3, tier:padTier}
];
function publicLand(b){
  var env = [b[1], b[0], b[3], b[2]].map(function(v){ return v.toFixed(5); }).join(',');
  var polys = [], got = [];
  return Promise.all(PUB_SRC.map(function(src){
    var page = 0, n = 0;
    function one(){
      var q = src.url + '?where=' + encodeURIComponent(src.where) + '&geometry=' + env + '&geometryType=esriGeometryEnvelope&inSR=4326' +
              '&spatialRel=esriSpatialRelIntersects&outFields=' + encodeURIComponent(src.fields) + '&returnGeometry=true&outSR=4326' +
              '&maxAllowableOffset=0.0002&geometryPrecision=5&f=geojson' + (src.pages > 1 ? '&resultRecordCount=1000&resultOffset=' + page*1000 : '');
      return timed(q, {}, 45000).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function(gj){
        (gj.features || []).forEach(function(f){
          var p = f.properties || {}, g = f.geometry, tr = g && src.tier(p); if(!tr) return;
          var rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? [].concat.apply([], g.coordinates) : [];
          if(!rings.length) return;
          var bb = [Infinity, Infinity, -Infinity, -Infinity];
          rings.forEach(function(r){ r.forEach(function(c){ if(c[0] < bb[0]) bb[0] = c[0]; if(c[1] < bb[1]) bb[1] = c[1]; if(c[0] > bb[2]) bb[2] = c[0]; if(c[1] > bb[3]) bb[3] = c[1]; }); });
          polys.push({rings:rings, bb:bb, t:tr.t, why:tr.why}); n++;
        });
        page++;
        if(gj.exceededTransferLimit || (gj.properties && gj.properties.exceededTransferLimit)){ if(page < src.pages) return one(); }
      });
    }
    return one().then(function(){ got.push(src.name + ' (' + n + ')'); }).catch(function(e){ got.push(src.name + ': ' + (e.message || 'no answer')); });
  })).then(function(){ return {polys:polys, got:got, ok:polys.length > 0}; });
}
var LAND0 = {t:0, why:'private land (no public land in the data here)'}, LAND_ANY = {t:2, why:''};
function landAt(pl, lat, lon){
  if(!pl) return LAND_ANY;
  var best = LAND0;
  for(var i = 0; i < pl.polys.length; i++){
    var p = pl.polys[i]; if(p.t <= best.t || lon < p.bb[0] || lon > p.bb[2] || lat < p.bb[1] || lat > p.bb[3]) continue;
    var inside = false;
    p.rings.forEach(function(r){
      for(var a = 0, b2 = r.length - 1; a < r.length; b2 = a++){
        var xa = r[a][0], ya = r[a][1], xb = r[b2][0], yb = r[b2][1];
        if((ya > lat) !== (yb > lat) && lon < (xb - xa)*(lat - ya)/(yb - ya) + xa) inside = !inside;
      }
    });
    if(inside) best = p;
  }
  return best;
}
function pubAt(pl, lat, lon){ return landAt(pl, lat, lon).t; }
/* what a mapped way itself allows, whoever owns the land under it */
function wayTier(t){
  var f = t.foot || '', a = t.access || '';
  if(/^(yes|designated|public)$/.test(f) || /^(yes|designated|public)$/.test(a)) return {t:2, why:''};
  if(/^(primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$/.test(t.highway || '')) return {t:2, why:''};
  if(f === 'permissive' || a === 'permissive') return {t:1, why:(t.name || 'a path') + ' is marked permissive: the owner allows it but can withdraw it'};
  if(a === 'destination' || f === 'destination') return {t:1, why:(t.name || 'a road') + ' is for local access only'};
  if(/^(path|footway|bridleway|steps)$/.test(t.highway || '')) return {t:1, why:(t.name || 'a path') + ' with no access tags, on land that is not public'};
  return {t:0, why:(t.name || 'a ' + (t.highway || 'way')) + ' on private land, not marked public'};
}
/* the public-land raster for the grid: scanline fill, even-odd, so inholdings stay holes */
function pubRaster(pl, b, nx, ny, cs, mx, my){
  var R = new Uint8Array(nx*ny), W = new Int32Array(nx*ny).fill(-1);
  pl.polys.forEach(function(p, pi){
    var j0 = Math.max(0, Math.floor((p.bb[1] - b[0])*my/cs)), j1 = Math.min(ny - 1, Math.floor((p.bb[3] - b[0])*my/cs));
    for(var j = j0; j <= j1; j++){
      var lat = b[0] + (j + 0.5)*cs/my, xs = [];
      p.rings.forEach(function(r){
        for(var a = 0, c = r.length - 1; a < r.length; c = a++){
          var ya = r[a][1], yb = r[c][1];
          if((ya > lat) !== (yb > lat)) xs.push(r[a][0] + (r[c][0] - r[a][0])*(lat - ya)/(yb - ya));
        }
      });
      xs.sort(function(x, y){ return x - y; });
      for(var k = 0; k + 1 < xs.length; k += 2){
        var i0 = Math.max(0, Math.ceil((xs[k] - b[1])*mx/cs - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[k+1] - b[1])*mx/cs - 0.5));
        for(var i = i0; i <= i1; i++){ var c = j*nx + i; if(p.t > R[c]){ R[c] = p.t; W[c] = pi; } }
      }
    }
  });
  return {t:R, w:W};
}

/* --------------------------------------------------------- driving */
var CAR_ALL = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|track|road';
var CAR_MAJOR = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link';
var CAR_V = {motorway:27, trunk:24, primary:22, secondary:20, tertiary:17.5, unclassified:13, residential:11, living_street:5, service:5, road:8};
function carSpeed(t){
  var h = String(t.highway || '').replace('_link', ''), v = CAR_V[h];
  if(h === 'track') v = t.tracktype === 'grade1' ? 9 : t.tracktype === 'grade2' ? 7 : 4.5;
  var ms = /^(\d+)\s*(mph)?/.exec(t.maxspeed || '');
  if(ms){ var lim = +ms[1]*(ms[2] ? 0.44704 : 0.27778); if(lim > 0) v = Math.min(v || lim, lim*0.9); }
  return v || 8;
}
function osmCars(from, to){
  function box(p, m){ var dl = m/110540, dk = m/(111320*Math.cos(p[0]*D)); return '(' + [p[0] - dl, p[1] - dk, p[0] + dl, p[1] + dk].map(function(v){ return v.toFixed(5); }).join(',') + ')'; }
  var span = dist(from, to), mid = [(from[0] + to[0])/2, (from[1] + to[1])/2], big = box(mid, span/2 + Math.max(8000, span*0.6));
  function w(re, bb){ return 'way["highway"~"^(' + re + ')$"]["access"!~"^(private|no)$"]["motor_vehicle"!~"^(private|no)$"]["motorcar"!~"^(private|no)$"]' + bb + ';'; }
  var bar = function(bb){ return 'node["barrier"~"^(gate|lift_gate|swing_gate|chain|bollard|block|jersey_barrier)$"]' + bb + ';'; };
  var q = '[out:json][timeout:90];(' + w(CAR_ALL, box(from, 6000)) + w(CAR_ALL, box(to, 6000)) + w(CAR_MAJOR, big) +
          bar(box(from, 6000)) + bar(box(to, 6000)) + ');out tags geom qt;';
  var i = 0;
  function next(){
    if(i >= OVERPASS.length) return Promise.reject(new Error('no OpenStreetMap server answered'));
    return timed(OVERPASS[i++], {method:'POST', body:'data=' + encodeURIComponent(q), headers:{'Content-Type':'application/x-www-form-urlencoded'}}, 95000)
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(next);
  }
  return next();
}
/* With PUBLIC LAND ONLY, where to park depends on what lies between the car
   and the destination. A coarse walk from the destination outward over the
   ownership map (100 m cells, 0.75 m/s, private and questionable land at
   their cost) gives every possible parking spot its cost of walking in. */
function accessField(pl, to, R){
  var lat0 = to[0], mx = 111320*Math.cos(lat0*D), my = 110540, cs = 100;
  var b = [to[0] - R/my, to[1] - R/mx, to[0] + R/my, to[1] + R/mx];
  var nx = Math.ceil(2*R/cs), ny = nx, n = nx*ny, PR = pubRaster(pl, b, nx, ny, cs, mx, my), T = PR.t;
  var G = new Float64Array(n).fill(Infinity), h = new Heap();
  var g0 = Math.floor(ny/2)*nx + Math.floor(nx/2); G[g0] = 0; h.push(0, g0);
  var DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  while(h.size()){
    var u = h.pop(), ui = u%nx, uj = Math.floor(u/nx);
    for(var k = 0; k < 8; k++){
      var vi = ui + DI[k], vj = uj + DJ[k]; if(vi < 0 || vj < 0 || vi >= nx || vj >= ny) continue;
      var v = vj*nx + vi;
      if(T[v] === 0 && (vi - Math.floor(nx/2))*(vi - Math.floor(nx/2)) + (vj - Math.floor(ny/2))*(vj - Math.floor(ny/2)) > 9) continue;   // private, beyond 300 m of the destination
      var t = G[u] + (k < 4 ? cs : cs*Math.SQRT2)/0.75*COST[T[v]];
      if(t < G[v]){ G[v] = t; h.push(t, v); }
    }
  }
  return function(la, lo){
    var i = Math.floor((lo - b[1])*mx/cs), j = Math.floor((la - b[0])*my/cs);
    return (i < 0 || j < 0 || i >= nx || j >= ny) ? Infinity : G[j*nx + i];
  };
}
/* Shortest time by car from near the start, then the best place to leave the
   car: least drive time plus a rough walking time from there (0.75 m/s). */
function driveRoute(from, to, osm, acc){
  var key = {}, lat = [], lon = [], adj = [], WAYS = [], BAR = {};
  /* bollards, blocks and chains stop a car; a gate costs 15 times the time and is reported, unless tagged open to cars */
  osm.elements.forEach(function(e){
    if(e.type !== 'node' || !e.tags || !e.tags.barrier) return;
    var t = e.tags, open = /^(yes|permissive|public|destination)$/.test(t.access || '') || /^(yes|permissive|destination)$/.test(t.motor_vehicle || t.motorcar || '');
    if(open) return;
    BAR[e.lat.toFixed(6) + ',' + e.lon.toFixed(6)] = /^(gate|lift_gate|swing_gate)$/.test(t.barrier) && !/^(private|no)$/.test(t.access || '') && t.locked !== 'yes' ? 15 : Infinity;
  });
  function barAt(i){ return BAR[lat[i].toFixed(6) + ',' + lon[i].toFixed(6)] || 1; }
  function node(p){ var k = p.lat.toFixed(6) + ',' + p.lon.toFixed(6); if(key[k] == null){ key[k] = lat.length; lat.push(p.lat); lon.push(p.lon); adj.push([]); } return key[k]; }
  osm.elements.forEach(function(e){
    if(e.type !== 'way' || !e.geometry || !e.tags || !e.tags.highway) return;
    var t = e.tags, v = carSpeed(t), wi = WAYS.length;
    var ow = /^(yes|true|1)$/.test(t.oneway || '') || /^motorway/.test(t.highway) ? 1 : t.oneway === '-1' ? -1 : 0;
    WAYS.push({name:t.name || t.ref || '', hw:t.highway, v:v, track:t.highway === 'track', svc:t.highway === 'service'});
    for(var i = 1; i < e.geometry.length; i++){
      var a = node(e.geometry[i-1]), c = node(e.geometry[i]); if(a === c) continue;
      var tt = dist([lat[a], lon[a]], [lat[c], lon[c]])/v*Math.max(barAt(a), barAt(c));
      if(!isFinite(tt)) continue;
      if(ow >= 0) adj[a].push([c, tt, wi]);
      if(ow <= 0) adj[c].push([a, tt, wi]);
    }
  });
  if(!lat.length) return {fail:'no roads in the data'};
  var near = [];
  for(var i = 0; i < lat.length; i++){ var d = dist(from, [lat[i], lon[i]]); if(d < 2000) near.push([d, i]); }
  near.sort(function(x, y){ return x[0] - y[0]; });
  if(!near.length) return {fail:'no road within 2 km of the start'};
  var N = lat.length, best = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), via = new Int32Array(N).fill(-1), h = new Heap();
  near.slice(0, 4).forEach(function(x){ best[x[1]] = x[0]/1.3; h.push(best[x[1]], x[1]); });
  while(h.size()){
    var u = h.pop(), ed = adj[u];
    for(var k = 0; k < ed.length; k++){ var v2 = ed[k][0], nt = best[u] + ed[k][1]; if(nt < best[v2]){ best[v2] = nt; prev[v2] = u; via[v2] = ed[k][2]; h.push(nt, v2); } }
  }
  var park = -1, score = Infinity;
  for(var n = 0; n < N; n++){ if(!isFinite(best[n])) continue; var s = best[n] + (acc ? acc(lat[n], lon[n]) : dist([lat[n], lon[n]], to)/0.75); if(s < score){ score = s; park = n; } }
  if(park < 0) return {fail:'no road reached'};
  var seq = [], cur = park; while(cur >= 0){ seq.push(cur); cur = prev[cur]; } seq.reverse();
  var pts = [], dd = 0, cue = [], tracks = 0, gates = 0;
  seq.forEach(function(nn, i){
    if(barAt(nn) > 1) gates++;
    var w = via[nn] >= 0 ? WAYS[via[nn]] : null;
    pts.push([lat[nn], lon[nn], null, 5, w ? w.name : '', w ? w.v : 10]);
    if(i){ var sd = dist([lat[seq[i-1]], lon[seq[i-1]]], [lat[nn], lon[nn]]); dd += sd; if(w && w.track) tracks += sd;
      var nm = w ? (w.name || (w.track ? 'a forest road' : w.svc ? 'a service road' : 'an unnamed road')) : '';
      var last = cue[cue.length-1]; if(last && last.name === nm) last.len += sd; else cue.push({name:nm, len:sd}); }
  });
  var tReal = 0; for(var ii = 1; ii < seq.length; ii++){ var w2 = WAYS[via[seq[ii]]]; tReal += dist([lat[seq[ii-1]], lon[seq[ii-1]]], [lat[seq[ii]], lon[seq[ii]]])/(w2 ? w2.v : 10); }
  return {pts:pts, t:tReal, gates:gates, d:dd, cue:cue.filter(function(c){ return c.len > 50; }), tracks:tracks, park:[lat[park], lon[park]],
          parkName:pts.length ? pts[pts.length-1][4] : '', walkToCar:near[0][0]};
}

/* Plan from where you are (or the map centre) to the GO TO destination. */
function planRoute(){
  if(!target) return;
  var from = me ? [me.lat, me.lon] : null;
  if(!from){
    if(!map || !confirm('No GPS fix. Plan from the centre of the map instead?')) return;
    from = [map.getCenter().lat, map.getCenter().lng];
  }
  var mode = {pub:!!RMODE.pub, drive:!!RMODE.drive};
  var to = [target.lat, target.lon], span = dist(from, to), lim = 60000;
  if(span > lim){ alert('That is ' + fmtDist(span) + ' in a straight line. Routes are planned up to 60 km (37 mi), about ' + (mode.drive ? 'an hour\u2019s drive' : 'a 3\u20134 day walk') +
                        '. Set a waypoint along the way, plan to it, then plan on from there.'); return; }
  if(span < 30){ alert('You are already there.'); return; }
  if(!navigator.onLine){ alert('Planning needs signal once, to get the paths and the ground for this area. Your saved route still works offline.'); return; }
  plan = {busy:true, note:mode.drive ? 'Getting the roads from OpenStreetMap…' : 'Getting the paths and roads from OpenStreetMap…', from:from, to:to, name:target.name, opts:[], mode:mode};
  paintPanel();
  var R = Math.min(15000, Math.max(6000, span*0.6));
  var landNear = mode.drive && mode.pub ? publicLand([to[0] - R/110540, to[1] - R/(111320*Math.cos(to[0]*D)), to[0] + R/110540, to[1] + R/(111320*Math.cos(to[0]*D))]) : Promise.resolve(null);
  var first = !mode.drive ? Promise.resolve({walkFrom:from}) : Promise.all([osmCars(from, to), landNear]).then(function(res){
    var osm = res[0], ln = res[1];
    planNote('Working out the drive…');
    var acc = ln && ln.ok ? accessField(ln, to, R) : null;
    if(mode.pub && !acc) plan.parkWhy = 'no public-land data for choosing where to park, so it parked by distance alone';
    var dr = driveRoute(from, to, osm, acc);
    if(dr.fail){ plan.driveWhy = dr.fail; return {walkFrom:from}; }
    if(dr.t < 90 || dist(dr.park, from) < 400){ plan.driveWhy = 'driving gets you no nearer than walking from here'; return {walkFrom:from}; }
    return {walkFrom:dr.park, drive:dr};
  }).catch(function(e){ plan.driveWhy = 'no road data (' + (e.message || e) + ')'; return {walkFrom:from}; });
  first.then(function(st){
    var A = st.walkFrom, wspan = dist(A, to);
    function finish(out, osm, dem){
      out.forEach(function(r){
        r.an = analyse(r, osm, dem, to); r.from = from; r.to = to; r.name = plan.name; r.made = Date.now(); r.paths = !!osm; r.pubGot = plan.pubGot;
        if(st.drive){ var d = st.drive; r.drive = {d:d.d, t:d.t, cue:d.cue, tracks:d.tracks, gates:d.gates, park:d.park, parkName:d.parkName, walkToCar:d.walkToCar};
                      r.wi = d.pts.length; r.pts = d.pts.concat(r.pts); }
      });
      plan.opts = out; plan.busy = false; plan.note = '';
      if(!out.length) plan.note = mode.pub ? 'No walking route could be found from ' + (st.drive ? 'the parking spot' : 'here') + ' within about ' + (plan.searched || 2) + ' km around, even crossing private land: ' +
                                             'the ground is too steep or cut by unbridged rivers.'
                                           : 'No route found: ' + [plan.netWhy, plan.gridWhy].filter(Boolean).join('; ') + '.';
      drawRoutes(); fitRoute(out[0]); paintPanel();
    }
    if(wspan < 30){ planNote('Working out the routes…'); return finish([{kind:'net', pts:[[A[0], A[1], null, OFF, ''], [to[0], to[1], null, OFF, '']]}], null, {sample:function(){ return null; }}); }
    planNote(st.drive ? 'Getting the paths for the walk in…' : plan.note);
    /* A legal way can be a long way round. With PUBLIC LAND ONLY, when the
       first area holds no legal line, look again wider: about 8 km, then
       about 20 km around (roads and trails only, so the data stays small). */
    var pads = wspan > 25000 ? [Math.max(5000, wspan*0.25)] : [Math.max(2000, wspan*0.4)];
    if(mode.pub) pads.push(Math.max(8000, wspan*0.5), Math.max(20000, wspan*0.8));
    STRICT = true; plan.fallback = false;
    END = [A, to];
    function attempt(k){
      var pad = pads[k], wide = k > 0 || wspan > 25000;
      var dLat = pad/110540, dLon = pad/(111320*Math.cos(A[0]*D));
      var b = [Math.min(A[0], to[0]) - dLat, Math.min(A[1], to[1]) - dLon, Math.max(A[0], to[0]) + dLat, Math.max(A[1], to[1]) + dLon];
      if(wide) planNote('No legal way in the nearby area; looking about ' + Math.round(pad/1000) + ' km around for public roads, trails and public land…');
      var osmP = osmBox(b, wide).catch(function(e){ plan.osmErr = e.message || String(e); return null; });
      var plP = mode.pub ? publicLand(b) : Promise.resolve(null);
      var demP = osmP.then(function(){ return demFor(b); });
      return Promise.all([osmP, demP, plP]).then(function(res){
        var osm = res[0], dem = res[1], pl = res[2];
        if(mode.pub){
          plan.pubGot = pl.got;
          if(!pl.ok){ throw new Error('PUBLIC LAND ONLY needs the land-ownership maps, and none arrived (' + pl.got.join('; ') + '). Try again with better signal'); }
        }
        plan.pub = !!pl; plan.land = pl;
        planNote('Working out the routes…');
        return new Promise(function(ok){ setTimeout(ok, 30); }).then(function(){
          plan.netWhy = plan.gridWhy = '';
          var out = [], net = osm ? netRoute(A, to, osm, dem, pl) : null, grid = gridRoute(A, to, b, osm, dem, pl);
          if(net && net.pts) out.push(net); else plan.netWhy = !osm ? 'no path data' : !net ? 'no mapped paths here' :
            net.fail === 'start' ? 'no path within 1.5 km of the start that can be reached ' + (mode.pub ? 'legally and ' : '') + 'safely' :
            net.fail === 'end' ? 'no path within 1.5 km of the destination that can be reached ' + (mode.pub ? 'legally and ' : '') + 'safely' : 'the paths here do not connect';
          if(grid && grid.pts) out.push(grid); else plan.gridWhy = mode.pub ? 'no way across the ground without crossing private land, very steep slopes or an unbridged river'
                                                                          : 'no way across the ground without very steep slopes or an unbridged river';
          if(!out.length && k + 1 < pads.length) return attempt(k + 1);
          /* Still nothing legal: give the walking route with the least private land, said plainly. */
          if(!out.length && mode.pub && STRICT){
            STRICT = false; plan.fallback = true;
            planNote('No fully legal way; finding the walking route with the least private land\u2026');
            var n2 = osm ? netRoute(A, to, osm, dem, pl) : null, g2 = gridRoute(A, to, b, osm, dem, pl);
            if(n2 && n2.pts) out.push(n2);
            if(g2 && g2.pts) out.push(g2);
            STRICT = true;
          }
          plan.searched = Math.round(pad/1000);
          out.forEach(function(r){ r.pub = !!pl; });
          finish(out, osm, dem);
        });
      });
    }
    return attempt(0);
  }).catch(function(e){
    plan.busy = false;
    plan.note = 'Could not plan: ' + (e.message || e) + '. Planning needs a usable signal for a minute or two.';
    paintPanel();
  });
}
function useRoute(i){
  var r = plan && plan.opts[i]; if(!r) return;
  ROUTE = {kind:r.kind, pts:r.pts.map(function(p){ return [+p[0].toFixed(6), +p[1].toFixed(6), p[2] == null ? null : Math.round(p[2]*10)/10, p[3], p[4] || '',
                                                            p[3] === 5 ? p[5] : 0, 0, +p[7] || 0, p[7] ? String(p[8] || '').slice(0, 140) : '']; }),
           an:r.an, from:r.from, to:r.to, name:r.name, made:r.made, paths:r.paths, cell:r.cell, pub:r.pub, drive:r.drive, wi:r.wi || 0, pubGot:r.pubGot};
  delete ROUTE.an.cum; delete ROUTE.an.tcum;
  routeIndex();
  if(!store('ap_route', ROUTE)) alert('This route is too large to keep on the device; it will last until the page is closed.');
  plan = null;
  drawRoutes(); drawTarget();                             // the bar switches to following the route at once
  saveAlongRoute();
  paintPanel();
}
function routeIndex(){                                  // distances and times along the kept route
  if(!ROUTE) return;
  var c = [0], t = [0], p = ROUTE.pts;
  for(var i = 1; i < p.length; i++){
    var d = dist([p[i-1][0], p[i-1][1]], [p[i][0], p[i][1]]), S = (p[i][2] != null && p[i-1][2] != null && d) ? (p[i][2] - p[i-1][2])/d : 0;
    c.push(c[i-1] + d); t.push(t[i-1] + (!d ? 0 : p[i][3] === 5 ? d/(p[i][5] || 10) : d/(tobler(S)*CLS_SPEED[p[i][3]])));
  }
  ROUTE._c = c; ROUTE._t = t;
}
routeIndex();
/* The map along the route, kept for offline: about 750 m either side. */
function saveAlongRoute(){
  if(!ROUTE || !navigator.onLine || !('caches' in window)) return;
  var seen = {}, tiles = [], T = BASES.topo;
  for(var z = 10; z <= 15; z++) ROUTE.pts.forEach(function(p, i){
    if(i % 3) return;
    var dl = 0.75/110.54, dk = 0.75/(111.32*Math.cos(p[0]*D));
    for(var x = lon2x(p[1] - dk, z); x <= lon2x(p[1] + dk, z); x++) for(var y = lat2y(p[0] + dl, z); y <= lat2y(p[0] - dl, z); y++){
      var k = z + '/' + x + '/' + y; if(!seen[k]){ seen[k] = 1; tiles.push([z, x, y]); }
    }
  });
  if(tiles.length > 2500) tiles = tiles.filter(function(t){ return t[0] <= 14; });
  var ok = 0, i = 0;
  ROUTE.saving = true; paintPanel();
  caches.open(TILE_CACHE).then(function(cache){
    function worker(){
      if(i >= tiles.length) return Promise.resolve();
      var t = tiles[i++], url = tileUrl(T.url, t[0], t[1], t[2]);
      return caches.match(url).then(function(hit){
        if(hit){ ok++; return cache.put(url, hit); }
        return fetch(url, {mode:'cors', credentials:'omit'}).then(function(r){ if(!r.ok) throw 0; ok++; return cache.put(url, r); });
      }).catch(function(){}).then(worker);
    }
    return Promise.all([worker(), worker(), worker(), worker()]);
  }).then(function(){
    if(!ROUTE) return;
    ROUTE.saving = false;
    if(!ok){ ROUTE.tileErr = true; store('ap_route', ROUTE); paintPanel(); return; }
    ROUTE.tiles = ok + ' of ' + tiles.length; ROUTE.tileErr = false; store('ap_route', ROUTE);
    var lats = ROUTE.pts.map(function(p){ return p[0]; }), lons = ROUTE.pts.map(function(p){ return p[1]; });
    SAVED.push({label:'Route to ' + ROUTE.name, layer:T.name, b:[Math.min.apply(null, lats), Math.min.apply(null, lons), Math.max.apply(null, lats), Math.max.apply(null, lons)],
                z:[10, 15], n:ok, at:Date.now(), auto:true});
    store('ap_saved', SAVED);
    paintPanel();
  }).catch(function(){ if(ROUTE){ ROUTE.saving = false; paintPanel(); } });
}
function drawRoutes(){
  if(!map) return;
  var L = window.L;
  if(routeLayer){ map.removeLayer(routeLayer); }
  routeLayer = L.layerGroup().addTo(map);
  function line(r, faded){
    var run = [r.pts[0]];
    for(var i = 1; i < r.pts.length; i++){
      run.push(r.pts[i]);
      if(i === r.pts.length - 1 || r.pts[i+1][3] !== r.pts[i][3]){
        var cls = r.pts[i][3], ll = run.map(function(p){ return [p[0], p[1]]; });
        L.polyline(ll, {color:'#0b1224', weight:faded ? 6 : 8, opacity:faded ? .35 : .6, interactive:false}).addTo(routeLayer);
        L.polyline(ll, {color:CLS_COLOR[cls], weight:faded ? 3 : 5, opacity:faded ? .6 : 1, dashArray:cls === OFF ? '8 6' : null, interactive:false}).addTo(routeLayer);
        run = [r.pts[i]];
      }
    }
    var an = r.an; if(!an || faded) return;
    var wp = walkPart(r);
    [['priv', '#ef4444', 'Private'], ['ques', '#fbbf24', 'Questionable access']].forEach(function(kd){
      (an[kd[0]] || []).forEach(function(x){
        var seg = wp.pts.filter(function(q, k){ return wp._c[k] >= x.a && wp._c[k] <= x.b; }).map(function(q){ return [q[0], q[1]]; });
        if(seg.length > 1) L.polyline(seg, {color:kd[1], weight:3, dashArray:'2 6', interactive:true}).bindTooltip(kd[2] + (x.why ? ': ' + x.why : '')).addTo(routeLayer);
      });
    });
    if(r.drive) L.circleMarker(r.drive.park, {radius:7, color:'#60a5fa', weight:3, fillColor:'#0b1224', fillOpacity:1}).bindTooltip('Park here', {permanent:true, direction:'left', className:'ap-tgt-tip'}).addTo(routeLayer);
    (an.crossings || []).forEach(function(c){ var p = atDist(wp, c.at); if(p) L.circleMarker(p, {radius:5, color:'#38bdf8', weight:2, fillOpacity:.6}).bindTooltip((c.bridge ? 'Bridge: ' : 'Crossing: ') + (c.name || c.kind)).addTo(routeLayer); });
    (an.steep || []).forEach(function(s){ var p = atDist(wp, s.a); if(p) L.circleMarker(p, {radius:5, color:'#ef4444', weight:2, fillOpacity:.6}).bindTooltip('Steep: ' + Math.round(Math.atan(s.g)/D) + '°').addTo(routeLayer); });
    (an.cliffs || []).forEach(function(s){ var p = atDist(wp, s.at); if(p) L.circleMarker(p, {radius:6, color:'#f43f5e', weight:3, fill:false}).bindTooltip('Drop-off nearby').addTo(routeLayer); });
  }
  if(plan && plan.opts.length && plan.land) plan.land.polys.forEach(function(pg){
    L.polygon(pg.rings.map(function(r){ return r.map(function(c){ return [c[1], c[0]]; }); }),
      {color:pg.t === 2 ? '#22c55e' : '#fbbf24', weight:1, opacity:.6, fillOpacity:.08, interactive:false}).addTo(routeLayer);
  });
  if(plan && plan.opts.length) plan.opts.forEach(function(r, i){ line(r, i !== (plan.show || 0)); });
  else if(routeActive()) line(ROUTE, false);
}
function routeActive(){ return !!(ROUTE && target && dist(ROUTE.to, [target.lat, target.lon]) < 50); }
function fitRoute(r){
  if(!map || !r || !r.pts.length) return;
  map.fitBounds(r.pts.map(function(p){ return [p[0], p[1]]; }), {padding:[30, 30], maxZoom:16});
  follow = false; $('apFollow').classList.remove('on');
}
/* The walk in, without the drive: what the profile and the hazards are about. */
function walkPart(r){
  var pts = r.wi ? r.pts.slice(r.wi) : r.pts, c = [0];
  for(var i = 1; i < pts.length; i++) c.push(c[i-1] + dist([pts[i-1][0], pts[i-1][1]], [pts[i][0], pts[i][1]]));
  return {pts:pts, an:r.an, _c:c};
}
function atDist(r, m){
  var c = r._c || (r.an && r.an.cum); if(!c) return null;
  for(var i = 1; i < c.length; i++) if(c[i] >= m) return [r.pts[i][0], r.pts[i][1]];
  return null;
}
/* Where you are against the route: how far off it, how far left, and a
   point ~80 m ahead on it for the arrow to aim at. */
function routeFix(){
  if(!ROUTE || !me || !ROUTE._c || !target || dist(ROUTE.to, [target.lat, target.lon]) > 50) return null;
  var p = ROUTE.pts, best = Infinity, bi = 0, bt = 0, mx = 111320*Math.cos(me.lat*D), my = 110540;
  for(var i = 1; i < p.length; i++){
    var ax = (p[i-1][1] - me.lon)*mx, ay = (p[i-1][0] - me.lat)*my, bx = (p[i][1] - me.lon)*mx, by = (p[i][0] - me.lat)*my;
    var dx = bx - ax, dy = by - ay, L2 = dx*dx + dy*dy, t = L2 ? Math.max(0, Math.min(1, -(ax*dx + ay*dy)/L2)) : 0;
    var ex = ax + dx*t, ey = ay + dy*t, d = Math.sqrt(ex*ex + ey*ey);
    if(d < best){ best = d; bi = i; bt = t; }
  }
  var along = ROUTE._c[bi-1] + (ROUTE._c[bi] - ROUTE._c[bi-1])*bt, total = ROUTE._c[ROUTE._c.length-1];
  var left = total - along, tl = ROUTE._t[ROUTE._t.length-1] - (ROUTE._t[bi-1] + (ROUTE._t[bi] - ROUTE._t[bi-1])*bt);
  var ahead = p[p.length-1];
  for(var k = bi; k < p.length; k++) if(ROUTE._c[k] - along > 80){ ahead = p[k]; break; }
  var nearPt = [p[bi-1][0] + (p[bi][0] - p[bi-1][0])*bt, p[bi-1][1] + (p[bi][1] - p[bi-1][1])*bt];
  return {off:best, left:left, tl:tl, along:along, ahead:[ahead[0], ahead[1]], near:nearPt, offRoute:best > Math.max(50, me.acc*1.5)};
}

/* Drawing the analysis. */
function profileSvg(r){
  var w = walkPart(r), p = w.pts, c = w._c, W = 320, H = 90, lo = r.an.lo, hi = r.an.hi;
  if(lo == null || !c) return '';
  var span = Math.max(30, hi - lo), tot = c[c.length-1] || 1, segs = '';
  for(var i = 1; i < p.length; i++){
    if(p[i][2] == null || p[i-1][2] == null) continue;
    var x1 = c[i-1]/tot*W, x2 = c[i]/tot*W, y1 = H - 8 - (p[i-1][2] - lo)/span*(H - 20), y2 = H - 8 - (p[i][2] - lo)/span*(H - 20);
    var d = c[i] - c[i-1], g = d ? Math.abs(p[i][2] - p[i-1][2])/d : 0;
    segs += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' +
            (g > 0.47 ? '#ef4444' : g > 0.27 ? '#fbbf24' : CLS_COLOR[p[i][3]]) + '" stroke-width="2.2"/>';
  }
  return '<svg class="ap-prof" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + segs +
    '<text x="2" y="10" fill="#94a3b8" font-size="9" font-family="monospace">' + Math.round(hi*3.28084).toLocaleString() + ' ft</text>' +
    '<text x="2" y="' + (H - 1) + '" fill="#94a3b8" font-size="9" font-family="monospace">' + Math.round(lo*3.28084).toLocaleString() + ' ft</text>' +
    '<text x="' + (W - 2) + '" y="' + (H - 1) + '" fill="#94a3b8" font-size="9" font-family="monospace" text-anchor="end">' + fmtMi(tot) + '</text></svg>';
}
function fmtMi(m){ return (m/1609.344).toFixed(m < 1609 ? 2 : 1) + ' mi'; }
function deg(g){ return Math.round(Math.atan(g)/D) + '° (' + Math.round(g*100) + '%)'; }
function routeSummary(r){
  var a = r.an;
  return '<div class="ap-grid">' + (r.drive ? kv('DRIVE', fmtDist(r.drive.d) + ', about ' + fmtDur(r.drive.t*1000)) : '') +
    (r.pub ? kv('PRIVATE LAND', a.privM > 20 ? '<span class="ap-bad">' + fmtDist(a.privM) + '</span>' : 'none in the data') +
             kv('QUESTIONABLE ACCESS', a.quesM > 20 ? '<span class="ap-warn">' + fmtDist(a.quesM) + '</span>' : 'none in the data') : '') +
    kv(r.drive ? 'WALK IN' : 'DISTANCE', fmtDist(a.d) + (a.t > 9*3600 ? ' <span class="ap-warn">(about ' + Math.ceil(a.t/(7*3600)) + ' days at 7 hours of walking a day)</span>' : '')) + kv('WALKING TIME', fmtDur(a.t*1000) + ' <span class="ap-dim">(Tobler, no breaks)</span>') +
    kv('CLIMB / DESCENT', '+' + Math.round(a.up*3.28084).toLocaleString() + ' / −' + Math.round(a.down*3.28084).toLocaleString() + ' ft') +
    kv('OFF-TRAIL', a.byCls[OFF] > 20 ? fmtDist(a.byCls[OFF]) : 'none') + '</div>';
}
function daylight(to, secs){
  var now = Date.now(), eta = now + secs*1000, t = function(ms){ return new Date(ms).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); };
  var sd = sunDay(to[0], to[1], now);
  if(sd.rise && now < sd.rise) return '<div class="ap-warn">It is dark now; sunrise at ' + t(sd.rise) + '. Walking time from now: ' + fmtDur(secs*1000) + '.</div>';
  if(sd.set && now > sd.set){ var nx = sunDay(to[0], to[1], now + 864e5); return '<div class="ap-warn">It is dark now; sunrise at ' + t(nx.rise) + '. Walking time from now: ' + fmtDur(secs*1000) + '.</div>'; }
  if(!sd.set) return '';
  var late = eta - sd.set;
  return '<div class="' + (late > 0 ? 'ap-bad' : '') + '">Leaving now, arrival about ' + t(eta) + '; sunset ' + t(sd.set) +
    (late > 0 ? ' \u2014 <b>that is ' + fmtDur(late) + ' after sunset.</b> Carry a light, or stop short.' : ', ' + fmtDur(-late) + ' of daylight to spare.') + '</div>';
}
function routeDetail(r, f){
  var a = r.an, h = '';
  if(r.drive){
    var dv = r.drive;
    h += '<h4>THE DRIVE</h4><div>Park at about ' + dv.park[0].toFixed(5) + ', ' + dv.park[1].toFixed(5) + (dv.parkName ? ' on ' + esc(dv.parkName) : '') +
         ' (the blue \u201cPark here\u201d on the map).' + (dv.walkToCar > 200 ? ' The nearest road is ' + fmtDist(dv.walkToCar) + ' from the start.' : '') + '</div>';
    if(dv.cue.length) h += '<ol class="ap-ul">' + dv.cue.map(function(c){ return '<li>' + fmtMi(c.len) + ' on ' + esc(c.name) + '</li>'; }).join('') + '</ol>';
    if(dv.gates) h += '<div class="ap-warn">' + dv.gates + ' gate' + (dv.gates > 1 ? 's' : '') + ' on the drive. Gates in the map are often closed or locked; it went through only because there was no better way.</div>';
    if(dv.tracks > 200) h += '<div class="ap-warn">' + fmtDist(dv.tracks) + ' of it on forest roads or tracks: many are gated or closed for the season, and some need high clearance. Have a plan B.</div>';
    h += '<div class="ap-dim">Drive times come from road types and speed limits in OpenStreetMap, not live traffic. Gates, closures and road surface are not known. Parking must be legal where you stop.</div>';
    h += '<h4>THE WALK IN</h4>';
  }
  h += profileSvg(r);
  h += '<div class="ap-dim">Green trail &middot; lime track &middot; grey road &middot; yellow dashed off-trail. On the profile: amber steeper than 15°, red steeper than 25°.</div>';
  h += '<div class="ap-grid">' + kv('HIGH / LOW', fmtEle(a.hi) + ' / ' + fmtEle(a.lo)) +
       kv('STEEPEST UP', a.maxUp ? deg(a.maxUp) + ' at ' + fmtMi(a.atUp) : '—') + kv('STEEPEST DOWN', a.maxDn ? deg(a.maxDn) + ' at ' + fmtMi(a.atDn) : '—') +
       kv('MIX', a.byCls.map(function(m, i){ return m > 20 ? CLS_NAME[i] + ' ' + fmtMi(m) : null; }).filter(Boolean).join(', ')) + '</div>';
  h += daylight(r.to, f ? f.tl : a.t + (r.drive ? r.drive.t : 0));
  var hz = [];
  a.steep.forEach(function(s){ hz.push([s.a, 'Steep: ' + deg(s.g) + ' from ' + fmtMi(s.a) + ' to ' + fmtMi(s.b) + (s.cls === OFF ? ', off trail' : '')]); });
  a.cliffs.forEach(function(c){ hz.push([c.at, 'Drop-off: ground steeper than 45° within about 30 m of the line at ' + fmtMi(c.at)]); });
  a.crossings.forEach(function(c){ hz.push([c.at, (c.bridge ? 'Bridge over ' : c.ford ? 'Ford of ' : (c.kind === 'river' ? 'River crossing: ' : 'Stream crossing: ')) + (c.name || 'a ' + c.kind) + ' at ' + fmtMi(c.at) +
    (c.bridge ? '' : '. Do not cross moving water above your knees; high after rain.')]); });
  a.roads.forEach(function(x){ if(x.busy) hz.push([x.at, 'Road walk on ' + x.name + ' from ' + fmtMi(x.at) + ': traffic. Walk facing it.']); });
  if(a.byCls[OFF] > 150) hz.push([0, fmtDist(a.byCls[OFF]) + ' off trail. The data cannot see rhododendron or laurel thickets, blowdowns or posted land; expect it slower than shown, and turn back if it closes in.']);
  if(!r.paths) hz.push([0, 'No path data arrived, so this route knows only the ground.']);
  (a.priv || []).forEach(function(x){ hz.push([x.a, 'PRIVATE from ' + fmtMi(x.a) + ' to ' + fmtMi(x.b) + ' (' + fmtDist(x.b - x.a) + ')' + (x.why ? ': ' + x.why : '') +
    '. There was no way round; ask the owner, or turn back.']); });
  (a.ques || []).forEach(function(x){ hz.push([x.a, 'QUESTIONABLE ACCESS from ' + fmtMi(x.a) + ' to ' + fmtMi(x.b) + ' (' + fmtDist(x.b - x.a) + ')' + (x.why ? ': ' + x.why : '') +
    '. Check signs and rules before you rely on it.']); });
  (a.gates || []).forEach(function(g){ hz.push([g.at, 'Gate at ' + fmtMi(g.at) + (g.closed ? ', marked private or closed' : '') + '.']); });
  if(hz.length){ hz.sort(function(x, y){ return x[0] - y[0]; }); h += '<h4>WATCH FOR</h4><ul class="ap-ul">' + hz.map(function(x){ return '<li>' + esc(x[1]) + '</li>'; }).join('') + '</ul>'; }
  if(a.near.length || a.roads.length){
    var along = a.near.map(function(x){ return [x.at, (KIND_ONE[x.k] || x.k) + ': ' + x.name + (x.off > 60 ? ' (' + fmtDist(x.off) + ' off the line)' : '')]; })
      .concat(a.roads.map(function(x){ return [x.at, 'Road (a way out): ' + x.name]; }))
      .sort(function(x, y){ return x[0] - y[0]; });
    h += '<h4>WATER, SHELTER AND WAYS OUT ALONG IT</h4><div class="ap-list">' + along.slice(0, 30).map(function(x){
      return '<div class="ap-li"><span>' + esc(x[1]) + '</span><b>' + fmtMi(x[0]) + '</b></div>'; }).join('') + '</div>';
  } else h += '<div class="ap-dim">No mapped water, shelter or road along this route. Carry the water you need.</div>';
  if(a.cue.length) h += '<h4>THE WAY</h4><ol class="ap-ul">' + a.cue.map(function(c){
    return '<li>' + fmtMi(c.len) + ' ' + (c.cls === OFF ? '<b>off trail</b>' : 'on ' + (c.name ? '<b>' + esc(c.name) + '</b> (' + CLS_NAME[c.cls] + ')' : 'a ' + CLS_NAME[c.cls])) + '</li>'; }).join('') + '</ol>';
  h += r.pub ? '<div class="ap-dim"><b>Public land only:</b> keeps to Forest Service-owned land and government land PAD-US lists as open (' + esc((r.pubGot || []).join('; ')) + '), plus public roads ' +
               'and paths marked public. Private land is not crossed beyond 250 m of the start and destination; questionable access costs six times the time and is listed. Off trail is fine there. The data is not a survey and can be out of date; posted signs, closures, seasonal rules and permits still apply, ' +
               'and in hunting season wear blaze orange.</div>'
             : '<div class="ap-dim"><b>Anywhere:</b> this route ignores who owns the land. Respect posted signs and ask before crossing private land.</div>';
  h += '<div class="ap-dim">Times are Tobler’s hiking function on the slope (off-trail at 0.6 of trail pace), with no breaks. Heights are from ~10–20 m terrain data, ' +
       'so short steep pitches and cliffs can hide between samples. Paths are OpenStreetMap’s, which can be out of date. Use it with the map and your eyes.</div>';
  return h;
}
function modeName(r){ return (r.drive ? 'DRIVE, THEN ' : '') + (r.kind === 'net' ? 'TRAILS AND ROADS' : 'OVER THE GROUND (QUICKEST)') + ' \u00b7 ' + (r.pub ? 'PUBLIC LAND ONLY' : 'ANYWHERE'); }
/* Land ownership for the area on screen, on demand: green public, amber questionable, nothing for private. */
var landLayer = null, landNote = 'needs signal; shades the area on screen';
function landShow(){
  if(landLayer){ map.removeLayer(landLayer); landLayer = null; landNote = ''; paintPanel(); return; }
  if(!map) return;
  var bb = map.getBounds(), b = [bb.getSouth(), bb.getWest(), bb.getNorth(), bb.getEast()];
  if(dist([b[0], b[1]], [b[2], b[3]]) > 40000){ landNote = 'zoom in to under about 25 km across first'; paintPanel(); return; }
  if(!navigator.onLine){ landNote = 'no signal'; paintPanel(); return; }
  landNote = 'fetching\u2026'; paintPanel();
  publicLand(b).then(function(pl){
    var L = window.L; landLayer = L.layerGroup().addTo(map);
    pl.polys.forEach(function(pg){
      L.polygon(pg.rings.map(function(r){ return r.map(function(c){ return [c[1], c[0]]; }); }),
        {color:pg.t === 2 ? '#22c55e' : '#fbbf24', weight:1.5, opacity:.8, fillOpacity:.15}).bindTooltip(pg.t === 2 ? 'Public: ' + pg.why : 'Questionable: ' + pg.why).addTo(landLayer);
    });
    landNote = pl.polys.length ? 'green public, amber questionable, unshaded private (' + pl.got.join('; ') + ')' : 'no public land found here (' + pl.got.join('; ') + ')';
    paintPanel();
  });
}
function modeBar(){
  function b(k, v, label){ return '<button class="ap-btn' + (!!RMODE[k] === v ? ' on' : '') + '" data-act="rmode" data-k="' + k + '" data-v="' + (v ? 1 : 0) + '">' + label + '</button>'; }
  return '<div class="ap-row"><span class="ap-dim">ON FOOT</span>' + b('pub', false, 'ANYWHERE') + b('pub', true, 'PUBLIC LAND ONLY') + '</div>' +
    (RMODE.pub ? '<div class="ap-row"><span class="ap-dim">PERMIT LAND</span>' + b('permit', false, 'AVOID') + b('permit', true, 'I HAVE THE PERMITS') + '</div>' : '') +
    '<div class="ap-row"><span class="ap-dim">GETTING THERE</span>' + b('drive', false, 'WALK ALL THE WAY') + b('drive', true, 'DRIVE, THEN WALK') + '</div>' +
    '<div class="ap-dim">' + (RMODE.pub ? 'Public land only: Forest Service land and government land open to the public, plus public roads and paths marked public; off trail is fine there. ' +
                                          'Private land is never crossed (beyond 250 m of your start and destination); public roads through it are fine. Questionable access (permits, easements, permissive or untagged paths) is avoided and flagged.'
                                        : 'Anywhere: ignores who owns the land.') +
    (RMODE.pub && RMODE.permit ? ' Permit land (state wildlife areas and the like) counts as public: carry the permit or licence.' : '') +
    (RMODE.drive ? ' Drives public roads to the best place to park' + (RMODE.pub ? ' for a walk in on public land' : '') + ', then walks in.' : '') + '</div>' +
    '<div class="ap-row"><button class="ap-btn" data-act="land-show">' + (landLayer ? 'HIDE LAND OWNERSHIP' : 'SHOW LAND OWNERSHIP HERE') + '</button>' +
    '<span class="ap-dim">' + esc(landNote) + '</span></div>';
}
function routeBlock(){
  var h = '<h4>ROUTE</h4>';
  if(plan && plan.busy) return h + '<div class="ap-warn">' + esc(plan.note) + '</div>';
  if(!(plan && plan.opts.length)) h += modeBar();          // the settings first, where they are seen
  if(plan && plan.opts.length){
    h += '<div class="ap-dim">' + (plan.opts.length > 1 ? 'Two ways' : 'A way') + ' to ' + esc(plan.name) + '. Tap SHOW to see one on the map, USE THIS to keep it for offline and follow it.</div>';
    if(plan.driveWhy) h += '<div class="ap-warn">No drive: ' + esc(plan.driveWhy) + '. These walk from where you are.</div>';
    if(plan.parkWhy) h += '<div class="ap-warn">' + esc(plan.parkWhy) + '.</div>';
    if(plan.fallback) h += '<div class="ap-bad"><b>No fully legal walking route</b> within about ' + (plan.searched || 20) + ' km: private land closes every way in. ' +
      'These are the walking routes with the least private land. The red-dashed stretches cross private land, listed below: you need the owners\u2019 permission for them.</div>';
    else if(plan.mode && plan.mode.drive && plan.mode.pub) h += '<div class="ap-dim">Parking was chosen for the cheapest walk in across public land, not the shortest distance.</div>';
    if(plan.pubWhy) h += '<div class="ap-bad">' + esc(plan.pubWhy) + '.</div>';
    plan.opts.forEach(function(r, i){
      h += '<div class="ap-ropt' + ((plan.show || 0) === i ? ' on' : '') + '"><b>' + modeName(r) + '</b>' + routeSummary(r) +
           '<div class="ap-row"><button class="ap-btn" data-act="route-show" data-i="' + i + '">SHOW</button><button class="ap-btn on" data-act="route-use" data-i="' + i + '">USE THIS</button></div>' +
           ((plan.show || 0) === i ? routeDetail(r) : '') + '</div>';
    });
    if(plan.netWhy) h += '<div class="ap-dim">No trails-and-roads route: ' + esc(plan.netWhy) + '.</div>';
    if(plan.gridWhy) h += '<div class="ap-dim">No over-the-ground route: ' + esc(plan.gridWhy) + '.</div>';
    if(plan.osmErr) h += '<div class="ap-dim">Path data: ' + esc(plan.osmErr) + '.</div>';
    return h + '<div class="ap-row"><button class="ap-btn" data-act="route-cancel">CANCEL</button></div>';
  }
  if(plan && plan.note) h += '<div class="ap-bad">' + esc(plan.note) + '</div>';
  if(ROUTE && target && dist(ROUTE.to, [target.lat, target.lon]) < 50){
    var f = routeFix();
    h += '<div class="ap-row"><button class="ap-btn" data-act="route-plan">PLAN AGAIN WITH THESE SETTINGS</button></div>';
    h += '<div><b>' + modeName(ROUTE) + '</b> to ' + esc(ROUTE.name) + ', planned ' + new Date(ROUTE.made).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) +
         (ROUTE.saving ? ' &middot; saving the map along it…' : ROUTE.tiles ? ' &middot; map along it saved (' + esc(ROUTE.tiles) + ' tiles)' :
          ' &middot; <span class="ap-warn">map along it not saved' + (ROUTE.tileErr ? ' (no tiles arrived; try SAVE MAP ALONG IT with signal)' : '') + '</span>') + '</div>';
    if(f) h += '<div class="' + (f.offRoute ? 'ap-bad' : 'ap-good') + '">' + (f.offRoute ? 'OFF ROUTE by ' + fmtDist(f.off) : 'On route') + ' &middot; ' + fmtMi(f.left) + ' and about ' + fmtDur(f.tl*1000) + ' to go</div>';
    h += routeSummary(ROUTE) + routeDetail(ROUTE, f);
    h += '<div class="ap-row"><button class="ap-btn" data-act="route-plan">PLAN AGAIN (settings at the top)</button>' +
         (ROUTE.tiles || ROUTE.saving ? '' : '<button class="ap-btn" data-act="route-save">SAVE MAP ALONG IT</button>') +
         '<button class="ap-btn" data-act="route-gpx">EXPORT GPX</button><button class="ap-btn warn" data-act="route-del">DELETE ROUTE</button></div>';
    return h;
  }
  return h + '<div class="ap-row"><button class="ap-btn on" data-act="route-plan">&#129406; PLAN A ROUTE</button></div>' +
    '<div class="ap-dim">Needs signal once (OpenStreetMap paths and roads, AWS terrain heights, and for public land only the Forest Service and PAD-US land maps; a few MB). ' +
    'Finds a trails-and-roads route and the quickest way over the ground, ' +
    'with climb, time, steep ground, crossings, water and ways out, then keeps the route and the map along it on the phone.</div>';
}
function routeGpx(){
  if(!ROUTE) return;
  var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="Appalachian Intel - Appalachistan" xmlns="http://www.topografix.com/GPX/1/1">',
             '<rte><name>' + esc('Route to ' + ROUTE.name) + '</name>'];
  ROUTE.pts.forEach(function(p){ out.push('<rtept lat="' + p[0] + '" lon="' + p[1] + '">' + (p[2] != null ? '<ele>' + p[2] + '</ele>' : '') + '</rtept>'); });
  out.push('</rte></gpx>');
  download('route-' + String(ROUTE.name).replace(/[^\w-]+/g, '-').slice(0, 30) + '.gpx', out.join('\n'));
}

/* ----------------------------------------------------------- library
   Real public-domain manuals (library_fetch.py puts them in library/). The
   list loads when the box is opened; SAVE keeps a PDF on the phone, and the
   service worker hands it back with no signal. */
var LIB_CACHE = 'tb-library-v1';
function libPaint(){
  var el = $('apLibList'); if(!el) return;
  var get = function(u){ return fetch(u, {cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); };
  get('library/index.json').catch(function(){
    return ('caches' in window) ? caches.open(LIB_CACHE).then(function(c){ return c.match('library/index.json'); })
      .then(function(r){ if(!r) throw new Error('not saved'); return r.json(); }) : Promise.reject(new Error('offline'));
  }).then(function(ix){
    var docs = ix.docs || [];
    return Promise.all(docs.map(function(d){
      return ('caches' in window) ? caches.open(LIB_CACHE).then(function(c){ return c.match(d.file); }).then(function(h){ d._saved = !!h; return d; }) : d;
    })).then(function(docs){
      el.className = '';
      el.innerHTML = docs.map(function(d){
        return '<div class="ap-lib-doc"><div class="t">' + esc(d.title) + '</div><div class="ap-dim">' + esc(d.publisher) + (d.year ? ', ' + d.year : '') +
          (d.pages ? ' &middot; ' + d.pages + ' pages' : '') + ' &middot; ' + (d.bytes/1048576).toFixed(1) + ' MB' +
          (d.shrunk ? ' (images reduced to about 150 dpi to fit a phone)' : '') + '</div><div>' + esc(d.about) + '</div>' +
          '<div class="ap-row"><a class="ap-btn" style="text-decoration:none" href="' + esc(d.file) + '" target="_blank" rel="noopener">OPEN</a>' +
          (d._saved ? '<span class="ap-good">saved on this phone</span> <button class="ap-btn" data-lib-del="' + esc(d.file) + '">REMOVE</button>'
                    : '<button class="ap-btn" data-lib-save="' + esc(d.file) + '">&#11015; SAVE FOR OFFLINE</button>') + '</div>' +
          (d.note ? '<div class="' + (/out of date/.test(d.note) ? 'ap-warn' : 'ap-dim') + '">' + esc(d.note) + '</div>' : '') + '</div>';
      }).join('') + '<div class="ap-dim">' + esc(ix.license || '') + ' Sources: ' + docs.map(function(d){
        return '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.publisher) + '</a>'; }).join(', ') + '.</div>' +
        (docs.length ? '<div class="ap-row"><button class="ap-btn" data-lib-save="*">SAVE ALL (' + (docs.reduce(function(a, d){ return a + (d.bytes || 0); }, 0)/1048576).toFixed(1) + ' MB)</button></div>' : '');
      el._docs = docs;
    });
  }).catch(function(){
    el.className = 'ap-dim';
    el.textContent = navigator.onLine ? 'The library is not on the site yet; it is fetched by a scheduled job. Check back soon.'
                                      : 'No signal, and the library has not been saved on this phone yet.';
  });
}
(function(){
  var box = $('apLib'); if(!box) return;
  box.addEventListener('toggle', function(){ if(box.open) libPaint(); });
  $('apLibList').addEventListener('click', function(e){
    var sv = e.target.closest('[data-lib-save]'), dl = e.target.closest('[data-lib-del]');
    if(!('caches' in window) || (!sv && !dl)) return;
    if(dl){ caches.open(LIB_CACHE).then(function(c){ return c.delete(dl.dataset.libDel); }).then(libPaint); return; }
    var files = sv.dataset.libSave === '*' ? ($('apLibList')._docs || []).map(function(d){ return d.file; }) : [sv.dataset.libSave];
    sv.disabled = true; sv.textContent = 'saving\u2026';
    if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function(){});
    caches.open(LIB_CACHE).then(function(c){ return c.addAll(['library/index.json'].concat(files)); })
      .then(libPaint).catch(function(){ sv.disabled = false; sv.textContent = 'could not save (signal?)'; });
  });
})();

/* ------------------------------------------------------------ panel */
function kv(k, v){ return '<div class="ap-kv"><span>' + esc(k) + '</span><b>' + v + '</b></div>'; }
function showTab(t){
  tab = t;
  document.querySelectorAll('#apTabs .ap-tab').forEach(function(b){ b.classList.toggle('on', b.dataset.tab === t); });
  if(t !== 'measure' && measure.on){ measure.on = false; }
  paintPanel();
}
document.querySelectorAll('#apTabs .ap-tab').forEach(function(b){ b.onclick = function(){ start(); showTab(b.dataset.tab); }; });

function gpsLine(){
  if(watchId == null) return '<div class="ap-row"><button class="ap-btn ap-gps" data-act="locate">&#9678; START GPS</button>' +
    '<span class="ap-dim">Uses the phone’s own GPS. No signal needed, but give it a clear view of the sky.</span></div>';
  if(!me) return '<div class="ap-row"><span class="ap-warn">' + esc(lastGpsErr || 'Waiting for a GPS fix…') + '</span></div>';
  var age = Math.round((Date.now() - me.t)/1000);
  return '';
}
/* GPS on or off from any tab. It needs no signal, so it belongs everywhere,
   OFFLINE above all. */
function gpsBar(){
  if(watchId == null) return '<div class="ap-row"><button class="ap-btn ap-gps" data-act="locate">&#9678; START GPS</button>' +
    '<span class="ap-dim">GPS works with no signal and in airplane mode.</span></div>';
  return '<div class="ap-row"><span class="' + (me ? '' : 'ap-warn') + '">&#9678; GPS on' +
    (me ? ' &middot; \u00b1' + Math.round(me.acc) + ' m' : ' &middot; ' + esc(lastGpsErr || 'waiting for a fix\u2026')) + '</span>' +
    '<button class="ap-btn" data-act="stop">STOP GPS</button></div>';
}
function paintPanel(){
  var el = $('apPanel'); if(!el) return;
  var h = '';
  var here = me ? [me.lat, me.lon] : (map ? [map.getCenter().lat, map.getCenter().lng] : null);

  if(tab !== 'here' && tab !== 'sos') h += gpsBar();
  if(tab === 'here'){
    h += gpsLine();
    if(me){
      var age = Math.round((Date.now() - me.t)/1000);
      h += '<h4>YOUR POSITION &middot; GPS ±' + Math.round(me.acc) + ' m' + (age > 30 ? ' &middot; <span class="ap-warn">' + age + ' s old</span>' : '') + '</h4>';
      if(me.acc > 100) h += '<div class="ap-warn">Accuracy is poor (±' + Math.round(me.acc) + ' m). Wait for a better fix before relying on it.</div>';
      h += '<div class="ap-grid wide">' + coordRows(me.lat, me.lon).map(function(r){ return kv(r[0], '<span class="ap-coord">' + r[1] + '</span>'); }).join('') + '</div>';
      h += '<div class="ap-grid">' +
        kv('GPS ALTITUDE', me.alt == null ? 'not reported' : fmtEle(me.alt) + (me.altAcc ? ' ±' + Math.round(me.altAcc) + ' m' : '')) +
        kv('SPEED', me.spd == null || !isFinite(me.spd) ? '—' : (me.spd*2.23694).toFixed(1) + ' mph') +
        kv('HEADING', heading() == null ? 'move, or turn on the compass' : Math.round(heading()) + '° ' + card(heading()) + (compassOn ? ' (compass, magnetic)' : ' (GPS course, true)')) +
        kv('SCREEN', wakeLock ? 'kept on while GPS runs' : ('wakeLock' in navigator ? 'may sleep' : 'this browser cannot keep it on')) +
        '</div>';
      h += '<div class="ap-row"><button class="ap-btn" data-act="compass">' + (compassOn ? 'COMPASS ON' : 'COMPASS') + '</button>' +
           '<button class="ap-btn" data-act="wpt-here">SAVE WAYPOINT HERE</button>' +
           '<button class="ap-btn" data-act="stop">STOP GPS</button></div>';
    }
    if(here){
      var t = onTrail(here);
      h += '<h4>ON THE TRAIL' + (me ? '' : ' &middot; <span class="ap-dim">for the map centre (no GPS fix)</span>') + '</h4>';
      if(!DATA) h += '<div class="ap-dim">loading trail data…</div>';
      else if(DATA.error) h += '<div class="ap-warn">Trail data is not on this site yet (' + esc(DATA.error) + '). It is built on the next site refresh; the maps work without it.</div>';
      else if(!t) h += '<div class="ap-dim">Trail miles appear once the whole trail is in the data' +
        (DATA.sections ? ' (' + DATA.sections.lines + ' of ' + DATA.sections.total + ' sections so far; it fills in daily)' : '') + '.</div>';
      else {
        var whole = CUM[CUM.length-1], OFFICIAL = 2197;
        h += '<div class="ap-grid">' + kv('AT MILE', '≈ ' + t.mile.toFixed(1) + ' <span class="ap-dim">of ' + whole.toFixed(0) + '</span>') +
             kv('OFF TRAIL', fmtDist(t.off)) + '</div>';
        /* Said plainly, with this build's own numbers: OSM's line is smoother
           than the trail on the ground, so these miles read low, more so the
           further north you are. */
        if(whole < OFFICIAL - 5)
          h += '<div class="ap-dim">Measured on OpenStreetMap\u2019s line, this build makes the whole trail ' + whole.toFixed(0) +
               ' miles against the official ~' + OFFICIAL.toLocaleString() + ', so its mile numbers read below a guidebook\u2019s ' +
               '\u2014 by about ' + Math.round(OFFICIAL - whole) + ' at Katahdin, less further south. Distances between nearby points are close.</div>';
        if(t.off < 3000){
          h += '<div class="ap-list">';
          [['water','Water'],['shelter','Shelter'],['camp','Campsite']].forEach(function(k){
            var a = alongTrail(t.mile, k[0]);
            [['NOBO', a.nobo], ['SOBO', a.sobo]].forEach(function(d){
              if(!d[1]) return;
              var p = d[1];
              h += '<div class="ap-li"><span><small>' + k[1].toUpperCase() + ' ' + d[0] + '</small> <span class="nm">' + esc(p.name || 'unnamed') +
                   '</span></span><span><b>' + Math.abs(p.mile - t.mile).toFixed(1) + ' trail mi</b> <small>mile ' + p.mile.toFixed(1) + '</small> ' +
                   '<button class="ap-btn" data-ap-goto="' + p.lat + ',' + p.lon + '" data-ap-name="' + esc(p.name || KIND_ONE[p.k]) + '">GO</button></span></div>';
            });
          });
          h += '</div><div class="ap-dim" style="margin-top:4px">NOBO = northbound toward Katahdin, SOBO = southbound toward Springer.</div>' +
               '<div class="ap-warn" style="margin-top:4px">Water: OpenStreetMap has only a fraction of the trail\u2019s springs and streams, so a long gap here does <b>not</b> mean there is no water \u2014 and a listed spring can be dry. Plan water from a current guide or recent hiker reports, not from this list.</div>';
        } else h += '<div class="ap-dim">More than 3 km from the trail, so nothing is listed by trail mile. Nearest by straight line:</div>';
      }
      if(POIS.length){
        h += '<h4>NEAREST, STRAIGHT LINE</h4><div class="ap-list">';
        ['shelter','water','trailhead','town'].forEach(function(k){
          nearest(here, k, 1).forEach(function(r){
            h += '<div class="ap-li"><span><small>' + KIND_ONE[k].toUpperCase() + '</small> <span class="nm">' + esc(r.p.name || 'unnamed') +
                 '</span></span><span><b>' + fmtDist(r.d) + '</b> <small>' + card(bearing(here, [r.p.lat, r.p.lon])) + '</small> ' +
                 '<button class="ap-btn" data-ap-goto="' + r.p.lat + ',' + r.p.lon + '" data-ap-name="' + esc(r.p.name || KIND_ONE[k]) + '">GO</button></span></div>';
          });
        });
        h += '</div>';
      }
      var sun = sunDay(here[0], here[1]), now = Date.now();
      h += '<h4>DAYLIGHT</h4><div class="ap-grid">' + kv('SUNRISE', clock(sun.rise)) + kv('SUNSET', clock(sun.set)) +
           kv('LAST USEFUL LIGHT', clock(sun.dusk)) +
           kv('DAYLIGHT LEFT', sun.set && now < sun.set ? fmtDur(sun.set - now) : (sun.dusk && now < sun.dusk ? '<span class="ap-warn">sun is down; ' + fmtDur(sun.dusk - now) + ' of twilight</span>' : '<span class="ap-warn">dark</span>')) +
           '</div><div class="ap-dim">Computed on the phone for this spot. Deep valleys lose the sun earlier.</div>';
    }
  }

  else if(tab === 'goto'){
    if(!target) h += '<div class="ap-dim">Pick a destination: tap the map and choose GO TO (or GO on a waypoint, shelter or water source). Then plan a route here with these settings:</div>' +
                     '<h4>ROUTE SETTINGS</h4>' + modeBar();
    else {
      h += '<h4>GOING TO</h4><div class="ap-big">' + esc(target.name) + '</div>' +
           '<div class="ap-coord">' + usng(target.lat, target.lon) + ' &middot; ' + ddm(target.lat,'N','S',2) + ' ' + ddm(target.lon,'E','W',3) + '</div>';
      if(!me) h += gpsLine() || '<div class="ap-warn">Waiting for a GPS fix…</div>';
      else {
        var d = dist([me.lat, me.lon], [target.lat, target.lon]), b = bearing([me.lat, me.lon], [target.lat, target.lon]);
        var hd = heading();
        h += '<div class="ap-row"><svg class="ap-arrow" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="none" stroke="#334155" stroke-width="2"/>' +
             '<text x="32" y="11" text-anchor="middle" fill="#64748b" font-size="8" font-family="monospace">' + (hd == null ? 'N' : 'AHEAD') + '</text>' +
             '<g id="apGoArrow"><path d="M32 12 L42 40 L32 34 L22 40 Z" fill="#ef4444"/></g></svg>' +
             '<div><div class="ap-big">' + fmtDist(d) + '</div><div>bearing <b>' + Math.round(b) + '° true</b> (' + card(b) + ')' +
             (hd == null ? ' &middot; <span class="ap-dim">arrow points to true north-up; walk or turn on the compass for a heading</span>' : '') + '</div>' +
             '<div class="ap-dim">straight-line distance; the trail is usually longer. At 2 mph that is about ' + fmtDur(d/1609.344/2*3600e3) + '.</div></div></div>' +
             (compassOn ? '' : '<div class="ap-row"><button class="ap-btn" data-act="compass">&#129517; USE COMPASS</button><span class="ap-dim">so the arrow points the way to go, not north-up</span></div>');
        var tm = onTrail([me.lat, me.lon]), tt = onTrail([target.lat, target.lon]);
        if(tm && tt && tm.off < 1500 && tt.off < 1500)
          h += kv('ALONG THE TRAIL', '≈ ' + Math.abs(tt.mile - tm.mile).toFixed(1) + ' mi ' + (tt.mile > tm.mile ? 'northbound' : 'southbound'));
      }
      h += '<div class="ap-row"><button class="ap-btn" data-act="show-target">SHOW ON MAP</button><button class="ap-btn" data-act="clear-target">CLEAR</button></div>';
      h += routeBlock();
    }
  }

  else if(tab === 'track'){
    var st = trackStats();
    h += '<h4>TRACK &middot; ' + (TRACK.on ? '<span class="ap-bad">RECORDING</span>' : 'stopped') + '</h4>';
    h += '<div class="ap-grid">' + kv('DISTANCE', fmtDist(st.d)) + kv('ELAPSED', fmtDur(st.el)) + kv('MOVING', fmtDur(st.moving)) +
         kv('MOVING PACE', st.moving > 60000 ? (st.d/1609.344/(st.moving/3600e3)).toFixed(1) + ' mph' : '—') +
         kv('CLIMB / DESCENT', st.gain || st.loss ? '+' + Math.round(st.gain*3.28084) + ' / −' + Math.round(st.loss*3.28084) + ' ft <span class="ap-dim">(GPS, rough)</span>' : '—') +
         kv('POINTS', st.n.toLocaleString()) + '</div>';
    h += '<div class="ap-row"><button class="ap-btn' + (TRACK.on ? ' warn' : '') + '" data-act="track">' + (TRACK.on ? 'STOP RECORDING' : 'START RECORDING') + '</button>' +
         '<button class="ap-btn" data-act="gpx"' + (st.n || WPTS.length ? '' : ' disabled') + '>EXPORT GPX</button>' +
         '<button class="ap-btn" data-act="track-clear"' + (st.n ? '' : ' disabled') + '>CLEAR TRACK</button>' +
         '<button class="ap-btn on" data-act="pocket">&#9681; POCKET MODE</button></div>';
    h += '<div class="ap-dim">Records while this page is open and the screen is on; the screen is kept awake while GPS runs where the phone allows it. ' +
         'No web page can use GPS with the screen off, so for the pocket use POCKET MODE: the screen goes black and locked but stays on, and the track keeps recording. Points worse than ±50 m are skipped. The track is kept on this device and survives a reload; export it as GPX to keep it for good.</div>';
    h += '<h4>IMPORT A GPX</h4><div class="ap-row"><input type="file" id="apGpxIn" accept=".gpx,application/gpx+xml,application/xml,text/xml"></div>';
    if(GPX.length){
      h += '<div class="ap-list">' + GPX.map(function(g, i){
        return '<div class="ap-li"><span class="nm">' + esc(g.name) + '</span><span><small>' + g.lines.length + ' line(s), ' + g.wpts.length +
               ' point(s)</small> <button class="ap-btn" data-act="gpx-del" data-i="' + i + '">REMOVE</button></span></div>';
      }).join('') + '</div>';
    }
  }

  else if(tab === 'wpt'){
    h += '<div class="ap-row"><button class="ap-btn" data-act="wpt-here"' + (me ? '' : ' disabled') + '>SAVE WHERE I AM</button>' +
         '<button class="ap-btn" data-act="wpt-centre">SAVE MAP CENTRE</button>' +
         '<button class="ap-btn" data-act="gpx"' + (WPTS.length ? '' : ' disabled') + '>EXPORT GPX</button></div>';
    if(!WPTS.length) h += '<div class="ap-dim">No waypoints yet. Tap anywhere on the map and choose SAVE WAYPOINT, or save where you are.</div>';
    else h += '<div class="ap-list">' + WPTS.map(function(w, i){
      var d = me ? ' &middot; ' + fmtDist(dist([me.lat, me.lon], [w.lat, w.lon])) + ' ' + card(bearing([me.lat, me.lon], [w.lat, w.lon])) : '';
      return '<div class="ap-li"><span><span class="nm">' + esc(w.n) + '</span><br><small>' + usng(w.lat, w.lon) + d + '</small></span>' +
             '<span><button class="ap-btn" data-ap-goto="' + w.lat + ',' + w.lon + '" data-ap-name="' + esc(w.n) + '">GO</button> ' +
             '<button class="ap-btn" data-act="wpt-del" data-i="' + i + '">✕</button></span></div>';
    }).join('') + '</div>';
  }

  else if(tab === 'measure'){
    h += '<div class="ap-row"><button class="ap-btn' + (measure.on ? ' on' : '') + '" data-act="measure">' + (measure.on ? 'MEASURING: TAP THE MAP' : 'START MEASURING') + '</button>' +
         '<button class="ap-btn" data-act="measure-undo"' + (measure.pts.length ? '' : ' disabled') + '>UNDO</button>' +
         '<button class="ap-btn" data-act="measure-clear"' + (measure.pts.length ? '' : ' disabled') + '>CLEAR</button></div>';
    h += '<div class="ap-big">' + fmtDist(measureLen()) + '</div><div class="ap-dim">' + measure.pts.length + ' point(s). Tap along a trail or road to measure a route before walking it.</div>';
  }

  else if(tab === 'offline'){
    var B = BASES[baseKey], sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    h += '<h4>THIS DEVICE</h4>';
    h += '<div>' + (sw ? '<b>Offline mode is on.</b> The page, the map and the trail data open without signal.'
                       : ('serviceWorker' in navigator ? '<span class="ap-warn">Offline mode starts after the page is loaded once more.</span> Reload now while you have signal.'
                                                       : '<span class="ap-bad">This browser does not support offline pages.</span>')) + '</div>';
    h += '<div id="apStore" class="ap-dim"></div>';
    if(DATA && DATA.complete === false) h += '<div class="ap-warn">Trail data is still incomplete' +
      (DATA.sections ? ': ' + DATA.sections.lines + ' of ' + DATA.sections.total + ' sections, points for ' + DATA.sections.points + ' of ' + DATA.sections.with_ways : '') +
      '. It fills in daily; open the page with signal to pick up the rest.</div>';
    h += '<div class="ap-dim">Trail data built ' + (DATA && DATA.built_at ? esc(DATA.built_at.slice(0, 10)) : '—') +
         ' from OpenStreetMap. Every USGS map tile you look at is also kept, up to a limit.</div>';
    if(job && !job.finished){
      h += '<h4>SAVING ' + esc(job.label.toUpperCase()) + '</h4><div class="ap-prog"><i style="width:' + (job.done/job.total*100).toFixed(1) + '%"></i></div>' +
           '<div>' + job.done.toLocaleString() + ' of ' + job.total.toLocaleString() + ' tiles' + (job.fail ? ' &middot; ' + job.fail + ' failed' : '') + '</div>' +
           '<div class="ap-row"><button class="ap-btn warn" data-act="cancel">CANCEL</button></div>';
    } else if(job && job.finished){
      h += '<div class="' + (job.err ? 'ap-bad' : '') + '">' + (job.err || ('Saved ' + job.ok.toLocaleString() + ' tiles for ' + esc(job.label) + (job.fail ? ' (' + job.fail + ' could not be fetched)' : '') + '.')) + '</div>';
    }
    var srcs = saveSources();
    if(!srcs.length) h += '<div class="ap-warn" style="margin-top:8px">' + esc(B.name) + ' cannot be saved. Choose a USGS map or turn on the lidar hillshade (layers button on the map) to save.</div>';
    else if(map){
      var zmax = +load('ap_zmax', 15), b = map.getBounds(), bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
      var ztop = Math.max.apply(null, srcs.map(function(s){ return s.max; }));
      var z0 = Math.max(8, map.getZoom() - 3), z1 = Math.min(ztop, zmax);
      var sv = z1 >= z0 ? sizeOf(tilesForBounds(bb, z0, z1)) : {n:0, mb:0};
      h += '<h4>SAVE THIS VIEW &middot; ' + esc(srcs.map(function(s){ return s.name; }).join(' + ')) + '</h4>' +
           '<div class="ap-row">detail to <select id="apZmax">' + [13,14,15,16,17].map(function(z){
             return '<option value="' + z + '"' + (z === zmax ? ' selected' : '') + '>zoom ' + z +
                    (z === 17 ? ' (lidar, ~1 m)' : z === 16 ? ' (topo, finest)' : z === 13 ? ' (overview)' : '') + '</option>'; }).join('') +
           '</select> <b>' + sv.n.toLocaleString() + ' tiles</b> <span class="ap-dim">≈ ' + sv.mb + ' MB</span>' +
           '<button class="ap-btn" data-act="save-view"' + (job && !job.finished ? ' disabled' : '') + '>&#11015; SAVE</button></div>' +
           '<div class="ap-dim">Zoom 16 is the finest USGS topo (about 2 m a pixel); zoom 17 adds only the lidar hillshade, and only if it is switched on. Beyond what is saved the map still zooms in, enlarging the finest saved tile.</div>';
      if(PATH){
        var cm0 = +load('ap_cm0', 450), cm1 = +load('ap_cm1', 550);
        var sc = sizeOf(tilesForCorridor(cm0, cm1, 1.5, 10, z1));
        h += '<h4>SAVE A STRETCH OF TRAIL</h4><div class="ap-row">mile <input type="number" id="apCm0" min="0" step="1" value="' + cm0 + '"> to ' +
             '<input type="number" id="apCm1" min="0" step="1" value="' + cm1 + '"> <span class="ap-dim">1.5 km either side, zoom 10–' + z1 + '</span> ' +
             '<b>' + sc.n.toLocaleString() + ' tiles</b> <span class="ap-dim">≈ ' + sc.mb + ' MB</span>' +
             '<button class="ap-btn" data-act="save-corridor"' + (job && !job.finished ? ' disabled' : '') + '>&#11015; SAVE</button></div>' +
             '<div class="ap-dim">Tip: Virginia is roughly miles 470–1020 from Springer, North Carolina and the Smokies roughly 75–470 (OSM miles; the HERE tab gives the mile for any spot). Save a week’s stretch at a time.</div>';
      }
    }
    if(SAVED.length){
      h += '<h4>SAVED ON THIS DEVICE</h4><div class="ap-list">' + SAVED.map(function(s, i){
        return '<div class="ap-li"><span><span class="nm">' + esc(s.label) + '</span><br><small>' + s.n.toLocaleString() + ' tiles &middot; ' +
               esc((BASES[s.layer] || {}).name || s.layer) + ' &middot; zoom ' + s.z[0] + '–' + s.z[1] + ' &middot; ' + new Date(s.at).toLocaleDateString() + '</small></span>' +
               '<button class="ap-btn" data-act="saved-show" data-i="' + i + '">SHOW</button></div>';
      }).join('') + '</div><div class="ap-row"><button class="ap-btn warn" data-act="clear-saved">DELETE ALL SAVED MAPS</button></div>';
    }
  }

  else if(tab === 'sos'){
    var p = me ? [me.lat, me.lon] : here;
    if(!p) h += '<div class="ap-dim">Open the map to see your coordinates.</div>';
    else {
      h += '<h4>' + (me ? 'YOUR LOCATION &middot; GPS ±' + Math.round(me.acc) + ' m at ' + new Date(me.t).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})
                        : '<span class="ap-warn">NO GPS FIX — THIS IS THE MAP CENTRE, NOT YOU</span>') + '</h4>';
      h += '<div class="ap-big">' + p[0].toFixed(5) + ', ' + p[1].toFixed(5) + '</div>';
      h += '<div class="ap-big" style="font-size:1.15em">USNG ' + usng(p[0], p[1]) + '</div>';
      h += '<div class="ap-coord">' + ddm(p[0],'N','S',2) + ' ' + ddm(p[1],'E','W',3) + '</div>';
      var tr = onTrail(p);
      if(tr && tr.off < 3000) h += '<div>Appalachian Trail, about mile ' + tr.mile.toFixed(1) + ' from Springer' + (tr.off > 100 ? ', ' + fmtDist(tr.off) + ' off the trail' : '') + '.</div>';
      var msg = 'EMERGENCY. My location: ' + p[0].toFixed(5) + ', ' + p[1].toFixed(5) + ' (USNG ' + usng(p[0], p[1]) + ')' +
                (me ? ', GPS +/-' + Math.round(me.acc) + ' m' : ', approximate') + (tr && tr.off < 3000 ? ', near Appalachian Trail mile ' + tr.mile.toFixed(1) : '') +
                '. https://www.openstreetmap.org/?mlat=' + p[0].toFixed(5) + '&mlon=' + p[1].toFixed(5) + '#map=15/' + p[0].toFixed(5) + '/' + p[1].toFixed(5);
      h += smsAsk(msg);
      if(!me) h += gpsLine();
      if(POIS.length){
        h += '<h4>WAYS OUT</h4><div class="ap-list">';
        [['trailhead', 2], ['town', 2], ['shelter', 1]].forEach(function(k){
          nearest(p, k[0], k[1]).forEach(function(r){
            h += '<div class="ap-li"><span><small>' + KIND_ONE[k[0]].toUpperCase() + '</small> <span class="nm">' + esc(r.p.name || 'unnamed') + '</span></span>' +
                 '<span><b>' + fmtDist(r.d) + '</b> <small>' + Math.round(bearing(p, [r.p.lat, r.p.lon])) + '° ' + card(bearing(p, [r.p.lat, r.p.lon])) + '</small></span></div>';
          });
        });
        h += '</div><div class="ap-dim">Straight-line distance and true bearing. Stay on the trail unless you know the ground.</div>';
      }
    }
    h += sigBlock();
    h += '<div class="ap-row"><button class="ap-btn on" data-act="pocket">&#9681; POCKET MODE</button>' +
         '<a class="ap-btn" style="text-decoration:none" href="#apGuide" data-act="guide">SURVIVAL GUIDE &darr;</a></div>';
  }

  el.innerHTML = h;
  var st = $('apStore'); if(st) storageLine(st);
  if(tab === 'goto') drawArrow();
}

/* Sending a text is asked four times, and the last ask is the link that opens
   Messages, where Send still has to be pressed. A pocket or a slip should
   never send anyone a location. */
var smsStep = 0, smsTimer = null;
var SMS_ASKS = ['Text your location to someone? (1 of 4)',
                'Sure? It opens your Messages app with your coordinates written in. (2 of 4)',
                'Your exact position goes to whoever you pick. Still want to? (3 of 4)',
                'Last check: open Messages now? You still choose who and press Send. (4 of 4)'];
function smsAsk(msg){
  var h = '<div class="ap-row">';
  if(!smsStep) h += '<button class="ap-btn" data-act="sms-ask">&#9993; TEXT MY LOCATION</button>';
  else {
    h += '<span class="ap-warn">' + SMS_ASKS[smsStep - 1] + '</span></div><div class="ap-row">';
    h += smsStep < 4 ? '<button class="ap-btn" data-act="sms-ask">YES</button>'
                     : '<a class="ap-btn warn" style="text-decoration:none" data-act="sms-go" href="sms:?&body=' + encodeURIComponent(msg) + '">YES, OPEN MESSAGES</a>' +
                       (navigator.share ? '<button class="ap-btn" data-act="share" data-msg="' + esc(msg) + '">SHARE INSTEAD</button>' : '');
    h += '<button class="ap-btn" data-act="sms-no">NO</button>';
  }
  return h + '<button class="ap-btn" data-act="copy" data-msg="' + esc(msg) + '">COPY</button></div>' +
    (smsStep ? '' : '<div class="ap-dim">Asks four times before anything opens. A text waits in Messages and goes out by itself when one bar of signal appears.</div>');
}
function smsReset(){ smsStep = 0; clearTimeout(smsTimer); }

/* panel actions */
$('apPanel').addEventListener('change', function(e){
  if(e.target.id === 'apGpxIn' && e.target.files[0]) importGpx(e.target.files[0]);
  if(e.target.id === 'apZmax'){ store('ap_zmax', +e.target.value); paintPanel(); }
  if(e.target.id === 'apCm0' || e.target.id === 'apCm1'){
    store('ap_cm0', Math.max(0, +$('apCm0').value || 0)); store('ap_cm1', Math.max(0, +$('apCm1').value || 0)); paintPanel();
  }
});
$('apPanel').addEventListener('click', function(e){
  var b = e.target.closest('[data-act]'); if(!b) return;
  var a = b.dataset.act;
  if(a === 'locate'){ start(); if(map) startLocate(); else setTimeout(function(){ if(map) startLocate(); }, 900); }
  else if(a === 'stop') stopLocate();
  else if(a === 'compass') toggleCompass();
  else if(a === 'wpt-here' && me) addWpt(me.lat, me.lon);
  else if(a === 'wpt-centre' && map) addWpt(map.getCenter().lat, map.getCenter().lng);
  else if(a === 'wpt-del'){ WPTS.splice(+b.dataset.i, 1); store('ap_wpts', WPTS); drawWpts(); paintPanel(); }
  else if(a === 'track'){
    TRACK.on = !TRACK.on; saveTrack();
    if(TRACK.on && watchId == null) startLocate();
    paintPanel();
  }
  else if(a === 'pocket') pocketOn();
  else if(a === 'sig-check') signalCheck(true);
  else if(a === 'route-plan') planRoute();
  else if(a === 'land-show'){ start(); landShow(); }
  else if(a === 'rmode'){ RMODE[b.dataset.k] = b.dataset.v === '1'; store('ap_rmode', RMODE); paintPanel(); }
  else if(a === 'route-show' && plan){ plan.show = +b.dataset.i; drawRoutes(); fitRoute(plan.opts[plan.show]); paintPanel(); }
  else if(a === 'route-use') useRoute(+b.dataset.i);
  else if(a === 'route-cancel'){ plan = null; drawRoutes(); paintPanel(); }
  else if(a === 'route-save') saveAlongRoute();
  else if(a === 'route-gpx') routeGpx();
  else if(a === 'route-del'){ if(confirm('Delete the saved route?')){ ROUTE = null; store('ap_route', null); drawRoutes(); drawTarget(); paintPanel(); } }
  else if(a === 'guide'){ var g = $('apGuide'); if(g) g.open = true; }
  else if(a === 'sms-ask'){ smsStep = Math.min(4, smsStep + 1); clearTimeout(smsTimer); smsTimer = setTimeout(function(){ smsReset(); paintPanel(); }, 60000); paintPanel(); }
  else if(a === 'sms-no'){ smsReset(); paintPanel(); }
  else if(a === 'sms-go'){ smsReset(); setTimeout(paintPanel, 500); }
  else if(a === 'track-clear'){ if(confirm('Delete the recorded track from this device?')){ TRACK.pts = []; saveTrack(); drawTrack(); paintPanel(); } }
  else if(a === 'gpx') download('appalachistan-' + new Date().toISOString().slice(0,10) + '.gpx', gpxText());
  else if(a === 'gpx-del'){ GPX.splice(+b.dataset.i, 1); store('ap_gpx', GPX); drawGpx(); paintPanel(); }
  else if(a === 'measure'){ measure.on = !measure.on; paintPanel(); }
  else if(a === 'measure-undo'){ measure.pts.pop(); if(measure.line) measure.line.setLatLngs(measure.pts); var ms = measure.marks && measure.marks.getLayers(); if(ms && ms.length) measure.marks.removeLayer(ms[ms.length-1]); paintPanel(); }
  else if(a === 'measure-clear'){ measureClear(); paintPanel(); }
  else if(a === 'show-target' && target && map){ map.setView([target.lat, target.lon], Math.max(map.getZoom(), 14)); follow = false; $('apFollow').classList.remove('on'); }
  else if(a === 'clear-target'){ target = null; store('ap_target', null); if(targetLine){ map.removeLayer(targetLine); targetLine = null; } plan = null; drawRoutes(); drawHud(); paintPanel(); }
  else if(a === 'save-view' && map){
    var bb = map.getBounds(), z0 = Math.max(8, map.getZoom() - 3),
        z1 = Math.min(Math.max.apply(null, saveSources().map(function(s){ return s.max; }).concat([8])), +load('ap_zmax', 15));
    var box = [bb.getSouth(), bb.getWest(), bb.getNorth(), bb.getEast()];
    var c = map.getCenter();
    runSave('view at ' + c.lat.toFixed(3) + ', ' + c.lng.toFixed(3), tilesForBounds(box, z0, z1), box, [z0, z1]);
  }
  else if(a === 'save-corridor'){
    var m0 = +load('ap_cm0', 450), m1 = +load('ap_cm1', 550),
        zz = Math.min(Math.max.apply(null, saveSources().map(function(s){ return s.max; }).concat([10])), +load('ap_zmax', 15));
    if(m1 <= m0){ alert('The second mile must be larger than the first.'); return; }
    var seg = PATH.filter(function(p, i){ return CUM[i] >= m0 && CUM[i] <= m1; });
    var lats = seg.map(function(p){ return p[0]; }), lons = seg.map(function(p){ return p[1]; });
    runSave('AT miles ' + m0 + '–' + m1, tilesForCorridor(m0, m1, 1.5, 10, zz),
            [Math.min.apply(null, lats), Math.min.apply(null, lons), Math.max.apply(null, lats), Math.max.apply(null, lons)], [10, zz]);
  }
  else if(a === 'cancel' && job){ job.cancel = true; }
  else if(a === 'saved-show' && map){ var s = SAVED[+b.dataset.i]; map.fitBounds([[s.b[0], s.b[1]], [s.b[2], s.b[3]]]); }
  else if(a === 'clear-saved'){
    if(!confirm('Delete every saved map from this device? You will need signal to save them again.')) return;
    caches.delete(TILE_CACHE).then(function(){ SAVED = []; store('ap_saved', SAVED); job = null; paintPanel(); });
  }
  else if(a === 'copy'){
    var m = b.dataset.msg;
    (navigator.clipboard ? navigator.clipboard.writeText(m) : Promise.reject()).then(function(){ b.textContent = 'COPIED'; })
      .catch(function(){ prompt('Copy this:', m); });
  }
  else if(a === 'share'){ smsReset(); navigator.share({text:b.dataset.msg}).catch(function(){}); paintPanel(); }
});

window.APPALACHISTAN = {start:start, usng:usng, utm:utm, sunDay:sunDay, onTrail:onTrail, dist:dist, bearing:bearing,
                        tilesForCorridor:tilesForCorridor, get map(){ return map; }};
})();
