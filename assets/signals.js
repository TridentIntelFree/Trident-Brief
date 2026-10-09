/* =====================================================================
   SIGNALS -- a live shortwave tuner, what radio monitors report, and an
   in-browser spectrum analyzer

   The tuner plays a public KiwiSDR receiver live in the page (presets,
   free tuning and a scan) and feeds the analyzer, which also takes the
   sound of another tab (desktop Chrome / Edge), the microphone, or a file;
   nothing is uploaded. The detectors are heuristics and say so: the
   Buzzer's pulse rate is measured from the envelope's periodicity, and a
   "voice?" mark is sustained, changing energy in the speech band that does
   not carry the Buzzer's own harmonic comb.
   ===================== */
(function(){
'use strict';
var BAND = document.getElementById('sigBand');
if(!BAND) return;
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function utc(ms){ return new Date(ms).toISOString().slice(11, 19) + 'Z'; }
function fmtHz(f){ return f >= 1000 ? (f/1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : Math.round(f) + ' Hz'; }

/* ------------------------------------------------- real recordings */
/* The retired relay's recordings stay on the repository's radio-data branch. */
var RADIO = 'https://raw.githubusercontent.com/' +
  ((typeof GH_REPO !== 'undefined' && GH_REPO) || 'TridentIntelFree/Trident-Brief') + '/radio-data/';
function ago(iso){
  var m = Math.max(0, Math.round((Date.now() - Date.parse(iso))/60000));
  return m < 60 ? m + ' min ago' : m < 2880 ? Math.round(m/60) + ' h ago' : Math.round(m/1440) + ' days ago';
}
async function clipBlob(rel){
  var r = await fetch(RADIO + rel, {cache:'no-store'});
  if(!r.ok) throw new Error('HTTP ' + r.status);
  return new Blob([await r.arrayBuffer()], {type:'audio/mpeg'});      // raw files come untyped
}
var player = null, playing = null;
async function playClip(rel, btn){
  if(player && playing === rel){ player.pause(); player = null; playing = null; btn.innerHTML = '&#9654; PLAY'; return; }
  if(player){ player.pause(); }
  BAND.querySelectorAll('.sig-play').forEach(function(b){ b.innerHTML = '&#9654; PLAY'; });
  btn.textContent = 'loading…';
  try{
    var url = URL.createObjectURL(await clipBlob(rel));
    player = new Audio(url); playing = rel;
    player.onended = function(){ btn.innerHTML = '&#9654; PLAY'; playing = null; };
    await player.play();
    btn.innerHTML = '&#10074;&#10074; STOP';
  }catch(e){ btn.innerHTML = '&#9654; PLAY'; status('That recording could not be played (' + esc(e.message) + ').', true); }
}
async function analyseClip(rel, label){
  status('Fetching ' + esc(label) + '…');
  try{
    var b = await clipBlob(rel);
    await openFile(new File([b], label + '.mp3', {type:'audio/mpeg'}));
    cv.scrollIntoView({behavior:'smooth', block:'center'});
  }catch(e){ status('That recording could not be fetched (' + esc(e.message) + ').', true); }
}
/* The relay that recorded these round the clock was retired on 7 October
   2026 in favour of live listening; what it caught stays playable here. */
function paintRadio(d){
  var box = $('sigLive'), ev = (d && d.events) || [];
  box.innerHTML = '<div class="sig-small" style="margin-bottom:6px">Recorded by the old receiver relay (retired 7 Oct 2026). ' +
    'Each was checked against its spectrogram; UVB-76 buzz once mislabelled as voice has been relabelled.</div>' +
    (ev.length ? '<div class="sig-events">' + ev.slice(0, 20).map(function(e){
      var secs = Math.round((e.voice || []).reduce(function(a, v){ return a + v[1] - v[0]; }, 0));
      return '<div class="sig-ev voice"><b>' + esc(e.at.slice(5, 16).replace('T', ' ')) + 'Z</b> ' + esc(e.name) + ' · ' + secs +
        ' s of voice · via ' + esc(e.rx || '?') + ' <button class="linkish sig-play" data-f="' + esc(e.file) + '" type="button">&#9654; PLAY</button> ' +
        '<button class="linkish sig-an" data-f="' + esc(e.file) + '" data-n="' + esc(e.name + ' ' + e.at.slice(0, 16)) + '" type="button">analyze</button></div>';
    }).join('') + '</div>' : '<div class="sig-empty">Nothing archived.</div>');
  box.querySelectorAll('.sig-play').forEach(function(b){ b.onclick = function(){ playClip(b.dataset.f, b); }; });
  box.querySelectorAll('.sig-an').forEach(function(b){ b.onclick = function(){ analyseClip(b.dataset.f, b.dataset.n); }; });
}
/* What the people who monitor these stations round the clock have reported
   on X in the last 48 hours, gathered once a day with the Analyst Desk. */
function paintReports(d){
  var box = $('sigReports'); if(!box) return;
  var r = (d && d.radio) || [];
  box.innerHTML = r.length ? r.map(function(x){
    return '<div class="sig-ev"><b>' + esc(String(x.at || '').slice(5, 16).replace('T', ' ')) + (x.at ? 'Z' : '') + '</b> ' +
      esc(x.station || '') + (x.khz ? ' · ' + esc(x.khz) + ' kHz' : '') + ' — ' + esc(x.what || '') +
      (x.by ? ' <span class="sig-small">(@' + esc(String(x.by).replace(/^@/, '')) + ')</span>' : '') +
      (/^https:\/\/(x|twitter)\.com\//.test(x.url || '') ? ' <a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">post</a>' : '') + '</div>';
  }).join('') : '<div class="sig-empty">' + (d && d.radio ? 'No activity reported by monitors in the last 48 hours.' :
                                              'Monitor reports appear after the next daily collection.') + '</div>';
  var at = $('sigReportsAt'); if(at && d && d.at) at.textContent = 'collected ' + ago(d.at);
}
function loadRadio(){
  fetch(RADIO + 'radio/radio.json?t=' + Date.now(), {cache:'no-store'})
    .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
    .then(paintRadio);
  fetch('data/analyst/desk.json', {cache:'no-store'})
    .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
    .then(paintReports);
}

/* ------------------------------------------------------ colour maps */
var MAPS = {
  thermal:[[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]],
  ocean:  [[2,6,23],[12,34,80],[18,78,140],[20,140,170],[80,200,170],[190,240,150],[250,255,210]],
  green:  [[0,8,0],[0,40,10],[0,90,20],[20,150,40],[80,210,80],[190,255,170]],
  gray:   [[0,0,0],[255,255,255]]
};
var LUT = null;
function buildLut(name){
  var stops = MAPS[name] || MAPS.thermal, lut = new Uint8ClampedArray(256*3);
  for(var i = 0; i < 256; i++){
    var t = i/255*(stops.length-1), k = Math.min(stops.length-2, Math.floor(t)), f = t - k;
    for(var c = 0; c < 3; c++) lut[i*3+c] = stops[k][c] + (stops[k+1][c] - stops[k][c])*f;
  }
  LUT = lut;
}

/* ----------------------------------------------------------- state */
var S = {
  mode:null, ctx:null, analyser:null, src:null, stream:null, rec:null, recChunks:[],
  running:false, paused:false, timer:null, raf:null,
  maxHz:3500, fft:4096, rowsPerSec:20, lo:-100, hi:-30, map:'thermal',
  rowTimes:[], env:[], sp:[], events:[], voiceOn:null, peak:null,
  file:null
};
/* identify & decode state (the code is further down) */
var DX = {tab:'id', on:{rtty:false, fax:false, sstv:false}, dec:{}, decim:null, ring:null, rpos:0, rfill:0, cw:null, busy:false,
          fxDrawn:0, pics:[]};
function set(k, v){ try{ localStorage.setItem('sig_' + k, JSON.stringify(v)); }catch(_){} }
function get(k, d){ try{ var v = localStorage.getItem('sig_' + k); return v == null ? d : JSON.parse(v); }catch(_){ return d; } }
S.maxHz = get('maxHz', 3500); S.fft = get('fft', 4096); S.map = get('map', 'thermal');
S.lo = get('lo', -100); S.hi = get('hi', -30); S.rowsPerSec = get('rps', 20);
buildLut(S.map);

var cv = $('sigCanvas'), g2 = cv.getContext('2d');
var SPEC_H = 70, AXIS_H = 18;                  // css px: spectrum strip, frequency axis
var wf = document.createElement('canvas'), wg = wf.getContext('2d');
function size(){
  if(!cv.clientWidth) return;                    // hidden or folded: measure again when it shows
  var dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight || 380;
  cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr);
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  var ww = Math.max(1, Math.round(w)), wh = Math.max(1, Math.round(h - SPEC_H - AXIS_H));
  if(wf.width !== ww || wf.height !== wh){
    var old = document.createElement('canvas'); old.width = wf.width; old.height = wf.height;
    if(wf.width) old.getContext('2d').drawImage(wf, 0, 0);
    wf.width = ww; wf.height = wh;
    wg.fillStyle = '#05070f'; wg.fillRect(0, 0, ww, wh);
    if(old.width) wg.drawImage(old, 0, 0, ww, Math.min(wh, old.height));
  }
  frame();
}
addEventListener('resize', function(){ if(!BAND.classList.contains('folded')) size(); });

/* ----------------------------------------------------- live sources */
function status(html, bad){ var el = $('sigStatus'); el.innerHTML = html; el.className = 'sig-status' + (bad ? ' bad' : ''); }
async function startLive(kind){
  stopAll();
  var stream;
  try{
    if(kind === 'tab'){
      stream = await navigator.mediaDevices.getDisplayMedia({video:true, audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
      stream.getVideoTracks().forEach(function(t){ t.stop(); });
      if(!stream.getAudioTracks().length){
        status('No audio was shared. Choose the receiver’s <b>tab</b> and tick <b>“Also share tab audio”</b>.', true);
        return;
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
    }
  }catch(e){
    status(kind === 'tab' ? 'Tab sharing was cancelled or is not supported in this browser (desktop Chrome or Edge).'
                          : 'The microphone was refused. Allow it for this site in the browser settings.', true);
    return;
  }
  var ctx = new (window.AudioContext || window.webkitAudioContext)();
  attach(kind, ctx, ctx.createMediaStreamSource(stream), stream,
         kind === 'tab' ? 'Listening to the shared tab' : 'Listening to the microphone',
         kind === 'tab' && $('sigMonitor').checked);                       // hear the tab here too
  stream.getAudioTracks()[0].addEventListener('ended', function(){ stopAll(); status('The shared audio ended.'); });
}
/* Any live source -- a shared tab, the microphone, the tuner -- runs through
   the same analyser and detectors from here. */
function attach(kind, ctx, src, stream, label, hear){
  S.ctx = ctx;
  S.stream = stream;
  S.src = src;
  S.analyser = S.ctx.createAnalyser();
  S.analyser.fftSize = S.fft; S.analyser.smoothingTimeConstant = 0;
  S.analyser.minDecibels = -140; S.analyser.maxDecibels = 0;
  S.src.connect(S.analyser);
  if(hear) S.analyser.connect(S.ctx.destination);
  S.mode = kind; S.running = true; S.paused = false;
  S.events = S.events.filter(function(ev){ return ev.at == null; }); paintEvents();   // drop a recording's marks
  S.rowTimes = []; S.sp = []; S.peak = null; detReset(S.ctx.sampleRate/DET_N);
  $('sigLiveBar').style.display = ''; $('sigFileBar').style.display = 'none';
  $('sigRec').disabled = !window.MediaRecorder;
  status(label + ' · sample rate ' + (S.ctx.sampleRate/1000).toFixed(1) + ' kHz · resolution ' +
         (S.ctx.sampleRate/S.fft).toFixed(1) + ' Hz');
  size();
  /* The audio itself is the clock: each block of 2048 samples runs the
     detectors and, when due, adds a waterfall row. Browsers slow timers in a
     background tab but keep audio running, so monitoring carries on while
     you look at another tab. The processor feeds a muted output only
     because it must be connected to run. */
  var sr = S.ctx.sampleRate, t0 = Date.now(), n = 0, nextRow = 0, win = new Float32Array(DET_N);
  for(var i = 0; i < DET_N; i++) win[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(DET_N - 1));
  S.proc = S.ctx.createScriptProcessor(DET_N, 1, 1);
  var mute = S.ctx.createGain(); mute.gain.value = 0;
  S.src.connect(S.proc); S.proc.connect(mute); mute.connect(S.ctx.destination);
  S.proc.onaudioprocess = function(e){
    if(!S.running) return;
    var x = e.inputBuffer.getChannelData(0), re = new Float32Array(DET_N), im = new Float32Array(DET_N);
    for(var i = 0; i < DET_N; i++) re[i] = x[i]*win[i];
    n += x.length;
    var now = t0 + n/sr*1000;
    detect(fftDb(re, im), sr, now);
    if(S.mode !== 'tuner') decFeed(x, sr);       // the tuner feeds the decoders its own 12 kHz audio
    if(now >= nextRow){ nextRow = Math.max(nextRow + 1000/S.rowsPerSec, now - 1000); liveRow(now); }
  };
  loop();
}
function stopAll(){
  S.job = null;
  tunerClose();
  if(S.proc){ S.proc.onaudioprocess = null; S.proc = null; }
  if(S.raf){ cancelAnimationFrame(S.raf); S.raf = null; }
  if(S.rec && S.rec.state !== 'inactive') S.rec.stop();
  if(S.stream) S.stream.getTracks().forEach(function(t){ t.stop(); });
  if(S.file && S.file.node){ try{ S.file.node.stop(); }catch(_){} }
  if(S.ctx){ S.ctx.close().catch(function(){}); }
  if(S.voiceOn) closeVoice();
  S.ctx = S.analyser = S.src = S.stream = null; S.running = false; S.mode = null;
}

/* one waterfall row per tick, from the analyser */
var fbuf = null;
function liveRow(now){
  if(!S.analyser || S.paused) return;
  var n = S.analyser.frequencyBinCount;
  if(!fbuf || fbuf.length !== n) fbuf = new Float32Array(n);
  S.analyser.getFloatFrequencyData(fbuf);
  pushRow(fbuf, S.ctx.sampleRate, now);
}
function pushRow(db, sr, when){
  var w = wf.width, h = wf.height, binHz = sr/2/db.length, maxBin = Math.min(db.length-1, Math.floor(S.maxHz/binHz));
  wg.drawImage(wf, 0, 0, w, h - 1, 0, 1, w, h - 1);          // scroll down one pixel
  var row = wg.createImageData(w, 1), d = row.data, span = S.hi - S.lo;
  for(var x = 0; x < w; x++){
    var b0 = Math.floor(x/w*maxBin), b1 = Math.max(b0 + 1, Math.floor((x+1)/w*maxBin)), v = -200;
    for(var b = b0; b < b1; b++) if(db[b] > v) v = db[b];
    var t = Math.max(0, Math.min(255, Math.round((v - S.lo)/span*255)));
    d[x*4] = LUT[t*3]; d[x*4+1] = LUT[t*3+1]; d[x*4+2] = LUT[t*3+2]; d[x*4+3] = 255;
  }
  wg.putImageData(row, 0, 0);
  S.rowTimes.unshift(when); if(S.rowTimes.length > h) S.rowTimes.length = h;
  /* a UTC tick every 10 s, drawn into the waterfall so it scrolls with it */
  if(Math.floor(when/10000) !== Math.floor((S.rowTimes[1] || 0)/10000)){
    wg.fillStyle = 'rgba(255,255,255,.35)'; wg.fillRect(0, 0, 6, 1);
    wg.font = '9px ui-monospace,monospace'; wg.fillStyle = 'rgba(226,232,240,.8)';
    wg.fillText(utc(when).slice(0, 8), 8, 9);
  }
  /* spectrum line + peak hold */
  S.sp = db; S.spHz = binHz;
  if(!S.peak || S.peak.length !== db.length) S.peak = Float32Array.from(db);
  for(var i = 0; i < db.length; i++) S.peak[i] = Math.max(db[i], S.peak[i] - 0.25);
}
function loop(){ if(ONSCREEN) frame(); S.raf = requestAnimationFrame(loop); }
/* The pictures are only drawn while the radio is on screen: the sound, the
   detectors and the decoders carry on regardless. Coming back, both are
   measured afresh and redrawn. */
var ONSCREEN = true;
if('IntersectionObserver' in window) new IntersectionObserver(function(es){
  var was = ONSCREEN; ONSCREEN = es[0].isIntersecting;
  if(ONSCREEN && !was && !BAND.classList.contains('folded')){ size(); if(typeof wfDraw === 'function') wfDraw(); }
}).observe(BAND);

/* ---------------------------------------------------------- drawing */
var cursor = null;
function frame(){
  var w = cv.clientWidth, h = cv.clientHeight;
  g2.fillStyle = '#05070f'; g2.fillRect(0, 0, w, h);
  var wfTop = SPEC_H;
  if(S.mode === 'file' && S.file && S.file.img) drawFile(w, h);
  else g2.drawImage(wf, 0, wfTop);
  /* spectrum strip */
  g2.fillStyle = 'rgba(8,12,26,.95)'; g2.fillRect(0, 0, w, SPEC_H);
  if(S.sp && S.sp.length){
    var binHz = S.spHz, maxBin = Math.min(S.sp.length-1, Math.floor(S.maxHz/binHz));
    var y = function(v){ return SPEC_H - 4 - Math.max(0, Math.min(1, (v - S.lo)/(S.hi - S.lo)))*(SPEC_H - 10); };
    if(S.peak){
      g2.strokeStyle = 'rgba(248,113,113,.55)'; g2.lineWidth = 1; g2.beginPath();
      for(var x = 0; x < w; x++){ var b = Math.floor(x/w*maxBin); x ? g2.lineTo(x, y(S.peak[b])) : g2.moveTo(x, y(S.peak[b])); }
      g2.stroke();
    }
    g2.strokeStyle = '#22d3ee'; g2.lineWidth = 1.2; g2.beginPath();
    for(var x2 = 0; x2 < w; x2++){
      var b0 = Math.floor(x2/w*maxBin), b1 = Math.max(b0+1, Math.floor((x2+1)/w*maxBin)), v = -200;
      for(var k = b0; k < b1; k++) if(S.sp[k] > v) v = S.sp[k];
      x2 ? g2.lineTo(x2, y(v)) : g2.moveTo(x2, y(v));
    }
    g2.stroke();
  } else {
    g2.fillStyle = '#64748b'; g2.font = '12px ui-monospace,monospace';
    g2.fillText('spectrum — choose a source below', 10, 38);
  }
  /* bottom axis: frequency for the live waterfall, time for a recording */
  var ay = h - AXIS_H, fileView = S.mode === 'file' && S.file && S.file.img;
  g2.fillStyle = 'rgba(8,12,26,.95)'; g2.fillRect(0, ay, w, AXIS_H);
  g2.font = '10px ui-monospace,monospace'; g2.fillStyle = '#94a3b8'; g2.strokeStyle = 'rgba(148,163,184,.25)';
  if(fileView){
    var dur = S.file.dur, ts = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find(function(v){ return dur/v <= 12; }) || 7200;
    for(var tt = 0; tt <= dur; tt += ts){
      var tx0 = tt/dur*w;
      g2.beginPath(); g2.moveTo(tx0, SPEC_H); g2.lineTo(tx0, ay); g2.stroke();
      if(tx0 < w - 40) g2.fillText(ts >= 60 ? Math.floor(tt/60) + ':' + ('0' + Math.round(tt%60)).slice(-2) : tt + 's', tx0 + 2, ay + 13);
    }
    g2.fillText('time', w - 30, ay + 13);
  } else {
    var step = S.maxHz <= 4000 ? 250 : S.maxHz <= 8000 ? 500 : 2000;
    for(var f = 0; f <= S.maxHz; f += step){
      var fx = f/S.maxHz*w;
      g2.beginPath(); g2.moveTo(fx, SPEC_H); g2.lineTo(fx, ay); g2.stroke();
      if(f % (step*2) === 0 && fx < w - 30) g2.fillText(f >= 1000 ? (f/1000) + 'k' : f, fx + 2, ay + 13);
    }
    g2.fillText('Hz', w - 18, ay + 13);
  }
  /* the spectrum strip always runs 0 Hz (left) to the range (right) */
  g2.fillStyle = 'rgba(148,163,184,.7)'; g2.font = '9px ui-monospace,monospace';
  g2.fillText('0', 3, SPEC_H - 3); g2.fillText(fmtHz(S.maxHz), w - 52, SPEC_H - 3);
  if(fileView) g2.fillText('spectrum at the play position', 24, 10);
  /* cursor readout */
  if(cursor){
    g2.strokeStyle = 'rgba(250,204,21,.8)'; g2.setLineDash([3, 3]);
    g2.beginPath(); g2.moveTo(cursor.x, 0); g2.lineTo(cursor.x, ay); g2.stroke(); g2.setLineDash([]);
    var inImg = fileView && cursor.y > SPEC_H;
    var fq = inImg ? (ay - cursor.y)/(ay - SPEC_H)*S.maxHz : cursor.x/w*S.maxHz, txt = fmtHz(Math.max(0, fq));
    if(S.sp && S.sp.length && !inImg){ var bi = Math.min(S.sp.length-1, Math.round(fq/S.spHz)); txt += ' · ' + S.sp[bi].toFixed(0) + ' dB'; }
    if(S.mode !== 'file' && cursor.y > SPEC_H && cursor.y < ay){
      var t = S.rowTimes[Math.round(cursor.y - SPEC_H)]; if(t) txt += ' · ' + utc(t);
    }
    if(S.mode === 'file' && S.file) txt += ' · ' + (cursor.x/w*S.file.dur).toFixed(1) + ' s';
    g2.font = '11px ui-monospace,monospace';
    var tw = g2.measureText(txt).width + 12, tx = Math.min(w - tw - 4, cursor.x + 8);
    g2.fillStyle = 'rgba(2,6,23,.9)'; g2.fillRect(tx, 4, tw, 18);
    g2.fillStyle = '#fde68a'; g2.fillText(txt, tx + 6, 17);
  }
  readouts();
}
cv.addEventListener('pointermove', function(e){ var r = cv.getBoundingClientRect(); cursor = {x:e.clientX - r.left, y:e.clientY - r.top}; if(!S.raf) frame(); });
cv.addEventListener('pointerleave', function(){ cursor = null; if(!S.raf) frame(); });

/* -------------------------------------------------------- detectors */
function bandPow(db, hz, f0, f1){
  var s = 0, n = 0;
  for(var i = Math.floor(f0/hz); i <= Math.min(db.length-1, Math.ceil(f1/hz)); i++){ s += Math.pow(10, db[i]/10); n++; }
  return n ? s/n : 0;
}
function pct(a, q){ var b = a.slice().sort(function(x, y){ return x - y; }); return b.length ? b[Math.min(b.length-1, Math.floor(q*b.length))] : 0; }
/* The detectors run on their own 2048-point spectrum, about twenty times a
   second, whatever the picture is set to, so a setting never changes what
   they find.
   - pulses: the energy in eight sub-bands (60-3400 Hz) over the last 12 s is
     tested for periodicity (autocorrelation, periods 0.4-5 s). A buzz that
     repeats scores 0.7-0.9 even when it is faint; noise and speech score low.
     Two agreeing readings start a train; two failing ones end it.
   - voice?: speech makes the speech-band level change from one moment to the
     next (median step over 3 s above 1.2 dB); a steady buzz or carrier moves
     well under 0.5 dB between its edges. A voice ends any pulse train, and
     the periodicity looks only at what came after the voice. */
var DET_N = 2048, SUB = [];
for(var q = 0; q <= 8; q++) SUB.push(60*Math.pow(3400/60, q/8));
function detReset(hz){
  S.detHz = hz; S.detK = 0; S.env = []; S.pulse = null; S.cand = null; S.candN = 0; S.missN = 0;
  S.voiceOn = null; S.voiceLast = 0; S.voiceEnd = -Infinity; S.voiceNow = false; S.sFloor = null; S.comb = null;
}
function periodicity(rows){
  var hz = S.detHz, n = rows.length, minLag = Math.ceil(0.4*hz), maxLag = Math.min(Math.floor(5*hz), Math.floor(n/2.5)), best = null;
  if(maxLag < minLag + 2) return null;
  for(var b = 0; b < 8; b++){
    var mu = 0; for(var i = 0; i < n; i++) mu += rows[i].b[b]; mu /= n;
    var e = new Float32Array(n), v = 0;
    for(i = 0; i < n; i++){ e[i] = rows[i].b[b] - mu; v += e[i]*e[i]; }
    if(v <= 1e-6) continue;
    var ac = new Float32Array(maxLag + 2);
    for(var L = minLag - 1; L <= maxLag + 1; L++){ var sum = 0; for(i = 0; i + L < n; i++) sum += e[i]*e[i+L]; ac[L] = sum/v; }
    var mx = 0, peaks = [];
    for(L = minLag; L <= maxLag; L++) if(ac[L] >= ac[L-1] && ac[L] >= ac[L+1]){ peaks.push(L); if(ac[L] > mx) mx = ac[L]; }
    for(var k = 0; k < peaks.length; k++) if(ac[peaks[k]] >= 0.85*mx){
      L = peaks[k];
      var d = ac[L-1] - 2*ac[L] + ac[L+1], off = d < 0 ? 0.5*(ac[L-1] - ac[L+1])/d : 0;   // parabolic peak
      if(!best || ac[L] > best.score){
        /* a real pulse train switches on and off: its band must swing 6 dB or more */
        var vals = rows.map(function(r){ return r.b[b]; });
        best = {score:ac[L], interval:(L + off)/hz, depth:pct(vals, 0.9) - pct(vals, 0.1), band:b};
      }
      break;
    }
  }
  return best;
}
function detect(db, sr, now){
  var hz = sr/2/db.length, b = [];
  for(var k = 0; k < 8; k++) b.push(10*Math.log10(bandPow(db, hz, SUB[k], SUB[k+1]) + 1e-20));
  var sv = 10*Math.log10(bandPow(db, hz, 300, 3000) + 1e-20), env = S.env;
  /* spectral flatness, 250-2600 Hz: radio noise and static sit near 0.55; speech,
     with its harmonics and formants, well below */
  var lg = 0, ar = 0, nb = 0;
  for(var q = Math.ceil(250/hz); q <= Math.min(db.length - 1, Math.floor(2600/hz)); q++){
    var pw = Math.pow(10, db[q]/10) + 1e-20; lg += Math.log(pw); ar += pw; nb++;
  }
  var fl = nb ? Math.exp(lg/nb)/(ar/nb) : 1;
  /* coarse spectrum, 24 bins over 250-2600 Hz: the Buzzer's harmonic comb is its fingerprint */
  var qv = [], q0 = Math.ceil(250/hz), q1 = Math.min(db.length - 1, Math.floor(2600/hz)), pb = Math.max(1, Math.floor((q1 - q0 + 1)/24));
  for(var j = 0; j < 24; j++){
    var acc = 0, cnt = 0;
    for(q = q0 + j*pb; q < q0 + (j + 1)*pb && q <= q1; q++){ acc += Math.pow(10, db[q]/10); cnt++; }
    qv.push(10*Math.log10(acc/Math.max(1, cnt) + 1e-20));
  }
  env.push({t:now, b:b, s:sv, f:fl, q:qv});
  while(env.length && env[0].t < now - 30000) env.shift();
  S.detK++;
  if(S.detK % 20 === 1) S.sFloor = pct(env.map(function(r){ return r.s; }), 0.1);
  if(env.length < S.detHz*3) return;
  /* voice? */
  var w = [], steps = [], flats = [];
  for(var i = env.length - 1; i >= 0 && env[i].t > now - 3000; i--){ w.push(env[i].s); flats.push(env[i].f); }
  for(i = 1; i < w.length; i++) steps.push(Math.abs(w[i] - w[i-1]));
  var lvl = w.reduce(function(a, c){ return a + c; }, 0)/w.length - S.sFloor;
  /* while the Buzzer runs, its own on/off passes the tests above: a frame carrying
     the buzz's comb never counts as voice (a message replaces the buzz) */
  var voice = pct(steps, 0.5) > 1.2 && lvl > 1.5 && pct(flats, 0.25) < 0.42 &&
              combFrac(env.filter(function(r){ return r.t > now - 3000; }), now) < 0.1;
  if(voice){
    if(!S.voiceOn) S.voiceOn = now - 1500;         // the 3 s window centres on its start
    S.voiceLast = now;
  } else if(S.voiceOn && now - S.voiceLast > 1000) closeVoice();
  S.voiceNow = voice;
  /* pulses, re-evaluated twice a second */
  if(S.detK % Math.round(S.detHz/2)) return;
  var cand = null;
  var from = S.voiceOn ? now - 12000 : Math.max(now - 12000, S.voiceEnd), rows = env.filter(function(r){ return r.t > from; });
  if(rows.length >= S.detHz*6){ var p = periodicity(rows); if(p && p.score >= 0.5 && p.depth >= 8) cand = p; }
  if(cand){
    learnComb(rows, cand, now);
    /* a "voice" the buzz runs straight through, matching its comb, was the buzz */
    if(S.voiceOn && combFrac(env.filter(function(r){ return r.t >= S.voiceOn; }), now) >= 0.1){
      S.voiceOn = null; S.voiceNow = false;
    }
    /* and so was a short "voice" logged before the buzz was recognised */
    var gone = S.events.filter(function(e){
      return e.kind === 'voice' && e.end && now - e.t < 25000 &&
             combFrac(env.filter(function(r){ return r.t >= e.t && r.t <= e.end; }), now) >= 0.1;
    });
    if(gone.length){ S.events = S.events.filter(function(e){ return gone.indexOf(e) < 0; }); paintEvents(); }
  }
  if(S.voiceOn) cand = null;
  if(cand && S.cand && Math.abs(cand.interval - S.cand.interval) < 0.1*cand.interval) S.candN++;
  else S.candN = cand ? 1 : 0;
  S.cand = cand;
  S.missN = cand ? 0 : S.missN + 1;
  if(S.pulse && (S.voiceOn || S.missN >= 2)){
    logEvent(now, 'pulses', 'pulse train stops' + (S.voiceOn ? ' (voice)' : ''));
    S.pulse = null;
  } else if(cand && S.candN >= 2){
    var per = {rate:60/cand.interval, interval:cand.interval, score:cand.score};
    if(!S.pulse) logEvent(now, 'pulses', 'pulse train · ' + per.rate.toFixed(1) + '/min (every ' + per.interval.toFixed(2) + ' s)');
    else if(Math.abs(per.interval - S.pulse.interval) > 0.1*S.pulse.interval)
      logEvent(now, 'pulses', 'pulse rate now ' + per.rate.toFixed(1) + '/min');
    S.pulse = per;
  }
}
function learnComb(rows, p, now){
  var vals = rows.map(function(r){ return r.b[p.band]; }), cut = pct(vals, 0.1) + 0.6*p.depth, t = null, n = 0;
  rows.forEach(function(r){
    if(r.b[p.band] <= cut || !r.q) return;
    var m = r.q.reduce(function(a, c){ return a + c; }, 0)/r.q.length;
    if(!t) t = r.q.map(function(){ return 0; });
    r.q.forEach(function(c, i){ t[i] += c - m; }); n++;
  });
  if(n < 3) return;
  var nm = Math.sqrt(t.reduce(function(a, c){ return a + c*c; }, 0)) || 1;
  S.comb = {tmpl:t.map(function(c){ return c/nm; }), t:now};
}
function combFrac(rows, now){
  if(!S.comb || now - S.comb.t > 60000 || !rows.length) return 0;
  var hit = 0;
  rows.forEach(function(r){
    if(!r.q) return;
    var m = r.q.reduce(function(a, c){ return a + c; }, 0)/r.q.length, dot = 0, nn = 0;
    r.q.forEach(function(c, i){ dot += (c - m)*S.comb.tmpl[i]; nn += (c - m)*(c - m); });
    if(dot/(Math.sqrt(nn) || 1) > 0.5) hit++;
  });
  return hit/rows.length;
}
function closeVoice(){
  var d = (S.voiceLast - S.voiceOn)/1000;
  if(d >= 1.5){ logEvent(S.voiceOn, 'voice', 'voice? · about ' + Math.round(d) + ' s in the speech band'); S.events[0].end = S.voiceLast; }
  S.voiceOn = null; S.voiceEnd = S.voiceLast;
}
function logEvent(t, kind, text, at){
  S.events.unshift({t:t, kind:kind, text:text, at:at});
  if(S.events.length > 300) S.events.length = 300;
  paintEvents();
}
function paintEvents(){
  var el = $('sigEvents'); if(!el) return;
  if(!S.events.length){ el.innerHTML = '<div class="sig-empty">No events yet. Detections appear here with their UTC time.</div>'; return; }
  el.innerHTML = S.events.slice(0, 60).map(function(ev, i){
    var when = ev.at != null ? ev.at.toFixed(1) + ' s' : utc(ev.t);
    return '<button class="sig-ev ' + ev.kind + '" data-i="' + i + '"><b>' + esc(when) + '</b> ' + esc(ev.text) + '</button>';
  }).join('');
  el.querySelectorAll('.sig-ev').forEach(function(b){
    b.onclick = function(){ var ev = S.events[+b.dataset.i]; if(ev && ev.at != null) seek(Math.max(0, ev.at - 1)); };
  });
}
function readouts(){
  var el = $('sigRead'); if(!el) return;
  var bits = [];
  if(S.pulse) bits.push('<span class="ok">pulse train ' + S.pulse.rate.toFixed(1) + '/min · every ' + S.pulse.interval.toFixed(2) + ' s</span>');
  else if(S.running) bits.push('<span>no periodic pulse pattern</span>');
  if(S.voiceNow) bits.push('<span class="hot">voice? now</span>');
  if(S.sp && S.sp.length){
    var best = -999, bf = 0, maxBin = Math.min(S.sp.length-1, Math.floor(S.maxHz/S.spHz));
    for(var i = 2; i < maxBin; i++) if(S.sp[i] > best){ best = S.sp[i]; bf = i*S.spHz; }
    bits.push('<span>strongest ' + fmtHz(bf) + ' at ' + best.toFixed(0) + ' dB</span>');
  }
  el.innerHTML = bits.join(' · ') || 'idle';
}

/* ------------------------------------------------------------ files */
function fftDb(re, im){                          // in-place radix-2, returns dB of the lower half
  var n = re.length;
  for(var i = 1, j = 0; i < n; i++){
    var bit = n >> 1;
    for(; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if(i < j){ var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for(var len = 2; len <= n; len <<= 1){
    var ang = -2*Math.PI/len, wr = Math.cos(ang), wi = Math.sin(ang);
    for(var s = 0; s < n; s += len){
      var cr = 1, ci = 0;
      for(var k = 0; k < len/2; k++){
        var a = s + k, b = a + len/2, tr = re[b]*cr - im[b]*ci, ti = re[b]*ci + im[b]*cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        var nr = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = nr;
      }
    }
  }
  var out = new Float32Array(n/2);
  for(var q = 0; q < n/2; q++) out[q] = 10*Math.log10((re[q]*re[q] + im[q]*im[q])/(n*n) + 1e-20);
  return out;
}
async function openFile(file){
  stopAll();
  status('Reading ' + esc(file.name) + '…');
  var ctx = new (window.AudioContext || window.webkitAudioContext)(), buf;
  try{ buf = await ctx.decodeAudioData(await file.arrayBuffer()); }
  catch(e){ status('This file could not be decoded as audio.', true); ctx.close(); return; }
  S.ctx = ctx;
  analyse(buf, file.name);
}
function analyse(buf, name){
  if(S.file && S.file.node){ try{ S.file.node.stop(); }catch(_){} }
  var job = S.job = {};
  S.file = null; S.mode = 'file'; S.events = []; S.pulse = null; S.voiceNow = false; paintEvents();
  $('sigPlay').textContent = '▶ PLAY';
  var ch = buf.getChannelData(0), sr = buf.sampleRate, N = S.fft, hop = N >> 1;
  var frames = Math.max(1, Math.floor((ch.length - N)/hop) + 1), win = new Float32Array(N);
  for(var i = 0; i < N; i++) win[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(N - 1));
  var cols = Math.min(frames, 6000), per = frames/cols;
  var binHz = sr/N, maxBin = Math.min(N/2 - 1, Math.floor(S.maxHz/binHz)), H = 360;
  var img = new ImageData(cols, H);
  detReset(sr/DET_N);
  var dN = DET_N, dWin = new Float32Array(dN), dHop = DET_N, dOff = 0;
  for(i = 0; i < dN; i++) dWin[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(dN - 1));
  $('sigLiveBar').style.display = 'none'; $('sigFileBar').style.display = '';
  var c = 0;
  (function chunk(){
    if(job !== S.job) return;
    var t0 = performance.now();
    while(c < cols && performance.now() - t0 < 30){
      var f = Math.floor(c*per), re = new Float32Array(N), im = new Float32Array(N), off = f*hop;
      for(var i = 0; i < N; i++) re[i] = (ch[off + i] || 0)*win[i];
      var db = fftDb(re, im);
      for(var y = 0; y < H; y++){
        var b0 = Math.floor((H - 1 - y)/H*maxBin), b1 = Math.max(b0 + 1, Math.floor((H - y)/H*maxBin)), v = -200;
        for(var b = b0; b < b1; b++) if(db[b] > v) v = db[b];
        var tq = Math.max(0, Math.min(255, Math.round((v - S.lo)/(S.hi - S.lo)*255))), p = (y*cols + c)*4;
        img.data[p] = LUT[tq*3]; img.data[p+1] = LUT[tq*3+1]; img.data[p+2] = LUT[tq*3+2]; img.data[p+3] = 255;
      }
      if(c === Math.floor(cols/2)){ S.sp = db; S.spHz = binHz; S.peak = null; }
      c++;
    }
    while(c >= cols && dOff + dN <= ch.length && performance.now() - t0 < 30){
      var re2 = new Float32Array(dN), im2 = new Float32Array(dN);
      for(var j = 0; j < dN; j++) re2[j] = ch[dOff + j]*dWin[j];
      detect(fftDb(re2, im2), sr, (dOff + dN/2)/sr*1000);
      dOff += dHop;
    }
    var done = (c + (c >= cols ? Math.min(cols, dOff/ch.length*cols) : 0))/(2*cols);
    status('Analysing ' + esc(name) + ' · ' + Math.round(done*100) + '%');
    if(c < cols || dOff + dN <= ch.length){ setTimeout(chunk, 0); return; }
    if(S.voiceOn != null) closeVoice();
    S.events.forEach(function(ev){ if(ev.at == null) ev.at = ev.t/1000; });
    S.events.sort(function(a, b){ return a.at - b.at; }); paintEvents();
    var oc = document.createElement('canvas'); oc.width = cols; oc.height = H; oc.getContext('2d').putImageData(img, 0, 0);
    S.file = {buf:buf, img:oc, dur:buf.duration, name:name, node:null, startAt:0, offset:0, playing:false};
    status(esc(name) + ' · ' + buf.duration.toFixed(1) + ' s · ' + (sr/1000).toFixed(1) + ' kHz · ' +
           S.events.length + ' detection' + (S.events.length === 1 ? '' : 's') + ' · tap the picture to play from there');
    size();
  })();
}
function drawFile(w, h){
  var F = S.file, top = SPEC_H, hh = h - SPEC_H - AXIS_H;
  /* file view: time runs left to right, frequency bottom to top */
  g2.imageSmoothingEnabled = false;
  g2.drawImage(F.img, 0, top, w, hh);
  S.events.forEach(function(ev){
    if(ev.at == null) return;
    var x = ev.at/F.dur*w;
    g2.fillStyle = ev.kind === 'voice' ? 'rgba(250,204,21,.9)' : 'rgba(34,211,238,.8)';
    g2.fillRect(x, top, 2, 6);
  });
  var pos = playPos();
  g2.strokeStyle = '#f8fafc'; g2.lineWidth = 1.5;
  g2.beginPath(); g2.moveTo(pos/F.dur*w, top); g2.lineTo(pos/F.dur*w, top + hh); g2.stroke();
  g2.fillStyle = 'rgba(226,232,240,.85)'; g2.font = '10px ui-monospace,monospace';
  g2.fillText(pos.toFixed(1) + ' / ' + F.dur.toFixed(1) + ' s', 6, top + 16);
  var fstep = S.maxHz <= 4000 ? 500 : S.maxHz <= 8000 ? 1000 : S.maxHz <= 12000 ? 2000 : 4000;
  g2.strokeStyle = 'rgba(226,232,240,.18)';
  for(var fq = fstep; fq < S.maxHz; fq += fstep){
    var fy = top + hh - fq/S.maxHz*hh;
    g2.beginPath(); g2.moveTo(0, fy); g2.lineTo(8, fy); g2.stroke();
    g2.fillText(fq >= 1000 ? (fq/1000) + 'k' : fq, 10, fy + 3);
  }
}
function playPos(){
  var F = S.file; if(!F) return 0;
  return F.playing ? Math.min(F.dur, F.offset + (S.ctx.currentTime - F.startAt)) : F.offset;
}
function play(from){
  var F = S.file; if(!F) return;
  if(F.node){ try{ F.node.stop(); }catch(_){} }
  var n = S.ctx.createBufferSource(); n.buffer = F.buf;
  var an = S.ctx.createAnalyser(); an.fftSize = S.fft; an.smoothingTimeConstant = 0;
  n.connect(an); an.connect(S.ctx.destination);
  S.analyser = an;
  F.offset = from; F.startAt = S.ctx.currentTime; F.node = n; F.playing = true;
  n.onended = function(){ if(F.node === n){ F.playing = false; F.offset = 0; $('sigPlay').textContent = '▶ PLAY'; } };
  n.start(0, from);
  $('sigPlay').textContent = '❚❚ PAUSE';
  if(S.ctx.state === 'suspended') S.ctx.resume();
  if(!S.raf) (function tick(){
    if(!S.file || S.mode !== 'file'){ S.raf = null; return; }
    if(F.playing && S.analyser){ var b = new Float32Array(S.analyser.frequencyBinCount); S.analyser.getFloatFrequencyData(b); S.sp = b; S.spHz = S.ctx.sampleRate/2/b.length;
      if(!S.peak || S.peak.length !== b.length) S.peak = Float32Array.from(b); for(var i = 0; i < b.length; i++) S.peak[i] = Math.max(b[i], S.peak[i] - 0.25); }
    frame(); S.raf = requestAnimationFrame(tick);
  })();
}
function pause(){ var F = S.file; if(!F || !F.playing) return; F.offset = playPos(); F.playing = false; try{ F.node.stop(); }catch(_){} $('sigPlay').textContent = '▶ PLAY'; }
function seek(t){ if(!S.file) return; S.file.playing ? play(t) : (S.file.offset = t, frame()); }
cv.addEventListener('click', function(e){
  if(S.mode !== 'file' || !S.file) return;
  var r = cv.getBoundingClientRect(); play((e.clientX - r.left)/r.width*S.file.dur);
});

/* --------------------------------------------------------- controls */
/* ------------------------------------------------------- live tuner */
/* You listen live through a public KiwiSDR, one receiver at a time, the way
   their owners intend: the page opens the receiver's own audio stream, plays
   it here and runs the analyser on it. A browser lets this HTTPS page reach
   only receivers that serve HTTPS, so the list is the ones that do: checked
   weekly by tuner_receivers.py into data/tuner/receivers.json. Each
   connection says who it is ("Trident Brief listener"), takes one slot,
   honours the receiver's own limits, and closes itself after an hour unless
   you are still there. */
var PRESETS = [
  {id:'uvb76', name:'UVB-76', khz:4625, mode:'usb', near:[55.8, 37.6],
   note:'Russian military “Buzzer”: a buzz about every 3.4 s, now and then a voice reading a callsign and codewords.'},
  {id:'pip', name:'The Pip', khz:5448, mode:'usb', near:[55.8, 37.6], note:'Russian military beacon: short pips. Its night frequency is 3756 kHz.'},
  {id:'wheel', name:'Squeaky Wheel', khz:5473, mode:'usb', near:[55.8, 37.6], note:'Russian military beacon. Its night frequency is 3828 kHz.'},
  {id:'hf8992', name:'HFGCS 8992', khz:8992, mode:'usb', near:[38.9, -77.0],
   note:'US Air Force global HF network: Emergency Action Messages and Skyking broadcasts. Best at night.'},
  {id:'hf11175', name:'HFGCS 11175', khz:11175, mode:'usb', near:[38.9, -77.0], note:'The same network’s main daytime frequency.'},
  {id:'hf4724', name:'HFGCS 4724', khz:4724, mode:'usb', near:[38.9, -77.0], note:'The same network’s night frequency.'},
  {id:'volmet', name:'Shannon VOLMET', khz:5505, mode:'usb', near:[52.7, -8.9],
   note:'North Atlantic aviation weather read round the clock: a quick check that a receiver is hearing well.'},
  {id:'wwv', name:'WWV 10 MHz', khz:10000, mode:'am', near:[40.7, -105.0], note:'US time signal: a tick every second, a voice every minute. Another reception check.'},
  /* pictures and text: each tunes where the decoder wants it and starts that
     decoder. Fax is tuned USB 1.9 kHz below the listed frequency, so the
     picture tones sit at 1500-2300 Hz; RTTY so its tones sit near 1500 Hz. */
  {id:'fxb4', dec:'fax', pb:[1100, 2700], name:'Fax Boston', khz:4233.1, mode:'usb', near:[41.7, -70.5], note:'US Coast Guard Boston (NMF) weather charts on 4235 kHz: best at night. Charts go out most hours; a new one starts on its own.'},
  {id:'fxb6', dec:'fax', pb:[1100, 2700], name:'Fax Boston', khz:6338.6, mode:'usb', near:[41.7, -70.5], note:'US Coast Guard Boston (NMF) on 6340.5 kHz: evening and night.'},
  {id:'fxb9', dec:'fax', pb:[1100, 2700], name:'Fax Boston', khz:9108.1, mode:'usb', near:[41.7, -70.5], note:'US Coast Guard Boston (NMF) on 9110 kHz: day and evening.'},
  {id:'fxb12', dec:'fax', pb:[1100, 2700], name:'Fax Boston', khz:12748.1, mode:'usb', near:[41.7, -70.5], note:'US Coast Guard Boston (NMF) on 12750 kHz: daytime.'},
  {id:'fxno', dec:'fax', pb:[1100, 2700], name:'Fax New Orleans', khz:8502.0, mode:'usb', near:[29.9, -90.1], note:'US Coast Guard New Orleans (NMG) on 8503.9 kHz: Gulf and Atlantic weather charts.'},
  {id:'fxpr', dec:'fax', pb:[1100, 2700], name:'Fax Pt Reyes', khz:8680.1, mode:'usb', near:[38.0, -122.9], note:'US Coast Guard Point Reyes (NMC) on 8682 kHz: Pacific weather charts.'},
  {id:'fxdwd', dec:'fax', pb:[1100, 2700], name:'Fax Germany', khz:7878.1, mode:'usb', near:[53.6, 10.0], note:'German Weather Service (DDK3) on 7880 kHz: European and Atlantic charts.'},
  {id:'sv14a', dec:'sstv', pb:[900, 2700], name:'SSTV', khz:14230, mode:'usb', near:[38, -81], note:'The busiest SSTV calling frequency (20 m): amateurs swap pictures, mostly in daylight and at weekends.'},
  {id:'sv14b', dec:'sstv', pb:[900, 2700], name:'SSTV', khz:14233, mode:'usb', near:[38, -81], note:'The second 20 m SSTV frequency, for when 14230 is busy.'},
  {id:'sv7', dec:'sstv', pb:[900, 2700], name:'SSTV', khz:7171, mode:'lsb', near:[38, -81], note:'40 m SSTV, lower sideband: late afternoon and evening.'},
  {id:'sv3', dec:'sstv', pb:[900, 2700], name:'SSTV', khz:3845, mode:'lsb', near:[38, -81], note:'80 m SSTV, lower sideband: evenings and night, nearer stations.'},
  {id:'sv28', dec:'sstv', pb:[900, 2700], name:'SSTV', khz:28680, mode:'usb', near:[38, -81], note:'10 m SSTV: only when the band is open, around midday in good sun years.'},
  {id:'rtdwd', dec:'rtty', pb:[900, 2100], name:'RTTY weather', khz:10099.3, mode:'usb', near:[53.6, 10.0], note:'German Weather Service (DDK9) on 10100.8 kHz: weather reports by teleprinter round the clock, 50 baud. A good first test of the RTTY decoder.'},
  {id:'rtdwd4', dec:'rtty', pb:[900, 2100], name:'RTTY weather', khz:4581.5, mode:'usb', near:[53.6, 10.0], note:'German Weather Service (DDK2) on 4583 kHz: the night frequency.'}
];
var SCAN = PRESETS.filter(function(p){ return !p.dec; });       // SCAN visits the listening presets only
var PASS = {usb:[300, 2700], lsb:[-2700, -300], am:[-4900, 4900], cw:[300, 800]};
var STEP = [7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,
  157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,
  1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,
  11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767];
var ADJ = [-1,-1,-1,-1,2,4,6,8,-1,-1,-1,-1,2,4,6,8];
var IDLE_MIN = 60;
var T = {list:[], ws:null, rx:null, live:false, khz:4625, mode:'usb', preset:'uvb76', sr:12000, dec:{i:0, p:0},
         next:0, rebuf:0, dropped:0, inp:null, out:null, lastKa:0, rssi:[], tried:[], scan:null, touched:0, idle:null, kaTimer:null};

/* Kiwi audio is IMA ADPCM: four bits a sample, low nibble first, the
   decoder's state carried from one frame to the next. */
function adpcm(data, st){
  var out = new Float32Array(data.length*2), k = 0;
  for(var i = 0; i < data.length; i++){
    out[k++] = nib(data[i] & 15, st)/32768;
    out[k++] = nib(data[i] >> 4, st)/32768;
  }
  return out;
}
function nib(code, st){
  var step = STEP[st.i];
  st.i = Math.min(88, Math.max(0, st.i + ADJ[code]));
  var d = step >> 3;
  if(code & 1) d += step >> 2;
  if(code & 2) d += step >> 1;
  if(code & 4) d += step;
  if(code & 8) d = -d;
  st.p = Math.max(-32768, Math.min(32767, st.p + d));
  return st.p;
}
function km(a, b){
  var r = Math.PI/180, x = Math.sin((b[0]-a[0])*r/2), y = Math.sin((b[1]-a[1])*r/2);
  return 12742*Math.asin(Math.sqrt(x*x + Math.cos(a[0]*r)*Math.cos(b[0]*r)*y*y));
}
/* receivers in order of preference: nearest the transmitter first, the ones
   that have just refused us last */
function ranked(near){
  return T.list.slice().sort(function(a, b){
    var fa = T.tried.indexOf(a.host) > -1, fb = T.tried.indexOf(b.host) > -1;
    if(fa !== fb) return fa ? 1 : -1;
    return (a.lat == null ? 1e9 : km(near, [a.lat, a.lon])) - (b.lat == null ? 1e9 : km(near, [b.lat, b.lon]));
  });
}
function presetOf(id){ return PRESETS.filter(function(p){ return p.id === id; })[0]; }
function tuneMsg(){
  var pb = passband();
  return 'SET mod=' + T.mode + ' low_cut=' + pb[0] + ' high_cut=' + pb[1] + ' freq=' + T.khz.toFixed(3);
}
function tunerNow(extra){
  var el = $('tuNow');
  if(!T.rx){ el.innerHTML = extra || 'not connected'; return; }
  var r = T.rssi.length ? T.rssi[T.rssi.length - 1] : null, pct = r == null ? 0 : Math.max(0, Math.min(100, (r + 130)/0.8));
  el.innerHTML = '<b>' + (T.khz % 1 ? T.khz.toFixed(2) : T.khz) + ' kHz ' + esc(T.mode.toUpperCase()) + '</b> · ' +
    (T.live ? 'live from ' : 'connecting to ') + esc(T.rx.loc || T.rx.host) +
    (T.rx.antenna ? ' <span class="sig-small">(' + esc(T.rx.antenna) + ')</span>' : '') +
    '<div class="tu-meter"><i style="width:' + pct.toFixed(0) + '%"></i><span>' + (r == null ? 'signal —' : 'signal ' + r.toFixed(0) + ' dBm') + '</span></div>' +
    (extra ? '<div class="sig-small">' + extra + '</div>' : '');
}
function tunerClose(){
  if(T.kaTimer){ clearInterval(T.kaTimer); T.kaTimer = null; }
  if(T.idle){ clearInterval(T.idle); T.idle = null; }
  if(T.scan){ clearTimeout(T.scan.timer); T.scan = null; $('tuScan').textContent = '⟳ SCAN PRESETS'; }
  var ws = T.ws; T.ws = null; T.live = false;
  if(ws){ try{ ws.close(); }catch(_){} }
  wfClose();
  T.rx = null; T.inp = T.out = null;
  if(typeof wfDraw === 'function') wfDraw();
  if($('tuNow')) tunerNow();
}
function touch(){ T.touched = Date.now(); }
/* start listening: a fresh audio chain and a connection to the best receiver */
function listen(){
  touch();
  if(!T.list.length){ status('The receiver list has not loaded yet.', true); return; }
  stopAll();                                     // closes any other source and any previous connection
  T.tried = [];
  var ctx = new (window.AudioContext || window.webkitAudioContext)();
  if(ctx.resume) ctx.resume();
  T.inp = ctx.createGain();
  T.out = ctx.createGain(); T.out.gain.value = +$('tuVol').value;
  T.inp.connect(T.out); T.out.connect(ctx.destination);
  var dest = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
  if(dest) T.inp.connect(dest);                  // lets RECORD CLIP save what you hear
  attach('tuner', ctx, T.inp, dest ? dest.stream : null, 'Live tuner', false);
  T.idle = setInterval(function(){
    var m = (Date.now() - T.touched)/60000;
    if(m >= IDLE_MIN){ stopAll(); status('Stopped after an hour without a touch, to free the receiver for others. Press LISTEN to carry on.'); }
    else if(m >= IDLE_MIN - 5) tunerNow('Still listening? Touch any tuner control in the next ' + Math.ceil(IDLE_MIN - m) + ' min to keep the receiver.');
  }, 30000);
  connect(pick());
}
function pick(){
  var sel = $('tuRx').value, p = presetOf(T.preset);
  if(sel !== 'auto'){
    var r = T.list.filter(function(x){ return x.host === sel; })[0];
    if(r && T.tried.indexOf(r.host) < 0) return r;
  }
  var near = p && p.khz === T.khz ? p.near : [50, 10];
  return ranked(near).filter(function(x){ return T.tried.indexOf(x.host) < 0; })[0] || null;
}
function connect(rx){
  if(!rx){ status('Every receiver on the list refused or is full right now. Try again in a few minutes.', true); tunerClose(); return; }
  if(T.ws){ var old = T.ws; T.ws = null; try{ old.close(); }catch(_){} }
  wfClose();
  T.rx = rx; T.live = false; T.dec = {i:0, p:0}; T.next = 0; T.rssi = [];
  tunerNow();
  var ws, settled = false;
  T.ts = Date.now();                             // the waterfall reuses it, so the receiver pairs the two
  try{ ws = new WebSocket('wss://' + rx.host + '/' + T.ts + '/SND'); }
  catch(e){ return refused(rx, 'could not connect'); }
  ws.binaryType = 'arraybuffer';
  T.ws = ws;
  var timer = setTimeout(function(){ if(!settled && T.ws === ws) refused(rx, 'no answer'); }, 10000);
  ws.onopen = function(){ ws.send('SET auth t=kiwi p='); };
  ws.onerror = function(){ if(!settled && T.ws === ws){ clearTimeout(timer); refused(rx, 'connection failed'); } };
  ws.onclose = function(){
    clearTimeout(timer);
    if(T.ws !== ws) return;
    if(!settled) return refused(rx, 'closed');
    T.ws = null; T.live = false;
    status('The receiver in ' + esc(rx.loc || rx.host) + ' closed the connection (most often its owner’s time limit). Press LISTEN to reconnect.', true);
    tunerNow();
  };
  ws.onmessage = function(e){
    if(T.ws !== ws) return;
    var u8 = new Uint8Array(typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data);
    var tag = String.fromCharCode(u8[0], u8[1], u8[2]);
    if(tag === 'MSG'){
      var bad = null;
      new TextDecoder('latin1').decode(u8.subarray(4)).split(' ').forEach(function(pair){
        var k = pair.split('=')[0], v = pair.slice(k.length + 1);
        if(k === 'audio_rate') ws.send('SET AR OK in=' + v + ' out=44100');
        else if(k === 'sample_rate'){
          T.sr = parseFloat(v) || 12000; ringReset(); if(CW.on) cwStart();
          ['SET squelch=0 max=0', 'SET genattn=0', 'SET gen=0 mix=-1', tuneMsg(),
           'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50', 'SET compression=1',
           'SET ident_user=Trident%20Brief%20listener', 'SET keepalive'].concat(dspMsgs()).forEach(function(m){ ws.send(m); });
          settled = true; clearTimeout(timer); T.live = true;
          wfView(T.khz); wfOpen();
          logEvent(Date.now(), 'mark', 'tuned ' + T.khz + ' kHz ' + T.mode.toUpperCase() + ' via ' + (rx.loc || rx.host));
          status('Live: ' + esc(rx.name || rx.host) + '. You are one listener on someone’s receiver; it closes itself after an hour untouched.');
          tunerNow();
        }
        else if(k === 'too_busy') bad = 'all ' + v + ' listener slots are taken';
        else if(k === 'down') bad = 'it is down for now';
        else if(k === 'redirect') bad = 'it redirected elsewhere';
        else if(k === 'badp' && v !== '0') bad = 'it refused (code ' + v + ')';
      });
      if(bad){ settled = false; refused(rx, bad); }
      return;
    }
    if(tag !== 'SND' || !S.ctx) return;
    var flags = u8[3], rssi = 0.1*((u8[8] << 8) | u8[9]) - 127, data = u8.subarray(10), f;
    T.rssi.push(rssi); if(T.rssi.length > 600) T.rssi.shift();
    if(flags & 0x10) f = adpcm(data, T.dec);
    else { f = new Float32Array(data.length >> 1); for(var i = 0; i < f.length; i++){ var v = (data[2*i] << 8) | data[2*i+1]; f[i] = (v > 32767 ? v - 65536 : v)/32768; } }
    tunerPlay(f);
    var now = Date.now();
    if(now - T.lastKa > 1000){ T.lastKa = now; try{ ws.send('SET keepalive'); }catch(_){} tunerNow(); }
  };
}
function refused(rx, why){
  wfClose();
  T.tried.push(rx.host);
  status('The receiver in ' + esc(rx.loc || rx.host) + ': ' + esc(why) + '. Trying the next one…');
  if(T.ws){ var w = T.ws; T.ws = null; try{ w.close(); }catch(_){} }
  connect(pick());
}
/* a short jitter buffer: each frame is scheduled after the last, a quarter
   second behind real time; if the network falls behind, it re-buffers, and
   if frames pile up, the extra is dropped rather than letting the delay grow */
function tunerPlay(f){
  var ctx = S.ctx; if(!ctx || !T.inp) return;
  ringPush(f);
  if(CW.on && CW.dec) CW.dec.push(f);
  decFeed(f, T.sr);
  var b = ctx.createBuffer(1, f.length, T.sr);
  if(b.copyToChannel) b.copyToChannel(f, 0); else b.getChannelData(0).set(f);
  var now = ctx.currentTime;
  if(T.next < now + 0.03){ T.next = now + 0.25; T.rebuf++; }
  if(T.next > now + 1.5){ T.dropped++; return; }
  var s = ctx.createBufferSource(); s.buffer = b; s.connect(T.inp); s.start(T.next);
  T.next += b.duration;
}
function retune(khz, mode, presetId){
  touch();
  if(mode && mode !== T.mode) bwFor(mode);
  T.khz = Math.max(10, Math.min(30000, +khz || T.khz)); T.mode = mode || T.mode; T.preset = presetId || null;
  var pp = presetOf(T.preset);
  T.pbFix = pp && pp.pb ? pp.pb : null;
  if(T.pbFix){                                   // show the width it set, and keep noise reduction off: it smears pictures
    $('tuBw').value = ((T.pbFix[1] - T.pbFix[0])/1000).toFixed(1); $('tuBwV').textContent = $('tuBw').value + ' kHz';
    if($('tuNr').value !== 'off'){ $('tuNr').value = 'off'; if(T.ws && T.live) dspMsgs().forEach(function(m){ T.ws.send(m); }); }
  }
  $('tuKhz').value = +T.khz.toFixed(3); $('tuMode').value = T.mode;
  BAND.querySelectorAll('.tu-p').forEach(function(b){ b.classList.toggle('on', b.dataset.p === T.preset); });
  var p = presetOf(T.preset);
  $('tuNote').textContent = p ? p.note : '';
  if(!T.ws || !T.live){ return; }
  /* a preset's best receiver may be another one: on "best for the channel",
     move when the current one is far from the transmitter */
  if(p && $('tuRx').value === 'auto' && !T.scan){
    var best = ranked(p.near)[0];
    if(best && best.host !== T.rx.host && T.rx.lat != null && best.lat != null &&
       km(p.near, [T.rx.lat, T.rx.lon]) > km(p.near, [best.lat, best.lon]) + 1500){
      T.tried = []; connect(best); return;
    }
  }
  T.ws.send(tuneMsg()); T.rssi = []; T.next = 0; TX.fill = 0;       // a transcript clip is one channel
  if(CW.on) cwStart();                                          // a new channel, a new tone and speed
  logEvent(Date.now(), 'mark', 'tuned ' + T.khz + ' kHz ' + T.mode.toUpperCase());
  tunerNow();
  if(WF.start != null && (T.khz < WF.start + WF.span*0.04 || T.khz > WF.start + WF.span*0.96)) wfView(T.khz);   // keep the tuning in view
  wfDraw();
}
/* scan: each preset in turn on the current receiver, its signal level and
   what the detectors made of it; stops where a voice is heard if asked to */
function scanToggle(){
  touch();
  if(T.scan){ clearTimeout(T.scan.timer); T.scan = null; $('tuScan').textContent = '⟳ SCAN PRESETS'; return; }
  if(!T.ws || !T.live){ status('Press LISTEN first; the scan uses the receiver you are on.', true); return; }
  T.scan = {i:0, res:[], dwell:+$('tuDwell').value*1000};
  $('tuScan').textContent = '■ STOP SCAN';
  scanStep();
}
function scanStep(){
  var sc = T.scan; if(!sc) return;
  if(sc.i >= SCAN.length){ T.scan = null; $('tuScan').textContent = '⟳ SCAN PRESETS'; status('Scan complete.'); return; }
  var p = SCAN[sc.i], ev0 = S.events.length;
  retune(p.khz, p.mode, p.id);
  sc.timer = setTimeout(function(){
    if(T.scan !== sc) return;
    var r = T.rssi.slice(Math.floor(T.rssi.length/4)).sort(function(a, b){ return a - b; });
    var voice = S.events.slice(0, S.events.length - ev0).some(function(e){ return e.kind === 'voice'; }) || S.voiceNow;
    sc.res.push({p:p, rssi:r.length ? r[r.length >> 1] : null, buzz:!!S.pulse, voice:voice, rate:S.pulse ? S.pulse.rate : null});
    paintScan(sc);
    if(voice && $('tuStopVoice').checked){
      T.scan = null; $('tuScan').textContent = '⟳ SCAN PRESETS';
      status('Voice-like sound on ' + esc(p.name) + ' — the scan stopped here. Confirm by ear: detectors are rules of thumb.');
      return;
    }
    sc.i++; scanStep();
  }, sc.dwell);
}
function paintScan(sc){
  var top = Math.max.apply(null, sc.res.map(function(x){ return x.rssi == null ? -999 : x.rssi; }));
  $('tuScanOut').innerHTML = sc.res.map(function(x){
    var flag = x.voice ? '<span class="sig-st voice">VOICE?</span>' : x.buzz ? '<span class="sig-st buzz">PULSES ' + (x.rate ? x.rate.toFixed(1) + '/min' : '') + '</span>' : '';
    return '<div class="tu-sr' + (x.rssi === top ? ' top' : '') + '"><b>' + esc(x.p.name) + '</b><span>' + x.p.khz + ' kHz</span><span>' +
      (x.rssi == null ? '—' : x.rssi.toFixed(0) + ' dBm') + '</span>' + flag + '</div>';
  }).join('');
}
/* ------------------------------------------ the receiver's own waterfall */
/* The Kiwi's waterfall comes over a second connection opened with the same
   timestamp as the audio, so the receiver pairs them as one listener (checked
   on a live Kiwi: the user count rose by one). Rows are 1024 bins of dB,
   IMA ADPCM with a fresh decoder per row and 10 values of padding in front;
   a bin's frequency follows from the row's start bin and zoom. Medium speed
   (about 8 rows a second) keeps it light on the receiver. */
var WF = {ws:null, ok:false, zoom:8, zoomMax:14, bwKhz:30000, cf:4625, start:null, span:null, rows:[], lastKa:0,
          off:null, og:null, lo:-110, hi:-50, seeking:null, note:''};
var BANDS = {
  broadcast:[['120 m',2300,2495],['90 m',3200,3400],['75 m',3900,4000],['60 m',4750,5060],['49 m',5900,6200],['41 m',7200,7450],
             ['31 m',9400,9900],['25 m',11600,12100],['22 m',13570,13870],['19 m',15100,15830],['16 m',17480,17900],['13 m',21450,21850]],
  ham:[['160 m',1800,2000,'lsb'],['80 m',3500,3800,'lsb'],['60 m',5330,5410,'usb'],['40 m',7000,7200,'lsb'],['30 m',10100,10150,'cw'],
       ['20 m',14000,14350,'usb'],['17 m',18068,18168,'usb'],['15 m',21000,21450,'usb'],['12 m',24890,24990,'usb'],['10 m',28000,29700,'usb']],
  utility:[['Aviation 3 MHz',2850,3155],['Aviation 5 MHz',5450,5730],['Aviation 6.6 MHz',6525,6765],['Aviation 9 MHz',8815,9040],
           ['Aviation 11 MHz (HFGCS)',11175,11400],['Aviation 13 MHz',13200,13360],['Maritime 4 MHz',4063,4438],['Maritime 6 MHz',6200,6525],
           ['Maritime 8 MHz',8195,8815],['Military 4.6 MHz (UVB-76)',4500,4750],['Time signals 10 MHz',9990,10010,'am']]
};
function wfSpan(z){ return WF.bwKhz/Math.pow(2, z); }
function wfMsg(){ return 'SET zoom=' + WF.zoom + ' cf=' + WF.cf.toFixed(3); }
function wfView(cf, zoom){
  if(zoom != null) WF.zoom = Math.max(0, Math.min(WF.zoomMax, zoom));
  var half = wfSpan(WF.zoom)/2;
  WF.cf = Math.max(half, Math.min(WF.bwKhz - half, cf));
  WF.rows = [];
  if(WF.og){ WF.og.fillStyle = '#070d1f'; WF.og.fillRect(0, 0, 1024, WF_H); }     // old rows were on another scale
  if(WF.ws && WF.ok) WF.ws.send(wfMsg());
}
function wfClose(){
  var ws = WF.ws; WF.ws = null; WF.ok = false; WF.rows = []; WF.seeking = null;
  if(ws){ try{ ws.close(); }catch(_){} }
}
function wfOpen(){
  wfClose();
  if(!T.rx || !$('tuWf')) return;
  var ws;
  try{ ws = new WebSocket('wss://' + T.rx.host + '/' + T.ts + '/W/F'); }catch(e){ WF.note = 'waterfall unavailable'; return; }
  ws.binaryType = 'arraybuffer';
  WF.ws = ws; WF.note = 'waterfall connecting…';
  var setup = function(){
    if(WF.ws !== ws || WF.ok) return;
    WF.ok = true; WF.note = '';
    ['SERVER DE CLIENT openwebrx.js W/F', 'SET send_dB=1', wfMsg(), 'SET maxdb=0 mindb=-100', 'SET wf_speed=3', 'SET wf_comp=1',
     'SET keepalive'].forEach(function(m){ ws.send(m); });
  };
  ws.onopen = function(){ ws.send('SET auth t=kiwi p='); setTimeout(setup, 2500); };
  ws.onclose = function(){ if(WF.ws === ws){ WF.ws = null; WF.ok = false; WF.note = 'this receiver is not sharing its waterfall right now'; wfDraw(); } };
  ws.onmessage = function(e){
    if(WF.ws !== ws) return;
    var u8 = new Uint8Array(typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data);
    var tag = String.fromCharCode(u8[0], u8[1], u8[2]);
    if(tag === 'MSG'){
      new TextDecoder('latin1').decode(u8.subarray(4)).split(' ').forEach(function(pair){
        var k = pair.split('=')[0], v = pair.slice(k.length + 1);
        if(k === 'bandwidth') WF.bwKhz = (+v || 30e6)/1000;
        else if(k === 'zoom_max') WF.zoomMax = +v || 14;
        else if(k === 'wf_setup') setup();
        else if(k === 'too_busy' || k === 'down' || (k === 'badp' && v !== '0')){ WF.note = 'this receiver is not sharing its waterfall right now'; wfClose(); }
      });
      return;
    }
    if(tag !== 'W/F') return;
    var dv = new DataView(u8.buffer, u8.byteOffset), xb = dv.getUint32(4, true), zf = dv.getUint32(8, true);
    var zoom = zf & 0xffff, flags = zf >>> 16, data = u8.subarray(16), vals;
    if(flags & 1){
      var st = {i:0, p:0}, out = new Float32Array(data.length*2), k = 0;
      for(var i = 0; i < data.length; i++){ out[k++] = nib8(data[i] & 15, st); out[k++] = nib8(data[i] >> 4, st); }
      vals = out.subarray(10, 10 + 1024);
    } else {
      vals = new Float32Array(1024); for(var j = 0; j < 1024 && j < data.length; j++) vals[j] = data[j];
    }
    var row = new Float32Array(vals.length);
    for(var m = 0; m < vals.length; m++) row[m] = vals[m] - 255;
    var start = xb*WF.bwKhz/(1024*Math.pow(2, WF.zoomMax)), span = wfSpan(zoom);
    if(zoom !== WF.zoom || Math.abs(start + span/2 - WF.cf) > span*0.02) return;       // a row from before a re-zoom
    WF.start = start; WF.span = span;
    WF.rows.push(row); if(WF.rows.length > 40) WF.rows.shift();
    wfRow(row);
    var now = Date.now();
    if(now - WF.lastKa > 1000){ WF.lastKa = now; try{ ws.send('SET keepalive'); }catch(_){} }
    if(WF.seeking && WF.rows.length >= 6) seekStep();
  };
}
function nib8(code, st){                         // the same ADPCM, clamped to one byte
  var step = STEP[st.i], d = step >> 3;
  if(code & 1) d += step >> 2;
  if(code & 2) d += step >> 1;
  if(code & 4) d += step;
  if(code & 8) d = -d;
  st.p = Math.max(0, Math.min(255, st.p + d));
  st.i = Math.min(88, Math.max(0, st.i + ADJ[code]));
  return st.p;
}
/* drawing: rows land in an offscreen 1024-wide image that scrolls down; the
   visible canvas scales it and adds the spectrum, the axis, the passband */
var WF_H = 180;
function wfRow(row){
  if(!WF.off){ WF.off = document.createElement('canvas'); WF.off.width = 1024; WF.off.height = WF_H; WF.og = WF.off.getContext('2d'); }
  var s = Array.prototype.slice.call(row, 4, 1020).sort(function(a, b){ return a - b; });
  var floor = s[Math.floor(s.length*0.2)], top = s[Math.floor(s.length*0.998)];
  WF.lo += (floor - 4 - WF.lo)*0.15; WF.hi += (Math.max(top + 4, WF.lo + 30) - WF.hi)*0.15;   // auto levels, smoothed
  WF.og.drawImage(WF.off, 0, 0, 1024, WF_H - 1, 0, 1, 1024, WF_H - 1);
  var img = WF.og.createImageData(1024, 1), lut = LUT || (buildLut('thermal'), LUT), rng = WF.hi - WF.lo;
  for(var i = 0; i < 1024; i++){
    var v = Math.max(0, Math.min(255, Math.round((row[i] - WF.lo)/rng*255)));
    img.data[i*4] = lut[v*3]; img.data[i*4+1] = lut[v*3+1]; img.data[i*4+2] = lut[v*3+2]; img.data[i*4+3] = 255;
  }
  WF.og.putImageData(img, 0, 0);
  wfDraw();
}
function wfAvg(n){
  var rows = WF.rows.slice(-(n || 12)); if(!rows.length) return null;
  var a = new Float32Array(1024);
  rows.forEach(function(r){ for(var i = 0; i < 1024; i++) a[i] += r[i]/rows.length; });
  return a;
}
function wfDraw(){
  var cv = $('tuWf'); if(!cv || !ONSCREEN || !cv.clientWidth) return;
  var dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300, SP = 46, AX = 16, h = SP + WF_H*0.8 + AX;
  if(cv.width !== Math.round(w*dpr) || cv.height !== Math.round(h*dpr)){ cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr); cv.style.height = h + 'px'; }
  var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#070d1f'; g.fillRect(0, 0, w, h);
  if(WF.off && WF.start != null) g.drawImage(WF.off, 0, 0, 1024, WF_H, 0, SP, w, WF_H*0.8);
  var avg = wfAvg(4);
  if(avg && WF.start != null){
    g.strokeStyle = '#22d3ee'; g.lineWidth = 1; g.beginPath();
    for(var i = 0; i < 1024; i += 2){
      var x = i/1024*w, y = SP - 2 - Math.max(0, Math.min(1, (avg[i] - WF.lo)/(WF.hi - WF.lo)))*(SP - 6);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  if(WF.start != null){
    var fx = function(f){ return (f - WF.start)/WF.span*w; };
    // passband
    var pb = passband(), a = fx(T.khz + pb[0]/1000), b = fx(T.khz + pb[1]/1000);
    g.fillStyle = 'rgba(250,204,21,.16)'; g.fillRect(Math.min(a, b), 0, Math.max(2, Math.abs(b - a)), h - AX);
    g.strokeStyle = '#facc15'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(fx(T.khz), 0); g.lineTo(fx(T.khz), h - AX); g.stroke();
    // axis
    var stepK = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].filter(function(s){ return WF.span/s <= w/70; })[0] || 5000;
    g.fillStyle = '#94a3b8'; g.font = '10px ui-monospace,monospace'; g.textAlign = 'center';
    for(var f = Math.ceil(WF.start/stepK)*stepK; f < WF.start + WF.span; f += stepK){
      var x2 = fx(f); g.fillRect(x2, h - AX, 1, 4); g.fillText(f >= 10000 ? (f/1000).toFixed(stepK < 1000 ? 2 : 0) + 'M' : String(f), x2, h - 3);
    }
  }
  if(WF.note || WF.start == null){
    g.fillStyle = '#94a3b8'; g.font = '12px system-ui,sans-serif'; g.textAlign = 'center';
    g.fillText(WF.note || (T.live ? 'waterfall loading…' : 'press LISTEN for the receiver’s waterfall'), w/2, SP + 40);
  }
}
/* seek: the next signal standing clear of the noise in the chosen direction;
   past the edge of the view, the view moves on and the search continues */
function seekSig(dir){
  touch();
  if(!WF.ok){ status('Seek reads the receiver’s waterfall; press LISTEN and wait a moment.', true); return; }
  WF.seeking = {dir:dir, hops:0};
  seekStep();
}
function seekStep(){
  var sk = WF.seeking; if(!sk) return;
  var avg = wfAvg(10); if(!avg || WF.start == null) return;
  var s = Array.prototype.slice.call(avg, 8, 1016).sort(function(a, b){ return a - b; }), floor = s[s.length >> 1], thr = floor + 9;
  var bin = WF.span/1024, gap = Math.max(1, 4*bin), peaks = [];
  for(var i = 8; i < 1016; i++){
    if(avg[i] < thr) continue;
    var j = i, best = i;
    while(j < 1016 && avg[j] >= thr){ if(avg[j] > avg[best]) best = j; j++; }
    peaks.push(WF.start + (best + 0.5)*bin); i = j;
  }
  var c = peaks.filter(function(f){ return sk.dir > 0 ? f > T.khz + gap : f < T.khz - gap; })
               .sort(function(a, b){ return sk.dir > 0 ? a - b : b - a; })[0];
  if(c != null){
    WF.seeking = null;
    retune(Math.round(c*10)/10, null, null);                    // to the bin, not the tap step
    status('Seek: signal at ' + T.khz.toFixed(1) + ' kHz, ' + Math.round(Math.max.apply(null, [].slice.call(avg)) - floor) + ' dB over the noise at its strongest point in view.');
    return;
  }
  if(++sk.hops > 8 || (sk.dir > 0 ? WF.start + WF.span >= WF.bwKhz : WF.start <= 0)){
    WF.seeking = null; status('Seek found nothing standing out in that direction.'); return;
  }
  wfView(WF.cf + sk.dir*WF.span*0.8);                  // move the view on, keep looking as rows arrive
}
function bwFor(mode){                           // a sensible width for each mode
  var bw = $('tuBw'); if(!bw) return;
  bw.value = mode === 'am' ? '8' : mode === 'cw' ? '0.5' : '2.4';
  $('tuBwV').textContent = (+bw.value).toFixed(1) + ' kHz';
}
function passband(){
  /* a picture or text preset sets its filter edges exactly: fax needs 1500-2300
     Hz with room for a tuning error, SSTV 1100-2300 Hz with the same */
  if(T.pbFix && T.mode !== 'am' && T.mode !== 'cw') return T.mode === 'lsb' ? [-T.pbFix[1], -T.pbFix[0]] : T.pbFix.slice();
  var bw = +$('tuBw').value*1000 || 2400;
  if(T.mode === 'usb') return [300, 300 + bw];
  if(T.mode === 'lsb') return [-(300 + bw), -300];
  if(T.mode === 'cw') return [Math.max(50, 550 - bw/2), 550 + bw/2];
  return [-bw/2, bw/2];
}
var NR_MSGS = {
  nb:  ['SET nb algo=1', 'SET nb type=0 param=0 pval=100', 'SET nb type=0 param=1 pval=50', 'SET nb type=0 en=1'],
  nboff: ['SET nb algo=0', 'SET nb type=0 en=0'],
  nr:  ['SET nr algo=3', 'SET nr type=0 param=0 pval=1', 'SET nr type=0 param=1 pval=0.95', 'SET nr type=0 param=2 pval=1000',
        'SET nr type=0 param=3 pval=0', 'SET nr type=0 en=1'],
  nroff: ['SET nr algo=0', 'SET nr type=0 en=0']
};
function dspMsgs(){
  var v = $('tuNr').value;
  return (v === 'nb' || v === 'both' ? NR_MSGS.nb : NR_MSGS.nboff).concat(v === 'nr' || v === 'both' ? NR_MSGS.nr : NR_MSGS.nroff);
}
function applyDsp(){
  touch();
  if(T.ws && T.live){ T.ws.send(tuneMsg()); dspMsgs().forEach(function(m){ T.ws.send(m); }); }
  wfDraw();
}
function bandPick(kind, idx){
  var b = BANDS[kind][idx]; if(!b) return;
  var span = b[2] - b[1], z = Math.max(0, Math.min(WF.zoomMax, Math.floor(Math.log(WF.bwKhz/(span*1.15))/Math.LN2)));
  var mode = b[3] || (kind === 'broadcast' ? 'am' : 'usb');
  retune(Math.round((b[1] + b[2])/2), mode, null);
  wfView((b[1] + b[2])/2, z);
  status(esc(b[0]) + ': ' + b[1] + '–' + b[2] + ' kHz. Tap a trace on the waterfall to tune it, or SEEK.');
}
/* --------------------------------------------- transcribe + translate */
/* Speech in the tuner's audio, written out and put into English by Whisper
   running on this device (transformers.js in a worker). The model is
   downloaded once from Hugging Face and kept by the browser; the audio never
   leaves the device. The last minute of what you hear is held in memory, and
   the clip is cleared whenever you retune, so it is one channel's audio. */
var TX_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
var TX_MODELS = {tiny:['onnx-community/whisper-tiny', '≈40 MB'], base:['onnx-community/whisper-base', '≈80 MB'],
                 small:['onnx-community/whisper-small', '≈250 MB']};
var TX = {ring:null, pos:0, fill:0, worker:null, busy:false, id:0, items:[]};
function ringReset(){ TX.ring = new Float32Array(Math.round(T.sr*60)); TX.pos = 0; TX.fill = 0; }
function ringPush(f){
  if(!TX.ring) ringReset();
  var r = TX.ring, n = r.length;
  for(var i = 0; i < f.length; i++){ r[TX.pos] = f[i]; TX.pos = (TX.pos + 1) % n; }
  TX.fill = Math.min(n, TX.fill + f.length);
}
function ringLast(sec){
  var r = TX.ring; if(!r) return null;
  var n = Math.min(TX.fill, Math.round(sec*T.sr)), out = new Float32Array(n), st = (TX.pos - n + r.length) % r.length;
  for(var i = 0; i < n; i++) out[i] = r[(st + i) % r.length];
  return out;
}
function to16k(x, sr){                          // Whisper hears 16 kHz
  var q = sr/16000, n = Math.floor(x.length/q), y = new Float32Array(n);
  for(var i = 0; i < n; i++){ var t = i*q, j = Math.floor(t), a = t - j; y[i] = x[j]*(1 - a) + x[Math.min(j + 1, x.length - 1)]*a; }
  return y;
}
/* phrases Whisper is known to invent over static and silence, from the
   subtitles it was trained on */
var TX_GHOSTS = /thank(s| you) for watching|subscribe|subtitles? by|amara\.org|продолжение следует|субтитр|спасибо за (просмотр|внимание)|ご視聴|字幕|^\W*(you|music|\[music\]|\(music\))\W*$/i;
/* Whisper's best-known failure: it gets stuck and writes one phrase over and
   over, worst on the small models and on noisy or music-like audio. A phrase
   of 1-12 words repeated three or more times in a row is folded to one copy
   marked with how often it came. */
function txLoops(text){
  var w = String(text || '').trim().split(/\s+/).filter(Boolean), out = [], worst = 1;
  for(var i = 0; i < w.length;){
    var best = null;
    for(var n = 1; n <= 12 && i + 3*n <= w.length; n++){
      var reps = 1, key = w.slice(i, i + n).join(' ').toLowerCase();
      while(i + (reps + 1)*n <= w.length && w.slice(i + reps*n, i + (reps + 1)*n).join(' ').toLowerCase() === key) reps++;
      if(reps >= 3 && (!best || reps*n > best.reps*best.n)) best = {n:n, reps:reps};
    }
    if(best){ out.push(w.slice(i, i + best.n).join(' ') + ' [×' + best.reps + ']'); i += best.n*best.reps; worst = Math.max(worst, best.reps); }
    else out.push(w[i++]);
  }
  return {text:out.join(' '), loops:worst};
}
function txDoubt(text){
  var t = (text || '').trim();
  if(!t) return 'no speech found';
  if(TX_GHOSTS.test(t)) return 'probably not speech: Whisper writes phrases like this over static';
  var lp = txLoops(t);
  if(lp.loops >= 3) return 'Whisper got stuck repeating a phrase (' + lp.loops + ' times in a row), a known failure of the model; the repeats are folded to one. ' +
                           'The real speech was probably shorter. Try the "better" or "best" model, or set the language';
  return '';
}
function txWorker(){
  if(TX.worker) return TX.worker;
  var src = "import { pipeline, env } from '" + TX_LIB + "';\n" +
    "env.allowLocalModels = false;\n" +
    "let asr = null, which = null;\n" +
    "const loops = " + txLoops.toString() + ";\n" +
    "self.onmessage = async (e) => {\n" +
    "  const { id, model, audio, language } = e.data;\n" +
    "  const budget = Math.max(48, Math.min(440, Math.round(audio.length / 16000 * 9)));\n" +
    "  try {\n" +
    "    if (!asr || which !== model) {\n" +
    "      const seen = {};\n" +
    "      asr = await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback: (p) => {\n" +
    "        if (p.status === 'progress' && p.total) { seen[p.file] = [p.loaded, p.total];\n" +
    "          let a = 0, b = 0; for (const k in seen) { a += seen[k][0]; b += seen[k][1]; }\n" +
    "          self.postMessage({ id, loading: a / b, mb: b / 1048576 }); } } });\n" +
    "      which = model;\n" +
    "    }\n" +
    "    self.postMessage({ id, working: 'transcribe' });\n" +
    "    let opt = { chunk_length_s: 30, stride_length_s: 5, language: language || null, max_new_tokens: budget };\n" +
    "    let orig;\n" +
    "    try { orig = await asr(audio, Object.assign({ task: 'transcribe' }, opt)); }\n" +
    "    catch (x) { opt = { chunk_length_s: 30, stride_length_s: 5, language: language || null };   // settings refused: plain run\n" +
    "                orig = await asr(audio, Object.assign({ task: 'transcribe' }, opt)); }\n" +
    "    let retried = false;\n" +
    "    if (loops(orig.text).loops >= 3) {\n" +
    "      self.postMessage({ id, working: 'retry' });\n" +
    "      opt = Object.assign({}, opt, { return_timestamps: true, repetition_penalty: 1.2 });\n" +
    "      let again = orig;\n" +
    "      try { again = await asr(audio, Object.assign({ task: 'transcribe' }, opt)); } catch (x) {}\n" +
    "      if (loops(again.text).loops < loops(orig.text).loops) orig = again;\n" +
    "      retried = true;\n" +
    "    }\n" +
    "    let en = null;\n" +
    "    if (language !== 'english' && orig.text.trim()) { self.postMessage({ id, working: 'translate', orig: orig.text });\n" +
    "      en = (await asr(audio, Object.assign({ task: 'translate' }, opt))).text; }\n" +
    "    self.postMessage({ id, done: true, orig: orig.text, en, retried });\n" +
    "  } catch (err) { asr = null; which = null; self.postMessage({ id, error: String((err && err.message) || err) }); }\n" +
    "};\n";
  try{ TX.worker = new Worker(URL.createObjectURL(new Blob([src], {type:'text/javascript'})), {type:'module'}); }
  catch(e){ return null; }
  TX.worker.onmessage = function(e){ txUpdate(e.data); };
  TX.worker.onerror = function(e){ txUpdate({id:TX.id, error:(e && e.message) || 'the speech model could not start in this browser'}); };
  return TX.worker;
}
function transcribe(){
  touch();
  if(TX.busy){ return; }
  if(!T.live){ status('Transcribe works on what the tuner is playing: press LISTEN first.', true); return; }
  var sec = +$('tuTxLen').value || 20, clip = ringLast(sec);
  if(!clip || clip.length < T.sr*2){ status('Listen for a few seconds on this channel first; the clip starts when you tune.', true); return; }
  var w = txWorker(); if(!w){ status('This browser cannot run the speech model (no module workers).', true); return; }
  var m = TX_MODELS[$('tuTxModel').value] || TX_MODELS.base, lang = $('tuTxLang').value;
  var it = {id:++TX.id, t:Date.now(), khz:T.khz, mode:T.mode, rx:T.rx ? (T.rx.loc || T.rx.host) : '', sec:Math.round(clip.length/T.sr),
            model:$('tuTxModel').value, lang:lang, state:'starting the speech model…'};
  TX.items.unshift(it); if(TX.items.length > 30) TX.items.length = 30;
  TX.busy = true; $('tuTx').disabled = true;
  paintTx();
  var audio = to16k(clip, T.sr);
  w.postMessage({id:it.id, model:m[0], audio:audio, language:lang === 'auto' ? null : lang}, [audio.buffer]);
}
function txUpdate(d){
  var it = TX.items.filter(function(x){ return x.id === d.id; })[0]; if(!it) return;
  if(d.loading != null) it.state = 'downloading the model, once: ' + Math.round(d.loading*100) + '% of ' + Math.round(d.mb) + ' MB';
  if(d.working) it.state = d.working === 'transcribe' ? 'listening through the clip…' : d.working === 'retry' ? 'it got stuck repeating itself; trying again another way…' : 'putting it into English…';
  if(d.orig != null) it.orig = d.orig.trim();
  if(d.done){
    it.state = ''; it.en = d.en ? d.en.trim() : null; it.retried = !!d.retried;
    it.doubt = txDoubt(it.orig) || (it.en ? txDoubt(it.en) : '');
    it.orig = txLoops(it.orig).text; if(it.en) it.en = txLoops(it.en).text;      // folded, never hundreds of copies
    if(it.en && it.orig && it.en.toLowerCase() === it.orig.toLowerCase()) it.en = null;
    logEvent(it.t, 'mark', 'transcript ' + it.khz + ' kHz: ' + (it.doubt ? '(' + it.doubt + ')' : (it.en || it.orig).slice(0, 80)));
  }
  if(d.error){ it.state = ''; it.err = d.error; }
  if(d.done || d.error){ TX.busy = false; $('tuTx').disabled = false; }
  paintTx();
}
function paintTx(){
  var el = $('tuTxOut'); if(!el) return;
  el.innerHTML = TX.items.map(function(it){
    var head = '<b>' + esc(utc(it.t)) + '</b> ' + esc(String(it.khz)) + ' kHz ' + esc(it.mode.toUpperCase()) + ' &middot; ' + it.sec + ' s &middot; ' +
               esc(it.rx) + ' &middot; whisper-' + esc(it.model) + (it.lang !== 'auto' ? ' &middot; ' + esc(it.lang) : '');
    var body = it.err ? '<div class="tu-tx-err">The speech model failed: ' + esc(it.err) + '</div>' :
      it.state ? '<div class="sig-small">' + esc(it.state) + '</div>' +
                 (it.orig ? '<div class="tu-tx-orig">' + esc(it.orig) + '</div>' : '') :
      (it.doubt ? '<div class="tu-tx-doubt">' + esc(it.doubt) + '</div>' : '') +
      (it.orig ? '<div class="tu-tx-orig' + (it.doubt ? ' dim' : '') + '">' + esc(it.orig) + '</div>' : '') +
      (it.en ? '<div class="tu-tx-en' + (it.doubt ? ' dim' : '') + '"><span>EN</span> ' + esc(it.en) + '</div>' : '');
    return '<div class="tu-tx-item">' + head + (it.state ? '' : ' <button class="ev-f tu-tx-del" type="button" data-del="' + it.id + '" title="delete this transcript">✕</button>') + body + '</div>';
  }).join('') + (TX.items.length && !TX.busy ? '<button class="ev-f" type="button" id="tuTxClear">CLEAR ALL TRANSCRIPTS</button>' : '');
  el.querySelectorAll('[data-del]').forEach(function(b){ b.onclick = function(){ txDelete(+b.dataset.del); }; });
  var ca = $('tuTxClear'); if(ca) ca.onclick = function(){ if(confirm('Delete every transcript on this page?')) txDelete(null); };
}
/* Transcripts live only in this page's memory. Deleting one also takes its
   line out of the analyzer's detections. */
function txDelete(id){
  var gone = TX.items.filter(function(it){ return id == null || it.id === id; });
  TX.items = TX.items.filter(function(it){ return gone.indexOf(it) < 0; });
  S.events = S.events.filter(function(ev){
    return !(ev.kind === 'mark' && /^transcript /.test(ev.text) && gone.some(function(it){ return it.t === ev.t; }));
  });
  paintEvents(); paintTx();
}
function wireTranscribe(){
  if(!$('tuTx')) return;
  $('tuTx').onclick = transcribe;
  $('tuTxModel').value = get('txModel', 'base');
  $('tuTxModel').onchange = function(){ set('txModel', this.value); };
  $('tuTxLang').value = get('txLang', 'auto');
  $('tuTxLang').onchange = function(){ set('txLang', this.value); };
}

/* ----------------------------------------------------- Morse decoder */
/* Morse in the tuner's audio, turned into text. The strongest steady tone in
   the audio is found, its level is followed sample by sample (mixed down and
   low-passed), and the on/off times are read against the sender's speed,
   which is learnt as it goes. Only the text is kept: a log per session, saved
   in this browser and downloadable as a .txt file. Weak or fading signals,
   two senders on one tone, and sloppy hand-keying all come out as errors. */
var MORSE = {'.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K',
  '.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W',
  '-..-':'X','-.--':'Y','--..':'Z','-----':'0','.----':'1','..---':'2','...--':'3','....-':'4','.....':'5','-....':'6',
  '--...':'7','---..':'8','----.':'9','.-.-.-':'.','--..--':',','..--..':'?','-..-.':'/','-...-':'=','.-.-.':'<AR>',
  '...-.-':'<SK>','-.--.':'<KN>','.-...':'<AS>','-.-.--':'!','---...':':','-.-.-.':';','.----.':"'",'-....-':'-',
  '.-..-.':'"','.--.-.':'@','........':'<HH>'};
function cwDecoder(sr, out){
  var D = {tone:0, acc:null, cands:[], hist:new Float32Array(Math.round(sr)), hn:0, since:0, blk:Math.round(sr*0.25),
           ph:0, i1:0, q1:0, i2:0, q2:0, k:1 - Math.exp(-2*Math.PI*45/sr),
           hop:Math.max(1, Math.round(sr*0.004)), hc:0,
           lo:1, hi:0, on:false, run:0, dit:0.06, sym:'', gapDone:2, snr:0, learn:[], marks:[], fresh:true, pending:null};
  for(var f = 300; f <= 1500; f += 10) D.cands.push(f);
  D.acc = new Float32Array(D.cands.length);
  function recent(n){                            // the last n samples, oldest first
    var h = D.hist, L = h.length, o = new Float32Array(n), st = (D.hn - n + L) % L;
    for(var i = 0; i < n; i++) o[i] = h[(st + i) % L];
    return o;
  }
  function scan(){                              // where is the tone?
    var b = recent(D.blk), n = b.length, best = 0, bi = 0;
    for(var c = 0; c < D.cands.length; c++){
      var w = 2*Math.PI*D.cands[c]/sr, cf = 2*Math.cos(w), s1 = 0, s2 = 0;
      for(var i = 0; i < n; i++){ var s0 = b[i] + cf*s1 - s2; s2 = s1; s1 = s0; }
      D.acc[c] = D.acc[c]*0.75 + (s1*s1 + s2*s2 - cf*s1*s2);
      if(D.acc[c] > best){ best = D.acc[c]; bi = c; }
    }
    var srt = Array.prototype.slice.call(D.acc).sort(function(a, b){ return a - b; }), med = srt[srt.length >> 1] || 1e-12;
    D.snr = 10*Math.log10(best/med);
    var f = D.cands[bi], cur = D.cands.indexOf(D.tone);
    if(D.snr > 10 && (!D.tone || (Math.abs(f - D.tone) > 25 && D.acc[bi] > 2*(D.acc[cur] || 0)))) lock(f);
  }
  /* a new tone: its levels come from the last second, which is then read
     again, so the start of the message is not lost while the tone was found */
  function lock(f){
    D.tone = f; D.ph = 0; D.i1 = D.q1 = D.i2 = D.q2 = 0; D.hc = 0; D.on = false; D.run = 0; D.gapDone = 2; D.sym = '';
    var x = recent(Math.min(D.since, D.hist.length)), envs = [];
    var save = [D.ph, D.i1, D.q1, D.i2, D.q2];
    for(var i = 0; i < x.length; i++){ var e = mix(x[i]); if(e != null) envs.push(e); }
    D.ph = save[0]; D.i1 = save[1]; D.q1 = save[2]; D.i2 = save[3]; D.q2 = save[4]; D.hc = 0;
    envs.sort(function(a, b){ return a - b; });
    D.lo = envs[Math.floor(envs.length*0.2)] || 1; D.hi = envs[Math.floor(envs.length*0.97)] || 0;
    for(var j = 0; j < x.length; j++) step(x[j]);
  }
  function mix(v){                               // the tone's level, every hop
    D.ph += 2*Math.PI*D.tone/sr; if(D.ph > 6.283185307) D.ph -= 6.283185307;
    var ii = v*Math.cos(D.ph), qq = v*Math.sin(D.ph);
    D.i1 += (ii - D.i1)*D.k; D.q1 += (qq - D.q1)*D.k; D.i2 += (D.i1 - D.i2)*D.k; D.q2 += (D.q1 - D.q2)*D.k;
    if(++D.hc < D.hop) return null;
    D.hc = 0;
    return Math.sqrt(D.i2*D.i2 + D.q2*D.q2);
  }
  function step(v){
    var env = mix(v); if(env == null) return;
    var dt = D.hop/sr;
    // the noise level is learnt while the key is up, the signal level while it is down
    if(D.on) D.hi += (env - D.hi)*(env > D.hi ? 0.3 : 0.03);
    else { D.lo += (env - D.lo)*(env < D.lo ? 0.2 : 0.03); D.hi += (env - D.hi)*(env > D.hi ? 0.3 : 0.002); }
    // key-down needs the tone well clear of the noise as well as near the signal's level
    var mid = D.lo + (D.hi - D.lo)*(D.on ? 0.4 : 0.6), on = env > mid && env > D.lo*(D.on ? 2.5 : 3.5) && D.hi > D.lo*4;
    if(on === D.on){
      D.run += dt;
      if(!on && D.learn && D.learn.length && D.run > 1.5) learnt();       // a short message: read it now
      if(!on && D.sym && D.run > D.dit*2.5){ letter(); D.gapDone = 1; }
      if(!on && D.gapDone === 1 && D.run > D.dit*6){ word(); D.gapDone = 2; }
      if(!on && D.run > 2 && !D.fresh){                 // a pause: drop a lone blip, start afresh
        if(D.pending && D.pending[1].length > 2) { flush(); out(' '); }
        D.pending = null; D.fresh = true;
      }
      return;
    }
    if(D.on) ev(true, D.run); else if(D.gapDone === 0) ev(false, D.run);
    D.gapDone = 0; D.on = on; D.run = dt;
  }
  /* a lone dot or dash with two seconds of quiet either side is a noise
     burst far more often than a letter, so the first letter after a pause is
     held until something follows it */
  function letter(){
    if(!D.sym) return;
    var ch = MORSE[D.sym] || '*', code = D.sym; D.sym = '';
    if(D.fresh){ D.pending = [ch, code]; D.fresh = false; return; }
    flush(); out(ch, code);
  }
  function flush(){ if(D.pending){ out(D.pending[0], D.pending[1]); D.pending = null; } }
  function word(){ if(!D.pending) out(' '); }
  function mark(t){                              // a key-down of t seconds
    if(t < Math.max(0.012, D.dit*0.35)) return;  // a click or a crash, not a dot
    // the speed, from the last 16 key-downs sorted into dots and dashes, so it follows a sender who speeds up
    D.marks.push(t); if(D.marks.length > 16) D.marks.shift();
    if(D.marks.length >= 6){
      var m = two(D.marks);
      if(m[1] > m[0]*2.2) D.dit = Math.min(0.3, Math.max(0.025, (m[0] + m[1]/3)/2));
    }
    D.sym += t < D.dit*2 ? '.' : '-';
    if(D.sym.length > 9) D.sym = '';             // nothing that long is Morse
  }
  function space(t){                             // a key-up of t seconds
    if(t > D.dit*5){ letter(); word(); }
    else if(t > D.dit*2) letter();
  }
  /* the first ten key-downs are held until the speed is known, then read */
  function two(v){                               // two-means: the short and the long
    var a = Math.min.apply(null, v), b = Math.max.apply(null, v);
    for(var k = 0; k < 12; k++){
      var sa = 0, na = 0, sb = 0, nb = 0;
      v.forEach(function(t){ if(Math.abs(t - a) <= Math.abs(t - b)){ sa += t; na++; } else { sb += t; nb++; } });
      a = na ? sa/na : a; b = nb ? sb/nb : b;
    }
    return [a, b];
  }
  function learnt(){
    var L = D.learn; D.learn = null;
    var marks = L.filter(function(e){ return e[0] && e[1] >= 0.012; }).map(function(e){ return e[1]; });
    var gaps = L.filter(function(e){ return !e[0]; }).map(function(e){ return e[1]; });
    if(marks.length){
      var m = two(marks);
      if(m[1] > m[0]*2) D.dit = (m[0] + m[1]/3)/2;
      else if(gaps.length) D.dit = Math.min(two(gaps)[0], m[0]);
      else D.dit = m[0];
      D.dit = Math.min(0.3, Math.max(0.025, D.dit));
    }
    L.forEach(function(e){ e[0] ? mark(e[1]) : space(e[1]); });
  }
  function ev(isMark, t){
    if(D.learn){
      D.learn.push([isMark, t]);
      if(D.learn.filter(function(e){ return e[0]; }).length >= 10) learnt();
      return;
    }
    isMark ? mark(t) : space(t);
  }
  D.push = function(x){
    for(var i = 0; i < x.length; i++){
      D.hist[D.hn] = x[i]; D.hn = (D.hn + 1) % D.hist.length; D.since++;
      if(D.since % D.blk === 0){ var had = D.tone; scan(); if(D.tone !== had) continue; }   // a lock has read this sample already
      if(D.tone) step(x[i]);
    }
  };
  D.wpm = function(){ return Math.round(1.2/D.dit); };
  return D;
}
var CW = {dec:null, on:false, line:'', log:[], cur:null};
function cwStart(){
  CW.dec = cwDecoder(T.sr, cwOut); CW.line = ''; CW.cur = null;
}
function cwOut(ch){
  var now = Date.now();
  if(!CW.cur || CW.cur.khz !== T.khz || now - CW.cur.last > 60000 || CW.cur.text.length > 400){
    if(ch === ' ') return;
    CW.cur = {t:now, last:now, khz:T.khz, rx:T.rx ? (T.rx.loc || T.rx.host) : '', text:''};
    CW.log.unshift(CW.cur); if(CW.log.length > 300) CW.log.length = 300;
  }
  if(ch === ' ' && / $/.test(CW.cur.text)) return;
  CW.cur.text += ch; CW.cur.last = now;
  CW.line = (CW.line + ch).slice(-80);
  cwSave(); paintCw();
}
function cwSave(){ try{ localStorage.setItem('sig_cwlog', JSON.stringify(CW.log.slice(0, 300))); }catch(_){} }
function cwText(){
  return 'Morse decoded by The Trident Brief (Appalachian Intel), machine-read and unverified\n\n' +
    CW.log.slice().reverse().map(function(e){
      return new Date(e.t).toISOString().slice(0, 19).replace('T', ' ') + 'Z  ' + e.khz + ' kHz  ' + e.rx + '\n  ' + e.text.trim();
    }).join('\n') + '\n';
}
function paintCw(){
  var el = $('tuCwOut'); if(!el) return;
  var d = S.mode === 'tuner' ? CW.dec : DX.cw, st = !CW.on ? 'off' : !S.running && !DX.busy ? 'waiting for something to listen to' : !d || !d.tone ? 'listening for a tone…' :
    'tone ' + d.tone + ' Hz · ' + d.wpm() + ' wpm · ' + Math.round(d.snr) + ' dB over the band';
  $('tuCwState').textContent = st;
  var ln = $('tuCwLine'), fit = Math.max(12, Math.floor((ln.clientWidth - 18)/10));   // the newest text, as much as fits
  ln.textContent = CW.line.slice(-fit) || ' ';
  el.innerHTML = CW.log.slice(0, 40).map(function(e){
    return '<div class="tu-cw-item"><b>' + esc(utc(e.t)) + '</b> ' + esc(String(e.khz)) + ' kHz &middot; ' + esc(e.rx) +
           '<div>' + esc(e.text.trim()) + '</div></div>';
  }).join('');
}
function wireMorse(){
  if(!$('tuCw')) return;
  try{ CW.log = JSON.parse(localStorage.getItem('sig_cwlog') || '[]') || []; }catch(_){ CW.log = []; }
  $('tuCw').onchange = function(){ CW.on = this.checked; touch(); if(CW.on) cwStart(); paintCw(); };
  $('tuCwSave').onclick = function(){
    var a = document.createElement('a'), d = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    a.href = URL.createObjectURL(new Blob([cwText()], {type:'text/plain'})); a.download = 'morse-' + d + 'Z.txt';
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('tuCwCopy').onclick = function(){
    var b = this; (navigator.clipboard ? navigator.clipboard.writeText(cwText()) : Promise.reject())
      .then(function(){ b.textContent = 'COPIED'; setTimeout(function(){ b.textContent = 'COPY'; }, 1500); }).catch(function(){});
  };
  $('tuCwClear').onclick = function(){ if(confirm('Clear the saved Morse log?')){ CW.log = []; CW.cur = null; CW.line = ''; cwSave(); paintCw(); } };
  setInterval(function(){ if(CW.on) paintCw(); }, 1000);
  paintCw();
}

function wireWaterfall(){
  var cv = $('tuWf'); if(!cv) return;
  ['broadcast', 'ham', 'utility'].forEach(function(kind){
    var sel = $('tuBand_' + kind);
    sel.innerHTML = '<option value="">' + {broadcast:'Broadcast bands', ham:'Ham bands', utility:'Aviation & utility'}[kind] + '</option>' +
      BANDS[kind].map(function(b, i){ return '<option value="' + i + '">' + esc(b[0]) + '</option>'; }).join('');
    sel.onchange = function(){ if(this.value !== ''){ bandPick(kind, +this.value); this.value = ''; if(!T.ws) listen(); } };
  });
  var down = null;
  /* A finger scrolling past the radio must scroll the page, not retune it:
     the page keeps vertical panning (touch-action: pan-y), a mostly-vertical
     movement cancels, only a sideways drag moves the band, and only a short,
     still tap tunes. */
  cv.addEventListener('pointerdown', function(e){ down = {x:e.clientX, y:e.clientY, t:Date.now(), cf:WF.cf, moved:false}; });
  cv.addEventListener('pointercancel', function(){ down = null; cv.style.transform = ''; });
  cv.addEventListener('pointermove', function(e){
    if(!down || WF.start == null) return;
    var dx = e.clientX - down.x, dy = e.clientY - down.y;
    if(!down.moved && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)){ down = null; cv.style.transform = ''; return; }   // a scroll
    if(Math.abs(dx) > 6){ if(!down.moved){ try{ cv.setPointerCapture(e.pointerId); }catch(_){} } down.moved = true; cv.style.transform = 'translateX(' + dx + 'px)'; }
  });
  cv.addEventListener('pointerup', function(e){
    if(!down) return;
    var r = cv.getBoundingClientRect(), d = down; down = null; cv.style.transform = '';
    if(WF.start == null) return;
    if(d.moved){ touch(); wfView(d.cf - (e.clientX - d.x)/r.width*WF.span); return; }
    if(Math.abs(e.clientY - d.y) > 8 || Date.now() - d.t > 700) return;          // not a tap
    var f = WF.start + (e.clientX - r.left)/r.width*WF.span, step = +$('tuStep').value || 0.1;
    retune(Math.round(f/step)*step, null, null);
  });
  /* the wheel scrolls the page, unless the waterfall has been clicked into
     (it then has focus) or Shift is held */
  cv.addEventListener('wheel', function(e){
    if(document.activeElement !== cv && !e.shiftKey && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if(e.ctrlKey || e.metaKey){ wfView(T.khz, WF.zoom + (e.deltaY < 0 ? 1 : -1)); return; }
    var step = +$('tuStep').value || 0.1;
    retune(Math.round((T.khz + (e.deltaY < 0 ? step : -step))/step)*step, null, null);
  }, {passive:false});
  $('tuZin').onclick = function(){ touch(); wfView(T.khz, WF.zoom + 1); };
  $('tuZout').onclick = function(){ touch(); wfView(T.khz, WF.zoom - 1); };
  $('tuSeekDn').onclick = function(){ seekSig(-1); };
  $('tuSeekUp').onclick = function(){ seekSig(1); };
  $('tuStep').value = String(get('step', 1));
  $('tuStep').onchange = function(){ set('step', +this.value); };
  $('tuBw').oninput = function(){ $('tuBwV').textContent = (+this.value).toFixed(1) + ' kHz'; };
  $('tuBw').onchange = function(){ T.pbFix = null; applyDsp(); };
  $('tuNr').onchange = applyDsp;
  cv.addEventListener('keydown', function(e){
    if(e.target.id !== 'tuWf') return;
    var step = +$('tuStep').value || 0.1;
    if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
      e.preventDefault(); retune(Math.round((T.khz + (e.key === 'ArrowRight' ? step : -step))/step)*step, null, null);
    }
  });
  window.addEventListener('resize', wfDraw);
  wfDraw();
}

function wireTuner(){
  if(!$('sigTuner')) return;
  function btn(p){ return '<button class="ev-f tu-p" data-p="' + p.id + '" type="button">' + esc(p.name) + ' <span>' + p.khz + '</span></button>'; }
  $('tuPresets').innerHTML = SCAN.map(btn).join('');
  var pp = $('tuPresetsPic');
  if(pp) pp.innerHTML = '<span class="sig-small">PICTURES &amp; TEXT</span>' + PRESETS.filter(function(p){ return p.dec; }).map(btn).join('');
  BAND.querySelectorAll('.tu-p').forEach(function(b){
    b.onclick = function(){
      var p = presetOf(b.dataset.p);
      if(p.dec === 'sstv' || p.dec === 'fax') WF.zoom = 11;   // about 15 kHz across: the channel and its neighbours
      retune(p.khz, p.mode, p.id); if(!T.ws) listen();
      if(p.dec === 'sstv' || p.dec === 'fax'){ if(WF.ws) wfView(p.khz + (p.mode === 'lsb' ? -1.9 : 1.9), 11); }
      if(p.dec){                                  // and the decoder that reads it, alone
        ['rtty', 'fax', 'sstv'].forEach(function(k){ if(k !== p.dec && DX.on[k]) decStart(k, false); });
        decTab(p.dec); if(!DX.on[p.dec]) decStart(p.dec, true);
      }
    };
  });
  BAND.querySelectorAll('.tu-steps button').forEach(function(b){
    b.onclick = function(){ retune(Math.round((T.khz + (+b.dataset.s))*100)/100, null, null); };
  });
  $('tuKhz').onchange = function(){ retune(+this.value, null, null); };
  $('tuMode').onchange = function(){ retune(T.khz, this.value, T.preset); };
  $('tuGo').onclick = function(){ T.ws && T.live ? retune(+$('tuKhz').value, $('tuMode').value, T.preset) : listen(); };
  $('tuStop').onclick = function(){ stopAll(); status('Stopped; the receiver is free again.'); };
  $('tuVol').oninput = function(){ touch(); if(T.out) T.out.gain.value = +this.value; set('vol', +this.value); };
  $('tuVol').value = get('vol', 0.9);
  $('tuRx').onchange = function(){ touch(); if(T.ws){ T.tried = []; connect(pick()); } };
  $('tuScan').onclick = scanToggle;
  wireWaterfall();
  wireTranscribe();
  wireMorse();
  wireDecoders();
  retune(4625, 'usb', 'uvb76');
  var base = (typeof window.DATA_BASE === 'string' ? window.DATA_BASE : '');
  fetch(base + 'data/tuner/receivers.json', {cache:'no-store'}).then(function(r){ return r.ok ? r.json() : null; })
    .catch(function(){ return null; }).then(function(d){
      T.list = (d && d.receivers) || [];
      $('tuRx').innerHTML = '<option value="auto">best for the channel</option>' + T.list.map(function(r){
        return '<option value="' + esc(r.host) + '">' + esc(r.loc || r.host) + '</option>'; }).join('');
      tunerNow(T.list.length ? T.list.length + ' receivers reachable from this page' + (d.checked ? ' (checked ' + esc(d.checked.slice(0, 10)) + ')' : '') +
                               '. Press LISTEN or a preset.' : 'The receiver list did not load.');
    });
}

function wire(){
  var tabBtn = $('sigTab');
  if(!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)){
    tabBtn.disabled = true; tabBtn.title = 'Sharing a tab’s audio needs desktop Chrome or Edge';
  }
  tabBtn.onclick = function(){ startLive('tab'); };
  $('sigMic').onclick = function(){ startLive('mic'); };
  $('sigFileIn').onchange = function(e){ if(e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
  $('sigStop').onclick = function(){ stopAll(); status('Stopped.'); };
  $('sigPause').onclick = function(){ S.paused = !S.paused; this.textContent = S.paused ? '▶ RESUME' : '❚❚ FREEZE'; };
  $('sigPlay').onclick = function(){ var F = S.file; if(!F) return; F.playing ? pause() : play(F.offset >= F.dur - 0.05 ? 0 : F.offset); };
  $('sigRange').value = String(S.maxHz); $('sigFft').value = String(S.fft); $('sigMap').value = S.map;
  $('sigLo').value = S.lo; $('sigHi').value = S.hi; $('sigSpeed').value = String(S.rowsPerSec);
  $('sigRange').onchange = function(){ S.maxHz = +this.value; set('maxHz', S.maxHz); if(S.mode === 'file' && S.file) reopen(); else frame(); };
  $('sigFft').onchange = function(){ S.fft = +this.value; set('fft', S.fft); if(S.analyser && S.mode !== 'file') S.analyser.fftSize = S.fft; if(S.mode === 'file' && S.file) reopen(); };
  $('sigMap').onchange = function(){ S.map = this.value; set('map', S.map); buildLut(S.map); if(S.mode === 'file' && S.file) reopen(); };
  $('sigLo').oninput = function(){ S.lo = Math.min(+this.value, S.hi - 10); set('lo', S.lo); frame(); };
  $('sigHi').oninput = function(){ S.hi = Math.max(+this.value, S.lo + 10); set('hi', S.hi); frame(); };
  $('sigSpeed').onchange = function(){ S.rowsPerSec = +this.value; set('rps', S.rowsPerSec); };
  $('sigAuto').onclick = function(){
    if(!S.sp || !S.sp.length) return;
    var maxBin = Math.min(S.sp.length-1, Math.floor(S.maxHz/S.spHz)), v = Array.prototype.slice.call(S.sp, 1, maxBin).sort(function(a, b){ return a - b; });
    S.lo = Math.round(v[Math.floor(v.length*0.5)] - 6); S.hi = Math.round(v[Math.floor(v.length*0.995)] + 6);
    $('sigLo').value = S.lo; $('sigHi').value = S.hi; set('lo', S.lo); set('hi', S.hi); frame();
  };
  $('sigShot').onclick = function(){
    cv.toBlob(function(b){ if(!b) return; var a = document.createElement('a'); a.href = URL.createObjectURL(b);
      a.download = 'spectrogram-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.png'; a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000); });
  };
  $('sigRec').onclick = function(){
    if(!S.stream) return;
    if(S.rec && S.rec.state === 'recording'){ S.rec.stop(); return; }
    var aud = new MediaStream(S.stream.getAudioTracks()); S.recChunks = [];
    S.rec = new MediaRecorder(aud);
    S.rec.ondataavailable = function(e){ if(e.data.size) S.recChunks.push(e.data); };
    S.rec.onstop = function(){
      var b = new Blob(S.recChunks, {type:S.rec.mimeType || 'audio/webm'}), a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'signal-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.webm'; a.click();
      $('sigRec').textContent = '● RECORD CLIP'; $('sigRec').classList.remove('on');
    };
    S.rec.start(); this.textContent = '■ STOP & SAVE'; this.classList.add('on');
    logEvent(Date.now(), 'mark', 'recording started');
  };
  $('sigCsv').onclick = function(){
    var rows = [['utc_or_seconds', 'kind', 'detail']].concat(S.events.slice().reverse().map(function(e){
      return [e.at != null ? e.at.toFixed(2) : new Date(e.t).toISOString(), e.kind, e.text]; }));
    var csv = rows.map(function(r){ return r.map(function(x){ return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    a.download = 'signal-events.csv'; a.click();
  };
  $('sigMark').onclick = function(){ if(S.running) logEvent(Date.now(), 'mark', 'marked by you'); };
  paintEvents();
}
function reopen(){ if(S.file && S.file.buf) analyse(S.file.buf, S.file.name); }

wire();
wireTuner();
size();
loadRadio();

/* ------------------------------------------------- identify & decode */
/* The decoders themselves are in decoders.js. Here they are fed whatever is
   playing (the tuner's own 12 kHz audio, or a shared tab, the microphone or
   an opened recording, brought down to about 12 kHz), and their text and
   pictures are drawn. All of it on this device. */
function D_(){ return window.DECODERS || null; }
function decFeed(f, sr){
  var D = D_(); if(!D) return;
  if(!DX.decim || DX.decim.srIn !== sr){ resetDecoders(sr); }
  var y = DX.decim.push(f), r = DX.ring;
  for(var i = 0; i < y.length; i++){ r[DX.rpos] = y[i]; DX.rpos = (DX.rpos + 1) % r.length; }
  DX.rfill = Math.min(r.length, DX.rfill + y.length);
  ['rtty', 'fax', 'sstv'].forEach(function(k){
    if(!DX.on[k]) return;
    if(!DX.dec[k]) DX.dec[k] = makeDec(k, DX.decim.sr);
    DX.dec[k].push(y);
  });
  if(CW.on && S.mode !== 'tuner'){
    if(!DX.cw) DX.cw = cwDecoder(DX.decim.sr, cwOut);
    DX.cw.push(y);
  }
}
function resetDecoders(sr){
  var D = D_();
  DX.decim = D.Decim(sr); DX.decim.srIn = sr;
  DX.ring = new Float32Array(Math.round(DX.decim.sr*8)); DX.rpos = 0; DX.rfill = 0;
  DX.dec = {}; DX.cw = null;
}
function makeDec(k, sr){
  var D = D_(), d;
  if(k === 'rtty'){ d = D.rtty(sr, {usos:$('rtUsos').checked}); }
  else if(k === 'fax'){
    d = D.fax(sr, {lpm:$('fxLpm').value});
    d.onstart = function(){ fxClear(); };
    fxClear();
  } else {
    d = D.sstv(sr);
    d.onstart = function(s){ var cv = $('svCv'); cv.width = s.mode.w; cv.height = s.mode.h; var g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
                             logEvent(Date.now(), 'mark', 'SSTV picture starting: ' + s.mode.name); };
    d.onrows = function(s, rows){ var g = $('svCv').getContext('2d');
      rows.forEach(function(r){ if(r.y < s.mode.h) g.putImageData(new ImageData(r.px, s.mode.w, 1), 0, r.y); }); };
    d.ondone = function(){ svKeep(); };
  }
  return d;
}
function ringOut(){
  var r = DX.ring, n = DX.rfill, o = new Float32Array(n), st = (DX.rpos - n + r.length) % r.length;
  for(var i = 0; i < n; i++) o[i] = r[(st + i) % r.length];
  return o;
}
/* a recording: run it through the chosen decoder from the start, a few
   seconds of sound at a time, so the page stays responsive */
function decFile(kind){
  var F = S.file; if(!F) return false;
  var ch = F.buf.getChannelData(0), sr = F.buf.sampleRate, i = 0, step = Math.round(sr*0.25);
  resetDecoders(sr); DX.busy = true;
  if(kind === 'cw'){ DX.cw = cwDecoder(DX.decim.sr, cwOut); }
  (function chunk(){
    var t0 = performance.now();
    while(i < ch.length && performance.now() - t0 < 40){
      var y = DX.decim.push(ch.subarray(i, i + step)); i += step;
      if(kind === 'cw'){ DX.cw.push(y); continue; }
      if(!DX.dec[kind]) DX.dec[kind] = makeDec(kind, DX.decim.sr);
      DX.dec[kind].push(y);
    }
    status('Decoding ' + esc(F.name) + ' · ' + Math.round(i/ch.length*100) + '%');
    decPaint();
    if(i < ch.length) setTimeout(chunk, 0);
    else { DX.busy = false; status('Decoded ' + esc(F.name) + '.'); decPaint(); }
  })();
  return true;
}


/* SNAP: amateurs seldom sit exactly on 14230; they spread over a few kHz,
   and a picture 1.5 kHz off falls outside the tight filter. Read the
   receiver's waterfall within about 3.5 kHz of where a picture should sit for
   a steady block 0.5-1.4 kHz wide (a picture; speech is wider and comes and
   goes), and tune so its middle lands on 1900 Hz. Automatic while an SSTV
   preset waits for a picture; never during one. */
function snapFind(){
  var rows = WF.rows.slice(-16); if(rows.length < 10 || WF.start == null) return null;
  var kpb = WF.span/1024, side = T.mode === 'lsb' ? -1 : 1, exp = T.khz + side*1.9;
  var avg = wfAvg(16), srt = Array.prototype.slice.call(avg, 8, 1016).sort(function(a, b){ return a - b; }), noise = srt[srt.length >> 1];
  var win = Math.max(3, Math.round(0.8/kpb)), i0 = Math.max(0, Math.floor((exp - 3.5 - WF.start)/kpb)), i1 = Math.min(1023 - win, Math.ceil((exp + 3.5 - WF.start)/kpb));
  var best = null;
  for(var i = i0; i <= i1; i++){
    var ex = 0; for(var k = i; k < i + win; k++) ex += avg[k] - noise; ex /= win;
    if(!best || ex > best.ex) best = {i:i, ex:ex};
  }
  if(!best || best.ex < 6) return null;
  /* steady: present in most of the rows */
  var steady = rows.filter(function(r){ var e = 0; for(var k = best.i; k < best.i + win; k++) e += r[k] - noise; return e/win > 4; }).length;
  if(steady < rows.length*0.75) return null;
  /* shaped like a picture: the strong part 0.5-1.4 kHz wide */
  var a = best.i, b = best.i + win - 1;
  while(a > 0 && avg[a - 1] - noise > 6) a--;
  while(b < 1023 && avg[b + 1] - noise > 6) b++;
  var width = (b - a + 1)*kpb;
  if(width < 0.5 || width > 1.4) return null;
  var centre = WF.start + (a + b + 1)/2*kpb;
  return {dial:Math.round((centre - side*1.9)*100)/100, shift:centre - exp, width:width, db:Math.round(best.ex)};
}
function snap(byHand){
  var f = snapFind();
  if(!f){ if(byHand) $('svState').textContent = 'SNAP: no steady picture-shaped signal within 3.5 kHz on the waterfall'; return false; }
  if(Math.abs(f.shift) < 0.15){ if(byHand) $('svState').textContent = 'SNAP: already on it'; return false; }
  logEvent(Date.now(), 'mark', 'SNAP: moved ' + (f.shift > 0 ? '+' : '') + f.shift.toFixed(2) + ' kHz to a picture-like signal (' + f.db + ' dB, ' + f.width.toFixed(1) + ' kHz wide)');
  retune(f.dial, T.mode, byHand ? T.preset : T.preset);
  return true;
}
setInterval(function(){
  var p = presetOf(T.preset), V = DX.dec.sstv;
  if(DX.on.sstv && T.live && p && p.dec === 'sstv' && V && !V.mode && !V.manual) snap(false);
}, 8000);

/* -- what is this? */
function idRun(){
  var D = D_(), x, sr, khz = null, mode = null, out = $('idOut');
  if(!D){ out.innerHTML = '<div class="sig-small">The decoders have not loaded yet.</div>'; return; }
  if(S.mode === 'file' && S.file){
    var b = S.file.buf, sr0 = b.sampleRate, ch = b.getChannelData(0), c = playPos(), a = Math.max(0, Math.floor((c - 4)*sr0));
    var dm = D.Decim(sr0); x = dm.push(ch.subarray(a, Math.min(ch.length, a + 8*sr0))); sr = dm.sr;
  } else if(DX.ring && DX.rfill > DX.decim.sr*3){
    x = ringOut(); sr = DX.decim.sr;
    if(S.mode === 'tuner'){ khz = T.khz; mode = T.mode; }
  } else { out.innerHTML = '<div class="sig-small">Listen for a few seconds first: press LISTEN, share a tab, use the microphone or open a recording.</div>'; return; }
  var res = D.identify(x, sr, {khz:khz, voice:S.voiceNow});
  if(res.error){ out.innerHTML = '<div class="sig-small">' + esc(res.error) + '</div>'; return; }
  var m = res.meas, bits = [];
  if(m.width) bits.push('about ' + m.width + ' Hz wide (' + m.lo + '–' + m.hi + ' Hz in the audio)');
  var pic = res.cands[0] && /sstv|fax/.test(res.cands[0].decode || '');   // a picture's sliding tone is not a set of tones
  if(!pic && m.tones && m.tones.length > 1 && m.tones.length < 12) bits.push(m.tones.length + ' tones' + (m.spacing ? ' ' + m.spacing + ' Hz apart' : ''));
  if(m.baud && !pic) bits.push('about ' + m.baud + ' changes a second');
  if(m.wpm) bits.push('keyed on and off, about ' + m.wpm + ' wpm');
  if(m.period) bits.push('repeats every ' + m.period + ' s');
  if(m.sweeps) bits.push(m.sweeps + ' sweep' + (m.sweeps === 1 ? '' : 's'));
  bits.push(m.snr + ' dB over the background');
  var html = '<div class="id-m">' + esc(bits.join(' · ')) + (khz ? ' · ' + esc(khz + ' kHz ' + mode.toUpperCase()) + (m.band ? ' (' + esc(m.band) + ')' : '') : '') + '</div>';
  html += res.cands.length ? res.cands.map(function(c){
    return '<div class="id-c"><b>' + esc(c.name) + '</b><span class="w">' + esc(c.word.toUpperCase()) + '</span><div>' + esc(c.why) + '</div>' +
      '<div class="tu-row">' + (c.decode ? '<button class="ev-f" type="button" data-dec="' + c.decode + '">DECODE IT</button>' : '') +
      '<a class="ev-f" href="https://www.sigidwiki.com/index.php?search=' + encodeURIComponent(c.term) + '" target="_blank" rel="noopener noreferrer">HEAR SAMPLES (sigidwiki)</a></div></div>';
  }).join('') : '<div class="sig-small">No clear match. Note the frequency and UTC time, and compare by ear on sigidwiki.com.</div>';
  html += '<div class="sig-small">Rules of thumb from about ' + m.seconds + ' s of sound. Fading, a second station on top, or a very weak signal will fool it; confirm by ear.</div>';
  out.innerHTML = html;
  out.querySelectorAll('[data-dec]').forEach(function(b){ b.onclick = function(){ decTab(b.dataset.dec); decStart(b.dataset.dec, true); }; });
}

/* -- tabs, start/stop */
function decTab(k){
  DX.tab = k; set('dectab', k);
  document.querySelectorAll('#decTabs [data-tab]').forEach(function(b){ b.classList.toggle('on', b.dataset.tab === k); });
  document.querySelectorAll('#decBox .dec-p').forEach(function(p){ p.classList.toggle('on', p.dataset.p === k); });
}
function decStart(k, on){
  if(k === 'cw'){ $('tuCw').checked = on; CW.on = on; if(on) cwStart(); if(on && S.mode === 'file') decFile('cw'); paintCw(); return; }
  DX.on[k] = on;
  if(!on){ delete DX.dec[k]; }
  else if(S.mode === 'file' && S.file){ delete DX.dec[k]; decFile(k); }
  decPaint();
}

/* -- painting */
function fxClear(){ var cv = $('fxCv'); cv.height = 300; var g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); DX.fxDrawn = 0; }
function fxDraw(all){
  var F = DX.dec.fax; if(!F) return;
  var cv = $('fxCv'), g = cv.getContext('2d'), n = Math.min(F.lines(), 2400);
  if(all){ DX.fxDrawn = 0; }
  if(n > cv.height){                               // grow the canvas, keeping what is drawn
    var keep = document.createElement('canvas'); keep.width = cv.width; keep.height = cv.height; keep.getContext('2d').drawImage(cv, 0, 0);
    cv.height = Math.min(2400, n + 200); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(keep, 0, 0);
  }
  var line = new Uint8Array(F.W), img = g.createImageData(F.W, 1);
  for(var k = DX.fxDrawn; k < n; k++){
    F.line(k, line);
    for(var x = 0; x < F.W; x++){ var o = x*4; img.data[o] = img.data[o+1] = img.data[o+2] = line[x]; img.data[o+3] = 255; }
    g.putImageData(img, 0, k);
  }
  DX.fxDrawn = n;
}
function svKeep(){
  var cv = $('svCv'), url; try{ url = cv.toDataURL('image/png'); }catch(_){ return; }
  DX.pics.unshift(url); if(DX.pics.length > 8) DX.pics.length = 8;
  $('svGal').innerHTML = DX.pics.map(function(u, i){ return '<img src="' + u + '" alt="received picture ' + (i + 1) + '" data-i="' + i + '">'; }).join('');
  $('svGal').querySelectorAll('img').forEach(function(im){ im.onclick = function(){ savePng(DX.pics[+im.dataset.i], 'sstv'); }; });
}
function savePng(url, what){
  var a = document.createElement('a'), d = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  a.href = url; a.download = what + '-' + d + 'Z.png'; document.body.appendChild(a); a.click(); a.remove();
}
function decPaint(){
  ['rtty', 'fax', 'sstv'].forEach(function(k){
    var b = $({rtty:'rtGo', fax:'fxGo', sstv:'svGo'}[k]); if(!b) return;
    b.textContent = DX.on[k] ? '■ STOP' : '▶ START'; b.classList.toggle('warn', DX.on[k]);
  });
  var idle = !S.mode && !DX.busy ? ' · waiting for something to listen to' : '';
  var R = DX.dec.rtty;
  $('rtState').textContent = !DX.on.rtty ? 'off' : R ? R.state() + idle : 'starting' + idle;
  if(R){ var o = $('rtOut'), atEnd = o.scrollTop + o.clientHeight >= o.scrollHeight - 20; o.textContent = R.text(); if(atEnd) o.scrollTop = o.scrollHeight; }
  var F = DX.dec.fax;
  $('fxState').textContent = !DX.on.fax ? 'off' : F ? F.status + ' · ' + F.lines() + ' lines' +
    ' · ' + F.lpm + ' lines/min' + (F.lpmFrom === 'phasing' ? ' (from the phasing lines)' : F.lpmFrom === 'measured' ? ' (measured)' : '') +
    (F.slant ? ' · straightened ' + Math.round(Math.abs(F.slant)*1e6) + ' ppm' : '') + (F.tuning() ? ' · ' + F.tuning() : '') +
    (F.level < 1e-7 ? ' · no sound' : '') + idle : 'starting' + idle;
  if(F) fxDraw(false);
  var V = DX.dec.sstv;
  $('svState').textContent = !DX.on.sstv ? 'off' : V ? V.status + (V.mode ? ' · line ' + V.rows + ' of ' + V.mode.h : '') + idle : 'starting' + idle;
}
function wireDecoders(){
  if(!$('decBox')) return;
  document.querySelectorAll('#decTabs [data-tab]').forEach(function(b){ b.onclick = function(){ decTab(b.dataset.tab); }; });
  decTab(get('dectab', 'id'));
  $('idGo').onclick = idRun;
  $('rtGo').onclick = function(){ decStart('rtty', !DX.on.rtty); };
  $('fxGo').onclick = function(){ decStart('fax', !DX.on.fax); };
  $('svGo').onclick = function(){ decStart('sstv', !DX.on.sstv); };
  $('rtUsos').onchange = function(){ if(DX.dec.rtty) DX.dec.rtty.usos = this.checked; };
  $('rtClear').onclick = function(){ if(DX.dec.rtty) DX.dec.rtty.machines.forEach(function(m){ m.text = ''; }); decPaint(); };
  $('rtCopy').onclick = function(){ var t = $('rtOut').textContent, b = this; if(navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ b.textContent = 'COPIED'; setTimeout(function(){ b.textContent = 'COPY'; }, 1500); }); };
  $('rtSave').onclick = function(){
    var a = document.createElement('a'), d = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    a.href = URL.createObjectURL(new Blob(['RTTY decoded by The Trident Brief (Appalachian Intel), machine-read and unverified\n' +
      (S.mode === 'tuner' ? T.khz + ' kHz\n\n' : '\n') + $('rtOut').textContent], {type:'text/plain'}));
    a.download = 'rtty-' + d + 'Z.txt'; document.body.appendChild(a); a.click(); a.remove();
  };
  $('fxLpm').onchange = function(){ if(DX.dec.fax) DX.dec.fax.setLpm(this.value); };
  $('fxLine').onclick = function(){ var F = DX.dec.fax; if(F && !F.lineUp()) $('fxState').textContent = 'no border found to line up by: use SHIFT'; };
  $('fxNew').onclick = function(){ if(DX.dec.fax){ DX.dec.fax.reset(); fxClear(); } };
  function nudge(dOff, dSl){ var F = DX.dec.fax; if(!F) return; F.offset = ((F.offset + dOff) % F.W + F.W) % F.W; F.slant += dSl; fxDraw(true); decPaint(); }
  $('fxL').onclick = function(){ nudge(Math.round(904/40), 0); };
  $('fxR').onclick = function(){ nudge(-Math.round(904/40), 0); };
  $('fxS1').onclick = function(){ nudge(0, -50e-6); };
  $('fxS2').onclick = function(){ nudge(0, 50e-6); };
  $('fxSave').onclick = function(){ savePng($('fxCv').toDataURL('image/png'), 'weatherfax'); };
  var modes = (window.DECODERS && DECODERS.SSTV_MODES) || {};
  $('svMode').innerHTML = Object.keys(modes).map(function(v){ return '<option value="' + v + '">' + esc(modes[v].name) + '</option>'; }).join('');
  $('svMode').value = '44';
  $('svNow').onclick = function(){ if(!DX.on.sstv) decStart('sstv', true); var V = DX.dec.sstv; if(V) V.start(+$('svMode').value); else setTimeout(function(){ if(DX.dec.sstv) DX.dec.sstv.start(+$('svMode').value); }, 300); };
  $('svSave').onclick = function(){ savePng($('svCv').toDataURL('image/png'), 'sstv'); };
  $('svSnap').onclick = function(){ if(!T.live){ $('svState').textContent = 'SNAP works on the live tuner: press LISTEN first'; return; } snap(true); };
  $('sigTall').onclick = function(){
    var c = $('sigCanvas'), on = !c.classList.contains('tall');
    c.classList.toggle('tall', on); this.classList.toggle('on', on);
    if(on){ DX.rps = S.rowsPerSec; S.rowsPerSec = 6; } else if(DX.rps){ S.rowsPerSec = DX.rps; }
    $('sigSpeed').value = String(S.rowsPerSec); size();
  };
  setInterval(function(){ if(!BAND.classList.contains('folded')) decPaint(); }, 500);
  decPaint();
}
window.SIGNALS = {state:S, tuner:T, wf:WF, cw:CW, cwDecoder:cwDecoder, fftDb:fftDb, logEvent:logEvent, dx:DX, decFeed:decFeed, idRun:idRun, snapFind:snapFind};
})();
