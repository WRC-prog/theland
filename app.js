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
  // 'force-cache' 였다. 그러면 한 번 받은 것을 **영영** 다시 안 받는다 —
  // terrain.json 을 고쳐 올려도 브라우저가 옛 것을 계속 물고 있었다.
  const r = await fetch(p, { cache: 'default' });
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
  const [sites, events, notes, i18n, terrain, roads, presets] = await Promise.all([
    loadJSON('data/sites.json'),
    loadJSON('data/events.json'),
    loadJSON('data/notes.json'),
    loadJSON('data/i18n.json'),
    loadJSON('terrain/terrain.json'),
    loadJSON('data/roads.json'),
    loadJSON('data/presets.json')
  ]);
  I18N = i18n; TERRAIN = terrain;
  ROADS = unpack(roads); PRESETS = unpack(presets);
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

// ── 땅 높이 읽기 ──────────────────────────────────────────
//
// 이름표를 **땅 위에** 얹으려면 그 자리의 높이를 알아야 한다. 예전에는 다
// 0 으로 두었는데, 높이를 네 배로 부풀려 그리므로 예루살렘(750 m)의 이름표가
// 실제 산꼭대기보다 3 km 아래에 찍혔다. 기울일수록 이름이 엉뚱한 데로 밀렸다.
//
// 그림을 다시 받아 오지 않는다 — 지형에 쓴 그림을 그대로 한 번 훑는다.
// 눈금은 **지형 판의 꼭짓점과 같은 간격**으로 잡는다. 그래야 이름표가
// 눈에 보이는 면에 딱 붙는다 (더 촘촘히 읽으면 오히려 면에서 떠 버린다).
const GRIDS = [];

function buildGrid(tile, img, segX, segZ) {
  try { buildGridUnsafe(tile, img, segX, segZ); }
  catch (e) { console.warn('높이를 읽지 못했습니다 — 이름표는 바다 높이에 놓입니다', e); }
}

function buildGridUnsafe(tile, img, segX, segZ) {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const g2 = cv.getContext('2d', { willReadFrequently: true });
  g2.drawImage(img, 0, 0);
  const px = g2.getImageData(0, 0, img.width, img.height).data;
  const gw = segX + 1, gh = segZ + 1;
  const m = new Int16Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    const iy = Math.round(j / segZ * (img.height - 1));   // j=0 이 북쪽(그림 맨 윗줄)
    for (let i = 0; i < gw; i++) {
      const ix = Math.round(i / segX * (img.width - 1));
      const p = (iy * img.width + ix) * 4;
      m[j * gw + i] = px[p] * 256 + px[p + 1] - 6000;
    }
  }
  cv.width = cv.height = 1;                                // 40 MB 짜리 자리를 바로 돌려준다
  GRIDS.push({ t: tile, gw, gh, m });
}

function gridAt(G, lat, lon) {
  const t = G.t;
  const u = (lon - t.lonMin) / (t.lonMax - t.lonMin);
  const v = (t.latMax - lat) / (t.latMax - t.latMin);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const fx = u * (G.gw - 1), fy = v * (G.gh - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, G.gw - 1), y1 = Math.min(y0 + 1, G.gh - 1);
  const tx = fx - x0, ty = fy - y0;
  const a = G.m[y0 * G.gw + x0], b = G.m[y0 * G.gw + x1];
  const c = G.m[y1 * G.gw + x0], d = G.m[y1 * G.gw + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** 그 자리의 땅 높이 (화면 단위 = km, 과장까지 먹인 값) */
function groundY(lat, lon) {
  for (const G of GRIDS) { const h = gridAt(G, lat, lon); if (h !== null) return h * 0.001 * VEXAG; }
  return 0;
}

/** 지명마다 높이를 다시 매긴다 (지형이 하나 더 붙을 때마다 부른다) */
function placeSites() {
  for (const s of SITES) { s.x = worldX(s.lon); s.y = groundY(s.lat, s.lon); s.z = worldZ(s.lat); }
}

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
function makeTerrain(tile, segX, segZ, tex, clip) {
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
      fogDen: { value: 0.0009 },
      // 비워 둘 네모 (x0,z0,x1,z1). 뒤집힌 값이면 아무 데도 비우지 않는다.
      clip: { value: clip || new THREE.Vector4(0, 0, -1, -1) }
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
      uniform vec4 clip;
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
        // 가나안 판이 맡은 자리는 넘기고 그리지 않는다 — 겹치면 서로 파고든다
        if (vWorld.x > clip.x && vWorld.x < clip.z &&
            vWorld.z > clip.y && vWorld.z < clip.w) discard;
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
let moved = 0;                     // 이번에 끈 만큼 — 끌었으면 누른 것이 아니다

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
      if (moved > 3) return;                 // 지도를 끌다가 뗀 것뿐이다
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
  // 낮게 기울였을 때 카메라가 산 속으로 들어가 화면이 캄캄해지던 것을 막는다
  const gy = groundAt(camera.position.x, camera.position.z);
  if (camera.position.y < gy + 0.6) camera.position.y = gy + 0.6;
  camera.lookAt(cam.tx, y, cam.tz);
  // 길은 세계 눈금으로 그리므로 멀어지면 실오라기가 되고 다가가면 밭두렁이 된다.
  // 배쯤 달라졌을 때만 다시 굽는다 — 끌 때마다 다시 만들 일은 아니다.
  if (routePts && Math.abs(Math.log(cam.dist / (ribbonDist || 1))) > 0.5) drawRoute();
  updateHUD();
}

function groundAt(x, z) { return groundY(latOfZ(z), lonOfX(x)); }

/** 화면에서 끈 만큼 땅이 따라오게 — 눈금은 거리와 기울기에서 나온다 */
function panBy(dx, dy, dist) {
  const d = dist || cam.dist;
  const k = 2 * d * Math.tan(camera.fov * Math.PI / 360) / Math.max(innerHeight, 1);
  const kz = k / Math.max(Math.sin(cam.el), 0.22);   // 낮게 볼수록 위아래로 더 멀다
  const sa = Math.sin(cam.az), ca = Math.cos(cam.az);
  cam.tx -= dx * k * ca + dy * kz * sa;
  cam.tz += dx * k * sa - dy * kz * ca;
}

/** 그 곳으로 옮겨 간다.
 *
 *  **높이는 건드리지 않는다.** 예전에는 누를 때마다 26~90 km 로 확 당겨서,
 *  멀리서 내려다보다가 이름 하나 눌렀을 뿐인데 화면이 통째로 뒤집혔다.
 *  보는 높이는 보는 사람이 정한다. (dist 를 딱 집어 준 때만 따른다) */
function flyTo(s, dist) {
  cam.tx = s.x; cam.tz = s.z;
  if (dist) cam.dist = dist;
  highlight = s.ko;
  applyCam();
}

function bindControls() {
  const el = renderer.domElement;
  const pts = new Map();                 // 지금 눌려 있는 손가락·단추
  let mode = null, last = null, twoD = 0, twoMid = null;

  // 화면 **전체**에서 받는다. 예전에는 그림판(canvas)에서만 받았는데,
  // 이름표가 그림판 위에 덮여 있어서 그 위에서 굴리면 사건이 그림판까지
  // 못 오고 **바깥 쪽(구글 사이트)** 이 대신 움직였다.
  const overUI = t => !!(t && t.closest && t.closest('#top, #panel, #gate'));

  // 왼쪽 단추로 그냥 끌면 **옮기기**. 지도는 그게 맞다.
  // 돌리고 기울이는 것은 오른쪽 단추(또는 ⇧·⌘·ctrl 을 누른 채) — 손가락은 둘.
  const orbitish = e => e.button === 2 || e.button === 1
    || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;

  addEventListener('pointerdown', e => {
    if (overUI(e.target)) return;
    moved = 0;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      mode = orbitish(e) ? 'orbit' : 'pan';
      last = { x: e.clientX, y: e.clientY };
    } else if (pts.size === 2) {
      const v = [...pts.values()];
      mode = 'two';
      twoD = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
      twoMid = { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
    }
  });

  addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    moved++;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode === 'two' && pts.size >= 2) {
      const v = [...pts.values()];
      const d = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
      const mid = { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
      if (twoD > 0 && d > 0) cam.dist *= twoD / d;          // 오므리면 다가간다
      cam.az -= (mid.x - twoMid.x) * 0.006;                 // 함께 옆으로 = 돌리기
      cam.el += (mid.y - twoMid.y) * 0.006;                 // 함께 위아래 = 기울이기
      twoD = d; twoMid = mid;
      applyCam();
      return;
    }
    if (!last || !mode) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    if (mode === 'orbit') { cam.az -= dx * 0.005; cam.el += dy * 0.005; }
    else                  { panBy(dx, dy); }
    applyCam();
  });

  const end = e => {
    pts.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (pts.size === 1) {
      const v = [...pts.values()][0];
      mode = 'pan'; last = { x: v.x, y: v.y };
    } else if (pts.size === 0) { mode = null; last = null; }
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  addEventListener('lostpointercapture', end);
  addEventListener('contextmenu', e => { if (!overUI(e.target)) e.preventDefault(); });

  // 바퀴 — 화살표가 가리키는 곳으로 다가간다
  // preventDefault 를 꼭 해야 한다. 안 하면 이 창이 아니라 **이 창을 담고 있는
  // 쪽**(구글 사이트)이 대신 굴러간다.
  addEventListener('wheel', e => {
    if (overUI(e.target)) return;
    e.preventDefault();
    zoomAt(Math.exp(e.deltaY * 0.0012), e.clientX, e.clientY);
  }, { passive: false });

  // 사파리는 두 손가락 벌리기를 제 나름대로 「쪽 넓히기」로 삼는다 — 막는다
  for (const n of ['gesturestart', 'gesturechange', 'gestureend'])
    addEventListener(n, e => e.preventDefault(), { passive: false });
  addEventListener('touchmove', e => {
    if (!overUI(e.target) && e.cancelable) e.preventDefault();
  }, { passive: false });

  // 자판으로도 — 화살표로 옮기고, +/- 로 다가가고, [ ] 로 기울인다
  addEventListener('keydown', e => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const step = 60;
    if (e.key === 'ArrowLeft')       panBy(step, 0);
    else if (e.key === 'ArrowRight') panBy(-step, 0);
    else if (e.key === 'ArrowUp')    panBy(0, step);
    else if (e.key === 'ArrowDown')  panBy(0, -step);
    else if (e.key === '+' || e.key === '=') cam.dist *= 0.8;
    else if (e.key === '-' || e.key === '_') cam.dist *= 1.25;
    else if (e.key === '[')          cam.el -= 0.12;
    else if (e.key === ']')          cam.el += 0.12;
    else return;
    e.preventDefault();
    applyCam();
  });
}

/** 화면의 한 점을 붙든 채 다가가거나 물러선다 */
function zoomAt(f, cx, cy) {
  const before = cam.dist;
  cam.dist = Math.max(1.5, Math.min(4200, cam.dist * f));
  const moved = 1 - cam.dist / before;
  if (Math.abs(moved) > 1e-4 && cx != null) {
    panBy(-(cx - innerWidth / 2) * moved, -(cy - innerHeight / 2) * moved, before);
  }
  applyCam();
}

/** 화면 위 단추 — 마우스가 없는 화면에서도 다가가고 기울일 수 있게 */
function addViewButtons() {
  const tools = document.getElementById('tools');
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label; b.title = title;
    b.addEventListener('click', fn);
    tools.insertBefore(b, tools.firstChild);
    return b;
  };
  // 넣는 차례가 거꾸로다 (맨 앞에 끼우므로)
  mk('⌄', L.s('눕히기', 'Lower the view'),  () => { cam.el -= 0.16; applyCam(); });
  mk('⇢', L.s('길', 'Journeys'), openRoutes);
  mk('⌃', L.s('세우기', 'Raise the view'),  () => { cam.el += 0.16; applyCam(); });
  mk('−', L.s('물러서기', 'Zoom out'),      () => zoomAt(1.35));
  mk('＋', L.s('다가가기', 'Zoom in'),       () => zoomAt(1 / 1.35));
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
  body.innerHTML = '<div class="note"><button class="rbtn" data-act="add" data-i="' + s.i + '">'
    + escapeHTML(L.s('길에 넣기', 'Add to route')) + '</button></div>' + html;
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


// ── 옛길과 경로 ───────────────────────────────────────────
//
// 두 곳을 곧은 자로 이으면 산등성이와 바다를 가로지른다. 실제로 사람이
// 다닌 길은 정해져 있었다 — 해안 길, 왕의 대로, 산지 능선길. 그래서
// 옛길 65갈래를 **그물**로 엮어 두고 그 위로 가장 짧은 길을 찾는다.
// 길에서 멀리 떨어진 곳(광야·바다 건너)은 어쩔 수 없이 곧게 잇는다.
let ROADS = [], PRESETS = [];
let roadNet = null;                       // {n:[{lat,lon,e:[[j,km]…]}]}
let routeMesh = null, roadsMesh = null, routeStops = [], routePts = null, ribbonDist = 0;

function kmLL(a, b) {
  return Math.hypot((a.lon - b.lon) * KM_LON, (a.lat - b.lat) * KM_LAT);
}

function buildRoadNet() {
  if (roadNet) return roadNet;
  const n = [];
  const link = (i, j) => {
    const d = kmLL(n[i], n[j]);
    n[i].e.push([j, d]); n[j].e.push([i, d]);
  };
  for (const r of ROADS) {
    let prev = -1;
    for (const p of r.pts) {
      n.push({ lat: p[0], lon: p[1], e: [] });
      const i = n.length - 1;
      if (prev >= 0) link(prev, i);
      prev = i;
    }
  }
  // 길과 길이 만나는 자리 — 4 km 안에 있으면 갈아탈 수 있다고 본다
  for (let i = 0; i < n.length; i++)
    for (let j = i + 1; j < n.length; j++)
      if (Math.abs(n[i].lat - n[j].lat) < 0.05 && Math.abs(n[i].lon - n[j].lon) < 0.05
          && kmLL(n[i], n[j]) < 4) link(i, j);
  roadNet = { n };
  return roadNet;
}

function nearestNode(p) {
  const { n } = buildRoadNet();
  let bi = -1, bd = 1e9;
  for (let i = 0; i < n.length; i++) { const d = kmLL(n[i], p); if (d < bd) { bd = d; bi = i; } }
  return { i: bi, km: bd };
}

/** 옛길 위로 a 에서 b 까지. 길이 멀면 곧게 잇는다. */
function roadPath(a, b) {
  const A = nearestNode(a), B = nearestNode(b);
  if (A.km > 35 || B.km > 35 || A.i < 0 || B.i < 0) return [a, b];
  const { n } = roadNet;
  const dist = new Float64Array(n.length).fill(Infinity);
  const prev = new Int32Array(n.length).fill(-1);
  const done = new Uint8Array(n.length);
  dist[A.i] = 0;
  for (;;) {
    let u = -1, bd = Infinity;
    for (let i = 0; i < n.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
    if (u < 0 || u === B.i) break;
    done[u] = 1;
    for (const [v, w] of n[u].e) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  if (!isFinite(dist[B.i])) return [a, b];
  const mid = [];
  for (let i = B.i; i >= 0; i = prev[i]) mid.unshift({ lat: n[i].lat, lon: n[i].lon });
  return [a, ...mid, b];
}

/** 마디마다 3 km 안쪽으로 잘게 나눈다 — 그래야 땅을 타고 흐른다 */
function densify(pts, stepKm) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const k = Math.max(1, Math.ceil(kmLL(a, b) / stepKm));
    for (let t = 0; t < k; t++)
      out.push({ lat: a.lat + (b.lat - a.lat) * t / k, lon: a.lon + (b.lon - a.lon) * t / k });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function makeRibbon(pts, widthKm, color, lift) {
  const v = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    const dx = worldX(q.lon) - worldX(o.lon), dz = worldZ(q.lat) - worldZ(o.lat);
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * widthKm / 2, nz = dx / len * widthKm / 2;
    const x = worldX(p.lon), z = worldZ(p.lat), y = groundY(p.lat, p.lon) + lift;
    v.push(x + nx, y, z + nz, x - nx, y, z - nz);
    if (i < pts.length - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  // 땅에 파묻히지 않게 깊이 견주기를 끈다 — 언덕 너머의 길도 비쳐 보인다
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
  m.renderOrder = 5;
  m.frustumCulled = false;
  return m;
}

function clearRoute() {
  if (routeMesh) { scene.remove(routeMesh); routeMesh.geometry.dispose(); routeMesh.material.dispose(); }
  routeMesh = null; routePts = null; routeStops = [];
  highlight = null;
}

function drawRoute() {
  if (routeMesh) { scene.remove(routeMesh); routeMesh.geometry.dispose(); routeMesh.material.dispose(); routeMesh = null; }
  if (!routePts || routePts.length < 2) return;
  ribbonDist = cam.dist;
  routeMesh = makeRibbon(routePts, Math.max(0.9, cam.dist * 0.0055), 0xfdcc61, 0.25);
  scene.add(routeMesh);
}

/** 들름 목록으로 길을 세운다 */
function setRoute(stops) {
  routeStops = stops.filter(Boolean);
  if (routeStops.length < 2) { routePts = null; drawRoute(); return 0; }
  let pts = [];
  for (let i = 0; i < routeStops.length - 1; i++) {
    const seg = densify(roadPath(routeStops[i], routeStops[i + 1]), 3);
    pts = pts.concat(i ? seg.slice(1) : seg);
  }
  routePts = pts;
  drawRoute();
  let km = 0;
  for (let i = 0; i < pts.length - 1; i++) km += kmLL(pts[i], pts[i + 1]);
  return km;
}

function frameRoute() {
  if (!routePts || !routePts.length) return;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of routePts) {
    const x = worldX(p.lon), z = worldZ(p.lat);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  cam.tx = (x0 + x1) / 2; cam.tz = (z0 + z1) / 2;
  cam.dist = Math.max(30, Math.hypot(x1 - x0, z1 - z0) * 1.15);
  applyCam(); drawRoute();
}

function toggleRoads() {
  if (roadsMesh) {
    scene.remove(roadsMesh);
    roadsMesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    roadsMesh = null;
    return false;
  }
  roadsMesh = new THREE.Group();
  for (const r of ROADS) {
    const pts = densify(r.pts.map(p => ({ lat: p[0], lon: p[1] })), 4);
    const m = makeRibbon(pts, Math.max(0.5, cam.dist * 0.0022), 0xc9b48a, 0.1);
    m.material.opacity = 0.5;
    roadsMesh.add(m);
  }
  scene.add(roadsMesh);
  return true;
}

// ── 경로 판 ───────────────────────────────────────────────
let pickList = [];                        // 내가 고른 곳들

function openRoutes() {
  document.getElementById('pTitle').textContent = L.s('길', 'Journeys');
  document.getElementById('pSub').textContent = L.s('옛길을 따라갑니다', 'Along the ancient roads');
  const b = document.getElementById('pb');
  let h = '<div class="note"><em>' + escapeHTML(L.s('내가 고른 길', 'Your own route')) + '</em>';
  if (pickList.length) {
    h += pickList.map((s, i) => '<div class="rstop" data-go="' + s.i + '">' + (i + 1) + '. ' +
      escapeHTML(L.place(s.ko)) + '<span data-del="' + i + '">✕</span></div>').join('');
    h += '<div style="margin-top:8px"><button class="rbtn" data-act="go">' +
      escapeHTML(L.s('이 길로', 'Draw it')) + '</button>' +
      '<button class="rbtn" data-act="clr">' + escapeHTML(L.s('비우기', 'Clear')) + '</button></div>';
  } else {
    h += escapeHTML(L.s('지명을 눌러 연 다음 「길에 넣기」를 누르면 여기에 쌓입니다.',
                        'Open a place and press “Add to route”.'));
  }
  h += '</div><div class="note"><em>' + escapeHTML(L.s('옛길', 'Ancient roads')) + '</em>' +
    '<button class="rbtn" data-act="roads">' + escapeHTML(roadsMesh
      ? L.s('감추기', 'Hide') : L.s('보이기', 'Show')) + '</button></div>';
  h += PRESETS.map((p, i) => '<div class="ep jrn" data-j="' + i + '"><h3>' +
    escapeHTML(L.cur === 'ko' ? p.ko : p.en) + '</h3><p>' +
    escapeHTML(L.cur === 'ko' ? p.detailKo : p.detailEn) + '</p><span class="ref">' +
    p.stops.length + L.s('곳', ' stops') + '</span></div>').join('');
  b.innerHTML = h;
  b.scrollTop = 0;
  panel.classList.add('open');
}

document.getElementById('pb').addEventListener('click', ev => {
  const j = ev.target.closest('.jrn');
  if (j) {
    const p = PRESETS[+j.dataset.j];
    const km = setRoute(p.stops.map(n => siteByName.get(n)).filter(Boolean));
    frameRoute();
    document.getElementById('pSub').textContent =
      Math.round(km) + L.s(' km · ' + p.stops.length + '곳', ' km · ' + p.stops.length + ' stops');
    return;
  }
  const del = ev.target.dataset.del;
  if (del != null) { pickList.splice(+del, 1); openRoutes(); return; }
  const go = ev.target.closest('[data-go]');
  if (go) { const s = SITES[+go.dataset.go]; if (s) flyTo(s); return; }
  const act = ev.target.dataset.act;
  if (act === 'go')   { const km = setRoute(pickList); frameRoute();
                        document.getElementById('pSub').textContent = Math.round(km) + ' km'; }
  if (act === 'clr')  { pickList = []; clearRoute(); openRoutes(); }
  if (act === 'roads'){ toggleRoads(); openRoutes(); }
  if (act === 'add')  { const s = SITES[+ev.target.dataset.i];
                        if (s && !pickList.includes(s)) pickList.push(s);
                        ev.target.textContent = L.s('넣었습니다', 'Added'); }
});

const routeCSS = document.createElement('style');
routeCSS.textContent =
  '.rbtn{border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--ink);' +
  'font:inherit;font-size:12.5px;cursor:pointer;padding:6px 11px;border-radius:9px;margin-right:6px}' +
  '.rbtn:hover{background:rgba(255,255,255,.13)}' +
  '.rstop{padding:5px 0;font-size:13px;display:flex;justify-content:space-between;cursor:pointer}' +
  '.rstop span{color:#8d867a;padding:0 4px}' +
  '.rstop span:hover{color:#ff9d86}' +
  '.jrn{cursor:pointer} .jrn:hover h3{color:var(--gold)}';
document.head.appendChild(routeCSS);

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

    placeSites();                       // 높이는 아직 0 — 지형을 읽고 다시 매긴다

    const texC = await loadTexture(canaan.file);
    say(L.s('가나안 지형', 'Canaan terrain'), 65);
    scene.add(makeTerrain(canaan, 600, 680, texC));
    const canaanClip = new THREE.Vector4(
      worldX(canaan.lonMin), worldZ(canaan.latMax),
      worldX(canaan.lonMax), worldZ(canaan.latMin));

    bindControls();
    addViewButtons();
    applyLang();
    const jer = siteByName.get('예루살렘');
    if (jer) { cam.tx = jer.x; cam.tz = jer.z; }
    applyCam();
    tick();
    boot.style.display = 'none';

    // 높이 읽기와 넓은 세계는 **지도를 띄운 뒤에** 한다.
    //
    // 높이 그림 한 장을 훑는 데 3 초쯤 걸린다(1,020만 칸). 그동안 화면이
    // 얼어붙으면 고장 난 줄 안다. 그래서 지도를 먼저 보여 주고, 이름표는
    // 잠깐 뒤에 땅 위로 내려앉는다.
    setTimeout(() => {
      buildGrid(canaan, texC.image, 600, 680);
      placeSites();
      applyCam();

      loadTexture(region.file).then(texR => {
        const m = makeTerrain(region, 420, 240, texR, canaanClip);
        m.renderOrder = -1;
        scene.add(m);
        setTimeout(() => {
          buildGrid(region, texR.image, 420, 240);
          placeSites();                 // 가나안 밖 지명도 땅 위로 올라온다
          applyCam();
        }, 40);
      }).catch(e => console.warn('넓은 세계를 못 불러왔습니다', e));
    }, 80);

  } catch (e) {
    die(L.s('여는 중에 막혔습니다', 'Could not open'), e);
  }
})();
