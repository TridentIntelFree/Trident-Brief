/* The Crystal Ball's oracle: a glass ball on a bronze stand, smoke turning
   inside it, and one glowing orb for each forecast, brighter and larger the
   likelier it is. Touch an orb to read its forecast. Everything is drawn in
   the browser with the three.js the globe already loads; it costs nothing to
   run, and it sleeps whenever it is off screen. */
import * as THREE from './three.module.js';

const GLOW = {high: new THREE.Color('#ffcf6b'), mid: new THREE.Color('#ff7ad9'), low: new THREE.Color('#7fd0ff')};
export const orbColor = p => p >= 65 ? GLOW.high : p >= 40 ? GLOW.mid : GLOW.low;

function glowTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.18, 'rgba(255,255,255,.85)');
  r.addColorStop(0.42, 'rgba(255,255,255,.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* a candle-lit room the glass can reflect, made once and never shown */
function environment(renderer){
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 d; void main(){
      vec3 c = mix(vec3(.02,.01,.04), vec3(.18,.06,.28), smoothstep(-.2,.9,d.y));
      c += vec3(1.,.55,.18)*pow(max(dot(d, normalize(vec3(-.8,.1,.6))),0.),18.)*3.;   // candle
      c += vec3(.45,.35,1.)*pow(max(dot(d, normalize(vec3(.9,.4,-.3))),0.),10.)*1.4; // moonlit window
      gl_FragColor = vec4(c,1.); }`
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.02).texture; pm.dispose();
  return tex;
}

const NOISE = `
float h(vec3 p){ p = fract(p*.3183099+.1); p *= 17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x), mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x), mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a = .5, s = 0.; for(int i = 0; i < 4; i++){ s += a*n3(p); p = p*2.03+vec3(1.7,9.2,3.1); a *= .5; } return s; }`;

/* the smoke: a ray marched through a sphere of turning noise */
function smoke(radius){
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {uTime: {value: 0}, uCenter: {value: new THREE.Vector3()}, uR: {value: radius}, uStir: {value: 0}},
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: NOISE + `
      uniform float uTime, uR, uStir; uniform vec3 uCenter; varying vec3 vW;
      void main(){
        vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition), oc = ro - uCenter;
        float b = dot(oc, rd), c = dot(oc, oc) - uR*uR, disc = b*b - c;
        if(disc < 0.) discard;
        float t0 = -b - sqrt(disc), t1 = -b + sqrt(disc), dt = (t1 - t0)/26.;
        vec3 col = vec3(0.); float a = 0.;
        for(int i = 0; i < 26; i++){
          vec3 p = (ro + rd*(t0 + dt*(float(i)+.5))) - uCenter;
          float r = length(p)/uR, ang = uTime*.18 + r*2.2 + uStir;
          mat2 m = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
          vec3 q = vec3(m*p.xz, p.y*1.35 - uTime*.05);
          float d = fbm(q*1.9 + vec3(0., uTime*.07, 0.));
          d = smoothstep(.42, .85, d)*(1. - smoothstep(.55, 1., r));
          vec3 tint = mix(vec3(.45,.18,.9), vec3(1.,.38,.82), smoothstep(.2,.9,fbm(q*.9 + 3.)));
          tint = mix(tint, vec3(.35,.85,1.), smoothstep(.75,.95,d)*.6);
          float k = d*dt*2.6;
          col += (1. - a)*tint*k*1.6; a += (1. - a)*k;
        }
        gl_FragColor = vec4(col, a*.92);
      }`
  });
}

/* the glass: reflections added on top, and a pale rim where the glass turns away */
function rimMaterial(){
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN, vV; void main(){ vec4 w = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `varying vec3 vN, vV; void main(){
      float f = pow(1. - max(dot(normalize(vN), normalize(vV)), 0.), 3.);
      gl_FragColor = vec4(vec3(.75,.65,1.)*f*.9, f); }`
  });
}

function stand(){
  const g = new THREE.Group();
  const bronze = new THREE.MeshStandardMaterial({color: 0x8c6a3c, metalness: 1, roughness: .32});
  const dark = new THREE.MeshStandardMaterial({color: 0x2a1a10, metalness: .6, roughness: .5});
  const prof = [[0,-1.62],[.98,-1.62],[1.02,-1.56],[.96,-1.5],[.7,-1.44],[.52,-1.3],[.5,-1.2],[.62,-1.12],[.7,-1.02],[.66,-.94],[0,-.94]]
    .map(p => new THREE.Vector2(p[0], p[1]));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 96), bronze));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.69, .035, 16, 96), bronze); ring.rotation.x = Math.PI/2; ring.position.y = -.98; g.add(ring);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.53, .53, .07, 96, 1, true), dark); band.position.y = -1.25; g.add(band);
  return g;
}

function dust(n){
  const pos = new Float32Array(n*3), seed = new Float32Array(n);
  for(let i = 0; i < n; i++){ pos[i*3] = (Math.random()-.5)*7; pos[i*3+1] = (Math.random()-.5)*4.4; pos[i*3+2] = (Math.random()-.5)*3 - .6; seed[i] = Math.random()*6.28; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  return new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uTime: {value: 0}, uPx: {value: 1}},
    vertexShader: `attribute float seed; uniform float uTime, uPx; varying float vA;
      void main(){ vec3 p = position; p.y += mod(uTime*.05 + seed, 4.4) - 2.2 - position.y*.0; p.x += sin(uTime*.3 + seed)*.15;
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
        vA = .35 + .35*sin(uTime*1.3 + seed*3.);
        gl_PointSize = uPx*(2.2 + 1.6*fract(seed*7.))*(4./-mv.z); }`,
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - .5); if(d > .5) discard; gl_FragColor = vec4(1.,.78,.45, vA*(1. - d*2.)); }'
  }));
}

/* mount(el, items, onPick): items are {p} with p in 0..100. Returns an
   object with select(i) and destroy(), or null where WebGL is missing. */
export function mount(el, items, onPick){
  let renderer;
  try{ renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'high-performance'}); }
  catch(e){ return null; }
  if(!renderer.getContext()) return null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(34, 1, .1, 50);
  cam.position.set(0, .35, 5.6); cam.lookAt(0, -.2, 0);
  scene.environment = environment(renderer);
  const candle = new THREE.PointLight(0xffa64d, 6, 9, 1.6); candle.position.set(-2.2, .4, 2.2); scene.add(candle);
  scene.add(new THREE.AmbientLight(0x2a1640, .6));

  const ball = new THREE.Group(); scene.add(ball);
  const R = 1;
  const fog = new THREE.Mesh(new THREE.SphereGeometry(R*.97, 64, 48), smoke(R*.95)); fog.renderOrder = 1; ball.add(fog);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(R*.985, 64, 48), new THREE.MeshBasicMaterial({color: 0x1a0830, transparent: true, opacity: .28, side: THREE.BackSide, depthWrite: false}));
  inner.renderOrder = 0; ball.add(inner);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, roughness: .03, clearcoat: 1, clearcoatRoughness: .02, envMapIntensity: 2.2,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}));
  shine.renderOrder = 4; ball.add(shine);
  const rim = new THREE.Mesh(new THREE.SphereGeometry(R*1.004, 96, 64), rimMaterial()); rim.renderOrder = 5; ball.add(rim);
  scene.add(stand());
  const motes = dust(260); scene.add(motes);

  // the orbs, one for each forecast
  const tex = glowTexture(), orbs = [];
  items.forEach((it, i) => {
    const p = Math.max(1, Math.min(99, +it.p || 0)), col = orbColor(p);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .55 + p/250}));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .9}));
    const s = .2 + p/100*.34; halo.scale.setScalar(s); core.scale.setScalar(s*.32);
    const o = new THREE.Group(); o.add(halo); o.add(core); o.renderOrder = 3; halo.renderOrder = core.renderOrder = 3;
    o.userData = {i, s, halo, core, r: .28 + .42*((i*.618) % 1), w: (.12 + .1*((i*.37) % 1))*(i % 2 ? 1 : -1),
                  ph: i*2.399, tilt: .35 + .5*((i*.71) % 1), bob: .9 + .7*((i*.43) % 1)};
    ball.add(o); orbs.push(o);
  });
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, color: 0xb98cff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .35}));
  heart.scale.setScalar(.9); heart.renderOrder = 2; ball.add(heart);

  let sel = -1, w = 0, h = 0, raf = 0, visible = true, t0 = performance.now(), last = t0, spin = 0, drag = null, stir = 0;
  function size(){
    const r = el.getBoundingClientRect(); w = Math.max(1, r.width); h = Math.max(1, r.height);
    renderer.setSize(w, h, false); cam.aspect = w/h;
    cam.position.z = w/h < .8 ? 7.4 : 5.6; cam.updateProjectionMatrix();
    motes.material.uniforms.uPx.value = renderer.getPixelRatio();
  }
  size();
  const ro = new ResizeObserver(size); ro.observe(el);
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if(visible && !raf) raf = requestAnimationFrame(frame); });
  io.observe(el);

  function frame(now){
    raf = 0;
    if(!visible || !el.isConnected) return;
    const t = (now - t0)/1000, dt = Math.min(.05, (now - last)/1000); last = now;
    if(!drag) spin += dt*.12;
    stir *= .96;
    ball.rotation.y = spin; ball.position.y = Math.sin(t*.6)*.03;
    fog.material.uniforms.uTime.value = t; fog.material.uniforms.uStir.value = stir;
    fog.material.uniforms.uCenter.value.setFromMatrixPosition(ball.matrixWorld);
    motes.material.uniforms.uTime.value = t;
    candle.intensity = 6 + Math.sin(t*7.1)*.5 + Math.sin(t*13.3)*.35 + (Math.random() - .5)*.4;
    heart.material.opacity = .28 + .08*Math.sin(t*1.7);
    orbs.forEach(o => {
      const u = o.userData, a = u.ph + t*u.w;
      const target = u.i === sel ? new THREE.Vector3(0, .05, .55).applyAxisAngle(new THREE.Vector3(0, 1, 0), -spin) : null;
      const pos = target || new THREE.Vector3(Math.cos(a)*u.r, Math.sin(a*u.bob)*u.r*u.tilt, Math.sin(a)*u.r);
      o.position.lerp(pos, target ? .08 : .2);
      const k = u.i === sel ? 1.7 + .15*Math.sin(t*5) : (sel >= 0 ? .75 : 1) * (1 + .08*Math.sin(t*2 + u.ph));
      u.halo.scale.setScalar(u.s*k); u.core.scale.setScalar(u.s*.32*k);
      u.halo.material.opacity = (sel >= 0 && u.i !== sel ? .3 : .6) + (+items[u.i].p || 0)/300;
    });
    renderer.render(scene, cam);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // touch: drag turns the ball, a tap picks the nearest orb
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const cv = renderer.domElement; cv.style.touchAction = 'pan-y'; cv.style.cursor = 'pointer';
  cv.addEventListener('pointerdown', e => { drag = {x: e.clientX, y: e.clientY, s: spin, moved: false}; });
  cv.addEventListener('pointermove', e => {
    if(!drag) return;
    const dx = e.clientX - drag.x;
    if(Math.abs(dx) > 5){ drag.moved = true; spin = drag.s + dx*.008; stir = Math.max(-1.5, Math.min(1.5, dx*.004)); }
  });
  const up = e => {
    const d = drag; drag = null;
    if(!d || d.moved) return;
    const r = cv.getBoundingClientRect();
    ndc.set((e.clientX - r.left)/r.width*2 - 1, -(e.clientY - r.top)/r.height*2 + 1);
    ray.setFromCamera(ndc, cam);
    let best = -1, bd = 1e9;                    // the orb nearest the tap, on screen
    orbs.forEach(o => {
      const v = o.getWorldPosition(new THREE.Vector3()).project(cam);
      const dd = Math.hypot((v.x - ndc.x)*w/2, (v.y - ndc.y)*h/2);
      if(dd < bd){ bd = dd; best = o.userData.i; }
    });
    if(best >= 0 && bd < 46){ stir = .9; api.select(best); onPick && onPick(best); }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', () => { drag = null; });

  const api = {
    select(i){ sel = i; },
    destroy(){ cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); cv.remove(); }
  };
  return api;
}

/* ------------------------------------------------------------- the heavens
   A real sky, read the old way. Where the sun, moon and planets stand comes
   from Astronomy Engine (assets/astronomy.min.js, MIT, by Don Cross), for this
   moment, as seen from Earth. What it is said to mean is astrology: folklore,
   for amusement, and labelled so on the page. */
const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
const SGLYPH = ['♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'];
const SIGN_SAYS = {
  Aries: 'bold first strikes and short tempers', Taurus: 'stubbornness and holding ground', Gemini: 'rumour, chatter and mixed signals',
  Cancer: 'defending home turf', Leo: 'pride, parades and grand gestures', Virgo: 'logistics, fixes and fine print',
  Libra: 'diplomacy, deals and the search for balance', Scorpio: 'secrets, grudges and intelligence work',
  Sagittarius: 'big claims and long reaches', Capricorn: 'institutions and hard power', Aquarius: 'networks, machines and upheaval',
  Pisces: 'fog, illusion and what goes unseen'};
const BODIES = [['Sun','☉','the main stage'], ['Moon','☽','the public mood'], ['Mercury','☿','signals, messages and deals'],
  ['Venus','♀','alliances and money'], ['Mars','♂','war and force'], ['Jupiter','♃','expansion and luck'],
  ['Saturn','♄','limits and consequences'], ['Uranus','♅','shocks and new machines'], ['Neptune','♆','deception and fog'],
  ['Pluto','♇','buried power']];
const RETRO_SAYS = {
  Mercury: 'Mercury is retrograde: the classic season of garbled messages and walked-back statements. Read every headline twice.',
  Venus: 'Venus is retrograde: old alliances get re-examined and money decisions get second thoughts.',
  Mars: 'Mars is retrograde: offensives stall, and old fights flare back up.',
  Jupiter: 'Jupiter is retrograde: grand plans shrink back to what can actually be done.',
  Saturn: 'Saturn is retrograde: old debts and unfinished business come back around.',
  Uranus: 'Uranus is retrograde: the shocks are aftershocks of earlier ones.',
  Neptune: 'Neptune is retrograde: some of the fog lifts, and a deception or two shows through.',
  Pluto: 'Pluto is retrograde: power struggles move out of sight.'};
const ASPECTS = [['conjunction', 0, 8, 'fuses with', '#ffd27a'], ['sextile', 60, 4, 'opens a door to', '#7fd0ff'], ['square', 90, 6, 'grinds against', '#ff6b6b'],
                 ['trine', 120, 6, 'flows easily with', '#7fd0ff'], ['opposition', 180, 8, 'faces off against', '#ff6b6b']];
const MOON_SAYS = [['New Moon', 'beginnings in the dark: what starts now is not yet visible'], ['Waxing Crescent', 'intentions gathering strength'],
  ['First Quarter', 'a test of resolve, a decision point'], ['Waxing Gibbous', 'pressure building toward a peak'],
  ['Full Moon', 'climax and revelation: what was hidden comes out'], ['Waning Gibbous', 'the aftermath being digested'],
  ['Last Quarter', 'a reckoning, and letting go of what failed'], ['Waning Crescent', 'exhaustion and quiet before the next cycle']];

function geoLon(A, name, t){
  if(name === 'Sun') return A.SunPosition(t).elon;
  if(name === 'Moon') return A.EclipticGeoMoon(t).lon;
  return A.Ecliptic(A.GeoVector(name, t, true)).elon;
}

export function heavens(A, when){
  const t = when || new Date(), bodies = BODIES.map(([name, glyph, rules]) => {
    const lon = geoLon(A, name, t), a = geoLon(A, name, new Date(+t - 432e5)), b = geoLon(A, name, new Date(+t + 432e5));
    const s = Math.floor(lon/30) % 12;
    return {name, glyph, rules, lon, sign: SIGNS[s], sg: SGLYPH[s], deg: lon - s*30,
            retro: name !== 'Sun' && name !== 'Moon' && (((b - a + 540) % 360) - 180) < 0};
  });
  const ph = A.MoonPhase(t), mi = Math.floor(((ph + 22.5) % 360)/45);
  const moon = {angle: ph, name: MOON_SAYS[mi][0], says: MOON_SAYS[mi][1], lit: A.Illumination('Moon', t).phase_fraction};
  const aspects = [];
  for(let i = 0; i < bodies.length; i++) for(let j = i + 1; j < bodies.length; j++){
    const d = Math.abs(((bodies[i].lon - bodies[j].lon + 540) % 360) - 180);
    for(const [type, ang, orb, verb, col] of ASPECTS){
      const off = Math.abs(d - ang);
      if(off <= orb) aspects.push({a: bodies[i], b: bodies[j], type, verb, col, off, hard: type === 'square' || type === 'opposition'});
    }
  }
  aspects.sort((x, y) => x.off - y.off);
  return {at: t, bodies, moon, aspects};
}

export function reading(sky, ball){
  const B = Object.fromEntries(sky.bodies.map(b => [b.name, b])), say = s => SIGN_SAYS[s];
  const out = [];
  out.push(`The Sun crosses ${B.Sun.sign}, so the world's stage favours ${say(B.Sun.sign)}. The Moon is a ${sky.moon.name.toLowerCase()} in ${B.Moon.sign} (${Math.round(sky.moon.lit*100)}% lit): ${sky.moon.says}, with the public mood leaning toward ${say(B.Moon.sign)}.`);
  out.push(`Mars, the war-bringer, stands in ${B.Mars.sign}: expect ${say(B.Mars.sign)} wherever force is used. ` +
           (sky.bodies.filter(b => b.retro).map(b => RETRO_SAYS[b.name]).join(' ') || 'No planet is retrograde; the sky, at least, is moving forward.'));
  const top = sky.aspects.filter(x => x.a.name !== 'Moon' && x.b.name !== 'Moon').slice(0, 3);
  if(top.length) out.push(top.map(x => `${x.a.name} ${x.verb} ${x.b.name} (${x.type}, ${x.off.toFixed(1)}° from exact): ${x.a.rules} meets ${x.b.rules}.`).join(' '));
  const hard = sky.aspects.filter(x => x.hard).length, soft = sky.aspects.length - hard;
  const best = (ball && ball.forecasts || []).slice().sort((x, y) => y.probability - x.probability)[0];
  out.push(`The verdict: ${hard} hard aspects against ${soft} easy ones, so the heavens call the week ${hard > soft + 1 ? 'tense' : soft > hard + 1 ? 'smoother than it looks' : 'finely balanced'}.` +
           (best ? ` The stars have no idea what is happening in ${best.region || 'the world'}, but the ball rates its likeliest vision there at ${best.probability}%.` : ''));
  return out;
}

/* the chart: signs round the rim, each body at its real longitude, aspect lines between them */
export function wheel(sky){
  const C = 160, R1 = 150, R2 = 122, RP = 100, RA = 74, pt = (lon, r) => {
    const a = Math.PI - lon*Math.PI/180;             // Aries at the left, signs running anticlockwise, as charts are drawn
    return [C + r*Math.cos(a), C - r*Math.sin(a)];
  };
  let s = `<svg viewBox="0 0 320 320" class="or-wheel" role="img" aria-label="tonight's chart"><defs>
    <radialGradient id="orWg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#2a0f45"/><stop offset=".7" stop-color="#12061f"/><stop offset="1" stop-color="#07030d"/></radialGradient>
    <filter id="orGlow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <circle cx="${C}" cy="${C}" r="${R1}" fill="url(#orWg)" stroke="#c9a45c" stroke-width="1.4"/>
    <circle cx="${C}" cy="${C}" r="${R2}" fill="none" stroke="#c9a45c" stroke-opacity=".6"/>
    <circle cx="${C}" cy="${C}" r="${RA}" fill="none" stroke="#c9a45c" stroke-opacity=".25"/>`;
  for(let i = 0; i < 12; i++){
    const [x1, y1] = pt(i*30, R2), [x2, y2] = pt(i*30, R1), [gx, gy] = pt(i*30 + 15, (R1 + R2)/2);
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c9a45c" stroke-opacity=".6"/>` +
         `<text x="${gx}" y="${gy}" class="or-sg" text-anchor="middle" dominant-baseline="central">${SGLYPH[i]}︎</text>`;
  }
  sky.aspects.filter(x => x.off < 6).forEach(x => {
    const [ax, ay] = pt(x.a.lon, RA), [bx, by] = pt(x.b.lon, RA);
    s += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${x.col}" stroke-opacity="${(.85 - x.off/10).toFixed(2)}" stroke-width="1.2" filter="url(#orGlow)"/>`;
  });
  // spread bodies that sit on top of each other
  const placed = [];
  sky.bodies.slice().sort((a, b) => a.lon - b.lon).forEach(b => {
    let r = RP; while(placed.some(p => Math.abs(((p.lon - b.lon + 540) % 360) - 180) < 9 && p.r === r)) r -= 17;
    placed.push({lon: b.lon, r});
    const [x, y] = pt(b.lon, r), [tx, ty] = pt(b.lon, R2 - 3), [ax, ay] = pt(b.lon, RA);
    s += `<line x1="${tx}" y1="${ty}" x2="${x}" y2="${y}" stroke="#f4d58d" stroke-opacity=".35"/>` +
         `<circle cx="${ax}" cy="${ay}" r="2" fill="#f4d58d"/>` +
         `<text x="${x}" y="${y}" class="or-pl${b.retro ? ' rx' : ''}" text-anchor="middle" dominant-baseline="central" filter="url(#orGlow)">${b.glyph}︎</text>` +
         (b.retro ? `<text x="${x + 9}" y="${y + 8}" class="or-rx">R</text>` : '');
  });
  return s + '</svg>';
}

/* the moon as it looks tonight */
export function moonFace(sky){
  const f = sky.moon.lit, waxing = sky.moon.angle < 180, r = 26, k = 1 - 2*f;   // the shadow's edge, as an ellipse
  const d = `M 30 ${30 - r} A ${r} ${r} 0 0 ${waxing ? 1 : 0} 30 ${30 + r} A ${Math.abs(k*r)} ${r} 0 0 ${(k > 0) === waxing ? 0 : 1} 30 ${30 - r}`;
  return `<svg viewBox="0 0 60 60" class="or-moon"><defs><radialGradient id="orMn" cx="40%" cy="35%"><stop offset="0" stop-color="#fff8e1"/><stop offset="1" stop-color="#d9c79a"/></radialGradient></defs>
    <circle cx="30" cy="30" r="${r}" fill="#1b1230" stroke="#c9a45c" stroke-opacity=".4"/><path d="${d}" fill="url(#orMn)"/></svg>`;
}
