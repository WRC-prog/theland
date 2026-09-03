/*  약속의 땅 — 웹판
 *
 *  아이폰 앱과 **같은 자료**를 읽는다. data/*.json 은 앱 소스에서 그대로
 *  뽑아낸 것이고(tools/export_web.py), 지형은 앱이 쓰는 실측 높이 자료를
 *  브라우저가 읽을 수 있게 PNG 로 구운 것이다.
 *
 *  높이는 그림의 R·G 두 칸에 담겨 있다 —  미터 = R×256 + G − 6000.
 *  브라우저가 16비트 PNG 를 8비트로 깎아 버리기 때문에 이렇게 나눠 담았다.
 */
'use strict';

// ── 뜨는 동안 보여 줄 것 ────────────────────────────────────
const boot = document.getElementById('boot');
const bootMsg = document.getElementById('bootmsg');
const bootBar = document.querySelector('#bar i');
const bootErr = document.getElementById('booterr');
function say(t, pct) { bootMsg.textContent = t; if (pct != null) bootBar.style.width = pct + '%'; }
function die(t, e) {
  boot.classList.add('err');
  boot.querySelector('h1').textContent = '열지 못했습니다';
  bootMsg.textContent = t;
  bootErr.textContent = e ? (e.message || String(e)) : '';
  console.error(t, e);
}
window.addEventListener('error', ev => { if (boot.style.display !== 'none') die('스크립트 오류', ev.error || ev); });

// ── 말 ────────────────────────────────────────────────────
const L = {
  cur: (localStorage.getItem('theland.lang') === 'en') ? 'en' : 'ko',
  s(ko, en) { return this.cur === 'ko' ? ko : en; },
  place(ko) { return this.cur === 'ko' ? ko : (I18N.place[ko] || ko); },
  region(ko) { return this.cur === 'ko' ? ko : (I18N.region[ko] || I18N.place[ko] || ko); },
  era(ko) { return this.cur === 'ko' ? ko : (I18N.era[ko] || ko); },
  ref(ko) {
    if (this.cur === 'ko') return ko;
    let out = ko;
    for (const [k, v] of BOOKS_BY_LEN) if (out.indexOf(k) >= 0) out = out.split(k).join(v);
    return out;
  }
};
let BOOKS_BY_LEN = [];

/** 찾기용으로 다듬은 꼴 — 붙임표·가운뎃점·띄어쓰기를 지우고 소문자로 */
function fold(s) {
  let o = '';
  for (const c of s) {
    if (c === '-' || c === '‐' || c === '‑' || c === '–'
      || c === '·' || c === ' ' || c === ' ' || c === "'" || c === '’'
      || c === '.' || c === ',') continue;
    o += c;
  }
  return o.toLowerCase();
}

// ── 자료 ──────────────────────────────────────────────────
let SITES = [], EVENTS = [], NOTES = new Map(), I18N = null, TERRAIN = null;
let byPlace = new Map();          // 지명 → 사건들
let siteByName = new Map();

async function loadJSON(p) {
  const r = await fetch(p, { cache: 'force-cache' });
  if (!r.ok) throw new Error(p + ' → ' + r.status);
  return r.json();
}

function unpack(o) {                       // {cols, rows} → 객체 배열
  return o.rows.map(r => {
    const x = {};
    o.cols.forEach((c, i) => x[c] = r[i]);
    return x;
  });
}

async function loadAll() {
  say('자료를 불러오는 중…', 5);
  const [sites, events, notes, i18n, terrain] = await Promise.all([
    loadJSON('data/sites.json'),
    loadJSON('data/events.json'),
    loadJSON('data/notes.json'),
    loadJSON('data/i18n.json'),
    loadJSON('terrain/terrain.json')
  ]);
  I18N = i18n; TERRAIN = terrain;
  BOOKS_BY_LEN = Object.entries(i18n.book).sort((a, b) => b[0].length - a[0].length);

  SITES = unpack(sites);
  SITES.forEach((s, i) => { s.i = i; s.f = fold(s.ko) + '' + fold(s.en); siteByName.set(s.ko, s); });

  const ERAS = events.eras, KINDS = events.kinds;
  EVENTS = unpack(events);
  for (const e of EVENTS) {
    e.eraKo = ERAS[e.era]; e.kindKo = KINDS[e.kind];
    e.f = fold(e.title + ' ' + e.ref + ' ' + e.text + ' ' + e.titleEn + ' ' + e.textEn);
    if (!byPlace.has(e.place)) byPlace.set(e.place, []);
    byPlace.get(e.place).push(e);
  }
  for (const n of unpack(notes)) NOTES.set(n.place, n);
  say('자료 ' + EVENTS.length + '건 · 지명 ' + SITES.length + '곳', 20);
}

// ── 땅의 잣대 ─────────────────────────────────────────────
// 화면 안에서는 킬로미터로 잰다. 위도 1도 = 111.32 km, 경도 1도는 이 위도에서 94.6 km.
const KM_LAT = 111.32, KM_LON = 94.6;
const ORIGIN = { lat: 31.8, lon: 35.2 };      // 예루살렘 언저리를 0 으로
let VEXAG = 4.0;                              // 높이 과장 (앱의 「축척」과 같은 뜻)

function worldX(lon) { return (lon - ORIGIN.lon) * KM_LON; }
function worldZ(lat) { return -(lat - ORIGIN.lat) * KM_LAT; }
function lonOfX(x) { return ORIGIN.lon + x / KM_LON; }
function latOfZ(z) { return ORIGIN.lat - z / KM_LAT; }

// ── 그림 판 ───────────────────────────────────────────────
let renderer, scene, camera, labelRoot;
const cam = { tx: 0, tz: 0, dist: 260, az: 0.35, el: 0.62 };   // 도는 카메라

function initGL() {
  if (!window.THREE) throw new Error('three.js 를 불러오지 못했습니다 (인터넷 차단?)');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x0b0d10);
  document.body.insertBefore(renderer.domElement, document.getElementById('labels'));

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b0d10, 0.0009);
  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 12000);
  labelRoot = document.getElementById('labels');

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
}

/** 높이 그림 한 장을 지형 판으로 세운다 */
function makeTerrain(tile, segX, segZ, tex) {
  const x0 = worldX(tile.lonMin), x1 = worldX(tile.lonMax);
  const z0 = worldZ(tile.latMax), z1 = worldZ(tile.latMin);   // 위도는 뒤집힌다
  const w = x1 - x0, d = z1 - z0;

  const geo = new THREE.PlaneBufferGeometry(w, d, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x0 + w / 2, 0, z0 + d / 2);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      hmap: { value: tex },
      texel: { value: new THREE.Vector2(1 / tile.w, 1 / tile.h) },
      bounds: { value: new THREE.Vector4(x0, z0, w, d) },
      vex: { value: VEXAG },
      sun: { value: new THREE.Vector3(0.55, 0.72, 0.42).normalize() },
      fogCol: { value: new THREE.Color(0x0b0d10) },
      fogDen: { value: 0.0009 }
    },
    vertexShader: `
      uniform sampler2D hmap;
      uniform vec4 bounds;      // x0, z0, w, d
      uniform float vex;
      varying vec2 vUv;
      varying float vH;
      varying vec3 vWorld;
      float height(vec2 uv){
        vec3 c = texture2D(hmap, uv).rgb;
        return (c.r * 255.0 * 256.0 + c.g * 255.0) - 6000.0;
      }
      void main(){
        vec3 p = position;
        vUv = vec2((p.x - bounds.x) / bounds.z, 1.0 - (p.z - bounds.y) / bounds.w);
        vH = height(vUv);
        p.y = vH * 0.001 * vex;              // m → km
        vWorld = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D hmap;
      uniform vec2 texel;
      uniform vec3 sun;
      uniform vec3 fogCol;
      uniform float fogDen;
      varying vec2 vUv;
      varying float vH;
      varying vec3 vWorld;
      float height(vec2 uv){
        vec3 c = texture2D(hmap, uv).rgb;
        return (c.r * 255.0 * 256.0 + c.g * 255.0) - 6000.0;
      }
      vec3 ramp(float h){
        // 표고 색 — 바다, 저지, 들, 구릉, 산, 눈
        if (h < 0.0)   return mix(vec3(0.06,0.16,0.25), vec3(0.13,0.31,0.42), clamp(h/-400.0+1.0,0.0,1.0));
        if (h < 200.0) return mix(vec3(0.35,0.46,0.26), vec3(0.44,0.50,0.28), h/200.0);
        if (h < 500.0) return mix(vec3(0.44,0.50,0.28), vec3(0.55,0.51,0.30), (h-200.0)/300.0);
        if (h < 900.0) return mix(vec3(0.55,0.51,0.30), vec3(0.58,0.46,0.32), (h-500.0)/400.0);
        if (h <1600.0) return mix(vec3(0.58,0.46,0.32), vec3(0.52,0.44,0.40), (h-900.0)/700.0);
        return mix(vec3(0.52,0.44,0.40), vec3(0.88,0.89,0.92), clamp((h-1600.0)/900.0,0.0,1.0));
      }
      void main(){
        float hl = height(vUv - vec2(texel.x, 0.0));
        float hr = height(vUv + vec2(texel.x, 0.0));
        float hu = height(vUv - vec2(0.0, texel.y));
        float hd = height(vUv + vec2(0.0, texel.y));
        vec3 n = normalize(vec3((hl - hr) * 0.02, 1.0, (hu - hd) * 0.02));
        float lam = clamp(dot(n, sun), 0.0, 1.0);
        vec3 col = ramp(vH) * (0.42 + 0.78 * lam);
        if (vH < 0.0) col = mix(col, vec3(0.10,0.25,0.36), 0.55);
        float d = length(vWorld - cameraPosition);
        float f = 1.0 - exp(-fogDen * fogDen * d * d);
        gl_FragColor = vec4(mix(col, fogCol, clamp(f, 0.0, 1.0)), 1.0);
      }`
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function loadTexture(url) {
  return new Promise((res, rej) => {
    new THREE.TextureLoader().load(url, t => {
      t.minFilter = THREE.NearestFilter;      // 칸 값을 섞으면 높이가 망가진다
      t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      res(t);
    }, undefined, e => rej(new Error(url + ' 를 불러오지 못했습니다')));
  });
}

// ── 이름표 ────────────────────────────────────────────────
const labelPool = [];
let shown = [];
let highlight = null;

function labelCap() { return innerWidth < 560 ? 44 : 110; }

function updateLabels() {
  const v = new THREE.Vector3();
  const cand = [];
  const camPos = camera.position;
  for (const s of SITES) {
    if (s.rank >= 10 && cam.dist > 12) continue;         // 성 안의 것은 가까이서만
    if (s.rank >= 5 && s.rank <= 9 && cam.dist < 60) continue;
    v.set(s.x, s.y, s.z).project(camera);
    if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;
    const d = Math.hypot(s.x - camPos.x, s.y - camPos.y, s.z - camPos.z);
    if (d > cam.dist * 3.2 + 60) continue;
    cand.push({ s, sx: (v.x * .5 + .5) * innerWidth, sy: (-v.y * .5 + .5) * innerHeight, d,
                score: s.rank * 1000 + d });
  }
  cand.sort((a, b) => a.score - b.score);

  // 겹침 정리 — 화면을 칸으로 나눠 한 칸에 하나만
  const cell = 34, cols = Math.ceil(innerWidth / cell);
  const taken = new Set();
  const out = [];
  for (const c of cand) {
    if (out.length >= labelCap()) break;
    const k = Math.floor(c.sy / cell) * cols + Math.floor(c.sx / cell);
    if (taken.has(k)) continue;
    taken.add(k); out.push(c);
  }

  while (labelPool.length < out.length) {
    const el = document.createElement('div');
    el.className = 'lab';
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const s = el._site; if (s) { openPlace(s); flyTo(s); }
    });
    labelRoot.appendChild(el); labelPool.push(el);
  }
  for (let i = 0; i < labelPool.length; i++) {
    const el = labelPool[i];
    if (i >= out.length) { el.style.display = 'none'; continue; }
    const c = out[i], s = c.s;
    el._site = s;
    const has = byPlace.has(s.ko);
    el.className = 'lab r' + s.rank + (highlight === s.ko ? ' on' : '');
    el.innerHTML = (has ? '<i></i>' : '') + escapeHTML(L.cur === 'ko' ? s.ko : s.en);
    el.style.display = '';
    el.style.left = c.sx + 'px';
    el.style.top = c.sy + 'px';
  }
  shown = out;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── 카메라 몰기 ───────────────────────────────────────────
function applyCam() {
  cam.el = Math.max(0.12, Math.min(1.5, cam.el));
  cam.dist = Math.max(1.5, Math.min(4200, cam.dist));
  const y = groundAt(cam.tx, cam.tz);
  const r = cam.dist * Math.cos(cam.el);
  camera.position.set(cam.tx + r * Math.sin(cam.az), y + cam.dist * Math.sin(cam.el),
                      cam.tz + r * Math.cos(cam.az));
  camera.lookAt(cam.tx, y, cam.tz);
  updateHUD();
}

/** 지금 자리의 땅 높이 (km). 가진 것이 그림뿐이라 대충 0 으로 둔다 —
 *  카메라가 지형을 뚫지 않을 만큼만 있으면 된다. */
function groundAt() { return 0; }

function flyTo(s, dist) {
  cam.tx = s.x; cam.tz = s.z;
  cam.dist = dist || (s.rank <= 1 ? 26 : s.rank <= 3 ? 40 : 90);
  highlight = s.ko;
  applyCam();
}

function bindControls() {
  const el = renderer.domElement;
  let drag = null, pinch = null;
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const k = cam.dist * 0.0016;
      cam.tx -= (dx * Math.cos(cam.az) - dy * Math.sin(cam.az)) * k;
      cam.tz += (dx * Math.sin(cam.az) + dy * Math.cos(cam.az)) * k;
    } else {
      cam.az -= dx * 0.005;
      cam.el += dy * 0.005;
    }
    applyCam();
  });
  const end = e => { drag = null; try { el.releasePointerCapture(e.pointerId); } catch (_) {} };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist *= Math.exp(e.deltaY * 0.0012);
    applyCam();
  }, { passive: false });

  // 손가락 둘 — 오므리면 다가간다
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
      drag = null;
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinch) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                           e.touches[0].clientY - e.touches[1].clientY);
      cam.dist *= pinch / Math.max(d, 1);
      pinch = d; applyCam();
    }
  }, { passive: true });
  el.addEventListener('touchend', () => { pinch = null; }, { passive: true });
}

function updateHUD() {
  const lat = latOfZ(cam.tz), lon = lonOfX(cam.tx);
  let best = null, bd = 1e9;
  for (const s of SITES) {
    if (s.rank > 4) continue;
    const d = Math.hypot(s.x - cam.tx, s.z - cam.tz);
    if (d < bd) { bd = d; best = s; }
  }
  document.getElementById('hudPlace').textContent = best ? L.place(best.ko) : '—';
  document.getElementById('hudSub').textContent =
    (best ? L.region(best.region) + ' · ' : '') +
    lat.toFixed(2) + '°N ' + lon.toFixed(2) + '°E';
}

// ── 옆 판 ─────────────────────────────────────────────────
const panel = document.getElementById('panel');
function openPlace(s) {
  document.getElementById('pTitle').textContent = L.place(s.ko);
  document.getElementById('pSub').textContent = L.region(s.region);
  const body = document.getElementById('pb');
  const eps = (byPlace.get(s.ko) || []).slice().sort((a, b) => a.era - b.era || a.year - b.year);
  const note = NOTES.get(s.ko);
  let html = '';
  if (note) {
    html += '<div class="note"><em>' + escapeHTML(L.s('성서에 나오지 않는 곳', 'Not named in the Bible')) +
      '</em>' + escapeHTML(L.cur === 'ko' ? note.ko : (note.en || note.ko)) + '</div>';
  }
  if (!eps.length && !note) {
    html += '<div class="note">' + escapeHTML(L.s('여기에 걸린 기록이 없습니다.', 'No records here.')) + '</div>';
  }
  for (const e of eps) {
    const t = (L.cur === 'en' && e.titleEn) ? e.titleEn : e.title;
    const x = (L.cur === 'en' && e.textEn) ? e.textEn : e.text;
    html += '<div class="ep"><span class="era">' + escapeHTML(L.era(e.eraKo)) + '</span>' +
      '<h3>' + escapeHTML(t) + '</h3><p>' + escapeHTML(x) + '</p>' +
      '<span class="ref">' + escapeHTML(L.ref(e.ref)) + '</span></div>';
  }
  body.innerHTML = html;
  body.scrollTop = 0;
  panel.classList.add('open');
}
document.getElementById('closeBtn').onclick = () => panel.classList.remove('open');

// ── 찾기 ──────────────────────────────────────────────────
const qEl = document.getElementById('q'), hitsEl = document.getElementById('hits');
qEl.addEventListener('input', () => {
  const q = qEl.value.trim();
  if (q.length < 1) { hitsEl.innerHTML = ''; return; }
  const qf = fold(q);
  const out = [];
  for (const s of SITES) {
    if (s.f.indexOf(qf) < 0) continue;
    out.push({ s, sub: L.region(s.region) + ((byPlace.get(s.ko) || []).length
      ? ' · ' + L.s((byPlace.get(s.ko)).length + '건', (byPlace.get(s.ko)).length + ' records') : '') });
    if (out.length >= 8) break;
  }
  if (qf.length >= 2) {
    const seen = new Set(out.map(o => o.s.ko));
    for (const e of EVENTS) {
      if (e.f.indexOf(qf) < 0) continue;
      if (seen.has(e.place)) continue;
      const s = siteByName.get(e.place); if (!s) continue;
      seen.add(e.place);
      out.push({ s, sub: (L.cur === 'en' && e.titleEn) ? e.titleEn : e.title });
      if (out.length >= 14) break;
    }
  }
  hitsEl.innerHTML = out.map((o, i) =>
    '<div class="hit" data-i="' + o.s.i + '"><b>' + escapeHTML(L.place(o.s.ko)) +
    '</b><s>' + escapeHTML(o.sub) + '</s></div>').join('');
});
hitsEl.addEventListener('click', e => {
  const row = e.target.closest('.hit'); if (!row) return;
  const s = SITES[+row.dataset.i];
  hitsEl.innerHTML = ''; qEl.blur();
  flyTo(s); openPlace(s);
});

// ── 단추 ──────────────────────────────────────────────────
document.getElementById('langBtn').onclick = () => {
  L.cur = L.cur === 'ko' ? 'en' : 'ko';
  localStorage.setItem('theland.lang', L.cur);
  applyLang();
};
document.getElementById('homeBtn').onclick = () => {
  const s = siteByName.get('예루살렘');
  if (s) flyTo(s, 260); else { cam.tx = 0; cam.tz = 0; cam.dist = 260; applyCam(); }
};
function applyLang() {
  document.getElementById('langBtn').textContent = L.cur === 'ko' ? 'EN' : '한';
  document.documentElement.lang = L.cur;
  document.title = L.s('약속의 땅', 'The Promised Land');
  qEl.placeholder = L.s('지명·인물·낱말 찾기', 'Find a place, a person, a word');
  qEl.dispatchEvent(new Event('input'));
  updateHUD(); updateLabels();
  if (panel.classList.contains('open')) {
    const n = document.getElementById('pTitle').textContent;
    const s = SITES.find(x => L.place(x.ko) === n) ||
              SITES.find(x => x.ko === n || x.en === n);
    if (s) openPlace(s);
  }
}

// ── 돌리기 ────────────────────────────────────────────────
function tick() {
  requestAnimationFrame(tick);
  renderer.render(scene, camera);
  updateLabels();
}

// ── 시작 ─────────────────────────────────────────────────
(async function main() {
  try {
    await loadAll();
    initGL();

    say(L.s('지형을 세우는 중…', 'Raising the land…'), 35);
    const [canaan, region] = TERRAIN.tiles;

    // 지명마다 미리 세계 좌표를 매겨 둔다 (높이는 그림에서 읽을 수 없으므로 0)
    for (const s of SITES) { s.x = worldX(s.lon); s.y = 0; s.z = worldZ(s.lat); }

    const texC = await loadTexture(canaan.file);
    say(L.s('가나안 지형', 'Canaan terrain'), 65);
    scene.add(makeTerrain(canaan, 600, 680, texC));

    bindControls();
    applyLang();
    const jer = siteByName.get('예루살렘');
    if (jer) { cam.tx = jer.x; cam.tz = jer.z; }
    applyCam();
    tick();
    boot.style.display = 'none';

    // 넓은 세계는 뒤에서 몰래 받아 온다
    loadTexture(region.file).then(texR => {
      const m = makeTerrain(region, 420, 240, texR);
      m.position.y = -0.35;                 // 가나안 판 밑으로 살짝
      m.renderOrder = -1;
      scene.add(m);
    }).catch(e => console.warn('넓은 세계를 못 불러왔습니다', e));

  } catch (e) {
    die(L.s('여는 중에 막혔습니다', 'Could not open'), e);
  }
})();
