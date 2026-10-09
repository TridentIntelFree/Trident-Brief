// Fax bench: a synthetic weather chart sent as a real 120 lpm fax (start tone, phasing,
// stop tone), with HF trouble added (noise, fading, an echo, static crashes, mistuning,
// a receiver clock error, joining part way), decoded by assets/decoders.js and scored
// against the original (1 = perfect). Run: node tests/fax_bench.js   (PNG=1 saves the pictures)
const fs = require('fs'), zlib = require('zlib');
const D = require(process.env.DEC || require('path').join(__dirname, '..', 'assets', 'decoders.js'));
const SR = 12000, W = 904, LPM = 120, LINES = +process.env.LINES || 260;
function rng(seed){ let s = seed >>> 0; return () => { s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; }; }
function gauss(r){ let u = r() || 1e-9, v = r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
// the chart: white background, black border, grid, wavy isobars, text blocks
function chart(){
  const img = []; const r = rng(7);
  const blocks = []; for(let i = 0; i < 40; i++) blocks.push([60 + r()*780, 20 + r()*(LINES - 40), 20 + r()*60, 6 + r()*8]);
  for(let y = 0; y < LINES; y++){
    const row = new Float32Array(W);
    for(let x = 0; x < W; x++){
      let v = 1;
      if(x < 30) v = 0;                                     // border
      if(x % 113 === 0 || y % 57 === 0) v = 0;              // grid
      for(let k = 0; k < 6; k++){ const yy = 30 + k*40 + 18*Math.sin(x/70 + k); if(Math.abs(y - yy) < 1.2) v = 0; }   // isobars
      for(const b of blocks) if(x > b[0] && x < b[0] + b[2] && y > b[1] && y < b[1] + b[3] && ((x + y) % 3)) v = 0; // text
      row[x] = v;
    }
    img.push(row);
  }
  return img;
}
function synth(img, o){
  const r = rng(o.seed || 1), out = [];
  let ph = 0; const dotsPerSec = W*LPM/60, spd = SR/dotsPerSec;
  const off = o.off || 0, rate = o.rate || 1;          // receiver mistuning (Hz); clock error (1 + e)
  function tone(fn, secs){ const n = Math.round(secs*SR); for(let i = 0; i < n; i++){ ph += 2*Math.PI*(fn(i/SR) + off)/SR; out.push(Math.sin(ph)); } }
  const lineS = 60/LPM*rate;
  if(!o.mid){
    tone(t => (Math.floor(t*600) % 2) ? 2300 : 1500, 5);                       // start tone: 300 Hz black/white
    tone(t => ((t % lineS)/lineS < 0.05) ? 2300 : 1500, 20);                   // phasing: dark, white pulse at line start
  }
  let carry = 0;
  for(const row of img.slice(o.mid || 0)){ const ns = lineS*SR + carry, n = Math.floor(ns); carry = ns - n; const sp = n/W;
    for(let i = 0; i < n; i++){ const x = Math.min(W - 1, Math.floor(i/sp)); ph += 2*Math.PI*(1500 + 800*row[x] + off)/SR; out.push(Math.sin(ph)); } }
  tone(t => (Math.floor(t*900) % 2) ? 2300 : 1500, 5);                       // stop tone 450 Hz
  let x = Float32Array.from(out);
  // frequency offset (receiver mistuned)
  // multipath echo
  if(o.echoMs){ const d = Math.round(o.echoMs*SR/1000), y = new Float32Array(x.length); for(let i = 0; i < x.length; i++) y[i] = x[i] + o.echoA*(i >= d ? x[i - d] : 0); x = y; }
  // slow fading (Rayleigh-ish: magnitude of two slowly varying gaussians)
  if(o.fade){ let a = 1, b = 0; const k = Math.exp(-1/(SR*o.fade)); for(let i = 0; i < x.length; i++){ a = a*k + Math.sqrt(1 - k*k)*gauss(r); b = b*k + Math.sqrt(1 - k*k)*gauss(r); x[i] *= Math.sqrt(a*a + b*b)/Math.SQRT2*1.0; } }
  // noise: o.snr = signal power over noise power in a 2.4 kHz receiver bandwidth (white, 6 kHz Nyquist)
  if(o.snr != null){ const ps = 0.5, pn24 = ps/Math.pow(10, o.snr/10), sigma = Math.sqrt(pn24*(SR/2)/2400); for(let i = 0; i < x.length; i++) x[i] += sigma*gauss(r); }
  // gentle noise impulses (static crashes)
  if(o.crash){ for(let k = 0; k < o.crash; k++){ const s = Math.floor(r()*x.length), n = Math.floor(SR*0.02); for(let i = 0; i < n && s + i < x.length; i++) x[s + i] += 3*gauss(r); } }
  return x;
}
function decode(x, opts){
  const F = D.fax(SR, opts || {}); const C = 4096;
  for(let i = 0; i < x.length; i += C) F.push(x.subarray(i, i + C));
  const n = F.lines(), rows = []; const ln = new Uint8Array(W);
  for(let k = 0; k < n; k++) rows.push(Uint8Array.from(F.line(k, ln)));
  return {F, rows};
}
function score(img, rows){
  // best alignment: vertical shift 0..60 lines, horizontal circular shift; correlation over the chart
  function c(sv, sh, step){
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
    for(let y = 10; y < img.length - 10; y += step){ const d = rows[y + sv]; if(!d) continue;
      for(let x = 0; x < W; x += 2*step){ const a = img[y][x]*255, b = d[(x + sh + W) % W]; sx += a; sy += b; sxx += a*a; syy += b*b; sxy += a*b; n++; } }
    return n ? (sxy/n - sx*sy/n/n)/Math.sqrt((sxx/n - sx*sx/n/n)*(syy/n - sy*sy/n/n) || 1) : -1;
  }
  let best = -1, bv = 0, bh = 0;
  for(let sv = 0; sv <= 60; sv += 1) for(let sh = -60; sh <= 60; sh += 3){ const q = c(sv, sh, 4); if(q > best){ best = q; bv = sv; bh = sh; } }
  for(let sh = bh - 3; sh <= bh + 3; sh++){ const q = c(bv, sh, 1); if(q > best){ best = q; bh = sh; } }
  best = c(bv, bh, 1);
  // straightness: the same score on the top and bottom thirds, aligned separately
  return {corr: best, shift: [bv, bh]};
}
function png(file, rows){
  const h = rows.length, raw = Buffer.alloc((W + 1)*h);
  rows.forEach((r, y) => { raw[y*(W + 1)] = 0; Buffer.from(r).copy(raw, y*(W + 1) + 1); });
  const crc = (b) => { let c, t = []; for(let n = 0; n < 256; n++){ c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for(const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
module.exports = {chart, synth, decode, score, png, SR, W};
if(require.main === module){
  const img = chart(); const tag = process.env.TAG || 'cur';
  const cases = [['clean', {}], ['snr20', {snr:20}], ['snr12', {snr:12}], ['snr8', {snr:8}], ['snr5', {snr:5}], ['snr3', {snr:3}], ['snr0', {snr:0}],
                 ['fade12', {snr:12, fade:0.7}], ['off150', {snr:8, off:150}], ['off-250', {snr:8, off:-250}], ['clock', {snr:8, rate:1.0002}],
                 ['mid12', {snr:12, mid:40}], ['midclk+', {snr:8, mid:40, rate:1.0002}], ['midclk-', {snr:8, mid:40, rate:0.99985}], ['mid6', {snr:6, mid:40}], ['midfade', {snr:10, mid:40, fade:0.7}], ['echo12', {snr:12, echoMs:2, echoA:0.6}], ['crash12', {snr:12, crash:30}]];
  for(const [name, o] of cases){
    const x = synth(img, o), t0 = Date.now(), {F, rows} = decode(x), s = score(o.mid ? img.slice(o.mid) : img, rows);
    console.log(name.padEnd(8), 'corr', s.corr.toFixed(3), 'slant', (F.slant*1e4).toFixed(2)+'e-4', F.slantFrom, 'lpm', F.lpm, F.lpmFrom, 'lines', rows.length, 'snr shown', F.snr, 'status:', F.status.slice(0, 50), '|', F.quality(), (Date.now() - t0) + 'ms');
    if(process.env.PNG) png(tag + '_' + name + '.png', rows);
  }
}
