/* =====================================================================
   SIGNALS -- UVB-76 and HFGCS: real recordings, a 48-hour timeline, and an
   in-browser spectrum analyzer

   The recordings come from radio_monitor.py: a relay of public shortwave
   receivers, two minutes each, published to the radio-data branch. Any slice
   can be played or loaded into the analyzer here. The analyzer itself also
   takes the sound of another tab (desktop Chrome / Edge), the microphone, or a
   file, and nothing is uploaded. The detectors are heuristics and say so: the
   Buzzer's pulse rate is measured from the envelope's periodicity, and a
   "voice?" mark is sustained, changing energy in the speech band.
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
/* radio_monitor.py records each channel through a relay of public receivers
   and publishes the slices, the voice events and a 48-hour timeline to the
   repository's radio-data branch, which is read from here. */
var RADIO = 'https://raw.githubusercontent.com/' +
  ((typeof GH_REPO !== 'undefined' && GH_REPO) || 'TridentIntelFree/Trident-Brief') + '/radio-data/';
var CHAN = [
  {id:'uvb76', name:'UVB-76', f:'4625 kHz AM', about:'Russian military “Buzzer”: a buzz 20–35 times a minute around the clock, broken now and then by a voice reading a callsign, codeword and numbers.'},
  {id:'hfgcs8992', name:'HFGCS 8992', f:'8992 kHz USB', about:'US Air Force global network: Emergency Action Messages and Skyking broadcasts, coded; their number and timing are what matter.'},
  {id:'hfgcs11175', name:'HFGCS 11175', f:'11175 kHz USB', about:'The same network’s other main frequency, heard best by day.'}
];
function ago(iso){
  var m = Math.max(0, Math.round((Date.now() - Date.parse(iso))/60000));
  return m < 60 ? m + ' min ago' : m < 2880 ? Math.round(m/60) + ' h ago' : Math.round(m/1440) + ' days ago';
}
function stateText(c){
  if(c.state === 'voice') return 'VOICE · ' + Math.round((c.voice || []).reduce(function(a, v){ return a + v[1] - v[0]; }, 0) || c.voice_s || 0) + ' s';
  if(c.state === 'buzz') return 'BUZZING' + (c.pulse_per_min ? ' · ' + c.pulse_per_min + '/min' : '');
  return {signal:'SIGNAL', quiet:'NOISE ONLY', short:'TOO SHORT', none:'NO RECORDING'}[c.state] || String(c.state || '').toUpperCase();
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
function paintRadio(d){
  var box = $('sigLive');
  if(!d){
    box.innerHTML = '<div class="sig-empty">No recordings yet. The receiver relay runs every half hour; the first slices appear after its first run.</div>';
    return;
  }
  var now = Date.now(), SLOT = 30*60000, h = '<div class="sig-tl"><h4 class="sig-h">LAST 48 HOURS</h4>';
  var rank = {voice:4, buzz:3, signal:2, quiet:1};
  var covered = 0;
  CHAN.forEach(function(ch){
    var cells = [];
    for(var i = 0; i < 96; i++) cells.push(null);
    (d.timeline || []).forEach(function(t){
      if(t.channel !== ch.id) return;
      var k = 95 - Math.floor((now - Date.parse(t.at))/SLOT);
      if(k < 0 || k > 95) return;
      var c = cells[k] || (cells[k] = {state:'quiet', n:0, voice:0, pulse:null});
      c.n++; c.voice += t.voice_s || 0; if(t.pulse_per_min) c.pulse = t.pulse_per_min;
      if((rank[t.state] || 0) > (rank[c.state] || 0)) c.state = t.state;
    });
    covered += cells.filter(Boolean).length;
    h += '<div class="sig-tl-row"><b>' + esc(ch.name) + '</b><div class="sig-tl-cells">' + cells.map(function(c, i){
      var at = new Date(now - (95 - i)*SLOT);
      var tip = at.toISOString().slice(5, 16).replace('T', ' ') + 'Z – ' + (c ? c.state + (c.pulse ? ' ' + c.pulse + '/min' : '') +
                (c.voice ? ', ' + Math.round(c.voice) + ' s voice' : '') + ' (' + c.n + ' slice' + (c.n > 1 ? 's' : '') + ')' : 'not recorded');
      return '<i class="' + (c ? c.state : '') + '" title="' + esc(tip) + '"></i>';
    }).join('') + '</div></div>';
  });
  h += '<div class="sig-tl-axis"><span>48 h ago</span><span>24 h</span><span>now</span></div>' +
       '<div class="sig-tl-key"><span style="--c:#facc15">voice</span><span style="--c:#0e7490">buzzing</span>' +
       '<span style="--c:#334155">signal</span><span style="--c:#1e293b">noise only</span><span style="--c:rgba(148,163,184,.08)">not recorded</span>' +
       '<span>covered ' + Math.round(covered/(96*CHAN.length)*100) + '% of the last 48 h</span></div></div>';
  var clips = {};
  (d.clips || []).forEach(function(c){ clips[c.channel] = c; });
  h += '<div class="sig-chs">' + CHAN.map(function(ch){
    var c = clips[ch.id];
    return '<div class="sig-ch"><div class="sig-ch-h"><b>' + esc(ch.name) + '</b><span class="sig-f">' + esc(ch.f) + '</span></div>' +
      (c ? '<span class="sig-st ' + esc(c.state) + '">' + esc(stateText(c)) + '</span>' +
           '<div class="sig-small">latest slice ' + esc(ago(c.at)) + ' · ' + esc(Math.round(c.seconds || 0)) + ' s' +
           (c.rx && c.rx.loc ? ' · receiver in ' + esc(c.rx.loc) : '') + '</div>' +
           (c.file ? '<div style="margin-top:7px"><button class="ap-btn sig-play" data-f="' + esc(c.file) + '" type="button">&#9654; PLAY</button>' +
                     '<button class="ap-btn sig-an" data-f="' + esc(c.file) + '" data-n="' + esc(ch.name) + '" type="button">&#128202; ANALYZE</button></div>' : '')
         : '<span class="sig-st none">NO RECORDING YET</span>') +
      '<p class="sig-small" style="margin:8px 0 0">' + esc(ch.about) + '</p></div>';
  }).join('') + '</div>';
  var ev = d.events || [];
  h += '<h4 class="sig-h">VOICE EVENTS</h4>' + (ev.length ? '<div class="sig-events">' + ev.slice(0, 20).map(function(e){
    var secs = Math.round((e.voice || []).reduce(function(a, v){ return a + v[1] - v[0]; }, 0));
    return '<div class="sig-ev voice"><b>' + esc(e.at.slice(5, 16).replace('T', ' ')) + 'Z</b> ' + esc(e.name) + ' · ' + secs +
      ' s of voice · via ' + esc(e.rx || '?') + ' <button class="linkish sig-play" data-f="' + esc(e.file) + '" type="button">&#9654; PLAY</button> ' +
      '<button class="linkish sig-an" data-f="' + esc(e.file) + '" data-n="' + esc(e.name + ' ' + e.at.slice(0, 16)) + '" type="button">analyze</button></div>';
  }).join('') + '</div>' : '<div class="sig-empty">No voice heard in the recorded slices yet. The Buzzer usually just buzzes; messages are rare.</div>');
  box.innerHTML = h;
  box.querySelectorAll('.sig-play').forEach(function(b){ b.onclick = function(){ playClip(b.dataset.f, b); }; });
  box.querySelectorAll('.sig-an').forEach(function(b){ b.onclick = function(){ analyseClip(b.dataset.f, b.dataset.n); }; });
}
function loadRadio(){
  fetch(RADIO + 'radio/radio.json?t=' + Date.now(), {cache:'no-store'})
    .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
    .then(paintRadio);
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
  S.ctx = new (window.AudioContext || window.webkitAudioContext)();
  S.stream = stream;
  S.src = S.ctx.createMediaStreamSource(stream);
  S.analyser = S.ctx.createAnalyser();
  S.analyser.fftSize = S.fft; S.analyser.smoothingTimeConstant = 0;
  S.analyser.minDecibels = -140; S.analyser.maxDecibels = 0;
  S.src.connect(S.analyser);
  if(kind === 'tab' && $('sigMonitor').checked) S.analyser.connect(S.ctx.destination);   // hear it here too
  stream.getAudioTracks()[0].addEventListener('ended', function(){ stopAll(); status('The shared audio ended.'); });
  S.mode = kind; S.running = true; S.paused = false;
  S.events = S.events.filter(function(ev){ return ev.at == null; }); paintEvents();   // drop a recording's marks
  S.rowTimes = []; S.sp = []; S.peak = null; detReset(S.ctx.sampleRate/DET_N);
  $('sigLiveBar').style.display = ''; $('sigFileBar').style.display = 'none';
  $('sigRec').disabled = !window.MediaRecorder;
  status((kind === 'tab' ? 'Listening to the shared tab' : 'Listening to the microphone') + ' · sample rate ' +
         (S.ctx.sampleRate/1000).toFixed(1) + ' kHz · resolution ' + (S.ctx.sampleRate/S.fft).toFixed(1) + ' Hz');
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
  S.voiceOn = null; S.voiceLast = 0; S.voiceEnd = -Infinity; S.voiceNow = false; S.sFloor = null;
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
      if(!best || ac[L] > best.score) best = {score:ac[L], interval:(L + off)/hz};
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
  env.push({t:now, b:b, s:sv, f:fl});
  while(env.length && env[0].t < now - 30000) env.shift();
  S.detK++;
  if(S.detK % 20 === 1) S.sFloor = pct(env.map(function(r){ return r.s; }), 0.1);
  if(env.length < S.detHz*3) return;
  /* voice? */
  var w = [], steps = [], flats = [];
  for(var i = env.length - 1; i >= 0 && env[i].t > now - 3000; i--){ w.push(env[i].s); flats.push(env[i].f); }
  for(i = 1; i < w.length; i++) steps.push(Math.abs(w[i] - w[i-1]));
  var lvl = w.reduce(function(a, c){ return a + c; }, 0)/w.length - S.sFloor;
  var voice = pct(steps, 0.5) > 1.2 && lvl > 1.5 && pct(flats, 0.25) < 0.42;
  if(voice){
    if(!S.voiceOn) S.voiceOn = now - 1500;         // the 3 s window centres on its start
    S.voiceLast = now;
  } else if(S.voiceOn && now - S.voiceLast > 1000) closeVoice();
  S.voiceNow = voice;
  /* pulses, re-evaluated twice a second */
  if(S.detK % Math.round(S.detHz/2)) return;
  var cand = null;
  if(!S.voiceOn){
    var from = Math.max(now - 12000, S.voiceEnd), rows = env.filter(function(r){ return r.t > from; });
    if(rows.length >= S.detHz*6){ var p = periodicity(rows); if(p && p.score >= 0.5) cand = p; }
  }
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
function closeVoice(){
  var d = (S.voiceLast - S.voiceOn)/1000;
  if(d >= 1.5) logEvent(S.voiceOn, 'voice', 'voice? · about ' + Math.round(d) + ' s in the speech band');
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
size();
loadRadio();
setInterval(loadRadio, 10*60000);       // new slices land through the half hour
window.SIGNALS = {state:S, fftDb:fftDb, logEvent:logEvent};
})();
