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
function set(k, v){ try{ localStorage.setItem('sig_' + k, JSON.stringify(v)); }catch(_){} }
function get(k, d){ try{ var v = localStorage.getItem('sig_' + k); return v == null ? d : JSON.parse(v); }catch(_){ return d; } }
S.maxHz = get('maxHz', 3500); S.fft = get('fft', 4096); S.map = get('map', 'thermal');
S.lo = get('lo', -100); S.hi = get('hi', -30); S.rowsPerSec = get('rps', 20);
buildLut(S.map);

var cv = $('sigCanvas'), g2 = cv.getContext('2d');
var SPEC_H = 70, AXIS_H = 18;                  // css px: spectrum strip, frequency axis
var wf = document.createElement('canvas'), wg = wf.getContext('2d');
function size(){
  var dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth || 600, h = cv.clientHeight || 380;
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
function loop(){ frame(); S.raf = requestAnimationFrame(loop); }

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
  {id:'wwv', name:'WWV 10 MHz', khz:10000, mode:'am', near:[40.7, -105.0], note:'US time signal: a tick every second, a voice every minute. Another reception check.'}
];
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
  var pb = PASS[T.mode] || PASS.usb;
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
  T.rx = null; T.inp = T.out = null;
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
  T.rx = rx; T.live = false; T.dec = {i:0, p:0}; T.next = 0; T.rssi = [];
  tunerNow();
  var ws, settled = false;
  try{ ws = new WebSocket('wss://' + rx.host + '/' + Date.now() + '/SND'); }
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
          T.sr = parseFloat(v) || 12000;
          ['SET squelch=0 max=0', 'SET genattn=0', 'SET gen=0 mix=-1', tuneMsg(),
           'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50', 'SET compression=1',
           'SET ident_user=Trident%20Brief%20listener', 'SET keepalive'].forEach(function(m){ ws.send(m); });
          settled = true; clearTimeout(timer); T.live = true;
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
    play(f);
    var now = Date.now();
    if(now - T.lastKa > 1000){ T.lastKa = now; try{ ws.send('SET keepalive'); }catch(_){} tunerNow(); }
  };
}
function refused(rx, why){
  T.tried.push(rx.host);
  status('The receiver in ' + esc(rx.loc || rx.host) + ': ' + esc(why) + '. Trying the next one…');
  if(T.ws){ var w = T.ws; T.ws = null; try{ w.close(); }catch(_){} }
  connect(pick());
}
/* a short jitter buffer: each frame is scheduled after the last, a quarter
   second behind real time; if the network falls behind, it re-buffers, and
   if frames pile up, the extra is dropped rather than letting the delay grow */
function play(f){
  var ctx = S.ctx; if(!ctx || !T.inp) return;
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
  T.khz = Math.max(10, Math.min(30000, +khz || T.khz)); T.mode = mode || T.mode; T.preset = presetId || null;
  $('tuKhz').value = T.khz; $('tuMode').value = T.mode;
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
  T.ws.send(tuneMsg()); T.rssi = []; T.next = 0;
  logEvent(Date.now(), 'mark', 'tuned ' + T.khz + ' kHz ' + T.mode.toUpperCase());
  tunerNow();
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
  if(sc.i >= PRESETS.length){ T.scan = null; $('tuScan').textContent = '⟳ SCAN PRESETS'; status('Scan complete.'); return; }
  var p = PRESETS[sc.i], ev0 = S.events.length;
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
function wireTuner(){
  if(!$('sigTuner')) return;
  $('tuPresets').innerHTML = PRESETS.map(function(p){
    return '<button class="ev-f tu-p" data-p="' + p.id + '" type="button">' + esc(p.name) + ' <span>' + p.khz + '</span></button>';
  }).join('');
  BAND.querySelectorAll('.tu-p').forEach(function(b){
    b.onclick = function(){ var p = presetOf(b.dataset.p); retune(p.khz, p.mode, p.id); if(!T.ws) listen(); };
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
window.SIGNALS = {state:S, tuner:T, fftDb:fftDb, logEvent:logEvent};
})();
