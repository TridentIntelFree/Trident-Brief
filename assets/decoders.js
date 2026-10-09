/* Decoders for the Signals tuner: RTTY to text, weather fax and SSTV to
   pictures, and a "what is this?" identifier. Everything runs on this device,
   on the audio you are already hearing; nothing is sent anywhere.

   Only modes sent in the clear are decoded. These turn tones back into the
   letters or picture lines they stand for, the way a radio teleprinter or a
   fax recorder did. Encrypted traffic cannot be read this way, and nothing
   here tries.

   Plain functions with no page dependencies, so the same file runs in Node
   for tests (module.exports) and in the page (window.DECODERS). */
(function(root){
'use strict';
var TAU = 2*Math.PI;

/* ------------------------------------------------------------ shared DSP */
function lowpassTaps(n, fc, sr){                // windowed sinc, unity gain at DC
  var h = new Float32Array(n), m = (n - 1)/2, s = 0;
  for(var i = 0; i < n; i++){
    var x = i - m, w = 0.42 - 0.5*Math.cos(TAU*i/(n - 1)) + 0.08*Math.cos(2*TAU*i/(n - 1));
    h[i] = (x === 0 ? 2*fc/sr : Math.sin(TAU*fc/sr*x)/(Math.PI*x))*w; s += h[i];
  }
  for(i = 0; i < n; i++) h[i] /= s;
  return h;
}
/* Integer decimation to about 11-16 kHz: the decoders need no more, and a
   browser's 44.1 or 48 kHz would cost four times the work. */
function Decim(srIn){
  var f = Math.max(1, Math.floor(srIn/11000)), D = {sr:srIn/f, factor:f};
  if(f === 1){ D.push = function(x){ return x; }; return D; }
  var h = lowpassTaps(10*f + 1, 0.45*srIn/f, srIn), L = h.length, ring = new Float32Array(L), p = 0, c = 0;
  D.push = function(x){
    var out = new Float32Array(Math.ceil((x.length + c)/f)), n = 0;
    for(var i = 0; i < x.length; i++){
      ring[p] = x[i]; p = (p + 1) % L;
      if(++c < f) continue;
      c = 0;
      var acc = 0; for(var k = 0; k < L; k++) acc += h[k]*ring[(p + k) % L];
      out[n++] = acc;
    }
    return out.subarray(0, n);
  };
  return D;
}
/* Instantaneous frequency: mix to baseband around the centre, low-pass, and
   read the phase step between samples. Fax and SSTV both send brightness as
   frequency (1500 Hz black to 2300 Hz white). */
function FM(sr, center, cutoff, ntaps){
  var h = lowpassTaps(ntaps, cutoff, sr), L = ntaps, ri = new Float32Array(L), rq = new Float32Array(L), p = 0;
  var ph = 0, dph = TAU*center/sr, pi = 0, pq = 0, k = sr/TAU;
  return function(v){
    ph += dph; if(ph > TAU) ph -= TAU;
    ri[p] = v*Math.cos(ph); rq[p] = -v*Math.sin(ph); p = (p + 1) % L;
    var i = 0, q = 0;
    for(var j = 0; j < L; j++){ var x = (p + j) % L; i += h[j]*ri[x]; q += h[j]*rq[x]; }
    var re = i*pi + q*pq, im = q*pi - i*pq; pi = i; pq = q;
    return center + Math.atan2(im, re)*k;
  };
}
/* The same, for fax: each sample's phase step as a vector (the product of
   this sample and the last one's conjugate), for the caller to add up over
   a dot before taking its angle. When noise swamps the signal for a moment
   the vectors are short and count for little, so a weak chart gets fine
   grain instead of the white and black speckle of single-sample spikes. */
function FMvec(sr, center, cutoff, ntaps){
  var h = lowpassTaps(ntaps, cutoff, sr), L = ntaps, ri = new Float32Array(L), rq = new Float32Array(L), p = 0;
  var ph = 0, dph = TAU*center/sr, pi = 0, pq = 0, out = [0, 0];
  return function(v){
    ph += dph; if(ph > TAU) ph -= TAU;
    ri[p] = v*Math.cos(ph); rq[p] = -v*Math.sin(ph); p = (p + 1) % L;
    var i = 0, q = 0;
    for(var j = 0; j < L; j++){ var x = (p + j) % L; i += h[j]*ri[x]; q += h[j]*rq[x]; }
    out[0] = i*pi + q*pq; out[1] = q*pi - i*pq; pi = i; pq = q;
    return out;
  };
}
function fftPow(x){                              // power spectrum, Hann window, lower half
  var n = x.length, re = new Float64Array(n), im = new Float64Array(n);
  for(var i = 0; i < n; i++) re[i] = x[i]*(0.5 - 0.5*Math.cos(TAU*i/(n - 1)));
  var j = 0;
  for(i = 1; i < n; i++){
    var bit = n >> 1;
    for(; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if(i < j){ var t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for(var len = 2; len <= n; len <<= 1){
    var ang = -TAU/len, wr = Math.cos(ang), wi = Math.sin(ang);
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
  for(var q = 0; q < n/2; q++) out[q] = re[q]*re[q] + im[q]*im[q];
  return out;
}
function median(a){ var b = Array.prototype.slice.call(a).sort(function(x, y){ return x - y; }); return b.length ? b[b.length >> 1] : 0; }
function pctl(a, q){ var b = Array.prototype.slice.call(a).sort(function(x, y){ return x - y; }); return b.length ? b[Math.min(b.length - 1, Math.floor(q*b.length))] : 0; }

/* ------------------------------------------------------------------ RTTY */
/* Radioteletype: two tones (mark and space), 5-bit Baudot/ITA2 letters with a
   start and a stop bit. The tones are found by looking for the strongest
   pair at a standard spacing (170 Hz amateur, 425/450 Hz weather and marine,
   850 Hz older services). Speed (45.45, 50 or 75 baud) and which tone is
   "mark" are found by decoding all six ways at once and keeping the one that
   reads like text. */
var ITA2_L = ['','E','\n','A',' ','S','I','U','\r','D','R','J','N','F','C','K','T','Z','L','W','H','Y','P','Q','O','B','G','','M','X','V',''];
var ITA2_F = ['','3','\n','-',' ',"'",'8','7','\r','$','4','*',',','!',':','(','5','+',')','2','#','6','0','1','9','?','&','','.','/','=',''];
var FIGS = 27, LTRS = 31, COMMON = 'ETAOINSHRDLU \n0123456789';
function rtty(sr, opts){
  opts = opts || {};
  var R = {sr:sr, lo:0, hi:0, shift:0, snr:0, machines:[], best:null, usos:opts.usos !== false, onchange:null};
  var SHIFTS = [170, 425, 450, 850], BAUDS = opts.baud ? [opts.baud] : [45.45, 50, 75];
  var N = 2048, HN = Math.round(sr*3), buf = new Float32Array(HN), bn = 0, since = 0, acc = null, cand = null, candN = 0;
  /* the two tone filters: mix to baseband, two one-pole stages */
  var kf = 1 - Math.exp(-TAU*34/sr), T = [mk(), mk()];
  function mk(){ return {f:0, ph:0, i1:0, q1:0, i2:0, q2:0, pk:1e-9, fl:0}; }
  var pkDecay = Math.exp(-1/(sr*0.6)), flRise = 1 - Math.exp(-1/(sr*0.6));
  function env(t, v){
    t.ph += TAU*t.f/sr; if(t.ph > TAU) t.ph -= TAU;
    var ii = v*Math.cos(t.ph), qq = v*Math.sin(t.ph);
    t.i1 += (ii - t.i1)*kf; t.q1 += (qq - t.q1)*kf; t.i2 += (t.i1 - t.i2)*kf; t.q2 += (t.q1 - t.q2)*kf;
    var e = Math.sqrt(t.i2*t.i2 + t.q2*t.q2);
    t.pk = Math.max(e, t.pk*pkDecay);             // each tone's own level, so selective fading
    t.fl = e < t.fl ? e : t.fl + (e - t.fl)*flRise; //   does not tip the decision (ATC)
    return (e - t.fl)/(t.pk - t.fl + 1e-12);
  }
  function machine(baud, inv){
    var M = {baud:baud, inv:inv, spb:sr/baud, state:0, c:0, last:0, accs:new Float32Array(8), cnt:new Uint16Array(8),
             figs:false, text:'', score:0, good:0, bad:0};
    M.step = function(d){
      var s = inv ? -d : d;
      if(M.state === 0){                         // waiting for a start bit: mark to space
        if(M.last > 0 && s <= 0){ M.state = 1; M.c = 0; for(var k = 0; k < 8; k++){ M.accs[k] = 0; M.cnt[k] = 0; } }
        M.last = s; return;
      }
      M.c++;
      var pos = M.c/M.spb, k2 = Math.floor(pos), fr = pos - k2;
      if(k2 < 7 && fr > 0.25 && fr < 0.75){ M.accs[k2] += s; M.cnt[k2]++; }
      if(pos >= 6.75){                           // start, five data bits, and the stop bit are in
        M.state = 0; M.last = s;
        var ok = M.accs[0] < 0 && M.accs[6] > 0;
        if(!ok){ M.bad++; M.score += -1.5; M.score *= 0.995; return; }
        var code = 0;
        for(k = 1; k <= 5; k++) if(M.accs[k] > 0) code |= 1 << (k - 1);
        M.good++; take(M, code);
      }
    };
    return M;
  }
  function take(M, code){
    var ch = '';
    if(code === FIGS){ M.figs = true; M.score += 0.2; }
    else if(code === LTRS){ M.figs = false; M.score += 0.2; }
    else {
      ch = (M.figs ? ITA2_F : ITA2_L)[code];
      if(ch === ' ' && R.usos) M.figs = false;   // "unshift on space", as most senders expect
      M.score += ch === '' ? -0.5 : COMMON.indexOf(ch) >= 0 ? 1 : /[A-Z]/.test(ch) ? 0.6 : 0.1;
    }
    M.score *= 0.995;
    if(ch === '\r') return;
    if(ch){ M.text += ch; if(M.text.length > 4000) M.text = M.text.slice(-3000); }
    pickBest();
  }
  function pickBest(){
    var b = R.best, top = null;
    R.machines.forEach(function(m){ if(!top || m.score > top.score) top = m; });
    if(!b || (top !== b && top.score > b.score + 4)) R.best = top;
    if(R.onchange) R.onchange(R);
  }
  /* where are the tones? every quarter second, from an averaged spectrum */
  function scan(){
    var x = new Float32Array(N); for(var i = 0; i < N; i++) x[i] = buf[(bn - N + i + HN) % HN];
    var p = fftPow(x), hz = sr/N;
    if(!acc) acc = p; else for(i = 0; i < p.length; i++) acc[i] = acc[i]*0.8 + p[i]*0.2;
    var lo = Math.ceil(250/hz), hi = Math.floor(3300/hz), med = median(acc.subarray(lo, hi)) || 1e-20, best = null;
    function at(b){ return Math.max(acc[b - 1] || 0, acc[b], acc[b + 1] || 0); }
    SHIFTS.forEach(function(sh){
      var d = Math.round(sh/hz);
      for(var b = lo; b + d < hi; b++){
        var v = Math.min(at(b), at(b + d));
        if(!best || v > best.v) best = {v:v, f0:b*hz, f1:(b + d)*hz, sh:sh};
      }
    });
    if(!best) return;
    R.snr = 10*Math.log10(best.v/med);
    if(R.snr < 8) return;
    var same = cand && Math.abs(best.f0 - cand.f0) < 2*hz && best.sh === cand.sh;
    candN = same ? candN + 1 : 1; cand = best;
    var moved = !R.lo || Math.abs(best.f0 - R.lo) > 3*hz || best.sh !== R.shift;
    if(moved && candN >= 3) lock(best);
  }
  function lock(b){
    R.lo = b.f0; R.hi = b.f1; R.shift = b.sh;
    T = [mk(), mk()]; T[0].f = b.f0; T[1].f = b.f1;
    R.machines = []; BAUDS.forEach(function(bd){ R.machines.push(machine(bd, false), machine(bd, true)); });
    R.best = null;
    var back = Math.min(since, HN);               // re-read the last 3 s, heard while the tones were being found
    for(var i = 0; i < back; i++) step(buf[(bn - back + i + HN) % HN]);
  }
  function step(v){
    var d = env(T[0], v) - env(T[1], v);
    for(var m = 0; m < R.machines.length; m++) R.machines[m].step(d);
  }
  R.push = function(x){
    for(var i = 0; i < x.length; i++){
      buf[bn] = x[i]; bn = (bn + 1) % HN; since++;
      if(since % Math.round(sr/4) === 0 && since >= N){ var had = R.lo; scan(); if(R.lo !== had) continue; }
      if(R.lo) step(x[i]);
    }
  };
  R.text = function(){ return R.best ? R.best.text : ''; };
  R.state = function(){
    var b = R.best;
    if(!R.lo) return 'looking for a pair of RTTY tones…';
    return 'tones ' + Math.round(R.lo) + ' / ' + Math.round(R.hi) + ' Hz (' + R.shift + ' Hz shift)' +
      (b ? ' · ' + b.baud + ' baud' + (b.inv ? ' · reversed' : '') + ' · ' + b.good + ' letters, ' + b.bad + ' bad frames' : '');
  };
  return R;
}

/* ----------------------------------------------------------- weather fax */
/* HF fax: brightness as frequency, 1500 Hz black to 2300 Hz white, usually
   120 lines a minute at 576 "IOC" (about 1810 dots a line; drawn here at
   half that). A 300 Hz start tone, then about 30 s of phasing lines (dark,
   with a short white pulse where each line begins), then the chart, then a
   450 Hz stop tone.

   It sets itself up, so a preset needs nothing set by hand:
   - tuning: a receiver a little off frequency makes the whole chart too dark
     or washed out. The white and black tones are found in the sound's
     spectrum (from the start tone and phasing lines, or from a chart's white
     background) and the error, up to 300 Hz, is taken out;
   - line rate: found from the phasing lines, or from how the picture
     repeats (60, 90, 120 or 240 lines a minute). The sound is kept at a
     fixed rate, so a change of line rate redraws the chart and loses nothing;
   - where lines start, and slant: from the phasing lines; or, for a chart
     joined part way, the slant from how the picture repeats eight lines
     apart (SHIFT moves the start by hand). */
function fax(sr, opts){
  opts = opts || {};
  var W = opts.width || 904, RATE = W*2;          // dots kept a second: 120 lines a minute's worth
  var autoLpm = !opts.lpm || opts.lpm === 'auto';
  var F = {W:W, lpm:autoLpm ? 120 : +opts.lpm, autoLpm:autoLpm, Ld:0, data:new Uint8Array(1 << 20), n:0, base:0, offset:0, slant:0,
           status:'listening', images:0, onstart:null, onstop:null, onlines:null, level:0,
           off:0, offSeen:false, slantFrom:'', lpmFrom:''};
  F.Ld = W*120/F.lpm;                            // dots per line at this line rate
  var spp = sr/RATE, accR = 0, accI = 0, pos = 0, demC = 1900, fm = FMvec(sr, demC, 800, 31), kHz = sr/TAU;
  var N = 4096, ab = new Float32Array(N), an = 0, psd = null, hz = sr/N;
  var g3 = 2*Math.cos(TAU*300/RATE), g4 = 2*Math.cos(TAU*450/RATE);
  var tone = {n:0, s3:[0, 0], s4:[0, 0], e:0}, toneHit = {start:0, stop:0}, phasing = null, ticks = 0;
  function put(v){
    if(F.n >= F.data.length){ var d = new Uint8Array(F.data.length*2); d.set(F.data); F.data = d; }
    F.data[F.n++] = v;
    /* the start and stop tones: black and white alternating at 300 or 450 Hz */
    var x = v - 128;
    var s = x + g3*tone.s3[0] - tone.s3[1]; tone.s3[1] = tone.s3[0]; tone.s3[0] = s;
    s = x + g4*tone.s4[0] - tone.s4[1]; tone.s4[1] = tone.s4[0]; tone.s4[0] = s;
    tone.e += x*x;
    if(++tone.n >= W) tick();                    // every half second
  }
  function tick(){
    var p3 = tone.s3[0]*tone.s3[0] + tone.s3[1]*tone.s3[1] - g3*tone.s3[0]*tone.s3[1];
    var p4 = tone.s4[0]*tone.s4[0] + tone.s4[1]*tone.s4[1] - g4*tone.s4[0]*tone.s4[1];
    var r3 = p3/(tone.e*W/2 + 1e-9), r4 = p4/(tone.e*W/2 + 1e-9);
    toneHit.start = r3 > 0.4 && tone.e/W > 1500 ? toneHit.start + 1 : 0;
    toneHit.stop = r4 > 0.4 && tone.e/W > 1500 ? toneHit.stop + 1 : 0;
    tone = {n:0, s3:[0, 0], s4:[0, 0], e:0};
    if(toneHit.start === 3) startImage();        // 1.5 s of it (stations send 5 s)
    if(toneHit.stop === 3) stopImage();
    if(phasing && phasing.from == null && !toneHit.start){ phasing.from = F.n; F.base = F.n; }   // the start tone has ended
    if(phasing && phasing.from != null){
      var el = (F.n - phasing.from)/RATE, m = 0;
      for(var i = F.n - W; i < F.n; i++) m += F.data[i];
      if(el > 3 && m/W > 110) finishPhasing(F.n - W);   // the chart has begun
      else if(el >= 32) finishPhasing(F.n);
    }
    tuning();
    ticks++;
    if(ticks % 20 === 0 && F.n - F.base > RATE*12){   // does it beat like a fax line? (0-1)
      var len = Math.round(RATE*10), fr = F.n - len - Math.ceil(F.Ld*(1 + F.slant)) - 2;
      if(fr > 0) F.rhythm = Math.max(0, corr(F.Ld*(1 + F.slant), fr, len));
    }
    var lines = (F.n - F.base)/F.Ld;
    if(!phasing && F.autoLpm && F.lpmFrom !== 'phasing' && lines >= 24 && ticks % 40 === 0) checkLpm();
    if(!phasing && lines >= 40 && ticks % 30 === 0) checkSlant();   // after phasing too: noise can throw its fit off
    /* joined part way, with no phasing lines: once straight, find the border */
    if(!phasing && F.slantFrom === 'measured' && !F.lined && lines >= 80){ F.lined = true; if(F.lineUp()) F.status = 'lined up by the chart\u2019s border (a best guess: SHIFT if it is off)'; }
  }
  function startImage(){
    if(F.onnew) F.onnew(F);                      // before the reset: the chart so far can still be kept
    F.base = F.n; F.offset = 0; F.slant = 0; F.slantFrom = ''; F.phEnd = null; F.prop = null; F.images++; F.status = 'start tone: a new chart';
    if(F.lpmFrom !== 'set') F.lpmFrom = '';
    phasing = {from:null};                       // phasing lines follow once the tone stops
    if(F.onstart) F.onstart(F);
  }
  function stopImage(){
    if(F.status.indexOf('stop') >= 0) return;
    if(phasing) finishPhasing(F.n);
    F.status = 'stop tone: the chart is complete'; phasing = null;
    if(F.onstop) F.onstop(F);
  }
  function setLpm(l, from){ F.lpm = l; F.Ld = W*120/l; F.lpmFrom = from; }
  /* phasing lines are dark with a short white pulse where each line begins */
  function finishPhasing(end){
    var from = phasing.from; phasing = null; F.phEnd = end;
    if(F.autoLpm && end - from > W*8){
      var best = bestLpm(from, end - from);
      if(best) setLpm(best, 'phasing');
    }
    /* each line's pulse: the window of the pulse's width (5% of a line) that
       is brightest against the line's own level. A sum over the window is
       not broken up by noise the way a run of bright dots is. */
    var Ld = F.Ld, pts = [], L = Math.round(Ld), pw = Math.max(3, Math.round(L*0.05));
    for(var li = 0; from + (li + 1)*Ld <= end; li++){
      var s = Math.round(from + li*Ld), tot = 0, win = 0, top = -1e9, at = 0;
      for(var x = 0; x < L; x++) tot += F.data[s + x];
      for(x = 0; x < pw; x++) win += F.data[s + x];
      for(x = 0; x < L; x++){                    // round the edge, so a pulse across it is whole
        if(win > top){ top = win; at = x; }
        win += F.data[s + ((x + pw) % L)] - F.data[s + x];
      }
      var inP = top/pw, outP = (tot - top)/(L - pw);
      if(inP - outP > 60) pts.push([li, at]);    // a clear pulse on a dark line
    }
    if(pts.length < 6){ F.status = 'chart started (no phasing lines found: use SHIFT to line it up)'; return; }
    for(var i = 1; i < pts.length; i++){         // unwrap round the edge, then fit position = a + b*line
      while(pts[i][1] - pts[i-1][1] > Ld/2) pts[i][1] -= Ld;
      while(pts[i][1] - pts[i-1][1] < -Ld/2) pts[i][1] += Ld;
    }
    /* a straight-line fit, refitted without the lines noise threw off */
    function fit(P){
      var n = P.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      P.forEach(function(q){ sx += q[0]; sy += q[1]; sxx += q[0]*q[0]; sxy += q[0]*q[1]; });
      var b = (n*sxy - sx*sy)/(n*sxx - sx*sx || 1); return {b:b, a:(sy - b*sx)/n};
    }
    var f = fit(pts);
    for(var round = 0; round < 2; round++){
      var res = pts.map(function(q){ return Math.abs(q[1] - f.a - f.b*q[0]); }), mad = median(res.slice()) || 0.5;
      var keep = pts.filter(function(q, j){ return res[j] <= Math.max(3*mad, 2); });
      if(keep.length < 6 || keep.length === pts.length) break;
      pts = keep; f = fit(pts);
    }
    var n = pts.length, b = f.b, a = f.a;
    F.slant = b/Ld; F.slantFrom = 'phasing';
    F.base = from; F.offset = ((a % Ld) + Ld) % Ld;
    F.status = 'chart started · lined up from ' + n + ' phasing lines';
    if(F.onstart) F.onstart(F);                  // redraw in place
  }
  /* tuning, from the spectrum: the white tone (most of a weather chart) and,
     during the start tone and phasing, the black one too */
  function tuning(){
    if(!psd) return;
    function peak(lo, hi){
      var b0 = Math.ceil(lo/hz), b1 = Math.floor(hi/hz), bi = b0;
      for(var k = b0; k <= b1; k++) if(psd[k] > psd[bi]) bi = k;
      var y0 = psd[bi - 1], y1 = psd[bi], y2 = psd[bi + 1], d = y0 - 2*y1 + y2;
      return {f:(bi + (d < 0 ? 0.5*(y0 - y2)/d : 0))*hz, p:y1};
    }
    var med = median(psd.subarray(Math.ceil(400/hz), Math.floor(3400/hz))) || 1e-20;
    /* how clear the signal is: the fax band (black to white, as tuned) against
       the noise just outside it, still inside the receiver's filter */
    function band(lo, hi){ var a = 0, n = 0; for(var k = Math.ceil(lo/hz); k <= Math.floor(hi/hz); k++){ a += psd[k]; n++; } return n ? a/n : 0; }
    var o = F.off, inb = band(1500 + o, 2300 + o), outb = (band(1150 + o, 1400 + o) + band(2420 + o, 2650 + o))/2;
    if(outb > 0) F.snr = Math.round(10*Math.log10(inb/outb));
    var w = peak(1650, 2750), bk = peak(1150, 1850), est = null;
    if(w.p > 8*med && bk.p > 8*med && Math.abs(w.f - bk.f - 800) < 60) est = (w.f + bk.f)/2 - 1900;
    else if(phasing && bk.p > 15*med) est = bk.f - 1500;
    else if(!phasing && !toneHit.start && w.p > 15*med) est = w.f - 2300;
    if(est == null || Math.abs(est) > 300) return;
    if(!F.offSeen){ F.off = est; F.offSeen = true; } else F.off += (est - F.off)*0.3;
    if(Math.abs(1900 + F.off - demC) > 40){ demC = 1900 + F.off; fm = FMvec(sr, demC, 800, 31); }   // re-centre the demodulator
  }
  function corr(lag, from, len){                 // normalised correlation of the dot stream with itself
    var sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0, d = F.data, li = Math.floor(lag), fr = lag - li;
    for(var i = from; i < from + len; i += 2){
      var x = d[i], y = d[i + li]*(1 - fr) + d[i + li + 1]*fr;
      sx += x; sy += y; sxx += x*x; syy += y*y; sxy += x*y; n++;
    }
    var cv = sxy/n - sx*sy/(n*n), vx = sxx/n - sx*sx/(n*n), vy = syy/n - sy*sy/(n*n);
    return vx > 1 && vy > 1 ? cv/Math.sqrt(vx*vy) : 0;
  }
  /* the line rate that the stretch repeats at: a picture also repeats over two
     lines, so the shortest line that does nearly as well as the best wins */
  function bestLpm(from, len){
    var cands = [60, 90, 120, 240].map(function(l){ var lag = W*120/l; return {l:l, c:len > lag*3 ? corr(lag, from, len - lag - 2) : -1}; });
    var best = Math.max.apply(null, cands.map(function(c){ return c.c; }));
    if(best < 0.3) return null;
    return cands.filter(function(c){ return c.c >= 0.85*best; }).sort(function(a, b){ return b.l - a.l; })[0].l;
  }
  function checkLpm(){
    var len = Math.round(RATE*12), from = F.n - len;
    if(from < F.base) return;
    var l = bestLpm(from, len);
    if(!l) return;
    if(l !== F.lpm){
      setLpm(l, 'measured'); F.slant = 0; F.slantFrom = '';
      F.status = 'line rate measured: ' + l + ' lines a minute';
      if(F.onstart) F.onstart(F);                // redrawn at the new rate: nothing is lost
    } else if(!F.lpmFrom) F.lpmFrom = 'confirmed';
  }
  /* How sharp the chart's columns are when the last lines are stacked at
     slant s: borders, margins and the latitude and longitude grid line up
     only at the true slant. Sloping lines (isobars, coasts) blur at every
     slant, so they cannot pull the answer the way a line-to-line
     correlation can. */
  function sharpness(s, k0, n){
    var L = F.Ld*(1 + s), S0 = F.base + F.offset + k0*F.Ld*(1 + F.slant), prof = new Float64Array(W);
    for(var k = 0; k < n; k++){
      var st = S0 + k*L;
      for(var x = 0; x < W; x++){ var i = Math.floor(st + x*L/W); prof[x] += i < F.n ? F.data[i] : 0; }
    }
    /* smoothed over three dots first, so fine hatching that lines up on a
       diagonal does not count as a column */
    var sm = new Float64Array(W), e = 0;
    for(x = 0; x < W; x++) sm[x] = prof[(x + W - 1) % W] + prof[x] + prof[(x + 1) % W];
    for(x = 0; x < W; x++){ var d = sm[(x + 2) % W] - sm[x]; e += d*d; }
    return e/(n*n);
  }
  function checkSlant(){
    var lines = F.lines(), L0 = F.Ld*(1 + F.slant);
    var first = F.phEnd != null ? Math.ceil((F.phEnd - F.base - F.offset)/L0) + 1 : 0;   // the chart, not its phasing lines
    var n = Math.min(80, lines - 2 - first);
    if(n < 36) return;
    var k0 = lines - n - 1, cur = F.slant, base = sharpness(cur, k0, n), best = base, bs = cur, step;
    function tryS(sv){ var v = sharpness(sv, k0, n); if(v > best){ best = v; bs = sv; } }
    /* a receiver's clock is off by a few parts in ten thousand at most:
       half a dot a line either way is plenty */
    for(step = -20; step <= 20; step++) if(step) tryS(cur + step*2.5e-5);
    var c = bs; for(step = -10; step <= 10; step++) if(step) tryS(c + step*2.5e-6);
    if(best < base*1.02 || Math.abs(bs - cur) < 2e-6) return;               // no clear gain over the slant in use
    if(F.slantFrom === 'phasing'){                                          // phasing's fit stands unless the chart clearly and repeatedly says otherwise
      var agree = F.prop != null && Math.abs(F.prop - bs) < 3e-5;
      F.prop = bs;
      if(best < base*1.1 || Math.abs(bs - cur) < 2e-5 || !agree) return;
    }
    /* the lines already drawn keep their place: line k still begins where it did */
    var kk = Math.max(0, Math.floor((F.n - F.base - F.offset)/(F.Ld*(1 + F.slant))));
    F.offset += kk*F.Ld*(F.slant - bs);
    F.slant = bs; F.slantFrom = 'measured';
  }
  F.push = function(x){
    for(var i = 0; i < x.length; i++){
      ab[an] = x[i]; an = (an + 1) % N;
      var z = fm(x[i]);
      accR += z[0]; accI += z[1]; pos++;
      F.level += (x[i]*x[i] - F.level)*0.0005;
      if(pos >= spp){
        pos -= spp;
        var v = (demC + Math.atan2(accI, accR)*kHz - F.off - 1500)/800*255; accR = 0; accI = 0;
        put(v < 0 ? 0 : v > 255 ? 255 : v | 0);
        if(tone.n === 0 && F.level > 1e-7){       // with each half-second tick: the spectrum, for tuning
          var buf = new Float32Array(N); for(var j = 0; j < N; j++) buf[j] = ab[(an + j) % N];
          var p = fftPow(buf);
          if(!psd) psd = p; else for(j = 0; j < p.length; j++) psd[j] = psd[j]*0.7 + p[j]*0.3;
        }
      }
    }
    if(F.onlines) F.onlines(F);
  };
  F.lines = function(){ return Math.max(0, Math.floor((F.n - F.base - F.offset)/(F.Ld*(1 + F.slant)))); };
  F.line = function(k, out){                     // line k of the current chart, W dots
    var L = F.Ld*(1 + F.slant), s = F.base + F.offset + k*L;
    for(var x = 0; x < W; x++){ var i = Math.floor(s + x*L/W); out[x] = i >= 0 && i < F.n ? F.data[i] : 0; }
    return out;
  };
  /* Line up a chart joined part way: weather charts have a border or margin,
     a band of columns that stays solid black or white down every line. The
     middle of the strongest such band is moved to the edge. */
  F.lineUp = function(){
    var n = F.lines(), from = Math.max(0, n - 70), rows = n - from;
    if(rows < 30) return false;
    var sum = new Float64Array(W), sq = new Float64Array(W), ln = new Uint8Array(W);
    for(var k = from; k < n; k++){ F.line(k, ln); for(var x = 0; x < W; x++){ sum[x] += ln[x]; sq[x] += ln[x]*ln[x]; } }
    var mean = [], vr = [];
    for(x = 0; x < W; x++){ mean[x] = sum[x]/rows; vr[x] = sq[x]/rows - mean[x]*mean[x]; }
    var mv = median(vr) || 1, best = null;
    for(var pass = 0; pass < 2 && !best; pass++){  // a dark border first; a white margin only if very steady
      var run = 0, dark = pass === 0;
      for(x = 0; x < W*2; x++){                  // twice round, so a band across the edge is whole
        var c = x % W, ok = dark ? mean[c] < 60 && vr[c] < 0.6*mv : mean[c] > 230 && vr[c] < 0.15*mv;
        run = ok ? run + 1 : 0;
        if(run >= W*0.01 && run <= W*0.25 && (!best || run > best.w)) best = {w:run, mid:(x - run/2 + W) % W};
      }
    }
    if(!best) return false;
    F.offset += best.mid*F.Ld*(1 + F.slant)/W;
    if(F.onstart) F.onstart(F);
    return true;
  };
  F.quality = function(){
    var b = [];
    if(F.snr != null) b.push('signal ' + (F.snr >= 15 ? 'strong' : F.snr >= 8 ? 'fair' : 'weak') + ' (' + F.snr + ' dB over the noise)');
    if(F.rhythm != null) b.push('line beat ' + (F.rhythm >= 0.5 ? 'clear' : F.rhythm >= 0.25 ? 'faint' :
      F.snr != null && F.snr >= 8 ? 'none: probably not a fax' : 'none: lost in the noise (try another receiver)'));
    return b.join(' · ');
  };
  F.tuning = function(){
    if(!F.offSeen) return '';
    var o = Math.round(F.off/10)*10;
    return Math.abs(o) < 40 ? 'tuned right' : 'receiver ' + Math.abs(o) + ' Hz ' + (o > 0 ? 'high' : 'low') + ', corrected';
  };
  F.setLpm = function(l){ if(l === 'auto'){ F.autoLpm = true; F.lpmFrom = ''; } else { F.autoLpm = false; setLpm(+l, 'set'); } if(F.onstart) F.onstart(F); };
  F.reset = function(){ F.base = F.n; F.offset = 0; F.slant = 0; F.slantFrom = ''; F.phEnd = null; F.prop = null; F.status = 'listening'; phasing = null; };
  return F;
}

/* ------------------------------------------------------------------- SSTV */
/* Slow-scan TV: pictures as tones, a line at a time. Each picture opens with
   a VIS code naming its format; the common amateur ones are read here.
   Every line is re-aligned on its 1200 Hz sync pulse, and the line period is
   fitted from the pulses, so a slightly fast or slow sound card does not
   slant the picture. */
function seg(a){ return a.map(function(s){ return {k:s[0], ms:s[1]}; }); }
var SSTV_MODES = {
  8:  {name:'Robot 36', w:320, h:240, kind:'r36', line:seg([['sync',9],['porch',3],['Y',88],['sep',4.5],['porch',1.5],['C',44]])},
  12: {name:'Robot 72', w:320, h:240, kind:'yuv', line:seg([['sync',9],['porch',3],['Y',138],['sep',4.5],['porch',1.5],['V',69],['sep',4.5],['porch',1.5],['U',69]])},
  44: {name:'Martin 1', w:320, h:256, kind:'rgb', line:seg([['sync',4.862],['porch',0.572],['G',146.432],['sep',0.572],['B',146.432],['sep',0.572],['R',146.432],['sep',0.572]])},
  40: {name:'Martin 2', w:320, h:256, kind:'rgb', line:seg([['sync',4.862],['porch',0.572],['G',73.216],['sep',0.572],['B',73.216],['sep',0.572],['R',73.216],['sep',0.572]])},
  60: {name:'Scottie 1', w:320, h:256, kind:'rgb', pre:9, line:seg([['sep',1.5],['G',138.24],['sep',1.5],['B',138.24],['sync',9],['porch',1.5],['R',138.24]])},
  56: {name:'Scottie 2', w:320, h:256, kind:'rgb', pre:9, line:seg([['sep',1.5],['G',88.064],['sep',1.5],['B',88.064],['sync',9],['porch',1.5],['R',88.064]])},
  76: {name:'Scottie DX', w:320, h:256, kind:'rgb', pre:9, line:seg([['sep',1.5],['G',345.6],['sep',1.5],['B',345.6],['sync',9],['porch',1.5],['R',345.6]])}
};
[[93, 'PD 50', 320, 256, 91.52], [99, 'PD 90', 320, 256, 170.24], [95, 'PD 120', 640, 496, 121.6], [98, 'PD 160', 512, 400, 195.584],
 [96, 'PD 180', 640, 496, 183.04], [97, 'PD 240', 640, 496, 244.48], [94, 'PD 290', 800, 616, 228.8]].forEach(function(p){
  SSTV_MODES[p[0]] = {name:p[1], w:p[2], h:p[3], kind:'pd', line:seg([['sync',20],['porch',2.08],['Y0',p[4]],['V',p[4]],['U',p[4]],['Y1',p[4]]])};
});
Object.keys(SSTV_MODES).forEach(function(v){
  var m = SSTV_MODES[v], t = 0;
  m.vis = +v;
  m.line.forEach(function(s){ s.at = t; t += s.ms; if(s.k === 'sync' && m.syncAt == null){ m.syncAt = s.at; m.syncMs = s.ms; } });
  m.lineMs = t;
  m.txLines = m.kind === 'pd' ? m.h/2 : m.h;
});
function yuv(Y, U, V, out, o){                   // studio-swing YCbCr, as MMSSTV and most senders use
  var y = 1.164*(Y - 16), u = U - 128, v = V - 128;
  out[o] = y + 1.596*v; out[o+1] = y - 0.392*u - 0.813*v; out[o+2] = y + 2.017*u; out[o+3] = 255;
}
function sstv(sr, opts){
  opts = opts || {};
  var S = {mode:null, status:'waiting for a picture (its VIS code)…', onstart:null, onrows:null, ondone:null, rows:0, level:0, manual:null, off:0};
  var fm = FM(sr, 1750, 1000, 27);
  var f = new Float32Array(sr*4), n = 0, base = 0;     // the frequency stream (index = n + base)
  var msLen = sr/1000, msAcc = 0, msCnt = 0, ms = [], msBase = 0, tot = 0;
  var img = null;
  function store(v){
    if(n >= f.length){
      if(!img){                                  // nothing being drawn: keep the last two seconds
        var keep = Math.round(sr*2); f.copyWithin(0, n - keep, n); base += n - keep; n = keep;
      } else { var g = new Float32Array(f.length*2); g.set(f); f = g; }
    }
    f[n++] = v;
  }
  function at(i){ i -= base; return i >= 0 && i < n ? f[i] : 1500; }
  function mean(a, b){                           // mean frequency over stream samples [a, b)
    a = Math.floor(a); b = Math.max(a + 1, Math.floor(b));
    var s = 0; for(var i = a; i < b; i++) s += at(i);
    return s/(b - a);
  }
  /* VIS: 300 ms of 1900 Hz, a 30 ms 1200 Hz start bit, seven bits and an even
     parity bit (1100 Hz = 1, 1300 Hz = 0, 30 ms each, low bit first) and a
     1200 Hz stop bit */
  function msMean(a, b){ var s = 0, c = 0; for(var i = a; i < b; i++){ var v = ms[i - msBase]; if(v != null){ s += v; c++; } } return c ? s/c : 0; }
  /* the sender may be off frequency (amateurs often are, by 100-200 Hz): the
     1900 Hz leader is measured and everything after it is read relative to
     it, up to 250 Hz either way */
  function checkVis(){
    var m = msBase + ms.length - 1, ts = m - 300;
    if(ts - 250 < msBase) return;
    var lead = msMean(ts - 250, ts - 10), off = lead - 1900;
    if(Math.abs(off) > 250) return;
    if(!(ms[ts - 1 - msBase] > 1600 + off && ms[ts + 2 - msBase] < 1450 + off)) return;
    for(var q = ts - 250; q < ts - 10; q += 25) if(Math.abs(msMean(q, q + 25) - lead) > 60) return;   // a steady tone, not a sweep
    if(Math.abs(msMean(ts + 6, ts + 24) - 1200 - off) > 80) return;
    if(Math.abs(msMean(ts + 276, ts + 294) - 1200 - off) > 90) return;
    var code = 0, par = 0;
    for(var k = 0; k < 8; k++){
      var v = msMean(ts + 30*(k + 1) + 6, ts + 30*(k + 1) + 24) - off;
      if(Math.abs(v - 1100) < 70){ if(k < 7) code |= 1 << k; par ^= 1; }
      else if(Math.abs(v - 1300) >= 70) return;
    }
    S.off = off;
    if(par) return;                              // even parity
    var mode = SSTV_MODES[code];
    if(!mode){ S.status = 'a VIS code ' + code + ' was heard, for a format this decoder does not read'; return; }
    begin(mode, (ts + 300)*msLen + (mode.pre || 0)*msLen);
  }
  function begin(mode, t0){
    S.mode = mode; S.rows = 0; S.manual = null;
    img = {t0:t0, T:mode.lineMs*msLen, syncs:[], next:0, pend:null};
    S.status = mode.name + ' · ' + mode.w + '×' + mode.h + ' · receiving' + (Math.abs(S.off) >= 30 ? ' · sender ' + Math.abs(Math.round(S.off/10)*10) + ' Hz ' + (S.off > 0 ? 'high' : 'low') + ', corrected' : '');
    if(S.onstart) S.onstart(S);
  }
  /* the sync pulse nearest where line k should start, by a running sum of
     "is this 1200 Hz?" */
  /* scored on the pulse and on the step back up after it, since a pulse can
     run on from something else at 1200 Hz (Robot 36's first one follows the
     VIS code's own 1200 Hz stop bit) */
  function findSync(expect, win){
    var len = Math.round(S.mode.syncMs*msLen), edge = Math.round(1.5*msLen), best = -1e9, bt = expect, inside = 0;
    for(var t = Math.round(expect - win); t <= expect + win; t++){
      var s = 0, a = 0;
      for(var i = 0; i < len; i += 2) s += at(t + i) < 1350 + S.off ? 1 : -1;
      for(i = 0; i < edge; i++) a += at(t + len + i) > 1350 + S.off ? 1 : -1;
      if(s + a*len/(2*edge) > best){ best = s + a*len/(2*edge); bt = t; inside = s; }
    }
    return inside >= 0.5*len/2 && best >= 0.6*len ? bt : null;
  }
  function lsq(pts){
    var nn = pts.length, sx = 0, s1 = 0, sxx = 0, sxy = 0;
    pts.forEach(function(q){ sx += q[0]; s1 += q[1]; sxx += q[0]*q[0]; sxy += q[0]*q[1]; });
    var b = (nn*sxy - sx*s1)/(nn*sxx - sx*sx || 1);
    return [(s1 - b*sx)/nn, b];
  }
  function lineStart(k){
    var sy = img.syncs, M = S.mode;
    if(sy.length >= 4){                          // fitted from the pulses found so far, outliers dropped
      var use = sy.slice(-40), fit = lsq(use);
      var good = use.filter(function(q){ return Math.abs(q[1] - (fit[0] + fit[1]*q[0])) < 0.8*msLen; });
      if(good.length >= 3 && good.length < use.length) fit = lsq(good);
      if(Math.abs(fit[1]/img.T - 1) < 0.01) return fit[0] + fit[1]*k - M.syncAt*msLen;
    }
    if(sy.length) return sy[sy.length - 1][1] + (k - sy[sy.length - 1][0])*img.T - M.syncAt*msLen;
    return img.t0 + k*img.T;
  }
  img = null;
  function work(){
    if(!img) return;
    var M = S.mode;
    while(img.next < M.txLines){
      var k = img.next, st = lineStart(k), end = st + img.T + 4*msLen;
      if(end > base + n) return;                 // not all heard yet
      var exp = st + M.syncAt*msLen, win = (img.syncs.length < 3 ? 12 : 3)*msLen;
      var found = findSync(exp, win);
      if(found != null){ img.syncs.push([k, found]); st = lineStart(k); }
      decodeLine(k, st);
      img.next++;
    }
    S.status = M.name + ' · complete';
    if(S.ondone) S.ondone(S);
    img = null; S.mode = null;
  }
  function chan(st, s, w, out){                  // w pixels of one colour from segment s
    var a = st + s.at*msLen, d = s.ms*msLen/w;
    for(var x = 0; x < w; x++){
      var v = (mean(a + x*d, a + (x + 1)*d) - S.off - 1500)/800*255;
      out[x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return out;
  }
  function segOf(k){ return S.mode.line.filter(function(s){ return s.k === k; })[0]; }
  function decodeLine(k, st){
    var M = S.mode, w = M.w, rows = [];
    if(M.kind === 'rgb'){
      var R = chan(st, segOf('R'), w, new Float32Array(w)), G = chan(st, segOf('G'), w, new Float32Array(w)), B = chan(st, segOf('B'), w, new Float32Array(w));
      var px = new Uint8ClampedArray(w*4);
      for(var x = 0; x < w; x++){ px[x*4] = R[x]; px[x*4+1] = G[x]; px[x*4+2] = B[x]; px[x*4+3] = 255; }
      rows.push({y:k, px:px});
    } else if(M.kind === 'yuv'){
      var Y = chan(st, segOf('Y'), w, new Float32Array(w)), U = chan(st, segOf('U'), w, new Float32Array(w)), V = chan(st, segOf('V'), w, new Float32Array(w));
      px = new Uint8ClampedArray(w*4);
      for(x = 0; x < w; x++) yuv(Y[x], U[x], V[x], px, x*4);
      rows.push({y:k, px:px});
    } else if(M.kind === 'pd'){
      var Y0 = chan(st, segOf('Y0'), w, new Float32Array(w)), Y1 = chan(st, segOf('Y1'), w, new Float32Array(w));
      U = chan(st, segOf('U'), w, new Float32Array(w)); V = chan(st, segOf('V'), w, new Float32Array(w));
      var p0 = new Uint8ClampedArray(w*4), p1 = new Uint8ClampedArray(w*4);
      for(x = 0; x < w; x++){ yuv(Y0[x], U[x], V[x], p0, x*4); yuv(Y1[x], U[x], V[x], p1, x*4); }
      rows.push({y:2*k, px:p0}, {y:2*k + 1, px:p1});
    } else {                                     // Robot 36: colour shared by each pair of lines
      Y = chan(st, segOf('Y'), w, new Float32Array(w));
      var cs = segOf('C'), C = chan(st, cs, w/2, new Float32Array(w/2));
      var sep = mean(st + segOf('sep').at*msLen, st + (segOf('sep').at + segOf('sep').ms)*msLen);
      var isV = sep - S.off < 1900;               // the separator says which colour this line carries
      if(isV){ img.pend = {k:k, Y:Y, V:C}; return; }
      var pv = img.pend && img.pend.k === k - 1 ? img.pend : null;
      var Vc = pv ? pv.V : new Float32Array(w/2).fill(128);
      var rowsY = pv ? [[k - 1, pv.Y], [k, Y]] : [[k, Y]];
      rowsY.forEach(function(r){
        var q = new Uint8ClampedArray(w*4);
        for(var x2 = 0; x2 < w; x2++) yuv(r[1][x2], C[x2 >> 1], Vc[x2 >> 1], q, x2*4);
        rows.push({y:r[0], px:q});
      });
      img.pend = null;
    }
    S.rows = Math.max(S.rows, rows[rows.length - 1].y + 1);
    if(S.onrows) S.onrows(S, rows);
  }
  S.push = function(x){
    for(var i = 0; i < x.length; i++){
      var v = fm(x[i]);
      store(v);
      S.level += (x[i]*x[i] - S.level)*0.0005;
      msAcc += v; msCnt++; tot++;
      if(tot >= (msBase + ms.length + 1)*msLen){  // millisecond k holds samples [k*msLen, (k+1)*msLen)
        ms.push(msAcc/msCnt); msAcc = 0; msCnt = 0;
        if(ms.length > 1500){ ms.splice(0, 500); msBase += 500; }
        if(!img){
          if(S.manual) manualSync(); else checkVis();
        }
      }
    }
    work();
  };
  /* START by hand, when the VIS code was missed: the next sync pulse that
     repeats at the format's line rate starts the picture */
  function manualSync(){
    var M = S.manual, T = M.lineMs*msLen, i1 = base + n - Math.round(2.2*T);
    if(i1 < base) return;
    var len = Math.round(M.syncMs*msLen);
    function isSync(t){ var s = 0; for(var i = 0; i < len; i += 2) s += at(t + i) < 1350 ? 1 : -1; return s >= 0.6*len/2; }
    for(var t = i1; t < i1 + T; t += 2){
      if(isSync(t) && isSync(Math.round(t + T)) && at(t - Math.round(2*msLen)) > 1350){
        begin(M, t - M.syncAt*msLen); S.status = M.name + ' · started by hand · receiving'; return;
      }
    }
  }
  S.start = function(vis){ S.manual = SSTV_MODES[vis]; img = null; S.off = 0; S.status = 'waiting for the next ' + S.manual.name + ' sync pulse…'; };
  S.stop = function(){ img = null; S.mode = null; S.manual = null; S.status = 'waiting for a picture (its VIS code)…'; };
  S.modes = SSTV_MODES;
  return S;
}

/* -------------------------------------------------------------- identify */
/* What is this? Measures what you are hearing (how wide, how many tones and
   how far apart, how fast it changes, whether it sweeps, pulses or holds
   steady) and weighs that with the frequency against known stations and
   bands. Gives likely matches with honest confidence, never a certainty. */
var KNOWN = [
  // [lo kHz, hi kHz, name, what it is, decoder, search term]
  [4624.5, 4625.5, 'UVB-76 "The Buzzer"', 'Russian military channel marker: a buzz about every 1-2 s, broken by rare voice messages in Russian', null, 'UVB-76'],
  [3755.5, 3756.5, '"The Pip"', 'Russian military channel marker: short repeated pips (night channel)', null, 'The Pip'],
  [5447.5, 5448.5, '"The Pip"', 'Russian military channel marker: short repeated pips (day channel)', null, 'The Pip'],
  [2499.5, 2500.5, 'WWV / WWVH time signal', 'US time station: a tick every second, voice time each minute', null, 'WWV'],
  [4999.5, 5000.5, 'WWV / WWVH time signal', 'US time station: a tick every second, voice time each minute', null, 'WWV'],
  [9999.5, 10000.5, 'WWV / WWVH time signal', 'US time station: a tick every second, voice time each minute', null, 'WWV'],
  [14999.5, 15000.5, 'WWV / WWVH time signal', 'US time station: a tick every second, voice time each minute', null, 'WWV'],
  [19999.5, 20000.5, 'WWV time signal', 'US time station', null, 'WWV'],
  [24999.5, 25000.5, 'WWV time signal', 'US time station', null, 'WWV'],
  [3329.5, 3330.5, 'CHU Canada time signal', 'Canadian time station: ticks, voice in English and French', null, 'CHU'],
  [7849.5, 7850.5, 'CHU Canada time signal', 'Canadian time station', null, 'CHU'],
  [14669.5, 14670.5, 'CHU Canada time signal', 'Canadian time station', null, 'CHU'],
  [4995.5, 4996.5, 'RWM Moscow time signal', 'Russian time station: pulses each second, Morse ID', null, 'RWM'],
  [9995.5, 9996.5, 'RWM Moscow time signal', 'Russian time station', null, 'RWM'],
  [14995.5, 14996.5, 'RWM Moscow time signal', 'Russian time station', null, 'RWM'],
  [4233, 4236, 'US Coast Guard weather fax, Boston (NMF)', 'weather charts by radio fax: tune USB 1.9 kHz below 4235', 'fax', 'Radiofax'],
  [6337, 6341, 'US Coast Guard weather fax, Boston (NMF)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [9106, 9111, 'US Coast Guard weather fax, Boston (NMF)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [12746, 12751, 'US Coast Guard weather fax, Boston (NMF)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [4314, 4319, 'US Coast Guard weather fax, New Orleans (NMG)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [8500, 8505, 'US Coast Guard weather fax, New Orleans (NMG)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [12786, 12791, 'weather fax (New Orleans NMG / Point Reyes NMC)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [4344, 4347, 'US Coast Guard weather fax, Point Reyes (NMC)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [8680, 8683, 'US Coast Guard weather fax, Point Reyes (NMC)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [3853, 3856, 'German Weather Service fax (DDH3)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [7878, 7881, 'German Weather Service fax (DDK3)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [13880, 13883.5, 'German Weather Service fax (DDK6)', 'weather charts by radio fax', 'fax', 'Radiofax'],
  [4582, 4584, 'German Weather Service RTTY (DDK2)', 'weather reports by teleprinter, 50 baud, 450 Hz shift', 'rtty', 'RTTY'],
  [7645, 7647, 'German Weather Service RTTY (DDH7)', 'weather reports by teleprinter, 50 baud, 450 Hz shift', 'rtty', 'RTTY'],
  [10099.5, 10101.5, 'German Weather Service RTTY (DDK9)', 'weather reports by teleprinter, 50 baud, 450 Hz shift', 'rtty', 'RTTY'],
  [517, 519, 'NAVTEX', 'maritime safety broadcasts (SITOR-B data)', null, 'NAVTEX'],
  [489, 491, 'NAVTEX (national)', 'maritime safety broadcasts', null, 'NAVTEX'],
  [4209, 4210, 'HF NAVTEX', 'maritime safety broadcasts', null, 'NAVTEX'],
  [4723.5, 4724.5, 'US Air Force HFGCS', 'military voice net: Emergency Action Messages (spoken letters and numbers), "Skyking" calls', null, 'HFGCS'],
  [8991.5, 8992.5, 'US Air Force HFGCS', 'military voice net: Emergency Action Messages, "Skyking" calls', null, 'HFGCS'],
  [11174.5, 11175.5, 'US Air Force HFGCS', 'military voice net: Emergency Action Messages', null, 'HFGCS'],
  [13199.5, 13200.5, 'US Air Force HFGCS', 'military voice net', null, 'HFGCS'],
  [15015.5, 15016.5, 'US Air Force HFGCS', 'military voice net', null, 'HFGCS'],
  [3484, 3486, 'New York VOLMET', 'aviation weather read out on a loop', null, 'VOLMET'],
  [6603, 6605, 'New York VOLMET', 'aviation weather read out on a loop', null, 'VOLMET'],
  [10050, 10052, 'New York VOLMET', 'aviation weather', null, 'VOLMET'],
  [13269, 13271, 'New York VOLMET', 'aviation weather', null, 'VOLMET'],
  [5504, 5506, 'Shannon VOLMET', 'aviation weather, Ireland', null, 'VOLMET'],
  [8956, 8958, 'Shannon VOLMET', 'aviation weather, Ireland', null, 'VOLMET'],
  [14099.5, 14100.5, 'NCDXF/IARU beacon', 'amateur beacons around the world in turn, every 10 s: Morse call sign, then four dashes stepping down in power', 'cw', 'NCDXF'],
  [18109.5, 18110.5, 'NCDXF/IARU beacon', 'amateur beacons, every 10 s', 'cw', 'NCDXF'],
  [21149.5, 21150.5, 'NCDXF/IARU beacon', 'amateur beacons, every 10 s', 'cw', 'NCDXF'],
  [24929.5, 24930.5, 'NCDXF/IARU beacon', 'amateur beacons, every 10 s', 'cw', 'NCDXF'],
  [28199.5, 28200.5, 'NCDXF/IARU beacon', 'amateur beacons, every 10 s', 'cw', 'NCDXF'],
  [1840, 1843, 'FT8 (amateur)', 'amateur digital mode: 15-second bursts of 8 close tones, many stations side by side', null, 'FT8'],
  [3573, 3576, 'FT8 (amateur)', 'amateur digital mode: 15-second bursts', null, 'FT8'],
  [7074, 7077, 'FT8 (amateur)', 'amateur digital mode: 15-second bursts', null, 'FT8'],
  [10136, 10139, 'FT8 (amateur)', 'amateur digital mode', null, 'FT8'],
  [14074, 14077, 'FT8 (amateur)', 'amateur digital mode: 15-second bursts', null, 'FT8'],
  [18100, 18103, 'FT8 (amateur)', 'amateur digital mode', null, 'FT8'],
  [21074, 21077, 'FT8 (amateur)', 'amateur digital mode', null, 'FT8'],
  [28074, 28077, 'FT8 (amateur)', 'amateur digital mode', null, 'FT8'],
  [3845, 3846, 'SSTV calling (amateur, 80 m)', 'slow-scan TV pictures', 'sstv', 'SSTV'],
  [7171, 7172, 'SSTV calling (amateur, 40 m)', 'slow-scan TV pictures', 'sstv', 'SSTV'],
  [14229, 14234, 'SSTV calling (amateur, 20 m)', 'slow-scan TV pictures', 'sstv', 'SSTV'],
  [21339, 21341, 'SSTV calling (amateur, 15 m)', 'slow-scan TV pictures', 'sstv', 'SSTV'],
  [28679, 28681, 'SSTV calling (amateur, 10 m)', 'slow-scan TV pictures', 'sstv', 'SSTV']
];
var BANDS = [
  [148, 283, 'long-wave broadcasting'], [190, 535, 'aviation beacons (NDB) and marine data'], [283.5, 325, 'DGPS beacons'],
  [530, 1700, 'AM broadcasting'], [1800, 2000, '160 m amateur band'], [2300, 2495, 'tropical broadcasting'],
  [2850, 3025, 'aviation HF (voice)'], [3200, 3400, 'tropical broadcasting'], [3400, 3500, 'aviation HF (voice)'],
  [3500, 4000, '80 m amateur band'], [4000, 4438, 'maritime HF'], [4380, 5400, 'possible CODAR ocean radar range'],
  [4650, 4700, 'aviation HF'], [4750, 5060, 'tropical broadcasting'], [5330, 5405, '60 m amateur channels'],
  [5450, 5680, 'aviation HF'], [5900, 6200, '49 m broadcasting'], [6200, 6525, 'maritime HF'], [6525, 6765, 'aviation HF'],
  [7000, 7300, '40 m amateur band'], [7200, 7450, '41 m broadcasting'], [8100, 8815, 'maritime HF'], [8815, 9040, 'aviation HF'],
  [9400, 9900, '31 m broadcasting'], [10005, 10100, 'aviation HF'], [10100, 10150, '30 m amateur band'],
  [11175, 11400, 'aviation HF'], [11600, 12100, '25 m broadcasting'], [12000, 14000, 'possible CODAR ocean radar range'],
  [12230, 13200, 'maritime HF'], [13200, 13360, 'aviation HF'], [13570, 13870, '22 m broadcasting'], [14000, 14350, '20 m amateur band'],
  [15100, 15800, '19 m broadcasting'], [16360, 17410, 'maritime HF'], [17480, 17900, '16 m broadcasting'], [17900, 18030, 'aviation HF'],
  [18068, 18168, '17 m amateur band'], [21000, 21450, '15 m amateur band'], [21450, 21850, '13 m broadcasting'],
  [24000, 27000, 'possible CODAR ocean radar range'], [24890, 24990, '12 m amateur band'], [25670, 26100, '11 m broadcasting'],
  [26965, 27405, 'CB radio'], [28000, 29700, '10 m amateur band']
];
function identify(x, sr, rf){
  rf = rf || {};
  var N = 1024, hop = 128, hz = sr/N, b0 = Math.ceil(150/hz), b1 = Math.min(N/2 - 1, Math.floor(3400/hz));
  var frames = [], F = Math.floor((x.length - N)/hop);
  if(F < 20) return {error:'Listen for a few seconds first.'};
  var mean = new Float64Array(N/2);
  for(var t = 0; t < F; t++){
    var p = fftPow(x.subarray(t*hop, t*hop + N));
    frames.push(p);
    for(var b = 0; b < p.length; b++) mean[b] += p[b]/F;
  }
  var band = Array.prototype.slice.call(mean, b0, b1), floor = pctl(band, 0.2) || 1e-20, top = Math.max.apply(null, band);
  var snr = 10*Math.log10(top/floor), dt = hop/sr;
  var meas = {snr:Math.round(snr), seconds:+(x.length/sr).toFixed(1)};
  /* how wide: the span holding the middle 90% of the energy above the floor */
  var ex = band.map(function(v){ return Math.max(0, v - floor*2); }), tot = ex.reduce(function(a, c){ return a + c; }, 0), cum = 0, lo = -1, hi = 0;
  for(var i = 0; i < ex.length; i++){ cum += ex[i]; if(lo < 0 && cum >= 0.05*tot) lo = i; if(cum >= 0.95*tot){ hi = i; break; } }
  if(lo < 0) lo = 0;
  meas.width = Math.round((hi - lo + 1)*hz); meas.lo = Math.round((lo + b0)*hz); meas.hi = Math.round((hi + b0)*hz);
  /* the strongest frequency, frame by frame */
  var dom = [], pw = [], on = [];
  for(t = 0; t < F; t++){
    var fp = frames[t], mb = b0, mv = 0, sum = 0;
    for(b = b0; b < b1; b++){ sum += fp[b]; if(fp[b] > mv){ mv = fp[b]; mb = b; } }
    dom.push(mb*hz); pw.push(mv); on.push(mv > floor*10);
  }
  var onFrac = on.filter(Boolean).length/F;
  meas.onFrac = +onFrac.toFixed(2);
  /* distinct tones: where the strongest frequency sits most of the time */
  var hist = {};
  dom.forEach(function(f, k){ if(on[k]){ var key = Math.round(f/hz); hist[key] = (hist[key] || 0) + 1; } });
  var nOn = on.filter(Boolean).length || 1;
  var tones = Object.keys(hist).map(function(k){ return [k*hz, hist[k]]; }).filter(function(q){ return q[1] >= 0.04*nOn; })
    .sort(function(a, c){ return a[0] - c[0]; });
  var merged = [];                               // neighbours within ~25 Hz are one tone
  tones.forEach(function(q){ var l = merged[merged.length - 1]; if(l && q[0] - l[0] < 1.6*hz){ if(q[1] > l[1]){ l[0] = q[0]; } l[1] += q[1]; } else merged.push(q.slice()); });
  meas.tones = merged.map(function(q){ return Math.round(q[0]); });
  if(merged.length >= 2){
    var gaps = []; for(i = 1; i < merged.length; i++) gaps.push(merged[i][0] - merged[i-1][0]);
    meas.spacing = Math.round(median(gaps));
  }
  /* how fast it changes: the shortest common stretch on one tone */
  var runs = [], r = 0, cur = null;
  for(t = 0; t < F; t++){
    var tk = on[t] ? Math.round(dom[t]/26) : -1;
    if(tk === cur) r++; else { if(cur != null && cur >= 0 && r > 0) runs.push(r*dt); cur = tk; r = 1; }
  }

  /* on/off keying (Morse): the level at the strongest tone */
  var lv = pw.map(function(v){ return 10*Math.log10(v/floor); }), up = 0, marks = [], m0 = null;
  var thr = (pctl(lv, 0.9) + pctl(lv, 0.1))/2;
  for(t = 0; t < F; t++){
    var u = lv[t] > thr;
    if(u && m0 == null) m0 = t;
    if(!u && m0 != null){ marks.push((t - m0)*dt); m0 = null; up++; }
  }
  meas.keyed = up >= 6 && pctl(lv, 0.9) - pctl(lv, 0.1) > 12;
  if(meas.keyed && marks.length >= 4){ var short = pctl(marks, 0.3); meas.wpm = Math.round(1.2/Math.max(0.02, short)); }
  /* sweeps: the strongest frequency gliding steadily up or down */
  var sweeps = 0, s0 = null, dir = 0, run = 0;
  for(t = 1; t < F; t++){
    if(!on[t] || !on[t-1]){ if(run >= 8) sweeps++; run = 0; dir = 0; continue; }
    var d = dom[t] - dom[t-1], dd = d > hz*0.5 ? 1 : d < -hz*0.5 ? -1 : 0;
    if(dd && dd === dir) run++; else { if(run >= 8){ sweeps++; } run = dd ? 1 : 0; dir = dd; }
  }
  meas.sweeps = sweeps;
  meas.sweepRate = sweeps ? +(sweeps/(F*dt)).toFixed(2) : 0;
  /* pulses: a 2 ms level envelope, and how regularly it repeats (10 ms to
     3 s). The repeat is the strongest echo after the envelope has first
     stopped resembling itself, so a smooth sound is not mistaken for a fast
     pulse. */
  var blk = Math.round(sr*0.002), env2 = [];
  for(i = 0; i + blk <= x.length; i += blk){ var s3 = 0; for(var q3 = i; q3 < i + blk; q3++) s3 += x[q3]*x[q3]; env2.push(10*Math.log10(s3/blk + 1e-12)); }
  var e2m = env2.reduce(function(a, c){ return a + c; }, 0)/env2.length, e2 = env2.map(function(v){ return v - e2m; }),
      e2v = e2.reduce(function(a, c){ return a + c*c; }, 0) || 1, maxL = Math.min(1500, Math.floor(env2.length/2.5)), acs = [];
  for(var L = 1; L <= maxL; L++){ var ac = 0; for(t = 0; t + L < e2.length; t += 1) ac += e2[t]*e2[t + L]; acs[L] = ac/e2v; }
  var L0 = 1; while(L0 < maxL && acs[L0] > 0.15) L0++;
  var bestL = 0, bestA = 0;
  for(L = Math.max(L0, 5); L < maxL; L++) if(acs[L] > bestA && acs[L] >= acs[L-1] && acs[L] >= (acs[L+1] || 0)){ bestA = acs[L]; bestL = L; }
  meas.depth = Math.round(Math.max(pctl(env2, 0.9), pctl(env2, 0.997)) - pctl(env2, 0.3));   // brief ticks count too
  if(bestA > 0.35 && meas.depth > 8) meas.period = +(bestL*0.002).toFixed(3);
  if(meas.period && snr < 8) snr = Math.max(snr, meas.depth);            // pulses of wideband noise still count
  var pkSnr = 10*Math.log10(pctl(pw, 0.98)/floor);
  if(snr < 8 && pkSnr > 15 && (sweeps || meas.period)) snr = pkSnr;    // a brief sweep or burst in a quiet stretch
  /* flatness inside the occupied band: noise-like (wideband data) or tonal */
  var occ = Array.prototype.slice.call(mean, lo + b0, hi + b0 + 1), lg = 0;
  occ.forEach(function(v){ lg += Math.log(v + 1e-20); });
  meas.flat = +(Math.exp(lg/occ.length)/(occ.reduce(function(a, c){ return a + c; }, 0)/occ.length)).toFixed(2);
  /* level steadiness at the strongest frequency: a carrier holds still */
  var peakF = (band.indexOf(top) + b0)*hz;
  meas.peak = Math.round(peakF);
  var steady = lv.filter(function(v){ return v > 6; }).length/F > 0.95 && pctl(lv, 0.9) - pctl(lv, 0.1) < 4 && meas.width < 120;
  meas.steady = steady;
  /* frequency-as-brightness signals (fax, SSTV): the instantaneous frequency,
     a millisecond at a time, shows SSTV's short 1200 Hz sync pulses and fax's
     half-second line rhythm, which the spectrum frames are too coarse to see */
  var dem = FM(sr, 1750, 1000, 27), msL = sr/1000, mf = [], accF = 0, cF = 0;
  for(i = 0; i < x.length; i++){ accF += dem(x[i]); cF++; if(cF >= msL){ mf.push(accF/cF); accF = 0; cF = 0; } }
  mf = mf.slice(20);
  var inFm = mf.filter(function(v){ return v > 1450 && v < 2350; }).length/(mf.length || 1);
  var sRuns = 0, rl = 0;
  mf.forEach(function(v){ if(Math.abs(v - 1200) < 70) rl++; else { if(rl >= 4 && rl <= 25) sRuns++; rl = 0; } });
  var syncs = sRuns/(mf.length/1000 || 1);       // sync pulses a second
  meas.fm = +inFm.toFixed(2); meas.syncsPerSec = +syncs.toFixed(1);
  if(merged.length >= 2 && merged.length <= 10){  // symbol speed: how long it stays on one tone
    var tl = merged.map(function(q){ return q[0]; }), sym = [], rn = 0, last = -1;
    mf.forEach(function(v){
      var bi = 0, bd = 1e9; tl.forEach(function(tf, ti){ var dd2 = Math.abs(v - tf); if(dd2 < bd){ bd = dd2; bi = ti; } });
      if(bi === last) rn++; else { if(rn >= 2) sym.push(rn); rn = 1; last = bi; }
    });
    if(sym.length > 10) meas.baud = Math.round(1000/pctl(sym, 0.2));
  }
  if(inFm > 0.6 && mf.length > 1500){            // line rhythm, 100 ms to 1 s
    var mm = mf.reduce(function(a, c){ return a + c; }, 0)/mf.length, mv = mf.map(function(v){ return v - mm; }),
        v2 = mv.reduce(function(a, c){ return a + c*c; }, 0) || 1, bl = 0, ba = 0;
    for(var lg2 = 100; lg2 <= Math.min(1000, mf.length/2); lg2++){
      var a2 = 0; for(var q2 = 0; q2 + lg2 < mf.length; q2 += 2) a2 += mv[q2]*mv[q2 + lg2];
      a2 = 2*a2/v2; if(a2 > ba){ ba = a2; bl = lg2; }
    }
    if(ba > 0.3) meas.fmPeriod = +(bl/1000).toFixed(3);
  }

  /* ---- candidates ---- */
  var C = [];
  function add(name, conf, why, decode, term){ C.push({name:name, conf:conf, why:why, decode:decode || null, term:term || name}); }
  if(snr < 8) add('Nothing clear: noise or a very weak signal', 0.7, 'the strongest sound is only ' + Math.round(snr) + ' dB over the background', null, 'Noise');
  else {
    if(meas.keyed && meas.width < 160 && merged.length <= 2)
      add('Morse code (CW)', 0.8, 'a single tone switched on and off' + (meas.wpm ? ', about ' + meas.wpm + ' words a minute' : ''), 'cw', 'Morse Code');
    if(merged.length === 2 && meas.spacing && !(syncs >= 1.5 && inFm > 0.6)){
      var sh = [170, 425, 450, 850].filter(function(s){ return Math.abs(meas.spacing - s) < s*0.12; })[0];
      if(sh) add('RTTY (radioteletype)', meas.baud && meas.baud > 30 && meas.baud < 110 ? 0.85 : 0.6,
                 'two tones ' + meas.spacing + ' Hz apart' + (meas.baud ? ', about ' + meas.baud + ' changes a second' : ''), 'rtty', 'RTTY');
      else add('FSK data (two tones)', 0.5, 'two tones ' + meas.spacing + ' Hz apart, not a standard RTTY spacing', null, 'FSK');
    }
    if(merged.length >= 6 && meas.spacing && Math.abs(meas.spacing - 250) < 40 && meas.lo > 600 && meas.hi < 2700)
      add('ALE (automatic link establishment)', 0.75, merged.length + ' tones about 250 Hz apart in short warbling bursts: radios calling each other, used by militaries, governments and aid agencies; the call signs are sent in the clear', null, 'ALE');
    else if(merged.length >= 4 && meas.spacing && meas.spacing < 120)
      add('Multi-tone data (MFSK family)', 0.6, merged.length + ' tones ' + meas.spacing + ' Hz apart, one at a time, a wandering "melody": Olivia, MFSK, Thor, Contestia among amateurs; also military and Russian multi-tone modes', null, 'MFSK');
    var picture = false;
    if(syncs >= 1.5 && syncs <= 8 && inFm > 0.6 && merged.length < 6 && meas.width > 500 && (picture = true))
      add('SSTV (slow-scan TV picture)', 0.75, 'a tone sliding between 1500 and 2300 Hz with about ' + meas.syncsPerSec + ' short 1200 Hz sync pulses a second', 'sstv', 'SSTV');
    else if(inFm > 0.75 && meas.width > 400 && meas.fmPeriod && (Math.abs(meas.fmPeriod - 0.5) < 0.02 || Math.abs(meas.fmPeriod - 1) < 0.03) && (picture = true))
      add('Weather fax (radiofax)', 0.7, 'a tone sliding between 1500 and 2300 Hz, repeating every half second (120 lines a minute)', 'fax', 'Radiofax');
    else if(inFm > 0.75 && meas.width > 400 && (picture = true))
      add('Weather fax or SSTV picture', 0.45, 'a tone sliding between 1500 and 2300 Hz, the range pictures are sent in', 'fax', 'Radiofax');
    if(meas.flat > 0.55 && meas.width > 1500 && onFrac > 0.8)
      add('Wideband data modem (PSK or OFDM)', 0.6, 'a ' + meas.width + ' Hz wide block of noise-like sound: military and government modems (STANAG 4285, 4539), HF email, or digital radio', null, 'STANAG 4285');
    if(meas.width < 90 && !meas.keyed && onFrac > 0.8 && !steady && merged.length <= 1)
      add('Narrow data (PSK31 or similar)', 0.45, 'a single narrow signal with a warble, not on/off keyed', null, 'PSK31');
    if(steady) add('A steady carrier', 0.6, 'one tone at ' + meas.peak + ' Hz holding still: an idle beacon, a broadcast carrier, or a marker', null, 'Carrier');
    if(picture){}
    else if(meas.sweeps >= 2 && meas.sweepRate >= 0.6)
      add('CODAR ocean radar (or another repeating sweep)', rf.khz && /CODAR/.test(bandOf(rf.khz)) ? 0.7 : 0.5,
          meas.sweeps + ' sweeps in ' + meas.seconds + ' s, about ' + meas.sweepRate + ' a second: coastal radars that measure sea currents sweep like this, nonstop', null, 'CODAR');
    else if(meas.sweeps >= 1)
      add('Chirp sounder or ionosonde', 0.45, 'a tone gliding steadily through the band: stations that sweep shortwave to measure the ionosphere', null, 'Chirp sounder');
    if(meas.period && meas.period < 0.12 && (meas.width > 800 || meas.flat > 0.8) && !meas.keyed)
      add('Over-the-horizon radar', 0.55, 'wide, regular pulses about ' + Math.round(1/meas.period) + ' a second', null, 'Over the horizon radar');
    else if(meas.period && Math.abs(meas.period - 1) < 0.03)
      add('Time signal ticks', 0.5, 'a pulse every second', null, 'Time signal');
    else if(meas.period && meas.period >= 0.3 && (!meas.keyed || meas.width > 300))
      add('Channel marker or beacon', 0.5, 'the same sound repeating every ' + meas.period + ' s' +
          (meas.flat < 0.2 ? ', a buzz rich in harmonics (like the Russian "Buzzer" markers)' : ''), null, 'Channel marker');
    if(rf.voice) add('Voice', 0.7, 'speech-like changes in level', null, 'Voice');
  }
  /* the frequency: known stations first, then the band. When the sound fits
     what is known to be on that frequency, the two make one stronger answer. */
  function kindOf(t){
    return /marker|Buzzer|Pip/i.test(t) ? 'marker' : /time sig|ticks/i.test(t) ? 'time' : /fax/i.test(t) ? 'fax' : /RTTY|teleprinter/i.test(t) ? 'rtty' :
           /Morse|beacon/i.test(t) ? 'cw' : /SSTV/i.test(t) ? 'sstv' : /Voice|HFGCS|VOLMET/i.test(t) ? 'voice' : /FT8|NAVTEX|data|ALE|tone/i.test(t) ? 'data' : '';
  }
  if(rf.khz){
    var dial = rf.khz;
    KNOWN.forEach(function(k){
      if(dial >= k[0] - 1 && dial <= k[1] + 1){
        var kk = kindOf(k[2] + ' ' + k[3]);
        var same = C.filter(function(c){ return (c.decode && c.decode === k[4]) || (kk && kindOf(c.name) === kk); })[0];
        if(same){ same.conf = Math.min(0.95, same.conf + 0.15); same.name = k[2] + ': ' + same.name; same.why += '; and ' + dial + ' kHz is a known frequency for it'; }
        else add(k[2], 0.5, k[3] + ' (known for ' + dial + ' kHz)', k[4], k[5]);
      }
    });
    meas.band = bandOf(dial);
  }
  C.sort(function(a, c){ return c.conf - a.conf; });
  C.forEach(function(c){ c.word = c.conf >= 0.8 ? 'likely' : c.conf >= 0.6 ? 'fairly likely' : c.conf >= 0.45 ? 'possible' : 'a guess'; });
  return {meas:meas, cands:C.slice(0, 6)};
}
function bandOf(khz){
  return BANDS.filter(function(b){ return khz >= b[0] && khz <= b[1]; }).map(function(b){ return b[2]; }).join(', ');
}

/* A clean-up for weak charts, for display: each dot becomes the median of
   three dots in whichever direction (across, down or either diagonal) agrees
   with it best. An isolated speck of noise disagrees in every direction and
   goes; a one-dot line along any of them stays. up, line and down are three
   neighbouring lines of W dots; the result goes into out. */
function faxClean(up, line, down, out){
  var W = line.length;
  function m3(a, b, c){ return a > b ? (b > c ? b : a > c ? c : a) : (a > c ? a : b > c ? c : b); }
  for(var x = 0; x < W; x++){
    var l = x > 0 ? x - 1 : 0, r = x < W - 1 ? x + 1 : W - 1, v = line[x];
    var c1 = m3(line[l], v, line[r]), c2 = m3(up[x], v, down[x]), c3 = m3(up[l], v, down[r]), c4 = m3(up[r], v, down[l]);
    var best = c1, bd = Math.abs(c1 - v);
    if(Math.abs(c2 - v) < bd){ best = c2; bd = Math.abs(c2 - v); }
    if(Math.abs(c3 - v) < bd){ best = c3; bd = Math.abs(c3 - v); }
    if(Math.abs(c4 - v) < bd){ best = c4; }
    out[x] = best;
  }
  return out;
}

var API = {faxClean:faxClean, Decim:Decim, FM:FM, fftPow:fftPow, rtty:rtty, fax:fax, sstv:sstv, identify:identify, SSTV_MODES:SSTV_MODES,
           KNOWN:KNOWN, BANDS:BANDS, bandOf:bandOf, ITA2_L:ITA2_L, ITA2_F:ITA2_F};
if(typeof module !== 'undefined' && module.exports) module.exports = API;
else root.DECODERS = API;
})(typeof window !== 'undefined' ? window : this);
