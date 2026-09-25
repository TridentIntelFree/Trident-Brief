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
if('IntersectionObserver' in window){
  var io = new IntersectionObserver(function(es){
    if(es.some(function(e){ return e.isIntersecting; })){ io.disconnect(); start(); }
  }, {rootMargin:'400px'});
  io.observe(BAND);
}
var sb = $('apStart'); if(sb) sb.onclick = start;
if(location.hash === '#appBand') start();

function init(){
  var L = window.L;
  $('apMap').innerHTML = '';
  map = L.map('apMap', {preferCanvas:true, zoomControl:true, minZoom:5, maxZoom:19, worldCopyJump:false,
                        tap:true, attributionControl:true});
  var view = load('ap_view', null);
  if(view && view.c && isFinite(view.z)) map.setView(view.c, view.z);
  else map.fitBounds([[35.0,-84.3],[39.4,-77.6]]);
  map.on('moveend', function(){ store('ap_view', {c:[map.getCenter().lat, map.getCenter().lng], z:map.getZoom()}); refreshKinds(); if(tab === 'offline') paintPanel(); });

  var bases = {}, baseObjs = {};
  Object.keys(BASES).forEach(function(k){
    var b = BASES[k];
    baseObjs[k] = L.tileLayer(b.url, {maxNativeZoom:b.max, maxZoom:19, subdomains:'abc', attribution:b.attr,
                                      keepBuffer:3, crossOrigin: false});
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
    {maxZoom:19, maxNativeZoom:17, opacity:.85,
     attribution:'<a href="https://hiking.waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a> (CC-BY-SA)'});
  atLayer = L.layerGroup().addTo(map);
  wptLayer = L.layerGroup().addTo(map);
  gpxLayer = L.layerGroup().addTo(map);
  trackLine = L.polyline([], {color:'#ef4444', weight:4, opacity:.9}).addTo(map);
  var overlays = {'Appalachian Trail': atLayer, 'Lidar hillshade, ~1 m (from zoom 11)': lidarLayer,
                  'Hiking routes (online only)': hikingLayer,
                  'My track': trackLine, 'Waypoints': wptLayer, 'Imported GPX': gpxLayer};
  L.control.layers(bases, overlays, {collapsed:true}).addTo(map);
  L.control.scale({imperial:true, metric:true}).addTo(map);
  map.attributionControl.addAttribution('Trail data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>');
  map.on('click', onMapClick);

  buildKinds();
  buildJump();
  drawTrack(); drawWpts(); drawGpx();
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
  $('apLocate').classList.add('on');
  follow = true; $('apFollow').classList.add('on');
  keepAwake(true);
  paintPanel();
}
function stopLocate(){
  if(watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  $('apLocate').classList.remove('on');
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
    });
    paintPanel();
  };
  if(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function'){
    DeviceOrientationEvent.requestPermission().then(function(r){ if(r === 'granted') go(); else alert('Compass permission was refused.'); })
      .catch(function(){ alert('Compass is not available.'); });
  } else go();
}
$('apLocate').onclick = function(){ start(); var f = function(){ watchId == null ? startLocate() : stopLocate(); }; map ? f() : setTimeout(f, 900); };
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
    L.circleMarker([target.lat, target.lon], {radius:9, color:'#ef4444', weight:3, fill:false}),
    me ? L.polyline(pts, {color:'#ef4444', weight:2, dashArray:'6 6', interactive:false}) : L.layerGroup()
  ]).addTo(map);
}
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
    addWpt(parseFloat(q[0]), parseFloat(q[1]));
    if(map) map.closePopup();
  }
});

/* -------------------------------------------------------------- track */
function addTrackPoint(f, prev){
  if(f.acc > 50) return;                       // a wild fix is worse than none
  var pts = TRACK.pts, last = pts[pts.length - 1];
  if(last && dist([last[1], last[2]], [f.lat, f.lon]) < Math.max(5, f.acc/2)) return;
  pts.push([Math.round(f.t/1000), +f.lat.toFixed(6), +f.lon.toFixed(6), f.alt == null ? null : Math.round(f.alt*10)/10]);
  if(pts.length % 5 === 0 || pts.length < 5) saveTrack();
  drawTrack();
}
function saveTrack(){
  if(!store('ap_track', TRACK)) lastGpsErr = 'Track too large to save on this device; export it as GPX.';
}
function drawTrack(){
  if(trackLine) trackLine.setLatLngs(TRACK.pts.map(function(p){ return [p[1], p[2]]; }));
}
function trackStats(){
  var pts = TRACK.pts, d = 0, moving = 0, gain = 0, loss = 0, ref = null;
  for(var i = 1; i < pts.length; i++){
    var s = dist([pts[i-1][1], pts[i-1][2]], [pts[i][1], pts[i][2]]), dt = pts[i][0] - pts[i-1][0];
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
  WPTS.push({n:String(n).slice(0, 60) || 'Waypoint', lat:+lat.toFixed(6), lon:+lon.toFixed(6), t:Date.now()});
  store('ap_wpts', WPTS);
  drawWpts();
  if(tab === 'wpt') paintPanel();
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
    out.push('<trk><name>Track ' + new Date(TRACK.pts[0][0]*1000).toISOString().slice(0,10) + '</name><trkseg>');
    TRACK.pts.forEach(function(p){
      out.push('<trkpt lat="' + p[1] + '" lon="' + p[2] + '">' + (p[3] != null ? '<ele>' + p[3] + '</ele>' : '') +
               '<time>' + new Date(p[0]*1000).toISOString() + '</time></trkpt>');
    });
    out.push('</trkseg></trk>');
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
function onMapClick(e){
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
function paintPanel(){
  var el = $('apPanel'); if(!el) return;
  var h = '';
  var here = me ? [me.lat, me.lon] : (map ? [map.getCenter().lat, map.getCenter().lng] : null);

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
        h += '<div class="ap-grid">' + kv('AT MILE', '≈ ' + t.mile.toFixed(1) + ' <span class="ap-dim">of ' + CUM[CUM.length-1].toFixed(0) + '</span>') +
             kv('OFF TRAIL', fmtDist(t.off)) + '</div>';
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
          h += '</div><div class="ap-dim" style="margin-top:4px">NOBO = northbound toward Katahdin, SOBO = southbound toward Springer. Only water mapped in OpenStreetMap is listed; springs run dry, so carry enough to reach the next two.</div>';
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
    if(!target) h += '<div class="ap-dim">Pick a destination: tap GO TO on any shelter, water source, waypoint or map point.</div>';
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
             '<div class="ap-dim">straight-line distance; the trail is usually longer. At 2 mph that is about ' + fmtDur(d/1609.344/2*3600e3) + '.</div></div></div>';
        var tm = onTrail([me.lat, me.lon]), tt = onTrail([target.lat, target.lon]);
        if(tm && tt && tm.off < 1500 && tt.off < 1500)
          h += kv('ALONG THE TRAIL', '≈ ' + Math.abs(tt.mile - tm.mile).toFixed(1) + ' mi ' + (tt.mile > tm.mile ? 'northbound' : 'southbound'));
      }
      h += '<div class="ap-row"><button class="ap-btn" data-act="show-target">SHOW ON MAP</button><button class="ap-btn" data-act="clear-target">CLEAR</button></div>';
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
         '<button class="ap-btn" data-act="track-clear"' + (st.n ? '' : ' disabled') + '>CLEAR TRACK</button></div>';
    h += '<div class="ap-dim">Records while this page is open and the screen is on; the screen is kept awake while GPS runs where the phone allows it. Points worse than ±50 m are skipped. The track is kept on this device and survives a reload; export it as GPX to keep it for good.</div>';
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
    h += '<div class="ap-row"><a class="ap-btn warn" href="tel:911" style="text-decoration:none">&#128222; CALL 911</a>' +
         '<span class="ap-dim">Call if you can; text 911 if you can’t. Text-to-911 works in many US counties, not all. A text can get through on a signal too weak for a call.</span></div>';
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
      h += '<div class="ap-row"><a class="ap-btn" style="text-decoration:none" href="sms:?&body=' + encodeURIComponent(msg) + '">&#9993; TEXT MY LOCATION</a>' +
           '<button class="ap-btn" data-act="copy" data-msg="' + esc(msg) + '">COPY</button>' +
           (navigator.share ? '<button class="ap-btn" data-act="share" data-msg="' + esc(msg) + '">SHARE</button>' : '') + '</div>';
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
  }

  el.innerHTML = h;
  var st = $('apStore'); if(st) storageLine(st);
  if(tab === 'goto') drawArrow();
}

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
  if(a === 'locate') startLocate();
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
  else if(a === 'track-clear'){ if(confirm('Delete the recorded track from this device?')){ TRACK.pts = []; saveTrack(); drawTrack(); paintPanel(); } }
  else if(a === 'gpx') download('appalachistan-' + new Date().toISOString().slice(0,10) + '.gpx', gpxText());
  else if(a === 'gpx-del'){ GPX.splice(+b.dataset.i, 1); store('ap_gpx', GPX); drawGpx(); paintPanel(); }
  else if(a === 'measure'){ measure.on = !measure.on; paintPanel(); }
  else if(a === 'measure-undo'){ measure.pts.pop(); if(measure.line) measure.line.setLatLngs(measure.pts); var ms = measure.marks && measure.marks.getLayers(); if(ms && ms.length) measure.marks.removeLayer(ms[ms.length-1]); paintPanel(); }
  else if(a === 'measure-clear'){ measureClear(); paintPanel(); }
  else if(a === 'show-target' && target && map){ map.setView([target.lat, target.lon], Math.max(map.getZoom(), 14)); follow = false; $('apFollow').classList.remove('on'); }
  else if(a === 'clear-target'){ target = null; store('ap_target', null); if(targetLine){ map.removeLayer(targetLine); targetLine = null; } paintPanel(); }
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
  else if(a === 'share'){ navigator.share({text:b.dataset.msg}).catch(function(){}); }
});

window.APPALACHISTAN = {start:start, usng:usng, utm:utm, sunDay:sunDay, onTrail:onTrail, dist:dist, bearing:bearing,
                        tilesForCorridor:tilesForCorridor, get map(){ return map; }};
})();
