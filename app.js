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
// ── 화질 ──────────────────────────────────────────────────
//
// 지형 그림은 상 48 MB · 중 20 MB · 하 11 MB 다. 와이파이에서는 몇 초지만
// 데이터로는 만만치 않다. 그래서 **연결을 보고 낮은 쪽으로 연다.**
// 고른 것은 기억해 두고, 바꾸면 새로 열어 다시 받는다.
const QUALS = ['low', 'mid', 'hi'];
function autoQual() {
  const c = navigator.connection || {};
  if (c.saveData) return 'low';
  const t = c.effectiveType || '';
  if (t === 'slow-2g' || t === '2g' || t === '3g') return 'low';
  if (c.type === 'cellular') return 'low';
  return 'mid';
}
let QUAL = 'mid', qualAuto = false;
try {
  const saved = localStorage.getItem('theland.qual');
  if (QUALS.indexOf(saved) >= 0) QUAL = saved;
  else { QUAL = autoQual(); qualAuto = true; }
} catch (e) { QUAL = 'mid'; }

/** 화질에 맞는 그림 이름 — 상은 본이름 그대로 */
function qualFile(f) {
  return QUAL === 'hi' ? f : f.replace(/\.png$/, '_' + QUAL + '.png');
}

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
  const [sites, events, notes, i18n, terrain, roads, presets, ways] = await Promise.all([
    loadJSON('data/sites.json'),
    loadJSON('data/events.json'),
    loadJSON('data/notes.json'),
    loadJSON('data/i18n.json'),
    loadJSON('terrain/terrain.json'),
    loadJSON('data/roads.json'),
    loadJSON('data/presets.json'),
    loadJSON('data/waterways.json')
  ]);
  I18N = i18n; TERRAIN = terrain;
  ROADS = unpack(roads); PRESETS = unpack(presets); WAYS = unpack(ways);
  I18N = i18n;
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
  // 물길에도 이름을 붙인다 — 앱처럼 골짜기와 급류가 지도에 보이게.
  // 가운데 점을 자리로 삼아 지명 목록에 끼워 넣는다(등급 7 = 물길).
  for (const wv of WAYS) {
    if (!wv.pts || wv.pts.length < 2 || siteByName.has(wv.ko)) continue;
    const mid = wv.pts[wv.pts.length >> 1];
    const s = { ko: wv.ko, en: (I18N.place && I18N.place[wv.ko]) || wv.ko,
                lat: mid[0], lon: mid[1], region: '물길', rank: 7 };
    s.i = SITES.length; s.f = fold(s.ko) + '' + fold(s.en);
    SITES.push(s); siteByName.set(s.ko, s);
  }
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
  const gw = segX + 1, gh = segZ + 1;
  const m = new Int16Array(gw * gh);
  // 통째로 읽으면 오천만 칸짜리 그림에서 200 MB 를 한꺼번에 잡는다 —
  // 폰에서는 그대로 떨어진다. 가로 띠로 나눠 읽는다.
  const band = Math.max(1, Math.floor(8e6 / Math.max(img.width, 1)));
  for (let y0 = 0; y0 < img.height; y0 += band) {
    const bh = Math.min(band, img.height - y0);
    const px = g2.getImageData(0, y0, img.width, bh).data;
    for (let j = 0; j < gh; j++) {
      const iy = Math.round(j / segZ * (img.height - 1));
      if (iy < y0 || iy >= y0 + bh) continue;
      const row = (iy - y0) * img.width;
      for (let i = 0; i < gw; i++) {
        const ix = Math.round(i / segX * (img.width - 1));
        const p = (row + ix) * 4;
        m[j * gw + i] = px[p] * 256 + px[p + 1] - 6000;
      }
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
const SKY = 0x9dc0dc, HAZE = 0xc6d6e0;      // 하늘빛과 지평선 안개

/** 위는 파랗고 아래로 갈수록 옅어지는 하늘 한 장 */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#6f9fca');
  grad.addColorStop(0.62, '#9dc0dc');
  grad.addColorStop(1, '#cfdde6');
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  return t;
}
const cam = { tx: 0, tz: 0, dist: 260, az: 0.35, el: 0.62 };   // 도는 카메라

function initGL() {
  if (!window.THREE) throw new Error('three.js 를 불러오지 못했습니다 (인터넷 차단?)');
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  // 캄캄한 밤하늘 대신 **낮**. 먼 데는 옅은 안개로 스러지게 한다.
  renderer.setClearColor(SKY);
  document.body.insertBefore(renderer.domElement, document.getElementById('labels'));

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(HAZE, 0.0009);
  scene.background = skyTexture();
  camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 12000);
  labelRoot = document.getElementById('labels');

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
}

/** 높이 그림 한 장을 지형 판으로 세운다 */
function makeTerrain(tile, segX, segZ, tex, clip, win) {
  const x0 = worldX(tile.lonMin), x1 = worldX(tile.lonMax);
  const z0 = worldZ(tile.latMax), z1 = worldZ(tile.latMin);   // 위도는 뒤집힌다
  const w = x1 - x0, d = z1 - z0;

  // win 을 주면 타일 **한 조각**만 세운다. 눈금(uv)은 타일 전체를 기준으로
  // 그대로 두므로, 같은 그림에서 훨씬 촘촘한 판을 뜰 수 있다.
  const gx = win ? win.x : x0, gz = win ? win.z : z0;
  const gw = win ? win.w : w,  gd = win ? win.d : d;
  const geo = new THREE.PlaneBufferGeometry(gw, gd, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(gx + gw / 2, 0, gz + gd / 2);

  const iw = (tex.image && tex.image.width)  || tile.w;
  const ih = (tex.image && tex.image.height) || tile.h;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      hmap: { value: tex },
      // 칸 수는 **그림에게 묻는다**. terrain.json 에 적힌 값과 어긋나면
      // 지형이 통째로 밀리는데, 그림을 더 촘촘히 구워 올릴 때마다 그 위험을
      // 지고 갈 까닭이 없다.
      texel: { value: new THREE.Vector2(1 / iw, 1 / ih) },
      bounds: { value: new THREE.Vector4(x0, z0, w, d) },
      vex: { value: VEXAG },
      vexf: { value: VEXAG },
      mpp: { value: new THREE.Vector2(
        (tile.lonMax - tile.lonMin) * KM_LON * 1000 / Math.max(iw - 1, 1),
        (tile.latMax - tile.latMin) * KM_LAT * 1000 / Math.max(ih - 1, 1)) },
      geo: { value: new THREE.Vector4(ORIGIN.lon, ORIGIN.lat, KM_LON, KM_LAT) },
      sun: { value: new THREE.Vector3(0.55, 0.72, 0.42).normalize() },
      fogCol: { value: new THREE.Color(HAZE) },
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
      uniform float vexf;
      uniform vec4 clip;
      uniform vec2 mpp;      // 칸 하나가 덮는 실제 거리 (m) — 동서, 남북
      uniform vec4 geo;      // 기준 경도·위도와 1도의 km
      varying vec2 vUv;
      varying float vH;
      varying vec3 vWorld;
      float height(vec2 uv){
        vec3 c = texture2D(hmap, uv).rgb;
        return (c.r * 255.0 * 256.0 + c.g * 255.0) - 6000.0;
      }
      // 실제 지중해 해안선. 바다냐 뭍이냐는 높이만으로 가릴 수 없다 —
      // 요르단 지구대와 아라바 골짜기는 해수면보다 낮지만 **마른 땅**이다.
      // 그걸 파랗게 칠하니 요단 골짜기가 통째로 강이 되어 있었다.
      float coastLon(float la){
        if (la < 31.29) return mix(33.900, 34.230, clamp((la-31.05)/0.24, 0.0, 1.0));
        if (la < 31.80) return mix(34.230, 34.620, (la-31.29)/0.51);
        if (la < 32.33) return mix(34.620, 34.840, (la-31.80)/0.53);
        if (la < 32.72) return mix(34.840, 34.935, (la-32.33)/0.39);
        if (la < 32.95) return mix(34.935, 35.074, (la-32.72)/0.23);
        if (la < 33.27) return mix(35.074, 35.190, (la-32.95)/0.32);
        return mix(35.190, 35.390, clamp((la-33.27)/0.33, 0.0, 1.0));
      }
      bool wetAt(float h, float la, float lo){
        if (h >= 0.0) return false;
        bool dry = false;
        if (la > 31.05 && la < 33.75 && lo > 34.20 && lo < 36.30) dry = lo > coastLon(la) + 0.06;
        if (la > 29.62 && la <= 31.05 && lo > 34.95 && lo < 35.80) dry = true;   // 아라바 골짜기
        if (la > 28.30 && la < 30.60 && lo > 25.80 && lo < 29.60) dry = true;   // 카타라 저지
        // 지구대 안에도 진짜 물은 있다 — 사해(수면 -430 m)와 갈릴리 바다(-210 m)
        if (la > 31.00 && la < 31.79 && lo > 35.32 && lo < 35.62 && h < -415.0) dry = false;
        if (la > 32.68 && la < 32.92 && lo > 35.47 && lo < 35.68 && h < -195.0) dry = false;
        return !dry;
      }
      vec3 ramp(float h, bool wet){
        // 표고 색 — 바다, 저지, 들, 구릉, 산, 눈
        if (wet)       return mix(vec3(0.06,0.16,0.25), vec3(0.13,0.31,0.42), clamp(h/-400.0+1.0,0.0,1.0));
        // 해수면보다 낮은 마른 땅 — 지구대 바닥의 먼지빛
        if (h < 0.0)   return mix(vec3(0.44,0.41,0.27), vec3(0.35,0.46,0.26), clamp(h/-450.0+1.0,0.0,1.0));
        if (h < 200.0) return mix(vec3(0.35,0.46,0.26), vec3(0.44,0.50,0.28), h/200.0);
        if (h < 500.0) return mix(vec3(0.44,0.50,0.28), vec3(0.55,0.51,0.30), (h-200.0)/300.0);
        if (h < 900.0) return mix(vec3(0.55,0.51,0.30), vec3(0.58,0.46,0.32), (h-500.0)/400.0);
        if (h <1600.0) return mix(vec3(0.58,0.46,0.32), vec3(0.52,0.44,0.40), (h-900.0)/700.0);
        return mix(vec3(0.52,0.44,0.40), vec3(0.88,0.89,0.92), clamp((h-1600.0)/900.0,0.0,1.0));
      }
      // 칸과 칸 사이를 **이어서** 읽는다.
      //
      // 높이 값은 칸마다 딱 떨어지게 담겨 있어서, 그냥 읽으면 다가갈수록
      // 110 m 짜리 네모가 드러난다 — 레고처럼 보이던 것이 그것이다.
      // 이웃한 네 칸을 섞어 읽으면 색도 그늘도 매끄럽게 이어진다.
      // (땅의 모양 자체는 판의 꼭짓점 간격만큼만 자세하다. 그건 자료가
      //  가진 만큼이지 그리는 방법의 문제가 아니다)
      // 값 잡음 — 110 m 자료가 담지 못하는 바위결을 손으로 얹는다.
      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.545); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float hLin(vec2 uv){
        vec2 p = uv / texel - 0.5;
        vec2 f = fract(p);
        vec2 b = (floor(p) + 0.5) * texel;
        return mix(mix(height(b), height(b + vec2(texel.x, 0.0)), f.x),
                   mix(height(b + vec2(0.0, texel.y)), height(b + texel), f.x), f.y);
      }
      void main(){
        // 가나안 판이 맡은 자리는 넘기고 그리지 않는다 — 겹치면 서로 파고든다
        if (vWorld.x > clip.x && vWorld.x < clip.z &&
            vWorld.z > clip.y && vWorld.z < clip.w) discard;
        float h  = hLin(vUv);
        float hl = hLin(vUv - vec2(texel.x, 0.0));
        float hr = hLin(vUv + vec2(texel.x, 0.0));
        float hu = hLin(vUv - vec2(0.0, texel.y));
        float hd = hLin(vUv + vec2(0.0, texel.y));
        // 그늘은 **실제 땅 거리**로 잰다. 예전에는 칸 하나를 무조건 0.02 로
        // 쳤는데, 가나안 판은 한 칸이 110 m 이고 넓은 판은 1.4 km 다 —
        // 같은 잣대를 대니 넓은 판이 열세 배 세게 그늘져서 두 판이 만나는
        // 자리에 네모난 테두리가 드러났다.
        vec3 n = normalize(vec3((hl - hr) * vexf / (2.0 * mpp.x), 1.0,
                                (hu - hd) * vexf / (2.0 * mpp.y)));
        float lo = geo.x + vWorld.x / geo.z;
        float la = geo.y - vWorld.z / geo.w;
        bool wet = wetAt(h, la, lo);
        float d = length(vWorld - cameraPosition);

        // 손으로 얹던 잔결과 돌빛은 걷어냈다. 실측 자료가 제 결을 가지고
        // 있으니 지어낸 무늬를 덧바를 까닭이 없다.
        vec3 col = ramp(h, wet);
        float lam = clamp(dot(n, sun), 0.0, 1.0);
        float sky = 0.5 + 0.5 * n.y;
        col *= vec3(1.02,0.99,0.94) * (0.30 + 0.80 * lam)
             + vec3(0.42,0.48,0.56) * (0.30 * sky);
        if (wet) col = mix(col, vec3(0.10,0.25,0.36), 0.55);

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

// ── 가까이 볼 때의 촘촘한 조각 ──────────────────────────────
//
// 가나안 판은 3000×3400 칸(110 m)짜리 그림을 600×680 꼭짓점으로 세운다 —
// 꼭짓점 하나가 550 m 를 맡는 셈이라, 다가가면 땅이 뭉개져 보였다.
// 그래서 **카메라가 보는 자리만** 따로 촘촘하게 뜬다. 자료를 더 받지 않고
// 같은 그림에서 조각만 다시 뜨는 것이라 값이 싸다.
//
// 겹치면 서로 파고들므로, 밑에 깔린 큰 판에게는 그 네모를 비우라고 이른다.
// 켜 두면 한 손가락으로 끌 때 자리를 옮기지 않고 **고개만 돌린다** —
// 높이는 그대로 두고 사방을 둘러볼 수 있다.
let lookMode = false, lookBtn = null;
let baseCanaan = null, canaanTex = null, canaanTile = null;
let detailMesh = null, detailWin = null;

function setBaseClip(r) {
  if (!baseCanaan) return;
  baseCanaan.material.uniforms.clip.value.set(
    r ? r.x : 0, r ? r.z : 0, r ? r.x + r.w : -1, r ? r.z + r.d : -1);
}

function dropDetail() {
  if (!detailMesh) return;
  scene.remove(detailMesh);
  detailMesh.geometry.dispose(); detailMesh.material.dispose();
  detailMesh = null; detailWin = null;
  setBaseClip(null);
}

function updateDetail() {
  if (!baseCanaan || !canaanTex) return;
  if (cam.dist > 200) { dropDetail(); return; }   // 멀리서는 큰 판으로 넉넉하다

  const half = Math.max(6, Math.min(70, cam.dist * 1.15));
  const need = !detailWin
    || Math.abs(cam.tx - detailWin.cx) > half * 0.3
    || Math.abs(cam.tz - detailWin.cz) > half * 0.3
    || Math.abs(Math.log(cam.dist / detailWin.dist)) > 0.5;
  if (!need) return;

  const t = canaanTile;
  const tx0 = worldX(t.lonMin), tx1 = worldX(t.lonMax);
  const tz0 = worldZ(t.latMax), tz1 = worldZ(t.latMin);
  const x = Math.max(tx0, cam.tx - half), z = Math.max(tz0, cam.tz - half);
  const w = Math.min(tx1, cam.tx + half) - x, d = Math.min(tz1, cam.tz + half) - z;
  if (w < 2 || d < 2) { dropDetail(); return; }   // 타일 밖이면 그만둔다

  // 그림이 가진 것보다 촘촘히 뜰 까닭은 없다. 칸 크기는 **그림에게 묻는다** —
  // 더 촘촘한 지형을 구워 올리면 조각도 저절로 그만큼 촘촘해진다.
  const iw = (canaanTex.image && canaanTex.image.width) || t.w;
  const step = Math.max(25, (t.lonMax - t.lonMin) * 94600 / Math.max(iw - 1, 1));
  const segX = Math.min(1100, Math.max(80, Math.round(w * 1000 / step)));
  const segZ = Math.min(1100, Math.max(80, Math.round(d * 1000 / step)));

  if (detailMesh) { scene.remove(detailMesh); detailMesh.geometry.dispose(); detailMesh.material.dispose(); }
  detailMesh = makeTerrain(t, segX, segZ, canaanTex, null, { x, z, w, d });
  detailMesh.renderOrder = 1;
  scene.add(detailMesh);
  detailWin = { cx: cam.tx, cz: cam.tz, dist: cam.dist, x, z, w, d };
  setBaseClip(detailWin);
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
      const s = el._site; if (s) { flyTo(s); showCard(s); }
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
  updateStopMarks();
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── 카메라 몰기 ───────────────────────────────────────────
function applyCam() {
  cam.el = Math.max(0.12, Math.min(1.5, cam.el));
  // 높이 자료가 110 m 눈금이다. 그보다 더 다가가면 보여 줄 것이 없고
  // 뭉개진 화면만 남는다 — 3 km 에서 멈춘다.
  cam.dist = Math.max(3.0, Math.min(4200, cam.dist));
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
  updateDetail();
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
  let mode = null, last = null, twoD = 0, twoA = 0, twoMid = null;

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
      twoA = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
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
      // 지도를 만지는 손버릇 그대로 — 오므리면 확대, 나란히 밀면 **옮기기**,
      // **비틀면** 돌리기. 예전에는 나란히 미는 것이 돌리기라 어색했다.
      // 기울이는 것은 손가락으로 가리기 어려워 ⌃ ⌄ 단추에 맡긴다.
      const a = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
      if (twoD > 0 && d > 0) cam.dist *= twoD / d;
      let da = a - twoA;
      while (da >  Math.PI) da -= 2.0 * Math.PI;
      while (da < -Math.PI) da += 2.0 * Math.PI;
      if (Math.abs(da) < 0.5) { cam.az += da; if (following) followAzOff += da; }
      // 세로로 함께 밀면 **기울이기**, 가로로 밀면 옮기기.
      // (한 손가락이 이미 아무 쪽으로나 옮겨 주므로 세로는 각도에 내준다)
      cam.el += (mid.y - twoMid.y) * 0.005;
      if (following) { followAzOff -= (mid.x - twoMid.x) * 0.004; cam.az -= (mid.x - twoMid.x) * 0.004; }
      else panBy(mid.x - twoMid.x, 0);
      twoD = d; twoA = a; twoMid = mid;
      applyCam();
      return;
    }
    if (!last || !mode) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    // 따라가는 중에는 **둘러보기**가 된다 — 걸음은 멈추지 않는다
    if (following)        { followAzOff -= dx * 0.005; cam.az -= dx * 0.005; cam.el += dy * 0.005; }
    else if (lookMode || mode === 'orbit') { cam.az -= dx * 0.005; cam.el += dy * 0.005; }
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
  cam.dist = Math.max(3.0, Math.min(4200, cam.dist * f));
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
  // 넣는 차례가 거꾸로다 (맨 앞에 끼우므로).
  // 확대·각도 단추는 걷어냈다 — 바퀴와 손가락이 이미 하는 일이다.
  mk('⇢', L.s('길', 'Journeys'), openRoutes);
  lookBtn = mk('◎', L.s('둘러보기 — 제자리에서 사방을 본다', 'Look around'), () => {
    lookMode = !lookMode;
    lookBtn.style.background = lookMode ? 'rgba(253,204,97,.25)' : '';
  });
  const qName = { low: L.s('하', 'Low'), mid: L.s('중', 'Mid'), hi: L.s('상', 'High') };
  const qBtn = mk(qName[QUAL], L.s('화질 — 누르면 상·중·하로 돕니다', 'Detail'), () => {
    const nx = QUALS[(QUALS.indexOf(QUAL) + 1) % 3];
    try { localStorage.setItem('theland.qual', nx); } catch (e) {}
    location.reload();
  });
  qBtn.style.fontWeight = '700';

  // 데이터로 들어온 듯하면 한 번만 알려 준다
  if (qualAuto && QUAL === 'low') toast(L.s(
    '데이터 연결로 보여 지형을 가볍게(하) 열었습니다. 위 「하」를 눌러 올릴 수 있습니다.',
    'Looks like a mobile connection — opened at low detail. Tap “Low” above to raise it.'));
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
  // 앱처럼 표고도 알려 준다 (땅 높이는 이미 읽어 두었다)
  const m = Math.round(groundY(lat, lon) / (0.001 * VEXAG));
  document.getElementById('hudSub').innerHTML =
    (best ? escapeHTML(L.region(best.region)) + ' · ' : '') +
    '<b>' + m + ' m</b> · ' + lat.toFixed(3) + '°N ' + lon.toFixed(3) + '°E';
}

// ── 옆 판 ─────────────────────────────────────────────────
const panel = document.getElementById('panel');
function openPlace(s) {
  panelIsRoutes = false;
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
  flyTo(s); showCard(s);
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
let ROADS = [], PRESETS = [], WAYS = [];
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

/** 점들을 부드러운 곡선으로 흘린다 (캣멀-롬).
 *
 *  옛길 자료는 몇 십 km 마다 한 점이라, 곧게 이으면 각진 꺾은선이 된다.
 *  실제 길은 그렇게 다니지 않는다. 점 네 개를 보고 사이를 굽혀 준다. */
function smoothPath(pts, stepKm) {
  if (pts.length < 3) return densify(pts, stepKm);
  const P = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    const n = Math.max(1, Math.ceil(kmLL(b, c) / stepKm));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (p, q, r, s) => 0.5 * (2 * q + (r - p) * t
        + (2 * p - 5 * q + 4 * r - s) * t2 + (-p + 3 * q - 3 * r + s) * t3);
      out.push({ lat: f(a.lat, b.lat, c.lat, d.lat), lon: f(a.lon, b.lon, c.lon, d.lon) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 이 점이 어느 호수 안인가 — 길이 물 위를 지나가지 않게 */
function inLake(lat, lon) {
  for (const l of LAKES) {
    let inside = false, r = l.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][0] > lat) !== (r[j][0] > lat) &&
          lon < (r[j][1] - r[i][1]) * (lat - r[i][0]) / (r[j][0] - r[i][0]) + r[i][1]) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** 물에 잠기는 토막은 끊어 내고 나머지만 얹는다 */
function addDryRuns(group, pts, widthKm, color, lift, opt) {
  let run = [];
  const flush = () => { if (run.length > 1) group.add(makeRibbon(run, widthKm, color, lift, opt)); run = []; };
  for (const p of pts) { if (inLake(p.lat, p.lon)) flush(); else run.push(p); }
  flush();
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

/** 길·강을 땅 위에 얹는다.
 *
 *  예전에는 깊이 견주기를 꺼서 언덕 뒤의 길까지 다 비쳐 보였다 — 그래서
 *  지도 위에 **붕 떠 있는** 느낌이 났다. 이제는 땅이 앞을 가리면 가려지고,
 *  대신 다각형 오프셋으로 땅에 파묻히는 것만 막는다. */
function makeRibbon(pts, widthKm, color, lift, opt) {
  opt = opt || {};
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
    color, transparent: true, opacity: opt.opacity != null ? opt.opacity : 0.9,
    depthTest: opt.through !== true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 }));
  m.renderOrder = opt.order || 5;
  m.frustumCulled = false;
  return m;
}



// ── 땅에 붙는 실 ──────────────────────────────────────────
//
// 길을 리본으로 얹어 놓으니 두 가지가 어긋났다.
//   · 땅이 여기저기 **파먹은** 것처럼 길을 삼켰다 — 리본의 높이는 성긴
//     격자에서 읽고 땅은 110 m 로 그리니, 능선마다 땅이 이겼다.
//   · 가장자리가 칼로 자른 듯해서 **형광펜**이나 **테이프**로 붙인 것 같았다.
//
// 그래서 실도 지형과 **똑같은 그림에서** 제 높이를 읽게 한다(꼭짓점 셰이더).
// 땅이 아무리 촘촘해져도 길은 늘 그 위에 앉는다. 가장자리는 투명하게
// 스러지게 해서 띠가 아니라 실로 보이게 한다.
let hTexA = null, hTexB = null, hBoundA = null, hBoundB = null;

function tileBounds(t) {
  const x0 = worldX(t.lonMin), z0 = worldZ(t.latMax);
  return new THREE.Vector4(x0, z0, worldX(t.lonMax) - x0, worldZ(t.latMin) - z0);
}

function drapeMaterial(color, opacity, lift, through) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: through !== true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true,
    polygonOffsetFactor: -8, polygonOffsetUnits: -12,
    uniforms: {
      hA: { value: hTexA }, bA: { value: hBoundA || new THREE.Vector4(0,0,1,1) },
      hB: { value: hTexB || hTexA }, bB: { value: hBoundB || hBoundA || new THREE.Vector4(0,0,1,1) },
      hasB: { value: hTexB ? 1 : 0 },
      vex: { value: VEXAG }, lift: { value: lift },
      tint: { value: new THREE.Color(color) }, alpha: { value: opacity }
    },
    vertexShader: [
      'uniform sampler2D hA; uniform vec4 bA;',
      'uniform sampler2D hB; uniform vec4 bB;',
      'uniform float hasB, vex, lift;',
      'attribute float edge;',
      'varying float vEdge;',
      'float dec(vec3 c){ return (c.r * 255.0 * 256.0 + c.g * 255.0) - 6000.0; }',
      'void main(){',
      '  vec3 p = position;',
      '  vec2 ua = vec2((p.x - bA.x) / bA.z, 1.0 - (p.z - bA.y) / bA.w);',
      '  float h;',
      '  if (ua.x > 0.001 && ua.x < 0.999 && ua.y > 0.001 && ua.y < 0.999) {',
      '    h = dec(texture2D(hA, ua).rgb);',
      '  } else if (hasB > 0.5) {',
      '    vec2 ub = vec2((p.x - bB.x) / bB.z, 1.0 - (p.z - bB.y) / bB.w);',
      '    h = dec(texture2D(hB, clamp(ub, 0.001, 0.999)).rgb);',
      '  } else { h = 0.0; }',
      '  p.y = h * 0.001 * vex + lift;',
      '  vEdge = edge;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 tint; uniform float alpha;',
      'varying float vEdge;',
      'void main(){',
      '  // 가장자리로 갈수록 스러지게 — 칼로 자른 띠가 아니라 실처럼',
      '  float a = alpha * (1.0 - vEdge * vEdge);',
      '  if (a < 0.01) discard;',
      '  gl_FragColor = vec4(tint, a);',
      '}'
    ].join('\n')
  });
}

/** 땅에 붙는 실 하나. 가운데가 진하고 가장자리는 스러진다. */
function drapeLine(pts, widthKm, color, lift, opt) {
  opt = opt || {};
  const pos = [], edge = [], idx = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, n - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = worldX(q.lon) - worldX(o.lon), dz = worldZ(q.lat) - worldZ(o.lat);
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * widthKm / 2, nz = dx / len * widthKm / 2;
    const x = worldX(p.lon), z = worldZ(p.lat);
    pos.push(x + nx, 0, z + nz);  edge.push(1);
    pos.push(x, 0, z);            edge.push(0);
    pos.push(x - nx, 0, z - nz);  edge.push(1);
    if (i < n - 1) {
      const a = i * 3, b = a + 3;
      idx.push(a, a+1, b,  a+1, b+1, b,  a+1, a+2, b+1,  a+2, b+2, b+1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, drapeMaterial(color, opt.opacity != null ? opt.opacity : 0.8,
                                            lift, opt.through));
  m.renderOrder = opt.order || 5;
  m.frustumCulled = false;
  return m;
}

/** 물에 잠기는 토막은 끊어 내고 나머지만 얹는다 */
function drapeRuns(group, pts, widthKm, color, lift, opt) {
  let run = [];
  const flush = () => { if (run.length > 1) group.add(drapeLine(run, widthKm, color, lift, opt)); run = []; };
  for (const p of pts) { if (inLake(p.lat, p.lon)) flush(); else run.push(p); }
  flush();
}

/** 길 위에 화살표를 촘촘히 박는다 — 어느 쪽으로 가는 길인지 한눈에 */
function makeArrows(pts, sizeKm, color, lift, opt) {
  opt = opt || {};
  const v = [], idx = [];
  const step = sizeKm * 2.8;
  let acc = step, n = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += kmLL(pts[i - 1], pts[i]);
    if (acc < step) continue;
    acc = 0;
    const a = pts[i - 1], b = pts[i];
    let dx = worldX(b.lon) - worldX(a.lon), dz = worldZ(b.lat) - worldZ(a.lat);
    const len = Math.hypot(dx, dz); if (len < 1e-6) continue;
    dx /= len; dz /= len;
    const px = -dz, pz = dx;
    const x = worldX(b.lon), z = worldZ(b.lat), y = groundY(b.lat, b.lon) + lift;
    const t = sizeKm, w = sizeKm * 0.6;
    const base = n * 3;
    v.push(x + dx * t, y, z + dz * t);
    v.push(x - dx * t * 0.45 + px * w, y, z - dz * t * 0.45 + pz * w);
    v.push(x - dx * t * 0.45 - px * w, y, z - dz * t * 0.45 - pz * w);
    idx.push(base, base + 1, base + 2);
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: opt.opacity != null ? opt.opacity : 0.95,
    depthTest: opt.through !== true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -10 }));
  m.renderOrder = opt.order || 7;
  m.frustumCulled = false;
  return m;
}

function disposeObj(o) {
  if (!o) return;
  o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
}

// ── 들르는 곳 표시 ────────────────────────────────────────
//
// 길만 그어 놓으면 어디가 출발이고 어디가 도착인지 알 수가 없다.
// 앱처럼 **눈에 바로 보이게** — 땅에는 기둥을, 화면에는 이름표를 세운다.
const markPool = [];
let markPins = null;
const SLOT_COLOR = { start: 0x6fd08a, via: 0xf2b64c, end: 0xff8a6a };

function buildPins() {
  if (markPins) { scene.remove(markPins); disposeObj(markPins); markPins = null; }
  if (!routeStops.length) return;
  markPins = new THREE.Group();
  for (const s of routeStops) {
    const slot = slotOf(s) || 'via';
    const g = new THREE.ConeGeometry(0.55, 2.4, 6);
    g.translate(0, 1.2, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: SLOT_COLOR[slot], transparent: true, opacity: 0.92, depthTest: false }));
    m.position.set(s.x, s.y + 0.1, s.z);
    m.renderOrder = 8;
    m.frustumCulled = false;
    markPins.add(m);
  }
  scene.add(markPins);
}

function updateStopMarks() {
  const need = routeStops.length;
  while (markPool.length < need) {
    const el = document.createElement('div');
    el.className = 'rmark';
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const s = el._site; if (s) { flyTo(s); showCard(s); }
    });
    labelRoot.appendChild(el);
    markPool.push(el);
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < markPool.length; i++) {
    const el = markPool[i];
    if (i >= need) { el.style.display = 'none'; continue; }
    const s = routeStops[i];
    el._site = s;
    v.set(s.x, s.y + 2.6, s.z).project(camera);
    if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) { el.style.display = 'none'; continue; }
    const slot = slotOf(s) || 'via';
    const nth = slot === 'via' ? plan.via.indexOf(s) + 1 : 0;
    el.className = 'rmark ' + slot;
    el.textContent = (slot === 'start' ? L.s('출발', 'Start')
                    : slot === 'end'   ? L.s('도착', 'End')
                    : L.s('경유', 'Via') + (plan.via.length > 1 && nth ? ' ' + nth : ''))
                    + ' · ' + L.place(s.ko);
    el.style.display = '';
    el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
    el.style.top  = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  }
}

const markCSS = document.createElement('style');
markCSS.textContent =
  '.rmark{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;pointer-events:auto;' +
  'cursor:pointer;font:600 11.5px/1 system-ui;padding:5px 9px;border-radius:11px;' +
  'color:#10130f;box-shadow:0 2px 10px rgba(0,0,0,.55);z-index:2}' +
  '.rmark.start{background:#6fd08a}.rmark.via{background:#f2b64c}.rmark.end{background:#ff8a6a}';
document.head.appendChild(markCSS);

// ── 따라가기 ──────────────────────────────────────────────
//
// 길을 그려 놓고 보기만 하면 지도지, 여정이 아니다. 길 위를 실제로 걸어야
// 골짜기와 고개가 눈에 들어온다. 카메라를 길 위에 얹고 앞을 보게 한다.
let following = false, followKm = 0, followTotal = 0, lastT = 0, lastStop = -1;
// 따라가는 중에 손으로 돌려본 만큼 — 나아가는 쪽에서 얼마나 비껴 보는가
let followAzOff = 0;

function routeLenTo(i) {
  let d = 0;
  for (let k = 1; k <= i && k < routePts.length; k++) d += kmLL(routePts[k - 1], routePts[k]);
  return d;
}

function followAt(km) {
  let acc = 0;
  for (let i = 1; i < routePts.length; i++) {
    const seg = kmLL(routePts[i - 1], routePts[i]);
    if (acc + seg >= km) {
      const t = seg > 0 ? (km - acc) / seg : 0;
      const a = routePts[i - 1], b = routePts[i];
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t,
               dlat: b.lat - a.lat, dlon: b.lon - a.lon };
    }
    acc += seg;
  }
  const e = routePts[routePts.length - 1], p = routePts[routePts.length - 2] || e;
  return { lat: e.lat, lon: e.lon, dlat: e.lat - p.lat, dlon: e.lon - p.lon };
}

function toggleFollow() {
  if (!routePts || routePts.length < 2) return false;
  following = !following;
  if (following) {
    followTotal = routeLenTo(routePts.length - 1);
    if (followKm >= followTotal - 0.5) followKm = 0;
    lastT = performance.now(); lastStop = -1; followAzOff = 0;
    cam.dist = Math.min(cam.dist, 26);
    cam.el = Math.min(cam.el, 0.42);
  }
  return following;
}

function stepFollow() {
  if (!following || !routePts) return;
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  // 마흔 초쯤에 다 걷도록 — 길이가 얼마든 지루하지 않게
  followKm += dt * Math.max(2, followTotal / 40);
  if (followKm >= followTotal) { followKm = followTotal; following = false; }

  const p = followAt(followKm);
  cam.tx = worldX(p.lon); cam.tz = worldZ(p.lat);
  const dx = p.dlon * KM_LON, dz = -p.dlat * KM_LAT;
  if (Math.hypot(dx, dz) > 1e-6) {
    // 카메라는 뒤에 서서 나아가는 쪽을 본다
    let want = Math.atan2(-dx, -dz) + followAzOff;   // 손으로 비껴 본 만큼 더해서
    let da = want - cam.az;
    while (da >  Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    cam.az += da * Math.min(1, dt * 2.2);
  }
  applyCam();

  for (let i = 0; i < routeStops.length; i++) {
    if (i <= lastStop) continue;
    const s = routeStops[i];
    if (Math.hypot(worldX(s.lon) - cam.tx, worldZ(s.lat) - cam.tz) < 4) {
      lastStop = i; showCard(s); break;
    }
  }
}

function clearRoute() {
  if (routeMesh) { scene.remove(routeMesh); disposeObj(routeMesh); }
  routeMesh = null; routePts = null; routeStops = [];
  if (markPins) { scene.remove(markPins); disposeObj(markPins); markPins = null; }
  following = false; followKm = 0;
  highlight = null;
}

function drawRoute() {
  if (routeMesh) { scene.remove(routeMesh); disposeObj(routeMesh); routeMesh = null; }
  if (!routePts || routePts.length < 2) return;
  ribbonDist = cam.dist;
  // 굵은 형광펜 한 줄이 아니라 **길잡이 화살표**로 — 어느 쪽으로 가는지가
  // 먼저 보여야 한다. 가느다란 실선 위에 화살표를 촘촘히 박는다.
  const w = Math.max(0.26, cam.dist * 0.0020);
  routeMesh = new THREE.Group();
  routeMesh.add(drapeLine(routePts, w * 2.2, 0xf2b64c, 0.02,
                          { through: true, opacity: 0.70, order: 6 }));
  routeMesh.add(makeArrows(routePts, Math.max(0.9, cam.dist * 0.0075), 0xffd27a, 0.10,
                           { through: true, opacity: 0.95, order: 7 }));
  scene.add(routeMesh);
}

/** 들름 목록으로 길을 세운다 */
function setRoute(stops) {
  routeStops = stops.filter(Boolean);
  if (routeStops.length < 2) { routePts = null; drawRoute(); buildPins(); return 0; }
  let pts = [];
  for (let i = 0; i < routeStops.length - 1; i++) {
    const seg = smoothPath(roadPath(routeStops[i], routeStops[i + 1]), 0.15);
    pts = pts.concat(i ? seg.slice(1) : seg);
  }
  routePts = pts;
  drawRoute();
  buildPins();
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
    // 땅을 촘촘히 따라가야 능선에서 파먹히지 않는다 (110 m 마디)
    const pts = smoothPath(r.pts.map(p => ({ lat: p[0], lon: p[1] })), 0.12);
    const wide = Math.max(0.30, cam.dist * 0.0013) * (r.rank === 0 ? 1.6 : 1);
    drapeRuns(roadsMesh, pts, wide, r.rank === 0 ? 0xd9c8a4 : 0xc3b190, 0.012,
              { opacity: r.rank === 0 ? 0.55 : 0.34, order: 4 });
  }
  scene.add(roadsMesh);
  return true;
}


// ── 물 ────────────────────────────────────────────────────
//
// 높이만으로는 물을 그릴 수 없다. 훌라 호는 20세기에 물을 빼 버려 실측
// 고도에 자취가 없고(그래서 웹판에서 말라 있었다), 소금 바다는 지금보다
// 성서 시대에 훨씬 넓었다. 그래서 앱과 똑같이 **옛 물가를 손으로 그린
// 테두리**를 쓰고, 그 안을 수면 높이로 덮는다.
const LAKES = [
  { ko: '갈릴리 바다', level: -211, ring: [
    [32.8850,35.6220],[32.8696,35.6380],[32.8542,35.6440],[32.8387,35.6460],
    [32.8233,35.6440],[32.8079,35.6400],[32.7925,35.6400],[32.7771,35.6360],
    [32.7617,35.6360],[32.7463,35.6320],[32.7308,35.6220],[32.7154,35.6080],
    [32.7154,35.5780],[32.7308,35.5740],[32.7463,35.5700],[32.7617,35.5620],
    [32.7771,35.5480],[32.7925,35.5460],[32.8079,35.5320],[32.8233,35.5200],
    [32.8387,35.5240],[32.8542,35.5360],[32.8696,35.5560],[32.8850,35.5900]] },
  // 성서 시대 수면(-393 m). 지금은 말라붙은 북단·남단까지 물이 차 있었다.
  { ko: '소금 바다', level: -393, ring: [
    [31.7548,35.5880],[31.7195,35.5880],[31.6843,35.5760],[31.6490,35.5720],
    [31.6138,35.5640],[31.5786,35.5540],[31.5433,35.5560],[31.5081,35.5580],
    [31.4729,35.5740],[31.4376,35.5640],[31.4024,35.5540],[31.3671,35.5460],
    [31.3319,35.5460],[31.2967,35.5200],[31.2614,35.4200],[31.2262,35.4520],
    [31.1910,35.5180],[31.1557,35.5240],[31.1205,35.5140],[31.0852,35.4940],
    [31.0852,35.4480],[31.1205,35.4560],[31.1557,35.4520],[31.1910,35.4260],
    [31.2262,35.4000],[31.2614,35.3780],[31.2967,35.3900],[31.3319,35.4000],
    [31.3671,35.3880],[31.4024,35.3940],[31.4376,35.3860],[31.4729,35.4000],
    [31.5081,35.3980],[31.5433,35.3980],[31.5786,35.4120],[31.6138,35.4120],
    [31.6490,35.4300],[31.6843,35.4480],[31.7195,35.4580],[31.7548,35.4960]] },
  // 20세기에 물을 빼 버려 실측 고도에는 자취가 없다. 옛 물가를 손으로 그렸다.
  { ko: '훌라 호', level: 66, ring: [
    [33.1010,35.6010],[33.0960,35.6160],[33.0840,35.6250],[33.0670,35.6280],
    [33.0510,35.6230],[33.0430,35.6100],[33.0450,35.5960],[33.0560,35.5880],
    [33.0730,35.5860],[33.0900,35.5900]] }
];

/** 테두리 하나를 삼각형으로 자른다 (귀 자르기) */
function earClip(pts) {
  const n = pts.length, idx = [...Array(n).keys()], out = [];
  const area2 = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += pts[i][0]*pts[(i+1)%n][1] - pts[(i+1)%n][0]*pts[i][1];
  if (sum < 0) idx.reverse();
  let guard = 0;
  while (idx.length > 3 && guard++ < 4000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i + idx.length - 1) % idx.length]];
      const b = pts[idx[i]], c = pts[idx[(i + 1) % idx.length]];
      if (area2(a, b, c) <= 0) continue;
      let inside = false;
      for (const k of idx) {
        const p = pts[k];
        if (p === a || p === b || p === c) continue;
        if (area2(a,b,p) >= 0 && area2(b,c,p) >= 0 && area2(c,a,p) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      out.push([pts.indexOf(a), pts.indexOf(b), pts.indexOf(c)]);
      idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

function addLakes() {
  for (const l of LAKES) {
    const tri = earClip(l.ring);
    const v = [], idx = [];
    const y = l.level * 0.001 * VEXAG + 0.02;
    for (const p of l.ring) v.push(worldX(p[1]), y, worldZ(p[0]));
    for (const t of tri) idx.push(t[0], t[1], t[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0x1d4e6b, transparent: true, opacity: 0.93, side: THREE.DoubleSide }));
    m.renderOrder = 2;
    m.frustumCulled = false;
    scene.add(m);
  }
}

/** 강과 급류 골짜기 — 땅 위에 파란 실로 얹는다 */
let riverMesh = null;
function addRivers() {
  if (riverMesh) return;
  riverMesh = new THREE.Group();
  for (const r of WAYS) {
    if (!r.pts || r.pts.length < 2) continue;
    const pts = smoothPath(r.pts.map(p => ({ lat: p[0], lon: p[1] })), 0.12);
    // 실제 강폭은 수십 미터라 그대로 그리면 안 보인다. 눈에 잡히는 굵기로
    // 올리되, 큰 강과 마른 급류 골짜기는 구별되게 둔다.
    const wide = Math.max(0.35, Math.min(1.6, (r.widthM || 30) / 90));
    // 마른 골짜기도 물길로 그린다 — 우기에는 실제로 물이 흐르던 곳이다.
    // 다만 큰 강보다는 옅게 두어 구별이 되게 한다.
    const dry = (r.ko || '').indexOf('급류') >= 0 || (r.ko || '').indexOf('와디') >= 0;
    drapeRuns(riverMesh, pts, Math.max(wide, dry ? 0.45 : 0.55),
              dry ? 0x4d87a6 : 0x2f6f95, 0.010,
              { opacity: dry ? 0.55 : 0.8, order: 3 });
  }
  scene.add(riverMesh);
}

// ── 아래쪽 카드 — 앱과 같은 모양 ────────────────────────────
//
// 지명을 누르면 곧바로 긴 글이 펼쳐지던 것을 고친다. 앱처럼 아래에 얇은
// 카드가 뜨고, 거기서 **출발·경유·도착**을 정하거나 이름을 눌러 기록을 편다.
const plan = { start: null, via: [], end: null };
let cardSite = null;

function planStops() { return [plan.start, ...plan.via, plan.end].filter(Boolean); }
function slotOf(s) {
  if (plan.start === s) return 'start';
  if (plan.end === s) return 'end';
  return plan.via.indexOf(s) >= 0 ? 'via' : null;
}
function unassign(s) {
  if (plan.start === s) plan.start = null;
  if (plan.end === s) plan.end = null;
  const i = plan.via.indexOf(s); if (i >= 0) plan.via.splice(i, 1);
}
function assign(s, slot) {
  const was = slotOf(s);
  unassign(s);
  if (was !== slot) {
    if (slot === 'start') plan.start = s;
    else if (slot === 'end') plan.end = s;
    else plan.via.push(s);
  }
  setRoute(planStops());
  showCard(s);
  if (panelIsRoutes) openRoutes();
}

let cardEl = null;
function showCard(s) {
  cardSite = s;
  if (!cardEl) {
    cardEl = document.createElement('div');
    cardEl.id = 'card';
    document.body.appendChild(cardEl);
    cardEl.addEventListener('click', ev => {
      const slot = ev.target.dataset.slot;
      if (slot) { assign(cardSite, slot); return; }
      if (ev.target.id === 'cX') { cardEl.classList.remove('on'); highlight = null; return; }
      if (ev.target.closest('#cName')) openPlace(cardSite);
    });
  }
  const eps = (byPlace.get(s.ko) || []).length;
  const note = NOTES.has(s.ko);
  const here = slotOf(s);
  const pill = (k, t) => '<button class="cslot' + (here === k ? ' on' : '') + '" data-slot="' + k + '">' + t + '</button>';
  cardEl.innerHTML =
    '<div id="cName">' + escapeHTML(L.place(s.ko)) + (eps || note ? ' <i>▤</i>' : '') +
    '<small>' + escapeHTML(L.region(s.region)) +
    ' · ' + Math.round(s.y / (0.001 * VEXAG)) + ' m' +
    ' · ' + s.lat.toFixed(3) + '°N ' + s.lon.toFixed(3) + '°E' +
    (eps ? ' · <b>' + L.s('사건 ' + eps, eps + ' records') + '</b>' : '') + '</small></div>' +
    '<span class="cgap"></span>' +
    pill('start', L.s('출발', 'Start')) + pill('via', L.s('경유', 'Via')) + pill('end', L.s('도착', 'End')) +
    '<button id="cX">✕</button>';
  cardEl.classList.add('on');
}

const cardCSS = document.createElement('style');
cardCSS.textContent =
  '#card{position:fixed;left:50%;bottom:14px;transform:translate(-50%,120%);z-index:25;' +
  'display:flex;align-items:center;gap:6px;max-width:min(620px,94vw);width:max-content;' +
  'padding:9px 8px 9px 14px;border-radius:15px;background:var(--panel);' +
  'border:1px solid var(--line);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
  'transition:transform .2s ease;opacity:0;pointer-events:none}' +
  '#card.on{transform:translate(-50%,0);opacity:1;pointer-events:auto}' +
  '#cName{font:600 15px/1.25 Georgia,"Apple SD Gothic Neo",serif;color:var(--ink);cursor:pointer;' +
  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}' +
  '#cName i{font-style:normal;color:var(--gold);font-size:11px}' +
  '#cName small{display:block;font:400 10.5px/1.4 system-ui;color:rgba(255,255,255,.55)}' +
  '#cName small b{color:rgba(253,204,97,.85);font-weight:400}' +
  '.cgap{flex:1;min-width:8px}' +
  '.cslot{border:0;font:600 12px/1 inherit;color:rgba(255,255,255,.9);cursor:pointer;' +
  'padding:0 12px;height:30px;border-radius:15px;background:rgba(255,255,255,.14)}' +
  '.cslot.on{background:#f5e6c2;color:rgba(0,0,0,.85)}' +
  '#cX{border:0;background:none;color:rgba(255,255,255,.6);font:14px/1 inherit;' +
  'cursor:pointer;width:26px;height:26px;border-radius:13px}' +
  '#cX:hover{background:rgba(255,255,255,.1)}' +
  '@media (max-width:560px){#card{left:8px;right:8px;transform:translateY(120%);max-width:none;width:auto}' +
  '#card.on{transform:none}.cslot{padding:0 9px}}';
document.head.appendChild(cardCSS);

// ── 경로 판 ───────────────────────────────────────────────
let panelIsRoutes = false;
function openRoutes() {
  panelIsRoutes = true;
  document.getElementById('pTitle').textContent = L.s('길', 'Journeys');
  document.getElementById('pSub').textContent = L.s('옛길을 따라갑니다', 'Along the ancient roads');
  const b = document.getElementById('pb');
  const stops = planStops();
  let h = '<div class="note"><em>' + escapeHTML(L.s('내가 짠 길', 'Your own route')) + '</em>';
  if (stops.length) {
    h += stops.map(s => '<div class="rstop" data-go="' + s.i + '">' +
      escapeHTML(slotOf(s) === 'start' ? L.s('출발', 'Start')
               : slotOf(s) === 'end'   ? L.s('도착', 'End')
               : L.s('경유', 'Via')) + ' · ' + escapeHTML(L.place(s.ko)) +
      '<span data-del="' + s.i + '">✕</span></div>').join('');
    h += '<div style="margin-top:8px"><button class="rbtn" data-act="follow">' +
      escapeHTML(following ? L.s('멈추기', 'Stop') : L.s('따라가기', 'Travel it')) + '</button>' +
      '<button class="rbtn" data-act="fit">' + escapeHTML(L.s('길 전체 보기', 'Fit the route')) + '</button>' +
      '<button class="rbtn" data-act="clr">' + escapeHTML(L.s('비우기', 'Clear')) + '</button></div>';
  } else {
    h += escapeHTML(L.s('지명을 누르면 아래에 뜨는 카드에서 출발·경유·도착을 정합니다.',
                        'Tap a place, then set Start / Via / End on the card below.'));
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
    following = false; followKm = 0;
    const km = setRoute(p.stops.map(n => siteByName.get(n)).filter(Boolean));
    frameRoute();
    openRoutes();
    document.getElementById('pSub').textContent =
      Math.round(km) + L.s(' km · ' + p.stops.length + '곳', ' km · ' + p.stops.length + ' stops');
    return;
  }
  const del = ev.target.dataset.del;
  if (del != null) { unassign(SITES[+del]); setRoute(planStops()); openRoutes(); return; }
  const go = ev.target.closest('[data-go]');
  if (go) { const s = SITES[+go.dataset.go]; if (s) { flyTo(s); showCard(s); } return; }
  const act = ev.target.dataset.act;
  if (act === 'fit')  { following = false; frameRoute(); }
  if (act === 'follow') { toggleFollow(); openRoutes(); }
  if (act === 'clr')  { plan.start = null; plan.end = null; plan.via = [];
                        clearRoute(); openRoutes(); }
  if (act === 'roads'){ toggleRoads(); openRoutes(); }
});

const labSizeCSS = document.createElement('style');
labSizeCSS.textContent =
  // 상 — 큰 도시
  '.lab.r0{font-size:19px;font-weight:800;letter-spacing:.01em}' +
  '.lab.r1{font-size:15.5px;font-weight:700}' +
  // 중 — 성읍
  '.lab.r2{font-size:13.5px;font-weight:600}' +
  '.lab.r3{font-size:12.5px;font-weight:500}' +
  // 하 — 지형과 지역
  '.lab.r4,.lab.r5,.lab.r6,.lab.r7,.lab.r8,.lab.r9{font-size:12px}' +
  '.lab.r7{color:#a9cfe0}' +
  '@media (max-width:560px){.lab.r0{font-size:16px}.lab.r1{font-size:13.5px}' +
  '.lab.r2{font-size:12px}.lab.r3{font-size:11px}}';
document.head.appendChild(labSizeCSS);

/** 화면 아래에 잠깐 뜨는 알림 */
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 6000);
}
const toastCSS = document.createElement('style');
toastCSS.textContent =
  '.toast{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:40;' +
  'max-width:min(520px,92vw);padding:10px 14px;border-radius:12px;background:var(--panel);' +
  'border:1px solid var(--line);color:var(--ink);font-size:12.5px;line-height:1.5;' +
  'backdrop-filter:blur(12px);transition:opacity .5s;text-align:center}';
document.head.appendChild(toastCSS);

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
  if (following) stepFollow();
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

    const texC = await loadTexture(qualFile(canaan.file));
    say(L.s('가나안 지형', 'Canaan terrain'), 65);
    baseCanaan = makeTerrain(canaan, 600, 680, texC);
    canaanTex = texC; canaanTile = canaan;
    hTexA = texC; hBoundA = tileBounds(canaan);
    scene.add(baseCanaan);
    const canaanClip = new THREE.Vector4(
      worldX(canaan.lonMin), worldZ(canaan.latMax),
      worldX(canaan.lonMax), worldZ(canaan.latMin));

    addLakes();
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
      // 길을 땅에 붙이려면 땅 높이를 촘촘히 알아야 한다. 600×680(550 m)로는
      // 능선에서 길이 파묻히거나 떠올랐다.
      buildGrid(canaan, texC.image, 1500, 1700);
      placeSites();
      addRivers();          // 강은 땅 높이를 알아야 얹을 수 있다
      toggleRoads();        // 옛길은 앱처럼 처음부터 깔아 둔다
      applyCam();

      loadTexture(qualFile(region.file)).then(texR => {
        // 3280×1760 짜리 그림을 420×240 으로 세우면 여덟 칸에 꼭짓점 하나다.
      // 가나안 밖이 유독 뭉개져 보이던 까닭이 그것이다. 그림만큼 세운다.
      hTexB = texR; hBoundB = tileBounds(region);
      const m = makeTerrain(region, 1000, 540, texR, canaanClip);
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
