/* =====================================================================
   BRIEF ME -- the brief read aloud as a spoken briefing

   Uses the speech voices already on the device (Web Speech API): free, no
   key, nothing uploaded, and it works offline once the page is loaded.

   The brief is written for the eye, so it is turned into a script for the
   ear first: X handles, citation numbers and the "searched:" notes are left
   out, the classification chips become words ("From social media:"),
   times are said the military way ("fourteen forty-four Zulu"), and an
   indicator line "A -> B -> C -> likely" becomes "Watch for A. That would
   mean B. First sign: C. Assessed likely."

   Two ways to listen: the full brief, or the key judgements (the bottom
   line, each theatre's assessment, the forecast check and the indicators),
   which takes a couple of minutes.
   ===================================================================== */
(function(){
'use strict';
var synth = window.speechSynthesis;
var BODY = document.getElementById('briefBody'), GO = document.getElementById('bmGo');
if(!BODY || !GO) return;
if(!synth || !window.SpeechSynthesisUtterance){
  GO.disabled = true; GO.title = 'This browser has no speech voices';
  return;
}
function $(id){ return document.getElementById(id); }
function get(k, d){ try{ var v = localStorage.getItem('bm_' + k); return v == null ? d : JSON.parse(v); }catch(_){ return d; } }
function set(k, v){ try{ localStorage.setItem('bm_' + k, JSON.stringify(v)); }catch(_){} }

/* ------------------------------------------------ words for the ear */
var NUM = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
var MONTHS = {jan:'January',feb:'February',mar:'March',apr:'April',may:'May',jun:'June',jul:'July',
              aug:'August',sep:'September',sept:'September',oct:'October',nov:'November',dec:'December'};
var MONTH_N = ['January','February','March','April','May','June','July','August','September','October','November','December'];
/* Acronyms a voice would otherwise read as a word, or get wrong. */
var SAY = {
  'US':'U.S.', 'U.S.':'U.S.', 'USA':'U.S.A.', 'PLA':'P.L.A.', 'PLAN':'P.L.A. Navy', 'KEV':'K.E.V.',
  'ADIZ':'A.D.I.Z.', 'ADS-B':'A.D.S.B.', 'AIS':'A.I.S.', 'IDF':'I.D.F.', 'IRGC':'I.R.G.C.',
  'OSINT':'open source', 'HUMINT':'human intelligence', 'SIGINT':'signals intelligence',
  'EAM':'E.A.M.', 'EAMs':'E.A.M.s', 'HFGCS':'H.F.G.C.S.', 'UAV':'U.A.V.', 'UAS':'U.A.S.', 'ICBM':'I.C.B.M.',
  'SRBM':'S.R.B.M.', 'MRBM':'M.R.B.M.', 'AU':'A.U.', 'EU':'E.U.', 'UN':'U.N.', 'UNSC':'U.N. Security Council',
  'DPRK':'D.P.R.K.', 'ROK':'R.O.K.', 'PRC':'P.R.C.', 'CVE':'C.V.E.', 'CISA':'SISSA', 'NWS':'National Weather Service',
  'FEMA':'FEMA', 'BLUF':'bottom line up front', 'I&W':'indicators and warnings', 'NOTAM':'NOTAM', 'NOTAMs':'NOTAMs',
  'GPS':'G.P.S.', 'TFR':'T.F.R.', 'CENTCOM':'CENTCOM', 'INDOPACOM':'INDOPACOM', 'EUCOM':'EUCOM'
};
function hhmm(h, m){
  h = +h; m = +m;
  var hs = (h < 10 ? 'zero ' : '') + h;
  var ms = m === 0 ? 'hundred' : (m < 10 ? 'zero ' + m : String(m));
  return hs + ' ' + ms;
}
var TODAY = '', YESTERDAY = '';        // the collection day, which needs no saying on every line
function speakable(t){
  t = ' ' + t + ' ';
  t = t.replace(/\(\s*Section\s+\d+\s*\)/gi, '');
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '');
  t = t.replace(/https?:\/\/\S+/g, '');
  /* times: 14:03Z, 1403Z, 13:52–14:42 UTC, ~14:44 UTC */
  t = t.replace(/(\d{1,2}):?(\d{2})\s*[–-]\s*(\d{1,2}):?(\d{2})\s*(?:UTC|Z|GMT)\b/g,
                function(_, a, b, c, d){ return 'from ' + hhmm(a, b) + ' to ' + hhmm(c, d) + ' Zulu'; });
  t = t.replace(/\b(\d{1,2}):(\d{2})\s*(?:UTC|Z|GMT)\b/g, function(_, a, b){ return hhmm(a, b) + ' Zulu'; });
  t = t.replace(/\b([01]\d|2[0-3])([0-5]\d)\s?Z\b/g, function(_, a, b){ return hhmm(a, b) + ' Zulu'; });
  t = t.replace(/\bUTC\b/g, 'Zulu');
  /* dates */
  t = t.replace(/\b(20\d\d)-(\d\d)-(\d\d)\b/g, function(_, y, m, d){ return (+d) + ' ' + MONTH_N[+m - 1] + ' ' + y; });
  t = t.replace(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b\.?/g,
                function(_, d, m){ return d + ' ' + MONTHS[m.toLowerCase()]; });
  if(TODAY){
    t = t.split('(' + TODAY + ')').join('').split(TODAY + ' ').join(TODAY + '\u0001');
    t = t.replace(new RegExp(TODAY + '\u0001\\s*(?=[~\\d]|about|from|zero)', 'g'), '').split('\u0001').join(' ');
    t = t.split('(' + YESTERDAY + ')').join('(yesterday)').replace(new RegExp(YESTERDAY + ' (?=[~\\d]|from)', 'g'), 'yesterday ');
  }
  /* amounts and ranges */
  t = t.replace(/\bNo\s+>\s*(\d)/g, 'No sign of more than $1');
  t = t.replace(/~\s*/g, 'about ');
  t = t.replace(/>\s*=?\s*(?=\d)/g, 'more than ').replace(/<\s*=?\s*(?=\d)/g, 'fewer than ');
  t = t.replace(/(\d)\s*[–-]\s*(\d+)\s*h\b/g, '$1 to $2 hours').replace(/(\d)\s*h\b/g, '$1 hours');
  t = t.replace(/(\d)\s*(?:km|kms)\b/g, '$1 kilometres').replace(/(\d)\s*nm\b/g, '$1 nautical miles')
       .replace(/(\d)\s*kts?\b/g, '$1 knots').replace(/(\d)\s*mi\b/g, '$1 miles');
  t = t.replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2');
  /* symbols */
  t = t.replace(/\s*->\s*|\s*→\s*/g, ', leading to, ').replace(/&/g, ' and ').replace(/\s\/\s/g, ' or ').replace(/([A-Za-z])\/([A-Za-z])/g, '$1 or $2');
  t = t.replace(/\bvs\.?\s/g, 'versus ').replace(/\be\.g\.,?/g, 'for example').replace(/\bi\.e\.,?/g, 'that is');
  t = t.replace(/\bc\.\s(?=\d)/g, 'about ').replace(/\s[·•|]\s/g, ', ');
  t = t.replace(/[*_`#]+/g, '').replace(/\[\s*\d+\s*\]/g, '');
  /* acronyms, whole words only */
  t = t.replace(/(^|[^\w.])(I&W|ADS-B|U\.S\.|[A-Z]{2,}s?)(?=[^\w]|$)/g, function(all, pre, w){
    return SAY[w] ? pre + SAY[w] : all;
  });
  t = t.replace(/about from/g, 'from').replace(/\.{2,}/g, '.');
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
}
/* ALL-CAPS headings are read letter by letter by some voices. */
function headingWords(t){
  t = t.replace(/^\s*(\d+)[.)]\s*/, function(_, n){ return 'Section ' + (NUM[+n] || n) + '. '; }).replace(/\s*\/\s*/g, ', ');
  return t.split(/(\s+|[\/,-])/).map(function(w){
    if(/^[A-Z]{2,}$/.test(w) && !SAY[w] && w.length > 4) return w.charAt(0) + w.slice(1).toLowerCase();
    if(/^[A-Z]{2,4}$/.test(w) && !SAY[w] && !/^(AND|THE|OF|IN)$/.test(w)) return w.charAt(0) + w.slice(1).toLowerCase();
    if(/^(AND|THE|OF|IN)$/.test(w)) return w.toLowerCase();
    return w;
  }).join('');
}

/* Text of an element with the chips, handles and citations dealt with. */
var TAG_SAY = [[/CHATTER|UNVERIF|RUMOU?R/, 'Unverified chatter:'], [/SOCIAL/, 'From social media:'],
               [/VERIFIED|CONFIRM|OFFICIAL/, 'Confirmed:'], [/LOCAL/, 'Locally:'], [/NEWS|WEB|MEDIA|WIRE/, 'Reported:']];
function elText(el){
  var c = el.cloneNode(true);
  c.querySelectorAll('a.cite, sup, .bm-skip').forEach(function(n){ n.remove(); });
  c.querySelectorAll('.cls').forEach(function(n){
    var t = n.textContent.toUpperCase(), s = '';
    for(var i = 0; i < TAG_SAY.length; i++) if(TAG_SAY[i][0].test(t)){ s = TAG_SAY[i][1]; break; }
    n.textContent = s ? s + ' ' : '';
  });
  c.querySelectorAll('.handle').forEach(function(n){ n.textContent = '⦃H⦄'; });
  var t = c.textContent;
  /* runs of handles: "@a, @b, and others" -> one phrase */
  t = t.replace(/⦃H⦄(?:\s*(?:,\s*and|,|and)\s*⦃H⦄)*(?:,?\s*and\s+others)?/g, function(run){
    return (run.match(/⦃H⦄/g).length > 1 || /others/.test(run)) ? '⦃HS⦄' : '⦃H1⦄';
  });
  t = t.replace(/\s*(?:including|such as|like)\s+⦃H[S1]⦄/g, '');       // "accounts including @a" -> "accounts"
  t = t.replace(/(^|[:.]\s*)⦃HS⦄/g, '$1Accounts on X').replace(/(^|[:.]\s*)⦃H1⦄/g, '$1An account on X');
  t = t.replace(/⦃HS⦄/g, 'accounts on X').replace(/⦃H1⦄/g, 'an account on X');
  return t;
}

/* ------------------------------------------------------- the script */
function visible(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
function indicatorLine(t){
  var p = t.split(/\s*(?:->|→)\s*/);
  if(p.length < 3) return null;
  var out = 'Watch for: ' + p[0].replace(/[.;]\s*$/, '') + '. That would mean: ' + p[1].replace(/[.;]\s*$/, '') + '.';
  if(p.length >= 4) out += ' First sign: ' + p[2].replace(/^first\s+(in|on|from)\s+/i, '').replace(/[.;]\s*$/, '') + '.';
  out += ' Assessed: ' + p[p.length - 1].replace(/[.;]\s*$/, '') + '.';
  return out;
}
function build(mode){
  var items = [], zone = '';
  function add(el, text, kind){
    text = speakable(text);
    if(text.length < 2) return;
    items.push({el:el, text:text, kind:kind});
  }
  var when = new Date(typeof COLLECTED_AT !== 'undefined' && COLLECTED_AT ? COLLECTED_AT :
                      (typeof BUILT_AT !== 'undefined' ? BUILT_AT : Date.now()));
  var open = 'The Trident Brief, from Appalachian Intel.';
  if(!isNaN(when)){
    TODAY = when.getUTCDate() + ' ' + MONTH_N[when.getUTCMonth()];
    var yd = new Date(when - 86400000); YESTERDAY = yd.getUTCDate() + ' ' + MONTH_N[yd.getUTCMonth()];
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    open += ' Collected ' + days[when.getUTCDay()] + ', ' + when.getUTCDate() + ' ' + MONTH_N[when.getUTCMonth()] +
            ', at ' + hhmm(when.getUTCHours(), when.getUTCMinutes()) + ' Zulu.';
    var age = (Date.now() - when)/3600000;
    if(age > 14) open += ' Note: this collection is ' + Math.round(age) + ' hours old.';
  }
  if(mode === 'quick') open += ' Key judgements follow.';
  items.push({el:null, text:open, kind:'open'});

  var nodes = BODY.querySelectorAll('h2, h3, h4, p, li, blockquote, tr');
  Array.prototype.forEach.call(nodes, function(el){
    if(!visible(el) || el.closest('.bm-skip')) return;
    if(el.tagName === 'LI' && el.parentElement.closest('li')) return;      // nested lists read with their parent
    if(el.tagName === 'P' && el.closest('li, blockquote, td, th')) return;
    var raw = el.textContent.trim();
    if(!raw) return;
    var tag = el.tagName;
    if(/^H[2-4]$/.test(tag)){
      zone = /indicator/i.test(raw) ? 'iw' : /forecast/i.test(raw) ? 'fc' : /gap/i.test(raw) ? 'gap' : '';
      add(el, headingWords(raw) + '.', tag === 'H2' ? 'H2' : 'H3');
      return;
    }
    if(/^(searched|leads worked)\b/i.test(raw)) return;      // the collector's own notes
    /* a bold line that works as a heading, e.g. **INDICATORS AND WARNINGS** */
    if(tag === 'P' && /^[A-Z][A-Z &\/-]{5,}:?$/.test(raw)){
      zone = /indicator/i.test(raw) ? 'iw' : /forecast/i.test(raw) ? 'fc' : /gap/i.test(raw) ? 'gap' : zone;
      add(el, headingWords(raw.replace(/:$/, '')) + '.', 'H3');
      return;
    }
    var bluf = el.classList.contains('bluf') || /^BLUF\b/i.test(raw);
    var assess = /^(Assessment|Judg(e)?ment|Outlook)\s*:/i.test(raw);
    if(mode === 'quick' && !(bluf || assess || zone === 'iw' || zone === 'fc')) return;
    var text = elText(el);
    if(bluf) text = text.replace(/^\s*BLUF\s*:?\s*/i, 'Bottom line up front. ');
    else if(assess) text = text.replace(/^\s*Assessment\s*:\s*/i, 'Assessment: ');
    if(zone === 'iw' && tag === 'LI'){ var il = indicatorLine(text); if(il) text = il; }
    if(zone === 'fc' && tag === 'LI'){
      var n = Array.prototype.indexOf.call(el.parentElement.children, el) + 1;
      text = text.replace(/^\s*(NOT TRIGGERED|TRIGGERED|OPEN|EXPIRED|PARTIAL(?:LY)?(?: TRIGGERED)?)\s*[-–—:]\s*/i,
                          function(_, s){ return 'Forecast ' + (NUM[n] || n) + ': ' + s.toLowerCase() + '. '; });
    }
    if(tag === 'TR'){
      text = Array.prototype.map.call(el.children, function(td){ return td.textContent.trim(); }).filter(Boolean).join(', ') + '.';
      if(el.closest('thead')) return;
    }
    add(el, text, bluf ? 'bluf' : assess ? 'assess' : 'item');
  });
  items.push({el:null, text:'End of brief.', kind:'end'});
  /* quick mode: drop theatre headings with nothing under them */
  if(mode === 'quick') items = items.filter(function(it, i){
    if(it.kind !== 'H3' && it.kind !== 'H2') return true;
    var nx = items[i + 1]; return nx && nx.kind !== 'H3' && nx.kind !== 'H2' && nx.kind !== 'end';
  });
  return items;
}
/* long text in sentence-sized pieces: some engines stop partway through a
   long utterance, and a piece is also the unit pause/resume works from */
function pieces(text){
  var s = text.match(/[^.!?;:]+(?:[.!?;:]+(?=\s|$)|$)/g) || [text], out = [], cur = '';
  s.forEach(function(x){
    x = x.trim(); if(!x) return;
    if((cur + ' ' + x).length > 220 && cur){ out.push(cur); cur = x; }
    else cur = cur ? cur + ' ' + x : x;
  });
  if(cur) out.push(cur);
  return out;
}

/* ------------------------------------------------------------ voices */
function rankVoice(v){
  var n = v.name, s = 0;
  if(!/^en/i.test(v.lang)) return -1;
  if(/natural|neural|premium|enhanced|wavenet|studio/i.test(n)) s += 50;
  if(/Google (US|UK) English|Samantha|Daniel|Karen|Moira|Serena|Arthur|Aria|Jenny|Guy|Ryan|Sonia|Ava|Evan|Zoe|Nathan|Tom/i.test(n)) s += 20;
  if(/^en[-_]US/i.test(v.lang)) s += 6; else if(/^en[-_]GB/i.test(v.lang)) s += 5;
  if(v.localService) s += 2;                                  // works offline
  if(/compact|espeak|novelty|whisper|bad news|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|zarvox|albert|fred|junior|ralph|kathy|bahh|wobble/i.test(n)) s -= 60;
  return s;
}
var voices = [];
function loadVoices(){
  voices = synth.getVoices().filter(function(v){ return rankVoice(v) >= 0; })
                            .sort(function(a, b){ return rankVoice(b) - rankVoice(a); });
  var sel = $('bmVoice'); if(!sel) return;
  var want = get('voice', '');
  sel.innerHTML = voices.length ? voices.map(function(v, i){
    return '<option value="' + i + '"' + (v.name === want ? ' selected' : '') + '>' +
           v.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*\(.*?\)\s*/g, ' ').trim() + ' · ' + v.lang + '</option>';
  }).join('') : '<option>device default</option>';
}
function voice(){ var i = +($('bmVoice') && $('bmVoice').value); return voices[i] || voices[0] || null; }

/* ------------------------------------------------------------ player */
var P = {items:[], i:0, k:0, parts:[], playing:false, gen:0, mode:get('mode', 'full'), rate:get('rate', 1), lock:null, userScroll:0};
function words(items){ return items.reduce(function(a, it){ return a + it.text.split(/\s+/).length; }, 0); }
function mins(n){ var m = n/(160*P.rate); return m < 1 ? 'under a minute' : Math.round(m) + ' min'; }

function mark(){
  document.querySelectorAll('.bm-now').forEach(function(e){ e.classList.remove('bm-now'); });
  var it = P.items[P.i]; if(!it) return;
  if(it.el){
    it.el.classList.add('bm-now');
    if(Date.now() - P.userScroll > 6000){
      var r = it.el.getBoundingClientRect();
      if(r.top < 90 || r.bottom > innerHeight - 120) it.el.scrollIntoView({block:'center', behavior:'smooth'});
    }
  }
  var secs = P.items.filter(function(x){ return x.kind === 'H2' || x.kind === 'H3'; });
  var here = 0; for(var j = 0; j <= P.i; j++) if(P.items[j].kind === 'H2' || P.items[j].kind === 'H3') here++;
  var left = words(P.items.slice(P.i));
  $('bmWhere').textContent = (here ? 'section ' + here + ' of ' + secs.length : 'opening') + ' · ' + mins(left) + ' left';
  $('bmFill').style.width = (P.items.length > 1 ? P.i/(P.items.length - 1)*100 : 0) + '%';
}
function sayNext(){
  var gen = P.gen;
  if(!P.playing) return;
  var it = P.items[P.i];
  if(!it){ stop(true); return; }
  if(!P.parts.length) P.parts = pieces(it.text);
  if(P.k >= P.parts.length){
    /* a beat between items, a longer one after a heading */
    var gap = it.kind === 'H2' ? 750 : it.kind === 'H3' || it.kind === 'open' ? 550 : 320;
    P.i++; P.k = 0; P.parts = [];
    if(P.i >= P.items.length){ stop(true); return; }
    mark();
    setTimeout(function(){ if(gen === P.gen) sayNext(); }, gap);
    return;
  }
  var u = new SpeechSynthesisUtterance(P.parts[P.k]);
  var v = voice(); if(v){ u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
  u.rate = P.rate; u.pitch = it.kind === 'H2' || it.kind === 'H3' ? 0.95 : 1;
  u.onend = function(){ if(gen !== P.gen) return; P.k++; sayNext(); };
  u.onerror = function(e){ if(gen !== P.gen || e.error === 'interrupted' || e.error === 'canceled') return; P.k++; sayNext(); };
  synth.speak(u);
}
function play(){
  if(!P.items.length) P.items = build(P.mode);
  if(P.i >= P.items.length){ P.i = 0; }
  P.gen++; synth.cancel(); P.playing = true; P.parts = []; P.k = 0;
  $('bmPlay').innerHTML = '&#10074;&#10074;'; $('bmPlay').title = 'pause';
  mark(); awake(true);
  var gen = P.gen;
  setTimeout(function(){ if(gen === P.gen) sayNext(); }, 60);     // after cancel settles (Safari)
}
function pause(){
  P.gen++; P.playing = false; synth.cancel();
  $('bmPlay').innerHTML = '&#9654;'; $('bmPlay').title = 'play';
  awake(false);
}
function stop(done){
  pause();
  document.querySelectorAll('.bm-now').forEach(function(e){ e.classList.remove('bm-now'); });
  if(done){ P.i = 0; $('bmWhere').textContent = 'finished · play to hear it again'; $('bmFill').style.width = '100%'; }
}
function jump(to){
  P.i = Math.max(0, Math.min(P.items.length - 1, to)); P.k = 0; P.parts = [];
  if(P.playing) play(); else mark();
}
function jumpSection(dir){
  var isHead = function(x){ return x.kind === 'H2' || x.kind === 'H3' || x.kind === 'open'; };
  var j = P.i;
  if(dir < 0){
    /* back to the start of this section, or the previous one if already there */
    j--; while(j > 0 && !isHead(P.items[j])) j--;
    if(j >= P.i - 1){ j--; while(j > 0 && !isHead(P.items[j])) j--; }
  } else { j++; while(j < P.items.length - 1 && !isHead(P.items[j])) j++; }
  jump(Math.max(0, j));
}
function awake(on){
  try{
    if(on && navigator.wakeLock && !P.lock) navigator.wakeLock.request('screen').then(function(l){ P.lock = l; l.addEventListener('release', function(){ P.lock = null; }); }).catch(function(){});
    if(!on && P.lock){ P.lock.release(); P.lock = null; }
  }catch(_){}
}
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState === 'visible' && P.playing && !P.lock) awake(true);
});

/* ---------------------------------------------------------------- UI */
function open(){
  var bar = $('bmBar');
  bar.hidden = false; document.body.classList.add('bm-on');
  loadVoices();
  P.items = build(P.mode); P.i = 0; P.k = 0; P.parts = [];
  $('bmMode').value = P.mode; $('bmRate').value = String(P.rate);
  play();
}
function close(){ stop(false); $('bmBar').hidden = true; document.body.classList.remove('bm-on'); }
GO.onclick = function(){ $('bmBar').hidden ? open() : (P.playing ? pause() : play()); };
$('bmPlay').onclick = function(){ P.playing ? pause() : play(); };
$('bmPrev').onclick = function(){ jump(P.i - 1); };
$('bmNext').onclick = function(){ jump(P.i + 1); };
$('bmSecPrev').onclick = function(){ jumpSection(-1); };
$('bmSecNext').onclick = function(){ jumpSection(1); };
$('bmClose').onclick = close;
$('bmRate').onchange = function(){ P.rate = +this.value; set('rate', P.rate); if(P.playing){ P.k = 0; P.parts = []; play(); } else mark(); };
$('bmVoice').onchange = function(){ var v = voice(); if(v) set('voice', v.name); if(P.playing){ P.parts = []; P.k = 0; play(); } };
$('bmMode').onchange = function(){
  P.mode = this.value; set('mode', P.mode);
  var el = P.items[P.i] && P.items[P.i].el;
  P.items = build(P.mode);
  /* carry on from the same place where it still exists */
  var at = 0; if(el) for(var j = 0; j < P.items.length; j++) if(P.items[j].el === el){ at = j; break; }
  jump(at);
};
$('bmProg').onclick = function(e){
  var r = this.getBoundingClientRect(); jump(Math.round((e.clientX - r.left)/r.width*(P.items.length - 1)));
};
/* while the player is open, tap any line of the brief to read from there */
BODY.addEventListener('click', function(e){
  if($('bmBar').hidden || e.target.closest('a, button, input, select')) return;
  var el = e.target.closest('h2, h3, h4, p, li, blockquote, tr');
  for(var j = 0; el && j < P.items.length; j++) if(P.items[j].el === el){ jump(j); if(!P.playing) play(); return; }
});
['wheel', 'touchmove'].forEach(function(ev){ addEventListener(ev, function(){ P.userScroll = Date.now(); }, {passive:true}); });
if(synth.onvoiceschanged !== undefined) synth.addEventListener ? synth.addEventListener('voiceschanged', loadVoices) : (synth.onvoiceschanged = loadVoices);
loadVoices();
addEventListener('pagehide', function(){ synth.cancel(); });
/* Chrome keeps speaking after a reload unless told otherwise */
synth.cancel();

window.BRIEFME = {build:build, speakable:speakable, state:P};
})();
