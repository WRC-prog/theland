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

// ── 표기 바로잡기 ─────────────────────────────────────────
//
// 사건 자료에 옛 표기가 몇 군데 남아 있었다. 자료를 다시 뽑을 때까지
// 여기서 갈아 끼운다 — 라이브러리 본문의 표기를 그대로 따른다.
//   · 벨릭스 → 펠릭스 · 더베 → 데르베 · 무라 → 미라 · 멜리데 → 몰타
//   · 나훔 3:9 의 구스 → 에티오피아 (민수기 12:1 의 구스는 그대로다)
//   · 성경 이름은 띄어 쓴다 — 고린도 전서 · 요한 1서 …
const WORDFIX = [
  ['벨릭스', '펠릭스'],
  ['더베 사람', '데르베 사람'],
  ['무라에서', '미라에서'],
  ['멜리데', '몰타'],
  ['구스와 이집트', '에티오피아와 이집트'],
  ['바울로을', '바울로를'],
  ['고린도전서', '고린도 전서'], ['고린도후서', '고린도 후서'],
  ['데살로니가전서', '데살로니가 전서'], ['데살로니가후서', '데살로니가 후서'],
  ['디모데전서', '디모데 전서'], ['디모데후서', '디모데 후서'],
  ['베드로전서', '베드로 전서'], ['베드로후서', '베드로 후서'],
  ['요한1서', '요한 1서'], ['요한2서', '요한 2서'], ['요한3서', '요한 3서']
];
function fixWords(s) {
  if (typeof s !== 'string' || !s) return s;
  for (let i = 0; i < WORDFIX.length; i++)
    if (s.indexOf(WORDFIX[i][0]) >= 0) s = s.split(WORDFIX[i][0]).join(WORDFIX[i][1]);
  return s;
}

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
  // 처음은 늘 가볍게 연다. 올리고 싶으면 위 단추로 바로 올린다.
  return 'low';
}
let QUAL = 'low', qualAuto = false;
try {
  const saved = localStorage.getItem('theland.qual');
  if (QUALS.indexOf(saved) >= 0) QUAL = saved;
  else { QUAL = autoQual(); qualAuto = true; }
} catch (e) { QUAL = 'low'; }

/** 지형 판 하나의 그림을 갈아 끼운다 — 칸 수도 그림에게 다시 묻는다 */
function swapTexture(mesh, tile, tex) {
  if (!mesh) return;
  const u = mesh.material.uniforms;
  const iw = tex.image.width, ih = tex.image.height;
  u.hmap.value = tex;
  u.texel.value.set(1 / iw, 1 / ih);
  u.mpp.value.set((tile.lonMax - tile.lonMin) * KM_LON * 1000 / Math.max(iw - 1, 1),
                  (tile.latMax - tile.latMin) * KM_LAT * 1000 / Math.max(ih - 1, 1));
}

/** 보던 자리 그대로 화질만 올리고 내린다 */
async function setQual(q) {
  if (q === QUAL || qualBusy) return;
  qualBusy = true;
  try { localStorage.setItem('theland.qual', q); } catch (e) {}
  const old = QUAL;
  QUAL = q;
  syncQualBtn();
  toast(L.s('지형을 ' + QUAL_NAME()[q] + ' 화질로 바꾸는 중…',
            'Switching terrain to ' + QUAL_NAME()[q] + '…'));
  try {
    const [ca, re] = TERRAIN.tiles;
    const texC = await loadTexture(qualFile(ca.file, ca)).catch(() => loadTexture(ca.file));
    swapTexture(baseCanaan, ca, texC);
    canaanTex = texC; hTexA = texC;
    if (worldMesh) {
      const texR = await loadTexture(qualFile(re.file, re)).catch(() => loadTexture(re.file));
      swapTexture(worldMesh, re, texR);
      hTexB = texR;
    }
    for (const [file, m] of regionLoaded) {
      if (!m || m === 'loading') continue;
      const t = REGIONS.find(x => x.file === file);
      if (!t) continue;
      const tx = await loadTexture(qualFile(t.file, t)).catch(() => loadTexture(t.file));
      swapTexture(m, t, tx);
    }
    // 길·강이 쓰는 재질도 같은 그림을 보게 한다
    for (const mt of drapeMats) {
      if (mt.uniforms.hA) mt.uniforms.hA.value = hTexA;
      if (mt.uniforms.hB) mt.uniforms.hB.value = hTexB || hTexA;
    }
    dropDetail();
    // 높이 격자를 **모두** 다시 세운다.
    //
    // 예전에는 가나안 것만 다시 세우고 넓은 세계와 지역 판은 버려 두었다.
    // 그러면 화질을 한 번 바꾼 뒤로 가나안 밖의 땅 높이가 죄다 0 이 되어,
    // 「여기는 물이니 물낯을 바닥으로 삼아라」는 판단이 뒤집혔다.
    // 그래서 바다를 건너는 뱃길이 물낯이 아니라 **바닷속 지형**을 따라
    // 그려졌다 — 로마로 가는 항해가 지중해 밑바닥을 기어갔다.
    GRIDS.length = 0;
    buildGrid(ca, texC.image, 1500, 1700);
    if (worldMesh && hTexB && hTexB.image) buildGrid(re, hTexB.image, 420, 240);
    for (const [file, m] of regionLoaded) {
      if (!m || m === 'loading') continue;
      const t = REGIONS.find(x => x.file === file);
      const tx = m.material && m.material.uniforms && m.material.uniforms.hmap.value;
      if (!t || !tx || !tx.image) continue;
      const sx = t.seg || 800;
      const sz = Math.max(80, Math.round(sx * (t.latMax - t.latMin) * KM_LAT
                                            / ((t.lonMax - t.lonMin) * KM_LON)));
      buildGrid(t, tx.image, Math.min(sx, 520), Math.min(sz, 520));
    }
    placeSites();
    applyCam();
    toast(L.s('화질 ' + QUAL_NAME()[q], 'Detail: ' + QUAL_NAME()[q]));
  } catch (e) {
    QUAL = old;
    syncQualBtn();
    toast(L.s('그 화질의 지형이 아직 없습니다', 'That level is not available yet'));
  }
  qualBusy = false;
  syncQualBtn();
}
let qualBusy = false, qualBtn = null;
function syncQualBtn() {
  if (!qualBtn) return;
  const nm = QUAL_NAME();
  qualBtn.innerHTML = '<i>' + escapeHTML(L.s('화질', 'Detail')) + '</i>' +
    QUALS.map(q => '<button data-q="' + q + '"' +
      (q === QUAL ? ' class="sel"' : '') + (qualBusy ? ' disabled' : '') +
      '>' + escapeHTML(nm[q]) + '</button>').join('');
}
function QUAL_NAME() {
  return { low: L.s('하', 'Low'), mid: L.s('중', 'Mid'), hi: L.s('상', 'High') };
}

/** 화질에 맞는 그림 이름 — 상은 본이름 그대로.
 *
 *  중·하 짜리를 본이름 옆에 두지 못할 때가 있다(본판은 뿌리에, 나머지는
 *  terrain/ 에). 그래서 terrain.json 에 "mid"·"low" 로 자리를 따로 적어
 *  두면 그것을 먼저 본다. */
function qualFile(f, t) {
  if (t && QUAL !== 'hi' && t[QUAL]) return t[QUAL];
  return QUAL === 'hi' ? f : f.replace(/\.png$/, '_' + QUAL + '.png');
}

let SITES = [], EVENTS = [], NOTES = new Map(), I18N = null, TERRAIN = null;
// 가나안 바깥의 큰 강 · 지도에 그려진 항로의 굽이 · 여정의 주제 묶음
let BIGRIVERS = [], LANES = [], JGROUPS = [];
// 토막들을 한 줄로 이어 붙인 여정의 이름들 — 「한번에 보기」가 이것을 쓴다
const WHOLEKO = new Set();
const LANEMAP = new Map();
let byPlace = new Map();          // 지명 → 사건들
let siteByName = new Map();

async function loadJSON(p) {
  // 'force-cache' 였다. 그러면 한 번 받은 것을 **영영** 다시 안 받는다 —
  // terrain.json 을 고쳐 올려도 브라우저가 옛 것을 계속 물고 있었다.
  //
  // terrain.json 은 지도의 뼈대라 옛 것을 물고 있으면 아예 열리지 않는다.
  // 작은 파일이니 app.js 와 같이 늘 새로 받는다.
  // 큰 사건 자료(1 MB)만 빼고 작은 자료는 늘 새로 받는다.
  const bust = /events\.json$/.test(p) ? '' : '?v=' + Math.floor(Date.now() / 60000);
  const r = await fetch(p + bust, { cache: 'default' });
  if (!r.ok) throw new Error(p + ' → ' + r.status);
  try {
    return await r.json();
  } catch (e) {
    // 받아 둔 것이 깨져 있으면(중간에 잘못 올라간 판을 물었을 수 있다)
    // 한 번은 창고를 건너뛰고 새로 받아 본다.
    const r2 = await fetch(p + (bust ? bust + '&' : '?') + 'r=' + Date.now(), { cache: 'reload' });
    if (!r2.ok) throw e;
    return r2.json();
  }
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
  const [sites, events, notes, i18n, terrain, roads, presets, ways, areas,
         bigrivers, lanes, jgroups] = await Promise.all([
    loadJSON('data/sites.json'),
    loadJSON('data/events.json'),
    loadJSON('data/notes.json'),
    loadJSON('data/i18n.json'),
    loadJSON('terrain/terrain.json'),
    loadJSON('data/roads.json'),
    loadJSON('data/presets.json'),
    loadJSON('data/waterways.json'),
    loadJSON('data/areas.json').catch(() => ({ tribes: [], nations: [] })),
    loadJSON('data/rivers.json').catch(() => ({ cols: [], rows: [] })),
    loadJSON('data/lanes.json').catch(() => ({ cols: [], rows: [] })),
    loadJSON('data/journeygroups.json').catch(() => ({ groups: [] }))
  ]);
  BIGRIVERS = unpack(bigrivers); LANES = unpack(lanes);

  // 나일 삼각주 — 갈퀴가 아니라 부챗살로.
  //
  // 자료에는 곧은 줄기 셋뿐이었다. 그래서 삼각주가 부챗살이 아니라 갈퀴처럼
  // 보였다. 지도대로 일곱 갈래로 다시 그린다 — 서쪽 카노포스에서 로제타 ·
  // 세벤니토스 · 다미에타 · 멘데스 · 타니스를 지나 동쪽 펠루시움까지.
  // 뒤의 셋은 앞 갈래에서 갈라져 나가므로 시작점이 어귀가 아니다.
  // 고센과 라메셋이 앉은 자리가 그 동쪽 갈래 언저리다.
  // 폭도 줄인다 — 본류만큼 굵게 그리니 삼각주가 강보다 커 보였다.
  BIGRIVERS = BIGRIVERS.filter(r => (r.ko || '').indexOf('삼각주') < 0);
  for (const b of [
    { ko: '나일 삼각주 — 카노포스 갈래', channelM: 300, widthKm: 6,
      pts: [[30.05,31.24],[30.20,31.14],[30.36,31.02],[30.50,30.94],[30.63,30.83],
            [30.75,30.70],[30.86,30.55],[30.97,30.42],[31.08,30.28],[31.18,30.16]] },
    { ko: '나일 삼각주 — 로제타 갈래', channelM: 430, widthKm: 8,
      pts: [[30.05,31.24],[30.22,31.19],[30.38,31.12],[30.54,31.06],[30.70,30.97],
            [30.86,30.87],[31.01,30.76],[31.15,30.64],[31.28,30.53],[31.39,30.45],
            [31.47,30.38]] },
    { ko: '나일 삼각주 — 세벤니토스 갈래', channelM: 340, widthKm: 7,
      pts: [[30.05,31.24],[30.24,31.24],[30.42,31.21],[30.60,31.19],[30.78,31.15],
            [30.95,31.12],[31.12,31.09],[31.28,31.07],[31.42,31.06]] },
    { ko: '나일 삼각주 — 다미에타 갈래', channelM: 430, widthKm: 8,
      pts: [[30.05,31.24],[30.23,31.30],[30.41,31.36],[30.58,31.44],[30.75,31.52],
            [30.92,31.60],[31.08,31.68],[31.23,31.74],[31.38,31.79],[31.50,31.83]] },
    { ko: '나일 삼각주 — 멘데스 갈래', channelM: 300, widthKm: 6,
      pts: [[30.41,31.36],[30.58,31.52],[30.74,31.66],[30.86,31.76],[30.98,31.84]] },
    { ko: '나일 삼각주 — 타니스 갈래', channelM: 340, widthKm: 7,
      pts: [[30.30,31.32],[30.46,31.46],[30.62,31.58],[30.78,31.70],[30.90,31.80],
            [30.98,31.88],[31.10,31.99],[31.20,32.07],[31.26,32.12]] },
    { ko: '나일 삼각주 — 펠루시움 갈래', channelM: 340, widthKm: 7,
      pts: [[30.24,31.30],[30.38,31.48],[30.52,31.66],[30.64,31.84],[30.75,32.02],
            [30.85,32.20],[30.93,32.38],[30.99,32.50],[31.03,32.56]] }
  ]) BIGRIVERS.push(b);
  JGROUPS = (jgroups && jgroups.groups) || [];
  // 「전체 여정」은 토막을 이어 붙여 그 자리에서 만든다.
  // (앱도 joinStops 로 같은 일을 한다 — 자료를 두 벌 들고 있을 까닭이 없다)
  const WHOLE = [
    { ko: '출애굽 — 전체', en: 'The Exodus — the whole route', g: '출애굽', take: 0,
      dko: '라메셋에서 모압 평야와 예리코까지, 사십 년 길 전부',
      den: 'From Rameses to the plains of Moab and Jericho — all forty years' },
    { ko: '가나안 정복 — 전체', en: 'The conquest of Canaan — the whole route',
      g: '가나안 정복', take: 0,
      dko: '요르단 동편에서 북부 원정까지',
      den: 'From east of the Jordan to the northern campaign' },
    { ko: '아브라함과 야곱 — 전체', en: 'Abraham and Jacob — the whole route',
      g: '족장들의 여정', take: 0,
      dko: '우르에서 가나안으로, 다시 이집트로',
      den: 'From Ur to Canaan, and on down to Egypt' },
    { ko: '사도 바울 — 전 여정', en: 'The apostle Paul — every journey',
      g: '사도 바울의 여행', take: 4,
      dko: '1·2·3차 선교 여행과 로마로 가는 항해를 한 줄로',
      den: 'The first, second and third journeys and the voyage to Rome, in one line' }
  ];
  for (const l of LANES) LANEMAP.set(l.a + '\u0000' + l.b, l.via);
  // 이집트로 피한 길. 「이집트」는 나라 전체를 가리키는 표지라 상이집트에
  // 찍혀 있어서, 곧게 이으면 아스글론 앞바다를 가로질러 버렸다. 뭍길로
  // 돌려 준다 — 블레셋 사람들의 땅으로 가는 길을 따라 나일 어귀로.
  for (const l of [
    { a: '베들레헴', b: '이집트',
      via: [[31.55,34.60],[31.50,34.47],[31.29,34.25],[31.13,33.80],[31.06,32.90],[31.04,32.55],
            [30.98,31.88],[30.40,31.40],[30.13,31.29],[29.30,31.02],[28.30,30.72]] },
    { a: '이집트', b: '나사렛',
      via: [[28.30,30.72],[29.30,31.02],[30.13,31.29],[30.40,31.40],[30.98,31.88],
            [31.04,32.55],[31.06,32.90],[31.13,33.80],[31.29,34.25],[31.50,34.47],
            [31.80,34.65],[32.20,34.90],[32.50,35.12]] }
  ]) if (!LANEMAP.has(l.a + '\u0000' + l.b)) LANEMAP.set(l.a + '\u0000' + l.b, l.via);
  I18N = i18n; TERRAIN = terrain;
  REGIONS = terrain.regions || [];
  ROADS = unpack(roads); PRESETS = unpack(presets); WAYS = unpack(ways);

  // 시나이를 건너던 두 옛길. 자료에는 가나안 안쪽 길만 담겨 있어서,
  // 이집트로 오르내리던 길이 통째로 비어 있었다.
  //   · 블레셋 사람들의 땅으로 가는 길 — 나일 어귀에서 해안을 따라 가자까지.
  //     가장 짧고 가장 붐비던 길이다.
  //   · 술로 가는 길 — 이집트 어귀에서 술을 지나 아스몬·가데스로.
  // 바르다윌 못은 물이라 길을 그 남쪽 뭍으로 지나가게 잡았다.
  for (const r of [
    { ko: '블레셋 사람들의 땅으로 가는 길', rank: 0,
      pts: [[30.98,31.88],[31.02,32.20],[31.04,32.55],[31.06,32.90],[31.05,33.25],
            [31.07,33.55],[31.13,33.80],[31.20,34.05],[31.29,34.25],[31.40,34.38],
            [31.502,34.466]] },
    { ko: '술로 가는 길', rank: 1,
      pts: [[30.40,32.45],[30.52,32.62],[30.62,32.78],[30.72,32.90],[30.70,33.30],
            [30.66,33.70],[30.62,34.05],[30.60,34.42],[30.575,34.477]] }
  ]) if (!ROADS.some(x => x.ko === r.ko)) ROADS.push(r);

  // 이집트 급류 골짜기 — 약속의 땅 남서쪽 경계. 시나이 한복판에서 북으로
  // 흘러 대해로 든다. 골짜기 바닥은 높이 자료에서 그대로 짚어 냈다.
  for (const w of [
    { ko: '이집트 급류 골짜기', widthM: 90,
      pts: [[31.13,33.80],[31.05,33.65],[30.97,33.51],[30.89,33.55],[30.81,33.68],
            [30.73,33.74],[30.65,33.73],[30.57,33.75],[30.49,33.79],[30.41,33.83],
            [30.33,33.94],[30.25,34.02],[30.17,33.99],[30.09,33.89],[30.01,33.82],
            [29.93,33.79],[29.85,33.71],[29.77,33.62],[29.69,33.60],[29.63,33.55]] }
  ]) if (!WAYS.some(x => x.ko === w.ko)) WAYS.push(w);
  AREAS = areas || { tribes: [], nations: [] };
  I18N = i18n;
  // 성경 이름도 같은 표기로 — 여기서 갈아 끼워야 영문 이름 표도 맞물린다
  { const nb = {}; for (const k in i18n.book) nb[fixWords(k)] = i18n.book[k]; i18n.book = nb; }
  BOOKS_BY_LEN = Object.entries(i18n.book).sort((a, b) => b[0].length - a[0].length);

  SITES = unpack(sites);
  SITES.forEach((s, i) => { s.i = i; s.f = fold(s.ko) + '' + fold(s.en); siteByName.set(s.ko, s); });

  const ERAS = events.eras, KINDS = events.kinds;
  EVENTS = unpack(events);
  // 예루살렘 안쪽 — 이름만 떠 있고 기록이 비어 있던 자리들.
  //
  // 성문·망대·샘·골짜기는 지도에 이름이 떠 있는데 눌러도 아무것도 없었다.
  // 느헤미야 3장과 12장이 그 문들을 차례로 짚어 주고, 기혼과 엔-로겔과
  // 기드론과 힌놈과 모리아와 오벨도 저마다 제 기록을 가지고 있다.
  // (자료를 다시 뽑을 때까지 여기서 얹는다 — 원본에도 같이 넣어 두었다)
  EVENTS.push(
    { place: "양 문", title: "성벽 재건이 시작되고 끝난 문",
      ref: "느헤미야 3:1, 32", era: 7, year: -455, kind: 0, recall: 0,
      text: "대제사장 엘리아십과 동료 제사장들이 이 문을 세우고 문짝을 달았다. 성벽을 고치는 일이 여기서 시작되어 성벽을 한 바퀴 돈 뒤 다시 이 문에서 끝났고, 마지막 구간은 금세공업자들과 상인들이 맡았다.",
      titleEn: "Where the rebuilding of the wall began and ended",
      textEn: "High Priest Eliashib and his fellow priests built this gate and set up its doors. The repair work started here, went all the way around the wall, and ended back at this gate; the last stretch was done by the goldsmiths and the merchants." },
    { place: "양 문", title: "양 문 곁 못에서 병자를 고치시다",
      ref: "요한복음 5:2-9", era: 8, year: 31, kind: 0, recall: 0,
      text: "이 문 곁에는 다섯 개의 주랑이 딸린 못이 있었고 병든 사람들이 거기 누워 있었다. 예수께서는 삼십팔 년 동안 병을 앓던 사람에게 일어나 자리를 들고 걸으라고 하셨다.",
      titleEn: "A sick man healed at the pool by the Sheep Gate",
      textEn: "By this gate lay a pool with five colonnades where sick people waited. Jesus told a man who had been ill for 38 years to get up, pick up his mat, and walk." },
    { place: "메아 망대", title: "제사장들이 성별한 북쪽 망대",
      ref: "느헤미야 3:1; 12:39", era: 7, year: -455, kind: 0, recall: 0,
      text: "양 문에서 이어지는 북쪽 성벽 위의 망대다. 제사장들은 양 문에서 이 망대와 하나넬 망대까지를 성별했고, 성벽 봉헌식 때에는 한 합창대가 이 망대를 지나 양 문으로 나아갔다.",
      titleEn: "A north tower the priests sanctified",
      textEn: "A tower on the north wall beyond the Sheep Gate. The priests sanctified the stretch from the Sheep Gate as far as this tower and the Tower of Hananel, and at the dedication of the wall one choir passed it on the way to the Sheep Gate." },
    { place: "하나넬 망대", title: "양 문에서 이어지는 망대",
      ref: "느헤미야 3:1; 12:39", era: 7, year: -455, kind: 0, recall: 0,
      text: "메아 망대와 나란히 선 북쪽 성벽의 망대다. 성벽을 고칠 때 제사장들이 여기까지 성별했고, 봉헌식 행렬도 물고기 문을 지나 이 망대를 거쳐 갔다.",
      titleEn: "The tower next along from the Sheep Gate",
      textEn: "A tower on the north wall standing alongside the Tower of Meah. The priests sanctified the wall as far as here, and the dedication procession passed it after the Fish Gate." },
    { place: "물고기 문", title: "하스나아 자손이 세운 문",
      ref: "느헤미야 3:3; 12:39", era: 7, year: -455, kind: 0, recall: 0,
      text: "하스나아 자손이 목재로 문틀을 짜고 문짝과 자물쇠와 빗장을 달았다. 성벽 봉헌식 때 한 합창대가 옛 도시 문을 지나 이 문에 이르렀다.",
      titleEn: "The gate the sons of Hassenaah built",
      textEn: "The sons of Hassenaah framed it with timber and set up its doors, bolts, and bars. At the dedication of the wall one choir reached this gate after passing the Gate of the Old City." },
    { place: "물고기 문", title: "므낫세의 바깥 성벽이 여기까지 이르다",
      ref: "역대기하 33:14", era: 5, year: -700, kind: 0, recall: 0,
      text: "므낫세는 골짜기의 기혼 서쪽에서 이 문에 이르기까지 다윗의 도시 바깥 성벽을 쌓고, 오벨을 돌아가며 성벽을 매우 높게 올렸다.",
      titleEn: "Manasseh's outer wall reached this gate",
      textEn: "Manasseh built an outer wall for the City of David from west of Gihon in the valley as far as this gate, and carried it around Ophel, raising it very high." },
    { place: "옛 도시 문", title: "요야다와 므술람이 고친 문",
      ref: "느헤미야 3:6; 12:39", era: 7, year: -455, kind: 0, recall: 0,
      text: "요야다와 므술람이 문틀을 목재로 짜고 문짝과 자물쇠와 빗장을 달았다. 봉헌식 행렬은 에브라임 문 위를 지나 이 문에 이르렀다.",
      titleEn: "The gate Joiada and Meshullam repaired",
      textEn: "Joiada and Meshullam framed it with timber and set up its doors, bolts, and bars. The dedication procession came to this gate after passing over the Gate of Ephraim." },
    { place: "화덕 망대", title: "말기야와 핫숩이 고친 망대",
      ref: "느헤미야 3:11; 12:38", era: 7, year: -455, kind: 0, recall: 0,
      text: "말기야와 핫숩이 또 다른 구역과 함께 이 망대를 고쳤다. 성벽 봉헌식 때 다른 합창대가 이 망대를 지나 넓은 성벽에 이르렀다.",
      titleEn: "The tower Malchijah and Hasshub repaired",
      textEn: "Malchijah and Hasshub repaired this tower along with another section. At the dedication of the wall the second choir passed it on the way to the Broad Wall." },
    { place: "골짜기 문", title: "사노아 주민들이 고친 문",
      ref: "느헤미야 3:13", era: 7, year: -455, kind: 0, recall: 0,
      text: "하눈과 사노아 주민들이 문틀을 세우고 문짝과 자물쇠와 빗장을 달았다. 그들은 거기서 잿더미 문까지 성벽 1,000큐빗을 이어서 고쳤다.",
      titleEn: "The gate the people of Zanoah repaired",
      textEn: "Hanun and the people of Zanoah set up its framework, doors, bolts, and bars, and went on to repair a thousand cubits of wall as far as the Ash-heap Gate." },
    { place: "잿더미 문", title: "벳학게렘의 방백이 고친 문",
      ref: "느헤미야 3:14; 12:31", era: 7, year: -455, kind: 0, recall: 0,
      text: "벳학게렘 지역의 방백 말기야가 문틀을 세우고 문짝과 자물쇠와 빗장을 달았다. 성벽 봉헌식 때 한 합창대가 성벽 위를 걸어 이 문 쪽으로 나아갔다.",
      titleEn: "The gate the prince of Beth-haccherem repaired",
      textEn: "Malchijah, prince of the district of Beth-haccherem, set up its framework, doors, bolts, and bars. At the dedication of the wall one choir walked along the top of the wall toward this gate." },
    { place: "샘 문", title: "지붕까지 얹어 고친 문",
      ref: "느헤미야 3:15; 12:37", era: 7, year: -455, kind: 0, recall: 0,
      text: "미스바 지역의 방백 살룬은 이 문에 지붕을 얹고 문짝과 자물쇠와 빗장을 달았으며, 수로 못의 성벽을 왕의 동산과 다윗의 도시에서 내려가는 계단까지 고쳤다. 봉헌식 행렬은 이 문에서 곧장 그 계단으로 올라갔다.",
      titleEn: "The gate roofed over when it was repaired",
      textEn: "Shallun, prince of the district of Mizpah, roofed this gate and set up its doors, bolts, and bars, and repaired the wall of the Pool of the Channel as far as the King’s Garden and the Stairway going down from the City of David. The dedication procession went straight up that stairway from this gate." },
    { place: "물 문", title: "오벨의 성전 종들이 고친 동쪽 문",
      ref: "느헤미야 3:26", era: 7, year: -455, kind: 0, recall: 0,
      text: "오벨에 살던 성전 종들이 동쪽에 있는 이 문 앞과 튀어나온 망대까지 성벽을 고쳤다.",
      titleEn: "The east gate repaired by the temple servants of Ophel",
      textEn: "The temple servants living in Ophel repaired the wall in front of this gate on the east side, as far as the projecting tower." },
    { place: "물 문", title: "에스라가 이 문 앞에서 율법을 읽다",
      ref: "느헤미야 8:1-3", era: 7, year: -455, kind: 0, recall: 0,
      text: "일곱째 달 첫날, 온 백성이 이 문 앞 광장에 한데 모였다. 에스라는 동틀 무렵부터 한낮까지 율법책을 읽었고, 남자와 여자와 알아들을 수 있는 모든 사람이 귀를 기울였다.",
      titleEn: "Ezra read the Law in front of this gate",
      textEn: "On the first day of the seventh month all the people gathered in the square before this gate. Ezra read from the book of the Law from daybreak until midday, and the men, the women, and all who could understand listened." },
    { place: "말 문", title: "제사장들이 저마다 제 집 앞을 고치다",
      ref: "느헤미야 3:28", era: 7, year: -455, kind: 0, recall: 0,
      text: "이 문 위쪽 구간은 제사장들이 맡아 저마다 자기 집 앞을 고쳤다.",
      titleEn: "The priests repaired the wall each in front of his own house",
      textEn: "Above this gate the priests did the repair work, each one in front of his own house." },
    { place: "검사 문", title: "금세공업자 말기야가 고친 문",
      ref: "느헤미야 3:31", era: 7, year: -455, kind: 0, recall: 0,
      text: "금세공업 조합의 말기야가 성전 종들과 상인들의 집까지, 그리고 이 문 앞과 모퉁이의 옥상방까지 성벽을 고쳤다.",
      titleEn: "The gate Malchijah the goldsmith repaired",
      textEn: "Malchijah of the goldsmiths’ guild repaired the wall as far as the house of the temple servants and the merchants, in front of this gate and up to the roof chamber at the corner." },
    { place: "경비대 문", title: "봉헌식 행렬이 멈추어 선 문",
      ref: "느헤미야 12:39", era: 7, year: -455, kind: 0, recall: 0,
      text: "성벽 봉헌식 때 한 합창대가 옛 도시 문과 물고기 문과 두 망대를 지나 양 문에 이른 뒤, 이 문에서 멈추어 섰다.",
      titleEn: "The gate where the dedication procession halted",
      textEn: "At the dedication of the wall one choir passed the Gate of the Old City, the Fish Gate, and the two towers, came to the Sheep Gate, and then halted at this gate." },
    { place: "에브라임 문", title: "초막절에 이 문 광장에 초막을 세우다",
      ref: "느헤미야 8:16", era: 7, year: -455, kind: 0, recall: 0,
      text: "백성은 나뭇가지를 가져다가 저마다 지붕과 뜰에, 그리고 물 문 광장과 이 문 광장에 초막을 세웠다.",
      titleEn: "Booths set up in the square of this gate at the Festival of Booths",
      textEn: "The people brought branches and made booths on their own roofs and in their courtyards, and in the square of the Water Gate and the square of this gate." },
    { place: "모퉁이 문", title: "여호아스가 성벽 400큐빗을 헐다",
      ref: "열왕기하 14:13", era: 5, year: -840, kind: 0, recall: 0,
      text: "이스라엘 왕 여호아스는 벳세메스에서 유다 왕 아마샤를 사로잡은 뒤 예루살렘으로 올라와, 에브라임 문에서 이 문까지 성벽 400큐빗을 헐어 버렸다.",
      titleEn: "Jehoash broke down 400 cubits of the wall",
      textEn: "After capturing King Amaziah of Judah at Beth-shemesh, King Jehoash of Israel came up to Jerusalem and broke down 400 cubits of the wall, from the Gate of Ephraim to this gate." },
    { place: "기혼 샘", title: "솔로몬이 여기서 왕이 되다",
      ref: "열왕기상 1:33, 38-40", era: 4, year: -1037, kind: 0, recall: 0,
      text: "다윗은 솔로몬을 자기 노새에 태워 이 샘으로 내려가게 했다. 제사장 사독과 예언자 나단이 거기서 그에게 기름을 부었고, 나팔 소리와 백성의 함성이 땅을 울렸다.",
      titleEn: "Solomon was made king here",
      textEn: "David had Solomon ride his own mule down to this spring. There Zadok the priest and Nathan the prophet anointed him, and the sound of the horn and the shouting of the people shook the ground." },
    { place: "엔-로겔", title: "아도니야가 여기서 잔치를 열다",
      ref: "열왕기상 1:9", era: 4, year: -1037, kind: 0, recall: 0,
      text: "아도니야는 이 샘 가까이 있는 소헬렛 돌 곁에서 양과 소와 살진 짐승으로 희생제를 열고, 자기 형제인 왕자들과 유다 사람인 왕의 신하들을 모두 불렀다.",
      titleEn: "Adonijah held his feast here",
      textEn: "Beside the stone of Zoheleth near this spring, Adonijah sacrificed sheep, cattle, and fattened animals, and invited all his brothers the king’s sons and the king’s servants of Judah." },
    { place: "엔-로겔", title: "유다 지파의 북쪽 경계가 여기서 끝나다",
      ref: "여호수아 15:7", era: 2, year: -1467, kind: 0, recall: 0,
      text: "유다 지파가 받은 땅의 북쪽 경계는 아둠밈 오르막길 앞을 지나 엔세메스의 물로 건너가서 이 샘에서 끝났다.",
      titleEn: "The north boundary of Judah ended here",
      textEn: "The northern boundary of Judah’s inheritance passed the ascent of Adummim, crossed to the waters of En-shemesh, and ended at this spring." },
    { place: "기드론 골짜기", title: "다윗이 이 골짜기를 건너 피신하다",
      ref: "사무엘하 15:23", era: 4, year: -1040, kind: 0, recall: 0,
      text: "압살롬의 반란으로 예루살렘을 떠날 때, 왕은 이 골짜기 곁에 서 있었고 백성은 모두 광야로 가는 길을 향해 건너갔다. 그 땅 사람들이 큰 소리로 울었다.",
      titleEn: "David crossed this valley in his flight",
      textEn: "As he left Jerusalem because of Absalom’s revolt, the king stood by this valley while all the people crossed over toward the road to the wilderness, and the whole land wept aloud." },
    { place: "기드론 골짜기", title: "예수께서 이 골짜기를 건너 동산으로 가시다",
      ref: "요한복음 18:1", era: 8, year: 33, kind: 0, recall: 0,
      text: "마지막 밤에 예수께서는 제자들에게 이르시던 말씀을 마치고 그들과 함께 나가 이 골짜기 건너편으로 가셨다. 거기에는 동산이 하나 있었고, 그분은 제자들과 함께 그 안으로 들어가셨다.",
      titleEn: "Jesus crossed this valley to the garden",
      textEn: "On his last night, after finishing what he was saying to his disciples, Jesus went out with them across this valley. There was a garden there, and he entered it with them." },
    { place: "힌놈 골짜기", title: "도벳의 산당이 세워지다",
      ref: "예레미야 7:31", era: 5, year: -647, kind: 0, recall: 0,
      text: "백성은 이 골짜기에 도벳의 산당들을 짓고 자기 아들딸들을 불살랐다. 여호와께서는 그런 일을 명령하신 적도, 마음에 떠올리신 적도 없다고 말씀하셨다.",
      titleEn: "The high places of Topheth were built here",
      textEn: "The people built the high places of Topheth in this valley and burned their own sons and daughters there. Jehovah said he had never commanded such a thing, nor had it ever come into his heart." },
    { place: "힌놈 골짜기", title: "유다의 경계가 이 골짜기로 올라가다",
      ref: "여호수아 15:8", era: 2, year: -1467, kind: 0, recall: 0,
      text: "유다 지파의 경계는 여부스 사람의 남쪽 비탈 곧 예루살렘으로 올라갔고, 서쪽으로는 이 골짜기 맞은편 산꼭대기로 올라가 르바임 골짜기 북쪽 끝에 이르렀다.",
      titleEn: "The boundary of Judah went up by this valley",
      textEn: "Judah’s boundary went up to the southern slope of the Jebusite, that is, Jerusalem, and westward to the top of the mountain facing this valley, at the north end of the Valley of Rephaim." },
    { place: "모리아 산", title: "아브라함이 이삭을 바치려 한 땅",
      ref: "창세기 22:2", era: 1, year: -1871, kind: 0, recall: 0,
      text: "하느님께서는 아브라함에게 그토록 사랑하는 외아들 이삭을 데리고 모리아 땅으로 가서, 일러 주실 산에서 그를 번제물로 바치라고 말씀하셨다.",
      titleEn: "The land where Abraham was to offer Isaac",
      textEn: "God told Abraham to take Isaac, his only son whom he loved so much, and go to the land of Moriah and offer him there as a burnt offering on a mountain that God would point out." },
    { place: "모리아 산", title: "솔로몬이 이 산에 성전을 짓기 시작하다",
      ref: "역대기하 3:1", era: 4, year: -1034, kind: 0, recall: 0,
      text: "솔로몬은 예루살렘의 이 산에 여호와의 집을 건축하기 시작했다. 여호와께서 그의 아버지 다윗에게 나타나셨던 곳이며, 다윗이 여부스 사람 오르난의 타작마당에 마련해 둔 자리였다.",
      titleEn: "Solomon began building the temple on this mountain",
      textEn: "Solomon began to build the house of Jehovah on this mountain in Jerusalem. It was where Jehovah had appeared to his father David, on the site David had prepared at the threshing floor of Ornan the Jebusite." },
    { place: "오벨", title: "요담이 오벨의 성벽에 많은 것을 짓다",
      ref: "역대기하 27:3", era: 5, year: -762, kind: 0, recall: 0,
      text: "요담 왕은 여호와의 집의 윗문을 세웠고, 이 언덕의 성벽에도 많은 것을 지었다.",
      titleEn: "Jotham built much on the wall of Ophel",
      textEn: "King Jotham built the upper gate of the house of Jehovah, and he also built much on the wall of this ridge." },
    { place: "오벨", title: "성전 종들이 여기 살며 성벽을 고치다",
      ref: "느헤미야 3:26, 27", era: 7, year: -455, kind: 0, recall: 0,
      text: "성전 종들이 이 언덕에 살면서 동쪽 물 문 앞과 튀어나온 망대까지 성벽을 고쳤고, 드고아 사람들은 그 큰 망대 앞에서 이 언덕의 성벽까지를 맡았다.",
      titleEn: "The temple servants lived here and repaired the wall",
      textEn: "The temple servants living on this ridge repaired the wall in front of the east Water Gate as far as the projecting tower, and the Tekoites took the stretch from that great tower to the wall of this ridge." }
  );
  for (const e of EVENTS) {
    e.eraKo = ERAS[e.era]; e.kindKo = KINDS[e.kind];
    e.title = fixWords(e.title); e.text = fixWords(e.text); e.ref = fixWords(e.ref);
    e.f = fold(e.title + ' ' + e.ref + ' ' + e.text + ' ' + e.titleEn + ' ' + e.textEn);
    if (!byPlace.has(e.place)) byPlace.set(e.place, []);
    byPlace.get(e.place).push(e);
  }
  for (const n of unpack(notes)) { n.ko = fixWords(n.ko); NOTES.set(n.place, n); }
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
  // 자료가 다 선 뒤에 — 시대 이름표와 「전체 여정」·예수의 발자취를 세운다.
  // (앞에서 세우면 뒤따르는 SITES = unpack(...) 가 통째로 덮어써 버린다)
  // 시대 이름표를 다시 세운다.
  //
  // 예전에는 지파(5)와 나머지 셋이 한 등급(6)에 뭉쳐 있어, 족장 시대의 민족과
  // 1세기의 갈릴리와 분열 왕국이 한 지도에 겹쳐 떴다. 눈이 어지러울 수밖에.
  // 등급을 넷으로 가르고, 이름표는 areas.json 에서 새로 세운다.
  SITES = SITES.filter(x => x.rank !== 5 && x.rank !== 6);
  for (const kind in AREAKIND) {
    for (const a of (AREAS[AREAKIND[kind]] || [])) {
      AREACOLOR.set(kind + '\u0000' + a.ko, a.color);
      const en = (I18N.place && I18N.place[a.ko]) || a.ko;
      SITES.push({ ko: a.ko, en: en, lat: a.at[0], lon: a.at[1],
                   region: kind === 'tribe' ? '지파' : kind === 'nation' ? '민족'
                         : kind === 'first' ? '1세기' : '분열 왕국',
                   rank: AREARANK[kind], era: kind });
    }
  }
  SITES.forEach((x, i) => { x.i = i; if (!x.f) x.f = fold(x.ko) + '' + fold(x.en); });

  // 예수 그리스도의 발자취. 복음서에 적힌 대로 들른 곳을 차례로 이었다.
  // (지명은 이미 지도에 있는 것만 쓴다 — 없는 곳을 지어내지 않는다)
  const JESUS = [
    { ko: '예수 ① 출생과 어린 시절', en: 'Jesus ① Birth and childhood',
      dko: '나사렛에서 베들레헴으로, 성전에 올랐다가 이집트로 피했다가, 다시 나사렛으로',
      den: 'To Bethlehem, up to the temple, into Egypt, and back to Nazareth',
      stops: ['나사렛', '베들레헴', '예루살렘', '베들레헴', '이집트', '나사렛'] },
    { ko: '예수 ② 침례와 첫 표징', en: 'Jesus ② Baptism and the first sign',
      dko: '요르단 강으로 내려가 침례를 받고, 광야를 지나 가나로',
      den: 'Down to the Jordan for baptism, through the wilderness, on to Cana',
      stops: ['나사렛', '요르단 강', '예리코', '가나', '가버나움'] },
    { ko: '예수 ③ 갈릴리 봉사', en: 'Jesus ③ The ministry in Galilee',
      dko: '갈릴리 바다 둘레의 성읍들 — 가버나움을 집처럼 삼았다',
      den: 'The towns around the Sea of Galilee — Capernaum was his base',
      stops: ['가버나움', '고라신', '벳새다', '나인', '나사렛', '가나', '가버나움'] },
    { ko: '예수 ④ 북쪽으로', en: 'Jesus ④ Northward',
      dko: '시돈 지방과 데카폴리스를 거쳐 높은 산으로',
      den: 'Through the region of Sidon and the Decapolis to a lofty mountain',
      stops: ['가버나움', '시돈', '데카폴리스', '헤르몬 산', '가버나움'] },
    { ko: '예수 ⑤ 사마리아를 지나', en: 'Jesus ⑤ Through Samaria',
      dko: '유대에서 사마리아를 가로질러 갈릴리로 — 수가의 우물을 지나',
      den: 'From Judea across Samaria to Galilee, past the well at Sychar',
      stops: ['예루살렘', '수가', '사마리아', '가버나움'] },
    { ko: '예수 ⑥ 마지막 유월절 길', en: 'Jesus ⑥ The last Passover journey',
      dko: '갈릴리에서 예리코를 거쳐 베다니로, 그리고 예루살렘으로',
      den: 'From Galilee by way of Jericho to Bethany, and on to Jerusalem',
      stops: ['가버나움', '에브라임', '예리코', '베다니', '벳바게', '예루살렘', '겟세마네'] }
  ];
  for (const p of JESUS) {
    if (PRESETS.some(x => x.ko === p.ko)) continue;
    const stops = p.stops.filter(n => siteByName.has(n));
    if (stops.length < 2) continue;
    PRESETS.push({ ko: p.ko, en: p.en, detailKo: p.dko, detailEn: p.den,
                   stops: stops, followTerrain: 1 });
  }
  {
    const parts = JESUS.map(p => PRESETS.find(x => x.ko === p.ko)).filter(Boolean);
    if (parts.length >= 2) {
      const stops = [];
      for (const p of parts)
        for (const st of p.stops) { if (stops[stops.length - 1] === st) continue; stops.push(st); }
      PRESETS.push({ ko: '예수 — 전 여정', en: 'Jesus — every journey',
                     detailKo: '출생에서 마지막 유월절까지 한 줄로',
                     detailEn: 'From his birth to the last Passover, in one line',
                     stops: stops, followTerrain: 1 });
      WHOLEKO.add('예수 — 전 여정');
    }
  }
  JGROUPS.push({ ko: '예수 그리스도의 발자취', en: 'In the footsteps of Jesus Christ',
                 all: '예수 — 전 여정',
                 names: JESUS.map(p => p.ko).concat(['예수 — 전 여정']) });

  for (const w of WHOLE) {
    if (PRESETS.some(p => p.ko === w.ko)) continue;
    const g = JGROUPS.find(x => x.ko === w.g);
    if (!g) continue;
    let parts = g.names.map(n => PRESETS.find(p => p.ko === n)).filter(Boolean);
    if (w.take) parts = parts.slice(0, w.take);
    if (parts.length < 2) continue;
    const stops = [];
    for (const p of parts)
      for (const st of p.stops) { if (stops[stops.length - 1] === st) continue; stops.push(st); }
    PRESETS.push({ ko: w.ko, en: w.en, detailKo: w.dko, detailEn: w.den,
                   stops: stops, followTerrain: parts[0].followTerrain });
    WHOLEKO.add(w.ko);
    g.all = w.ko;
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

/** 높이 그림을 **여러 판에 나눠** 읽는다.
 *
 *  3000×3400 짜리 그림을 한 판에 훑으면 그동안 화면이 통째로 멎는다 —
 *  처음 열 때 1초쯤 얼어붙던 것이 그것이다. 읽어 내는 값은 조금도 달라지지
 *  않는다. 다만 몇 줄씩 끊어 앉힐 뿐이다. 다 읽은 뒤에야 격자를 내놓으므로,
 *  읽는 동안 어설픈 높이가 새어 나갈 일도 없다.
 */
function buildGridAsync(tile, img, segX, segZ, done) {
  const fin = () => { try { placeSites(); } catch (e) {} if (done) done(); };
  let cv, g2, G;
  try {
    cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    g2 = cv.getContext('2d', { willReadFrequently: true });
    g2.drawImage(img, 0, 0);
    G = { t: tile, gw: segX + 1, gh: segZ + 1, m: new Int16Array((segX + 1) * (segZ + 1)) };
  } catch (e) {
    console.warn('높이를 읽지 못했습니다 — 이름표는 바다 높이에 놓입니다', e);
    fin(); return;
  }
  // 한 판에 읽을 줄 수 — 격자가 넓을수록 적게 끊는다
  const rows = Math.max(16, Math.min(200, Math.round(2.0e6 / Math.max(G.gw, 1))));
  let j0 = 0, bad = false;
  const step = () => {
    try {
      const j1 = Math.min(G.gh, j0 + rows);
      const y0 = Math.round(j0 / segZ * (img.height - 1));
      const y1 = Math.round((j1 - 1) / segZ * (img.height - 1));
      const px = g2.getImageData(0, y0, img.width, y1 - y0 + 1).data;
      for (let j = j0; j < j1; j++) {
        const row = (Math.round(j / segZ * (img.height - 1)) - y0) * img.width;
        for (let i = 0; i < G.gw; i++) {
          const q = (row + Math.round(i / segX * (img.width - 1))) * 4;
          G.m[j * G.gw + i] = px[q] * 256 + px[q + 1] - 6000;
        }
      }
      j0 = j1;
    } catch (e) {
      console.warn('높이를 읽지 못했습니다 — 이름표는 바다 높이에 놓입니다', e);
      bad = true;
    }
    if (!bad && j0 < G.gh) { requestAnimationFrame(step); return; }
    cv.width = cv.height = 1;                          // 40 MB 짜리 자리를 돌려준다
    if (!bad) GRIDS.push(G);
    fin();
  };
  requestAnimationFrame(step);
}

/** 무거운 일을 **한 판에 하나씩** 나눠 한다 — 한꺼번에 하면 화면이 멎는다.
 *  일마다 next 를 받고, 제 일이 끝나면 next 를 부른다. */
function inSteps(jobs) {
  let i = 0;
  const run = () => {
    if (i >= jobs.length) return;
    const f = jobs[i++];
    try { f(() => requestAnimationFrame(run)); }
    catch (e) { console.warn(e); requestAnimationFrame(run); }
  };
  requestAnimationFrame(run);
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

// 안개는 가까이서 볼 때 거리를 느끼게 하는 장치다. 그런데 짙기를 고정해 두면
// 물러설수록 화면 전체가 안개에 잠겨 **온 세상이 뿌옇게** 된다 — 지도를 보러
// 왔는데 안개를 보게 된다. 그래서 멀리 물러설수록 옅게 푼다.
const terrainMats = [];

// 표고 모드 — 땅빛 대신 **높이 색**으로 칠한다. 어디가 산이고 어디가 골인지
// 한눈에 들어온다. 켜고 끈 것은 기억해 둔다.
let HYPS = false;
try { HYPS = localStorage.getItem('theland.hyps') === '1'; } catch (e) {}
function syncHyps() {
  for (const m of terrainMats)
    if (m.uniforms && m.uniforms.hyps) m.uniforms.hyps.value = HYPS ? 1 : 0;
}

function fogDenNow() {
  return 0.0009 * Math.max(0.12, Math.min(1, 260 / Math.max(40, cam.dist)));
}
function syncFog() {
  const v = fogDenNow();
  if (scene && scene.fog) scene.fog.density = v;
  for (const m of terrainMats) if (m.uniforms && m.uniforms.fogDen) m.uniforms.fogDen.value = v;
}

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
/** 이 판에게 「여기는 그리지 마라」 하고 이르는 네모들 */
function setClips(mesh, rects) {
  const u = mesh.material.uniforms;
  const n = Math.min(6, rects.length);
  for (let i = 0; i < 6; i++) {
    const r = i < n ? rects[i] : null;
    if (r) u.clips.value[i].set(r.x, r.y, r.z, r.w);
    else u.clips.value[i].set(0, 0, -1, -1);
  }
  u.nClip.value = n;
}

/** 타일 하나가 덮는 네모 (x0, z0, x1, z1) */
function tileRect(t, shrinkKm) {
  const m = shrinkKm || 0;
  return new THREE.Vector4(worldX(t.lonMin) + m, worldZ(t.latMax) + m,
                           worldX(t.lonMax) - m, worldZ(t.latMin) - m);
}
// 이음매에서 성긴 판이 이만큼 덜 비운다 — 그만큼 촘촘한 판 밑으로 들어간다.
// 딱 맞춰 비우면 그 사이에 아무것도 안 그려진 실낱 같은 금이 남았다.
const SEAM_KM = 2.5;

/** 판 하나를 **곧바로** 엮는다.
 *
 *  three 가 주는 PlaneBufferGeometry 는 쓰지도 않는 법선(normal)과 눈금(uv)
 *  까지 함께 만드느라, 꼭짓점 칠십만 개에 0.4초를 쓴다. 지형 셰이더는 자리
 *  (position)만 보므로 자리와 삼각형만 곧바로 채운다 — 여남은 곱 빠르고,
 *  나오는 판은 꼭짓점 하나까지 똑같다.
 *
 *  꼭짓점 차례와 삼각형 감는 방향은 PlaneBufferGeometry 를 rotateX(-90°) 한
 *  것과 그대로 맞춰 두었다. 그래야 앞뒷면이 뒤집히지 않는다.
 */
function flatGrid(w, d, segX, segZ, cx, cz) {
  const nx = segX + 1, nz = segZ + 1;
  const pos = new Float32Array(nx * nz * 3);
  const x0 = cx - w / 2, z0 = cz - d / 2, sw = w / segX, sd = d / segZ;
  for (let j = 0, k = 0; j < nz; j++) {
    const z = z0 + j * sd;
    for (let i = 0; i < nx; i++, k += 3) { pos[k] = x0 + i * sw; pos[k + 2] = z; }
  }
  const idx = (nx * nz > 65535) ? new Uint32Array(segX * segZ * 6)
                                : new Uint16Array(segX * segZ * 6);
  for (let j = 0, k = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = i + nx * j, b = a + nx;
      idx[k++] = a; idx[k++] = b; idx[k++] = a + 1;
      idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function makeTerrain(tile, segX, segZ, tex, clip, win) {
  const x0 = worldX(tile.lonMin), x1 = worldX(tile.lonMax);
  const z0 = worldZ(tile.latMax), z1 = worldZ(tile.latMin);   // 위도는 뒤집힌다
  const w = x1 - x0, d = z1 - z0;

  // win 을 주면 타일 **한 조각**만 세운다. 눈금(uv)은 타일 전체를 기준으로
  // 그대로 두므로, 같은 그림에서 훨씬 촘촘한 판을 뜰 수 있다.
  const gx = win ? win.x : x0, gz = win ? win.z : z0;
  const gw = win ? win.w : w,  gd = win ? win.d : d;
  // win.seg 를 주면 **되쓰는 격자**를 빌려 쓴다 — 새로 엮지 않는다.
  const geo = (win && win.seg) ? unitGrid(win.seg)
                               : flatGrid(gw, gd, segX, segZ, gx + gw / 2, gz + gd / 2);

  const iw = (tex.image && tex.image.width)  || tile.w;
  const ih = (tex.image && tex.image.height) || tile.h;
  const mat = new THREE.ShaderMaterial({
    // 이음매에서 겹친 자리는 **촘촘한 판이 이긴다**. 화소가 작을수록 앞으로 당긴다.
    polygonOffset: true,
    polygonOffsetFactor: -Math.min(20, 1400 / Math.max(40, tile.mPerPx || 500)),
    polygonOffsetUnits: -2,
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
      fogDen: { value: fogDenNow() },
      hyps: { value: HYPS ? 1 : 0 },
      moistT: { value: moistTex || new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.LuminanceFormat) },
      moistB: { value: new THREE.Vector4(MOISTB.lon0, MOISTB.lat0, MOISTB.lonSpan, MOISTB.latSpan) },
      farmOn: { value: moistTex ? 1 : 0 },
      // 땅에 새긴 길 자국 (아래 bakeRoadMask 참고)
      roadT: { value: roadTex || BLANK1 },
      roadB: { value: roadBnd || new THREE.Vector4(0, 0, 1, 1) },
      roadOn: { value: (roadTex && roadShow) ? 1 : 0 },
      // 비워 둘 네모들 (x0,z0,x1,z1). nClip 개까지만 본다.
      clips: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -1, -1)) },
      nClip: { value: 0 }
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
        // 눈금(uv)은 **세계 자리**에서 뽑는다. 그래야 격자 하나를 자리와
        // 크기만 바꿔 가며 되쓸 수 있다 — 격자가 어디에 놓이든 그 자리의
        // 높이를 그림에서 제대로 찾아 온다.
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        vUv = vec2((p.x - bounds.x) / bounds.z, 1.0 - (p.z - bounds.y) / bounds.w);
        vH = height(vUv);
        p.y = vH * 0.001 * vex;              // m → km
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D hmap;
      uniform vec2 texel;
      uniform vec3 sun;
      uniform vec3 fogCol;
      uniform float fogDen;
      uniform float hyps;
      uniform sampler2D moistT;
      uniform vec4 moistB;
      uniform float farmOn;
      uniform float vexf;
      uniform sampler2D roadT;
      uniform vec4 roadB;      // lonMin, latMin, lon폭, lat폭
      uniform float roadOn;
      uniform vec4 clips[6];
      uniform int nClip;
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
        // 지구대 안에도 진짜 물은 있다 — 사해와 갈릴리 바다.
        // 높이 자료에는 사해의 **물낯이 -412 m 짜리 판판한 면**으로 담겨 있다.
        // 그런데 -415 보다 낮아야 물로 치게 해 두어서, 그 면이 걸리지 않고
        // 소금 바다가 통째로 마른 땅으로 칠해졌다. 물낯 높이(-393 m)에 맞춘다.
        if (la > 31.00 && la < 31.79 && lo > 35.32 && lo < 35.62 && h < -391.0) dry = false;
        if (la > 32.68 && la < 32.92 && lo > 35.47 && lo < 35.68 && h < -195.0) dry = false;
        return !dry;
      }
      // 표고 모드의 색 — 지도책의 등고 채색 그대로.
      // 초록(저지) → 노랑 → 황토 → 갈색(산) → 흰빛(높은 봉우리).
      vec3 hypsRamp(float h, bool wet){
        if (wet)        return mix(vec3(0.09,0.22,0.44), vec3(0.46,0.70,0.88),
                                   clamp(h/-1800.0+1.0,0.0,1.0));
        if (h < 0.0)    return mix(vec3(0.60,0.72,0.52), vec3(0.72,0.83,0.58),
                                   clamp(h/-430.0+1.0,0.0,1.0));
        if (h < 200.0)  return mix(vec3(0.50,0.74,0.42), vec3(0.74,0.84,0.47), h/200.0);
        if (h < 500.0)  return mix(vec3(0.74,0.84,0.47), vec3(0.94,0.89,0.54), (h-200.0)/300.0);
        if (h < 1000.0) return mix(vec3(0.94,0.89,0.54), vec3(0.90,0.73,0.43), (h-500.0)/500.0);
        if (h < 2000.0) return mix(vec3(0.90,0.73,0.43), vec3(0.74,0.53,0.38), (h-1000.0)/1000.0);
        if (h < 3000.0) return mix(vec3(0.74,0.53,0.38), vec3(0.80,0.74,0.73), (h-2000.0)/1000.0);
        return mix(vec3(0.80,0.74,0.73), vec3(1.0,1.0,1.0), clamp((h-3000.0)/1600.0,0.0,1.0));
      }
      // 땅빛은 예전대로 **높이**가 정한다. 다만 한 군데는 높이만으로는
      // 도무지 맞지 않는다 — 분수령 동쪽이다.
      //
      // 예루살렘 마루는 750 m 라 「높으니까」 메마른 빛이 되고, 그 동쪽으로
      // 뚝 떨어지는 유다 광야는 「낮으니까」 초록이 되었다. 실제로는 정반대다.
      // 마루 서쪽은 비를 받아 푸르고, 넘어간 동쪽은 비그늘에 들어 광야다.
      //
      // 그래서 팔레트는 그대로 두고, 레반트에서만 젖은 정도로 살짝
      // 기울인다. 메마른 데는 먼지빛으로, 마루는 풀빛으로.
      //
      // 네모는 **가나안 판 그대로**다. 그 밖은 한 획도 건드리지 않는다 —
      // 시나이도 나바테아도 다마스쿠스도 예전 색 그대로.
      //
      // 다만 스러지는 자리를 **네모 바깥이 아니라 안쪽으로** 넉넉히 잡는다.
      // 0.5도로 끊었더니 나바테아 어름에서 밝기가 꺾여 네모 자국이 드러났다.
      // 1.3도(약 145 km)에 걸쳐 안에서 스러지면, 바깥에 닿을 즈음에는 이미
      // 손질이 0 이라 이을 자리가 없다. 스러지는 구간은 아라바·네게브 남단
      // 이라 어차피 한 가지 빛깔로 메마른 땅이다.
      float coreAt(float la, float lo){
        float g = 1.3;
        return min(min(smoothstep(0.0, 1.0, (lo - 33.90) / g),
                       smoothstep(0.0, 1.0, (36.90 - lo) / g)),
                   min(smoothstep(0.0, 1.0, (la - 30.20) / g),
                       smoothstep(0.0, 1.0, (33.60 - la) / g)));
      }
      vec3 ramp(float h, bool wet){
        if (wet)       return mix(vec3(0.06,0.16,0.25), vec3(0.13,0.31,0.42), clamp(h/-400.0+1.0,0.0,1.0));
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
        // 더 촘촘한 판이 맡은 자리는 넘기고 그리지 않는다 — 겹치면 서로 파고든다.
        // 지역 판이 하나씩 내려앉을 때마다 비울 네모가 늘어난다.
        for (int i = 0; i < 6; i++) {
          if (i < nClip) {
            vec4 c = clips[i];
            if (vWorld.x > c.x && vWorld.x < c.z &&
                vWorld.z > c.y && vWorld.z < c.w) discard;
          }
        }
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
        float lo = geo.x + vWorld.x / geo.z;   // 땅빛에도 쓴다
        float la = geo.y - vWorld.z / geo.w;
        bool wet = wetAt(h, la, lo);
        float d = length(vWorld - cameraPosition);   // 길 자국 굵기에도 쓴다

        // 손으로 얹던 잔결과 돌빛은 걷어냈다. 실측 자료가 제 결을 가지고
        // 있으니 지어낸 무늬를 덧바를 까닭이 없다.
        // 젖은 정도 — 미리 구워 둔 그림에서 읽는다 (없으면 가운데 값)
        float mo = 0.42;
        if (farmOn > 0.5) {
          vec2 mu = vec2((lo - moistB.x) / moistB.z, (la - moistB.y) / moistB.w);
          mo = texture2D(moistT, clamp(mu, 0.001, 0.999)).r;
        }
        vec3 col = hyps > 0.5 ? hypsRamp(h, wet) : ramp(h, wet);
        // 젖은 정도로 땅빛을 살짝 기울인다 (레반트에서만, 아주 넓게 스러지며).
        //   · 비그늘(유다 광야·요단 골짜기·네게브) → 먼지빛
        //   · 분수령 마루(예루살렘·베들레헴·헤브론·실로) → 풀빛
        if (hyps < 0.5 && !wet) {
          float ca = coreAt(la, lo);
          // 메마름은 **문턱이 아니라 비탈**이라야 한다. 0.38 에서 뚝 끊었더니
          // 네게브 북부(브엘-세바 ~200 mm)가 「낮은 땅」이라는 이유로 에스드모아
          // (~300 mm)보다 푸르게 나왔다 — 거꾸로다. 0.62 까지 완만히 끌면서
          // 낮은 쪽을 세게 눌러, 경계 지대가 강수량 차례대로 눕게 한다.
          float dry = pow(max(1.0 - smoothstep(0.0, 0.62, mo), 0.0), 0.75) * ca;
          // 풀빛을 한 칸 더 내려 잡는다. 0.45 에서 시작했더니 마루와 광야
          // 사이에 **어느 쪽도 아닌 갈색 띠**가 2~3 km 남았다 — 예루살렘이
          // 딱 그 위에 앉아 누렇게 보였다. 0.36 부터 받으면 마루가 능선 동턱
          // 까지 푸르고, 거기서 광야로 넘어가는 자리가 짧고 또렷해진다.
          float grn = smoothstep(0.36, 0.60, mo) * ca;
          // 남으로 갈수록 모래빛이 짙어진다. 브엘-세바 아래는 이미 사막의
          // 문턱이고, 가데스-바네아쯤이면 온전한 사막이다. 다만 **물이 있는
          // 자리는 뺀다** — 그러지 않으면 상이집트를 가로지르는 나일의 초록
          // 실띠까지 함께 바래 버린다.
          float neg = (1.0 - smoothstep(30.10, 31.75, la))
                    * (1.0 - smoothstep(0.30, 0.60, mo)) * ca;
          col = mix(col, vec3(0.63, 0.56, 0.41), dry * 0.85);
          col = mix(col, vec3(0.34, 0.44, 0.24), grn * 0.80);
          col = mix(col, vec3(0.74, 0.66, 0.50), neg * 0.55);
        }

        // ── 땅에 새긴 길 ─────────────────────────────────────
        // 길을 띠로 얹으면 아무리 다듬어도 「위에 붙인 테이프」다. 가까이서는
        // 땅빛 자체를 다져진 흙빛으로 물들인다 — 그래야 길도 산등성이의
        // 그늘을 같이 받고 아지랑이도 같이 먹는다. 그늘을 입히기 **전에**
        // 섞는 까닭이 그것이다.
        if (roadOn > 0.5 && !wet) {
          vec2 ru = vec2((lo - roadB.x) / roadB.z,
                         (roadB.y + roadB.w - la) / roadB.w);
          if (ru.x > 0.001 && ru.x < 0.999 && ru.y > 0.001 && ru.y < 0.999) {
            float mk = texture2D(roadT, ru).r;
            // 다가가면 실제 너비대로 좁게, 물러서면 지도처럼 넓게
            float t0 = mix(0.72, 0.15, clamp((d - 12.0) / 110.0, 0.0, 1.0));
            float core = smoothstep(t0, t0 + 0.22, mk);
            float halo = smoothstep(t0 - 0.18, t0 + 0.02, mk);
            // 멀리서는 띠가 대신 그린다 — 겹치지 않게 스러진다
            float fade = 1.0 - smoothstep(70.0, 150.0, d);
            // 다져진 길바닥은 풀도 흙도 벗겨진 자리라 **늘 둘레보다 밝다**.
            // 밝은 땅에서는 어둡게 기울여 보았더니 그늘진 비탈에서 아예
            // 사라져 버렸다. 그래서 밝기는 한 쪽으로만 — 언제나 밝게 —
            // 두고, 대신 길섶에 머리카락 같은 그늘 한 줄을 둘러 밝은 땅
            // 에서도 테두리가 잡히게 한다.
            vec3 dust = mix(col, vec3(0.76, 0.68, 0.52), 0.60) * 1.10;
            col = mix(col, col * 0.86, (halo - core) * 0.55 * fade);
            col = mix(col, dust, core * 0.90 * fade);
          }
        }

        float lam = clamp(dot(n, sun), 0.0, 1.0);
        float sky = 0.5 + 0.5 * n.y;
        vec3 lit = col * (vec3(1.02,0.99,0.94) * (0.30 + 0.80 * lam)
                        + vec3(0.42,0.48,0.56) * (0.30 * sky));
        // 표고 모드에서는 그늘을 옅게 — 색이 곧 높이라, 그늘이 짙으면 색을 가린다.
        col = hyps > 0.5 ? mix(col * 0.95, lit, 0.42) : lit;
        if (wet && hyps < 0.5) col = mix(col, vec3(0.10,0.25,0.36), 0.55);

        float f = 1.0 - exp(-fogDen * fogDen * d * d);
        gl_FragColor = vec4(mix(col, fogCol, clamp(f, 0.0, 1.0)), 1.0);
      }`
  });
  terrainMats.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  if (win && win.seg) { mesh.position.set(gx + gw / 2, 0, gz + gd / 2); mesh.scale.set(gw, 1, gd); }
  if (clip) setClips(mesh, Array.isArray(clip) ? clip : [clip]);
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
// ── 지역 판 ──────────────────────────────────────────────
//
// 넓은 세계 한 장으로 지구의 8분의 1을 덮으니 620 m 로 뭉갤 수밖에 없었다.
// 그래서 지역을 갈라 촘촘히 구워 두고, **카메라가 다가갈 때만 내려받는다.**
// 처음 열 때는 가나안과 성긴 배경만 받으므로 여는 속도는 그대로다.
let REGIONS = [], worldMesh = null, worldClips = [];
const regionLoaded = new Map();

function applyWorldClips() {
  if (worldMesh) setClips(worldMesh, worldClips);
}

function updateRegions() {
  if (!REGIONS.length) return;
  // 지역 판 하나가 십몇 MB 다. 여섯을 한꺼번에 부르면 폰이 숨을 못 쉰다.
  //  · 한참 물러서서 볼 때는 620 m 짜리 세계 판으로 충분하다 — 부르지 않는다.
  //  · 한 번에 하나씩만 받는다.
  if (cam.dist > 900) return;
  if (following) return;                    // 걷는 중에는 멎게 하지 않는다
  if (downAt) return;                       // 끄는 동안에는 건드리지 않는다
  for (const v of regionLoaded.values()) if (v === 'loading') return;
  const lat = latOfZ(cam.tz), lon = lonOfX(cam.tx);
  const near = 0.5 + cam.dist / 200;          // 다가가는 쪽만 미리 챙긴다
  for (const t of REGIONS) {
    if (regionLoaded.has(t.file)) continue;
    if (lon < t.lonMin - near || lon > t.lonMax + near ||
        lat < t.latMin - near || lat > t.latMax + near) continue;
    regionLoaded.set(t.file, 'loading');
    const segX = t.seg || 800;
    const segZ = Math.max(80, Math.round(segX * (t.latMax - t.latMin) * KM_LAT
                                              / ((t.lonMax - t.lonMin) * KM_LON)));
    // 지역 판끼리 네모가 겹치는 자리가 있다(시리아와 소아시아처럼).
    // 겹친 채로 두면 두 면이 서로 파고들어 얼룩이 진다. 먼저 온 판이
    // 이기고, 나중 판은 그 네모를 비운다.
    const rects = canaanTile ? [tileRect(canaanTile, SEAM_KM)] : [];
    for (const f of (t.clipBy || [])) {
      const o = REGIONS.find(x => x.file === f);
      if (o) rects.push(tileRect(o, SEAM_KM));
    }
    loadTexture(qualFile(t.file, t)).catch(() => loadTexture(t.file)).then(tex => {
      const m = makeTerrain(t, segX, segZ, tex, rects);
      m.renderOrder = -0.5;                   // 성긴 배경보다 위, 가나안보다 아래
      scene.add(m);
      regionLoaded.set(t.file, m);
      worldClips.push(tileRect(t, SEAM_KM));
      // 다음 판은 이 판을 다 세운 뒤에 (한 번에 하나씩)
      applyWorldClips();
      // 높이 격자는 성기게 — 이천만 화소를 900×900 으로 훑으면 폰이 멎는다
      // 높이 읽기는 수백만 화소를 훑는 일이라, 한 판에 몰아 하면 그만큼 멎는다.
      buildGridAsync(t, tex.image, Math.min(segX, 520), Math.min(segZ, 520));
    }).catch(() => { regionLoaded.set(t.file, 'none'); });   // 없는 판을 되풀이해 찾지 않는다
  }
}

let baseCanaan = null, canaanTex = null, canaanTile = null;
let detailMesh = null, detailWin = null;

// 조각 판이 맡은 자리를 큰 판이 비우되, **딱 맞춰 비우지 않는다.**
//
// 딱 맞추면 그 선에서 두 면의 높이가 미세하게 어긋난다 — 조각 판은 60 m
// 마디로, 큰 판은 475 m 마디로 같은 그림을 읽으니 능선 하나를 서로 다르게
// 깎는다. 그 틈으로 하늘이 비쳐, 걸을 때 앞에 파란 실 조각이 흩어져
// 따라다녔다. 지역 판끼리 쓰는 것과 같은 수를 쓴다 — 큰 판이 조각 밑으로
// 조금 들어가게 비울 네모를 안쪽으로 줄인다.
const DETAIL_LAP = 0.7;                 // 700 m 겹침
function setBaseClip(r) {
  if (!baseCanaan) return;
  const m = DETAIL_LAP;
  setClips(baseCanaan, r
    ? [new THREE.Vector4(r.x + m, r.z + m, r.x + r.w - m, r.z + r.d - m)]
    : []);
}

// 조각 판의 격자는 **한 번 엮어 두고 되쓴다.**
//
// 예전에는 화면을 조금 끌 때마다 1100×1100 짜리 판을 새로 엮었다. 꼭짓점
// 백이십만 개와 삼각형 이백사십만 개를 자바스크립트로 짜 맞추는 일이라,
// 폰에서는 그때마다 3~4십분의 1초씩 화면이 멎었다 — 끌면 뚝뚝 끊기던
// 까닭이 바로 그것이다. 이제 격자는 **한 변이 1 인 네모** 몇 벌만 엮어
// 두고, 자리와 크기만 바꿔 끼운다. 높이는 어차피 그림에서 읽으므로
// 격자가 어디에 놓이든 상관이 없다.
const GRIDSEG = [256, 384, 576, 864];
const unitGrids = new Map();
function unitGrid(seg) {
  let g = unitGrids.get(seg);
  if (!g) {
    g = flatGrid(1, 1, seg, seg, 0, 0);
    unitGrids.set(seg, g);
  }
  return g;
}

/** 격자를 **미리** 엮어 둔다 — 다가갈 때 처음 엮느라 멎지 않게.
 *  지도를 다 띄운 뒤 한가한 틈에 하나씩 짠다. */
function warmGrids() {
  const q = GRIDSEG.slice();
  const idle = window.requestIdleCallback
    ? f => window.requestIdleCallback(f, { timeout: 4000 })
    : f => setTimeout(f, 500);
  (function next() {
    const seg = q.shift();
    if (seg == null) return;
    idle(() => { unitGrid(seg); next(); });
  })();
}

function dropDetail() {
  if (!detailMesh) return;
  scene.remove(detailMesh);
  detailMesh.material.dispose();          // 격자는 되쓰므로 버리지 않는다
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
  const want = Math.max(w, d) * 1000 / step;
  let seg = GRIDSEG[GRIDSEG.length - 1];
  for (const g of GRIDSEG) if (g >= want) { seg = g; break; }
  // 아직 엮어 두지 않은 격자를 **손가락이 눌린 채로** 엮으면 그 순간
  // 화면이 멎는다. 손을 뗀 뒤에 엮는다 — 그동안은 있던 조각을 그대로 쓴다.
  if (!unitGrids.has(seg) && (downAt || following || flyAnim)) return;

  if (detailMesh) {
    // 있던 판은 그대로 두고 **자리와 크기만** 바꾼다 — 값이 거의 안 든다.
    detailMesh.geometry = unitGrid(seg);
    detailMesh.position.set(x + w / 2, 0, z + d / 2);
    detailMesh.scale.set(w, 1, d);
  } else {
    detailMesh = makeTerrain(t, 0, 0, canaanTex, null, { x, z, w, d, seg });
    // 겹치는 띠에서는 **조각 판이 이긴다.** 큰 판과 같은 옵셋(-20)이면 서로
    // 파고들어 얼룩이 진다. 길·강이 쓰는 -34 보다는 얕게 두어 차례를 지킨다.
    detailMesh.material.polygonOffsetFactor = -26;
    detailMesh.material.polygonOffsetUnits = -5;
    detailMesh.renderOrder = 1;
    scene.add(detailMesh);
  }
  detailWin = { cx: cam.tx, cz: cam.tz, dist: cam.dist, x, z, w, d };
  setBaseClip(detailWin);
}

// ── 이름표 ────────────────────────────────────────────────
const labelPool = [];
let shown = [];
// 지난 판에 떠 있던 이름들. 화면을 조금 움직였다고 이름이 사라졌다
// 나타났다 하면 눈이 어지럽다. 한 번 뜬 이름은 웬만하면 그대로 둔다.
const LABPREV = new Set();
// 이름 하나가 늘 같은 DOM 조각을 쓰게 한다. 자리 번호로 나눠 주면
// 차례가 한 칸만 밀려도 글씨가 통째로 갈아 끼워져 튀어 보인다.
const LABSLOT = new Map();
// 이름만으로는 모자란다. 「사마리아」는 성읍에도 있고 1세기 지역에도 있어서,
// 이름을 열쇠로 삼으면 둘이 한 조각을 놓고 판마다 다투었다 — 그것이 곧
// 미친 듯이 깜빡이던 까닭이다. 등급과 시대까지 붙여 서로 다른 것으로 센다.
function labKey(s) { return s.ko + '\u0000' + s.rank + '\u0000' + (s.era || ''); }
// 도피 도시 여섯 성 — 앱과 같이 붉은 세모를 붙인다 (여호수아 20장)
const REFUGE = new Set(['게데스', '세겜', '헤브론', '베셀', '라못-길르앗', '골란']);

// 앱이 **특별히 크게** 쓰는 곳들. 이름만 보아도 어디쯤인지 잡히는 큰 도시라,
// 성읍 수백 개 사이에서 한눈에 도드라져야 한다. (앱은 1.55 곱, 여기도 같게)
const KEYCITY = new Set([
  '예루살렘', '로마', '바빌론', '니네베', '안티오크(시리아)', '에베소',
  '알렉산드리아', '아테네', '고린도', '데살로니가', '빌립보', '다마스쿠스',
  '사마리아', '카이사레아', '티레', '시돈', '멤피스(노브)', '타르수스',
  '수산', '우르', '하란', '앗수르', '콘스탄티노플', '안티오크(피시디아)',
  '가데스', '시나이 산(호렙)', '베들레헴', '나사렛', '가버나움'
]);
// 크게 쓰는 큰 지형 이름 (앱은 1.35 곱)
const BIGREGION = new Set([
  '이스르엘 저지 평야', '유다 산지', '네게브', '샤론 평야',
  '갈릴리 바다', '소금 바다 (사해)', '유다 광야 (여시몬)', '요르단 골짜기 (고르)'
]);

// 표시해 둔 곳에 차례로 주는 색 — 앱 MarkOverlay 와 같은 열 가지.
// 흙빛 지도 위에서 서로 헷갈리지 않게 고른 것이다.
const MARKCOLOR = ['#fccc57', '#6bc7fa', '#fa8c6b', '#9ee699', '#dba8fa',
                   '#fcadcc', '#8cebe0', '#f0e09e', '#b8c7fc', '#f5b88c'];
function markIdx(ko) {
  let i = 0;
  for (const k of MARKED) { if (k === ko) return i; i++; }
  return -1;
}

// 골라 둔 곳 — 자잘한 마을이라도 **늘** 지도에 뜬다.
// 찾아 놓고도 지도에 안 보인다는 말이 여기서 나왔다. 앱의 「표시하기」와 같다.
const MARKED = new Set();
try {
  const sv = JSON.parse(localStorage.getItem('theland.marked') || '[]');
  for (const k of sv) MARKED.add(k);
} catch (e) {}
function saveMarked() {
  try { localStorage.setItem('theland.marked', JSON.stringify([...MARKED])); } catch (e) {}
}
function toggleMark(s) {
  if (!s) return;
  if (MARKED.has(s.ko)) MARKED.delete(s.ko); else MARKED.add(s.ko);
  saveMarked(); updateLabels();
}
// 지파·민족 이름표에 쓸 그 땅의 색 (이름 → [r,g,b])
const AREACOLOR = new Map();
let highlight = null;
// 이번에 끈 만큼(화면 픽셀) — 끌었으면 누른 것이 아니다.
//
// 예전에는 이것이 **거리가 아니라 pointermove 가 몇 번 왔는가**였다.
// 마우스는 누르는 동안 가만히 있으니 0 이지만, 트랙패드는 손가락이
// 눌린 채 미세하게 흔들려 네댓 번은 그냥 온다. 그래서 맥북에서는 지명을
// 눌러도 「끌다가 뗀 것」으로 여겨져 카드가 뜨지 않았다. 이제 누른 자리에서
// **얼마나 벗어났는지**를 잰다.
let moved = 0, downAt = null;
const TAPSLOP = 8;                 // 이만큼까지는 흔들려도 누른 것으로 본다

// 이름표를 누른 자리.
//
// 지도의 moved 를 그대로 썼더니 손가락에서 **되었다 안 되었다** 했다.
// 이름표를 누를 때는 지도 쪽 pointerdown 이 아예 비켜서므로 moved 가
// 갱신되지 않는다 — 곧 **직전에 지도를 끈 값이 그대로 남아 있다.**
// 지도를 크게 끌고 나서 지명을 누르면 「끌다가 뗀 것」으로 여겨져 무시되고,
// 살짝 누르고 나서 누르면 먹혔다. 그래서 이름표는 제 누름 자리를 따로 잰다.
// 손가락은 마우스보다 훨씬 흔들리므로 넉넉히 18 px 까지 눌린 것으로 본다.
let labDown = null;
const LABSLOP = 18;
function labSlid(ev) {
  if (!labDown || ev.clientX == null) return false;
  return Math.hypot(ev.clientX - labDown.x, ev.clientY - labDown.y) > LABSLOP;
}

function labelCap() { return innerWidth < 560 ? 52 : 130; }

// ── 툴바 크기 ─────────────────────────────────────────────
//
// 아이패드로 멀리 놓고 보거나 눈이 침침하면 지금 크기가 작다. 「보통」과
// 「크게」 둘을 두되, 키운 만큼 높이와 여백이 같이 자라 줄이 흐트러지지
// 않게 한다 — 글씨만 키우면 단추가 삐뚤빼뚤해진다.
let UIBIG = false;
try { UIBIG = localStorage.getItem('theland.uibig') === '1'; } catch (e) {}
function applyUIBig() {
  document.body.classList.toggle('uibig', UIBIG);
  try { localStorage.setItem('theland.uibig', UIBIG ? '1' : '0'); } catch (e) {}
}

/** 시점으로 서 있을 때, 이 곳이 산에 가려 안 보이는가.
 *  눈에서 그 곳까지 곧게 가면서 땅이 그 선보다 높이 솟는 데가 있으면 가려진 것이다.
 *  (하늘에서 내려다볼 때는 재지 않는다 — 그때는 다 보이는 것이 맞다) */
function hiddenByLand(s, camPos, was) {
  const steps = 14;
  // 이미 떠 있던 이름은 조금 넉넉히 봐 준다 — 능선을 스칠 때마다
  // 껐다 켰다 하면 그것이 곧 깜빡임이다.
  const tol = was ? 0.06 : 0.015;
  for (let i = 2; i < steps; i++) {
    const t = i / steps;
    const x = camPos.x + (s.x - camPos.x) * t;
    const z = camPos.z + (s.z - camPos.z) * t;
    const y = camPos.y + (s.y - camPos.y) * t;
    if (groundAt(x, z) > y + tol) return true;
  }
  return false;
}

// ── 지명 상세도 — 앱과 같은 다섯 단계 ───────────────────────
//
// 0 아주 간단히 · 1 간단히 · 2 보통 · 3 자세히(기본) · 4 아주 자세히.
// 등급마다 「얼마나 멀리서부터 보이는가」를 달리 주어, 낮은 단계에서는
// 작은 마을이 아예 뜨지 않게 한다. 앱의 SiteBillboards 규칙 그대로다.
const DETAILS = [
  { ko: '아주 간단히', en: 'Minimal',  hintKo: '큰 도시만',
    hintEn: 'Major cities only' },
  { ko: '간단히',     en: 'Simple',   hintKo: '큰 도시와 큰 지형 이름만',
    hintEn: 'Major cities and large landforms' },
  { ko: '보통',       en: 'Normal',   hintKo: '여기에 성읍과 산 정상까지',
    hintEn: 'Adds towns and mountain peaks' },
  { ko: '자세히',     en: 'Detailed', hintKo: '작은 마을과 유적까지',
    hintEn: 'Adds villages and ruins' },
  { ko: '아주 자세히', en: 'Full',     hintKo: '성문과 샘까지 전부',
    hintEn: 'Everything, down to gates and springs' }
];
// 갈래마다 따로 정한다 — 성읍은 아주 자세히, 지형은 간단히 보고 싶을 수 있다.
const DET = { city: 3, land: 3, water: 3, tribe: 3, nation: 3, first: 3, divided: 3, inner: 3 };
try {
  const sv = JSON.parse(localStorage.getItem('theland.detail2') || 'null');
  if (sv) {
    for (const k in DET) if (sv[k] >= 0 && sv[k] <= 4) DET[k] = sv[k];
  } else {
    const v = parseInt(localStorage.getItem('theland.detail'), 10);
    if (v >= 0 && v <= 4) for (const k in DET) DET[k] = v;
  }
} catch (e) {}
function saveDetail() {
  try { localStorage.setItem('theland.detail2', JSON.stringify(DET)); } catch (e) {}
}
// 등급 → 그 등급이 속한 갈래 (syncLayers 가 채운다)
const rankLayer = {};
function detailOf(rank) {
  const k = rankLayer[rank];
  return (k && DET[k] != null) ? DET[k] : 3;
}

function detailMul(rank) {
  const D = detailOf(rank);
  switch (rank) {
    case 0:  return D >= 2 ? 1.25 : 1.7;
    case 1:  return D >= 2 ? 1.00 : 0;
    case 3:  return D >= 2 ? 0.85 : 0;
    case 4:  return D >= 2 ? 1.8 : (D === 1 ? 1.2 : 0);
    case 7:  return D >= 2 ? 1.8 : (D === 1 ? 1.2 : 0);
    case 8:  return D >= 1 ? 2.4 : 0;
    case 5: case 6: case 9: case 11: case 12: return 9.0;
    case 10: return D >= 3 ? 0.55 : 0;
    default: return D >= 4 ? 1.20 : (D === 3 ? 0.95 : 0);
  }
}

// ── 테마 ──────────────────────────────────────────────────
//
// 지파도 민족도 지형도 한꺼번에 띄우면 지도가 아니라 낱말 더미가 된다.
// 갈래를 골라 볼 수 있게 한다. 처음에는 성읍·지형·물길만 켜 둔다.
const LAYERS = [
  { k: 'city',   ko: '성읍',  en: 'Towns',   ranks: [0, 1, 2, 3], on: true,
    hintKo: '도시와 마을의 이름', hintEn: 'Names of towns and villages' },
  { k: 'land',   ko: '지형',  en: 'Landforms', ranks: [4, 8, 9], on: true,
    hintKo: '산 · 산맥 · 골짜기 · 들 · 광야', hintEn: 'Mountains, valleys, plains, wilderness' },
  { k: 'water',  ko: '물길',  en: 'Waters',  ranks: [7],          on: true,
    hintKo: '강과 급류 골짜기의 이름', hintEn: 'Rivers and torrent valleys' },
  { k: 'tribe',  ko: '지파',  en: 'Tribes',  ranks: [5],          on: false,
    hintKo: '이스라엘 열두 지파가 받은 땅 (정착 이후)',
    hintEn: 'The lands of the twelve tribes (after the settlement)' },
  { k: 'nation', ko: '민족',  en: 'Nations', ranks: [6],          on: false,
    hintKo: '정복 이전에 그 땅에 살던 민족들',
    hintEn: 'The peoples living there before the conquest' },
  { k: 'first',  ko: '1세기', en: 'First century', ranks: [11],   on: false,
    hintKo: '갈릴리 · 사마리아 · 유대 · 데카폴리스 …',
    hintEn: 'Galilee, Samaria, Judea, the Decapolis …' },
  { k: 'divided', ko: '분열 왕국', en: 'Divided kingdom', ranks: [12], on: false,
    hintKo: '유다 왕국과 이스라엘 왕국',
    hintEn: 'The kingdoms of Judah and Israel' },
  { k: 'inner',  ko: '성 안', en: 'Inside a city', ranks: [10],   on: true,
    hintKo: '예루살렘·로마 등 성 안의 자리 (가까이 가야 보입니다)',
    hintEn: 'Places inside Jerusalem, Rome … (only up close)' }
];
try {
  const saved = JSON.parse(localStorage.getItem('theland.layers') || 'null');
  if (saved) for (const l of LAYERS) if (saved[l.k] != null) l.on = !!saved[l.k];
} catch (e) {}
const rankOn = {};
function syncLayers() {
  for (const l of LAYERS) for (const r of l.ranks) { rankOn[r] = l.on; rankLayer[r] = l.k; }
  try {
    const o = {}; for (const l of LAYERS) o[l.k] = l.on;
    localStorage.setItem('theland.layers', JSON.stringify(o));
  } catch (e) {}
}
syncLayers();

function updateLabels() {
  const v = new THREE.Vector3();
  const cand = [];
  const camPos = camera.position;
  // 얼마나 멀리까지 이름을 띄울 것인가.
  //   · 물러설수록 멀리까지 — 보는 거리에 비례한다.
  //   · 다만 눈을 낮게 깔면 수십 km 가 지평선 한 줄로 눌려 붙는다. 거기까지
  //     이름을 다 띄우면 글자 띠가 되어 지도가 아니라 낱말 더미가 된다.
  //     그래서 눕혀 볼수록 짧게 끊는다.
  const tilt = Math.max(0, Math.min(1, (cam.el - 0.12) / 0.55));   // 0 눕힘 · 1 내려다봄
  const reach = (cam.dist * 2.6 + 50) * (0.55 + 0.45 * tilt);
  for (const s of SITES) {
    if (rankOn[s.rank] === false) continue;              // 꺼 둔 갈래
    if (s.rank === 10 && cam.dist > 12) continue;        // 성 안의 것은 가까이서만
    // 골라 둔 곳과 방금 찾은 곳은 어떤 셈에도 걸리지 않는다 — 늘 뜬다.
    const keep = MARKED.has(s.ko) || highlight === s.ko;
    if (!keep) {
    // 지파·민족·지역 이름은 넓은 땅의 이름이라 물러섰을 때만 뜬다.
    // 산 · 산맥 · 골짜기 · 물길은 그렇지 않다 — 가까이서도 보여야 한다.
    if (s.era && cam.dist < 60) continue;
    if (s.era && !areaShown(s.era, s.ko)) continue;
    if (s.rank === 9 && cam.dist < 60) continue;
    const mul = detailMul(s.rank);
    if (mul <= 0) continue;
    }
    v.set(s.x, s.y, s.z).project(camera);
    if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;
    const d = Math.hypot(s.x - camPos.x, s.y - camPos.y, s.z - camPos.z);
    // 떠 있던 이름에게는 좀 더 먼 데까지 자리를 준다 (되돌아올 때는 좁게)
    const was = LABPREV.has(labKey(s));
    // 주요 도시는 훨씬 멀리서부터 보인다 — 앱이 그렇다
    const key = s.rank <= 1 && KEYCITY.has(s.ko);
    if (!keep && d > reach * detailMul(s.rank) * (key ? 1.9 : 1) * (was ? 1.22 : 1)) continue;
    if (fpv && !s.era && hiddenByLand(s, camPos, was)) continue;
    // 자리다툼의 차례. 지파·민족·지역은 **넓은 땅의 이름**이라 성읍 수백 개에
    // 밀려나면 안 된다 — 켜 두었으면 먼저 자리를 잡는다. (예전에는 등급이
    // 높다는 이유로 맨 뒤로 밀려, 110개 한도에 걸려 하나도 안 보였다.)
    const era = !!s.era || s.rank === 9;
    // 지역 이름은 성읍 이름 위로 한 뼘 띄운다. 「사마리아」처럼 성읍과
    // 지역이 같은 이름·같은 자리인 곳에서 둘이 포개져 읽을 수가 없었다.
    cand.push({ s, keep: keep, key: key, sx: (v.x * .5 + .5) * innerWidth,
                sy: (-v.y * .5 + .5) * innerHeight - (s.era ? 34 : 0), d,
                // 주요 도시끼리도 등급 차례는 지켜야 한다. 다 같이 -60000 으로
                // 눌러 놓았더니 물러섰을 때 예루살렘(0등급)이 베들레헴(1등급)에
                // 밀려 사라졌다 — 자리다툼이 거리만으로 판가름 났기 때문이다.
                score: (keep ? -2000000 : era ? -900000
                             : (key ? -60000 : 0) + s.rank * 1000) + d
                       - (was ? 520 : 0) });
  }
  cand.sort((a, b) => a.score - b.score);

  // 겹침 정리 — 화면을 칸으로 나눠 한 칸에 하나만.
  //
  // 다만 칸 하나에 하나씩만으로는 지평선 언저리가 여전히 다닥다닥하다.
  // 저 멀리서는 수십 km 가 몇십 픽셀로 눌리기 때문이다. 그래서 **멀리 있는
  // 이름일수록 넓은 자리를 차지하게** 한다 — 가까운 데는 그대로 촘촘하고,
  // 먼 데만 성기게 솎인다.
  const cell = 34, cols = Math.ceil(innerWidth / cell);
  const taken = new Set();
  const out = [];
  const near = Math.max(cam.dist, 1);
  for (const c of cand) {
    // 골라 둔 곳은 한도에도 자리다툼에도 걸리지 않는다
    if (!c.keep && out.length >= labelCap()) continue;
    const far = c.d / near;                       // 보는 거리의 몇 곱쯤 멀리 있는가
    let sp = c.keep ? 1 : (far > 2.5 ? 3 : far > 1.5 ? 2 : 1);
    if (c.key) sp = Math.max(sp, 2);              // 큰 글씨에는 그만한 자리를
    const cx = Math.floor(c.sx / cell), cy = Math.floor(c.sy / cell);
    let hit = false;
    for (let a = 0; a < sp && !hit; a++)
      for (let b = 0; b < sp && !hit; b++)
        if (taken.has((cy + b) * cols + (cx + a))) hit = true;
    if (!c.keep && hit) continue;
    for (let a = 0; a < sp; a++)
      for (let b = 0; b < sp; b++) taken.add((cy + b) * cols + (cx + a));
    out.push(c);
  }

  while (labelPool.length < out.length) {
    const el = document.createElement('div');
    el.className = 'lab';
    el.addEventListener('pointerdown', ev => {
      labDown = { x: ev.clientX, y: ev.clientY };
    });
    // stopPropagation 을 하지 않는다. pointerup 을 여기서 막으면 지도가
    // 손가락을 놓지 못해(pts 가 남아) 다음 끌기가 어긋난다.
    onTap(el, ev => {
      if (labSlid(ev)) return;               // 누른 게 아니라 문지른 것이다
      const s = el._site; if (s) { flyTo(s, 0, true); showCard(s); }
    });
    labelRoot.appendChild(el); labelPool.push(el);
  }
  // 이름마다 지난 판에 쓰던 조각을 그대로 물려 준다
  const used = new Array(labelPool.length).fill(false);
  const slot = new Array(out.length).fill(-1);
  for (let i = 0; i < out.length; i++) {
    const j = LABSLOT.get(labKey(out[i].s));
    if (j != null && j < labelPool.length && !used[j]) { used[j] = true; slot[i] = j; }
  }
  for (let i = 0, free = 0; i < out.length; i++) {
    if (slot[i] >= 0) continue;
    while (free < labelPool.length && used[free]) free++;
    used[free] = true; slot[i] = free;
  }
  LABSLOT.clear(); LABPREV.clear();
  for (let i = 0; i < out.length; i++) {
    LABSLOT.set(labKey(out[i].s), slot[i]);
    LABPREV.add(labKey(out[i].s));
  }
  for (let j = 0; j < labelPool.length; j++) if (!used[j]) labelPool[j].style.display = 'none';
  for (let i = 0; i < out.length; i++) {
    const el = labelPool[slot[i]];
    const c = out[i], s = c.s;
    el._site = s;
    const has = byPlace.has(s.ko);
    const ref = s.rank < 4 && REFUGE.has(s.ko);
    const key = s.rank <= 1 && KEYCITY.has(s.ko);
    const bigr = s.rank === 4 && BIGREGION.has(s.ko);
    const mi = MARKED.has(s.ko) ? markIdx(s.ko) : -1;
    // 글씨와 차림새가 그대로면 손대지 않는다. 판마다 다시 써 넣으면
    // 브라우저가 그때마다 글자를 다시 앉혀 미세하게 떨린다.
    const sig = s.ko + '|' + s.rank + '|' + (ref ? 1 : 0) + '|' + (has ? 1 : 0) + '|' +
                mi + '|' + (highlight === s.ko ? 1 : 0) + '|' + L.cur;
    if (el._sig !== sig) {
    el._sig = sig;
    el.className = 'lab r' + s.rank + (ref ? ' refuge' : '') +
                   (key ? ' key' : '') + (bigr ? ' bigr' : '') +
                   (mi >= 0 ? ' mark' : '') +
                   (highlight === s.ko ? ' on' : '');
    // 표시해 둔 곳은 앱처럼 **번호가 달린 알약**으로 — 그냥 글씨 색만
    // 바꿔서는 성읍 수백 개 사이에서 도무지 찾을 수가 없었다.
    const tint = mi >= 0 ? MARKCOLOR[mi % MARKCOLOR.length] : null;
    el.innerHTML = (tint ? '<em style="background:' + tint + '">' + (mi + 1) + '</em>'
                         : (ref || has ? '<i></i>' : '')) +
                   escapeHTML(L.cur === 'ko' ? s.ko : s.en);
    // 지파·민족은 앱처럼 **그 땅 색의 판 위에 큰 흰 글씨**로 앉힌다.
    const ac = s.era ? AREACOLOR.get(s.era + '\u0000' + s.ko) : null;
    if (tint) {
      el.style.background = 'rgba(15,16,18,.86)';
      el.style.borderColor = tint;
    } else if (ac) {
      const p = (m, al) => 'rgba(' + ac.map(v => Math.round(Math.min(255, v * 255 * m))).join(',') +
                           ',' + al + ')';
      el.style.background = p(0.52, 0.88);
      el.style.borderColor = p(1.35, 0.95);
    } else if (el.style.background) {
      el.style.background = ''; el.style.borderColor = '';
    }
    }
    el.style.display = '';
    el.style.left = c.sx + 'px';
    el.style.top = c.sy + 'px';
  }
  shown = out;
  updateStopMarks();
}

/** 성구를 누르면 그 대목이 열리게 — 앱과 같은 주소를 쓴다 */
function verseURL(ref) {
  // 근거 성구가 둘 이상이면 **다 함께** 연다.
  //
  // 예전에는 세미콜론 앞의 첫 성구만 보냈다. 그래서
  // 「민수기 13:1-3,17-20; 신명기 1:19-23」 을 눌러도 신명기는 열리지 않았다.
  // 뒤엣것은 아예 찾아 주지 않으니, 있는 줄도 모르고 지나쳤다.
  // 세미콜론 뒤의 빈칸은 지우고 목록 그대로 넘긴다.
  const all = String(ref).split(';').map(t => t.trim()).filter(Boolean).join(';');
  if (!all) return null;
  const q = encodeURIComponent(L.ref(all));
  const path = L.cur === 'en' ? 'en/wol/l/r1/lp-e' : 'ko/wol/l/r8/lp-ko';
  return 'https://wol.jw.org/' + path + '?q=' + q;
}

/** 눌렀을 때 확실히 듣는다.
 *
 *  지도를 손가락으로 붙잡아 끄는 화면이라, 브라우저에 따라 단추 위에서 뗀
 *  손가락이 click 으로 이어지지 않는 일이 있다. 폰에서 「따라가기가 안 먹는다」는
 *  말이 여기서 나왔다. 그래서 pointerup 도 함께 듣고, 곧이어 오는 click 은
 *  한 번 더 부르지 않도록 흘려 보낸다. */
function onTap(el, fn) {
  let last = 0;
  el.addEventListener('pointerup', ev => {
    if (ev.button > 0) return;
    last = Date.now();
    fn(ev);
  });
  el.addEventListener('click', ev => {
    if (Date.now() - last < 700) return;
    fn(ev);
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── 시점 — 땅에 내려서서 ────────────────────────────────────
//
// 하늘에서 내려다보는 지도가 아니라, 그 땅에 서서 둘레를 보는 눈이다.
// 조이스틱으로 걸어 다니고, 걸음새는 걷기 · 낙타 · 전차 가운데 고른다.
// (실제 걸음보다 빠르게 잡았다. 실측대로 두면 한 골짜기를 건너는 데
//  반나절이 걸려, 지도를 보러 온 사람에게는 재미가 없다.)
let fpv = false, fpvBtn = null;
// 눈높이(m). 처음에는 380 m — 언덕 하나쯤 위에서 골짜기를 굽어보는 높이다.
// 사람 키에 붙여 두었더니 앞산에 다 가려 아무것도 안 보였다. 거기서부터
// 위로 더 올라가는 자리를 넉넉히 두어, 지방 전체를 굽어볼 수도 있게 했다.
const EYES = [1.7, 40, 120, 380, 900, 2000, 4500];
let eyeIdx = 3, eyeEl = null;
function eyeM_() { return EYES[eyeIdx]; }
// 실제 걸음에 맞춘다. 예전에는 걷기를 6 m/s (21 km/h) 로 잡았는데 그건
// 걷는 것이 아니라 뛰는 것이다. 대신 빠르기(×0.5~×4)를 시점에서도 쓸 수
// 있게 해서, 멀리 갈 때는 빠르게 감을 수 있다.
const TRAVEL = [
  { ko: '걷기', en: 'Walk',    mps: 1.4 },   // 5 km/h — 사람 걸음
  { ko: '낙타', en: 'Camel',   mps: 4.0 },   // 14 km/h — 낙타 속보
  { ko: '전차', en: 'Chariot', mps: 9.0 }    // 32 km/h — 전차
];
let travelIdx = 0;
const joyVec = { x: 0, y: 0 };
let joyEl = null, joyKnob = null, travelEl = null;

function stepFpv(dt) {
  if (!fpv) return;
  if (!joyVec.x && !joyVec.y) return;
  const step = TRAVEL[travelIdx].mps * spdMul() * dt / 1000;   // 미터/초 → km
  const sa = Math.sin(cam.az), ca = Math.cos(cam.az);
  // 앞은 시선 쪽, 옆은 그 오른쪽
  const f = -joyVec.y * step, r = joyVec.x * step;
  cam.tx += -sa * f + ca * r;
  cam.tz += -ca * f - sa * r;
  applyCam();
}

function makeJoy() {
  joyEl = document.createElement('div');
  joyEl.id = 'joy';
  joyKnob = document.createElement('i');
  joyEl.appendChild(joyKnob);
  dockEl().appendChild(joyEl);

  travelEl = document.createElement('div');
  travelEl.id = 'travel';
  travelEl.addEventListener('click', ev => {
    const b = ev.target.closest('[data-tv]');
    if (!b) return;
    travelIdx = +b.dataset.tv;
    syncTravel();
  });
  dockEl().appendChild(travelEl);

  eyeEl = document.createElement('div');
  eyeEl.id = 'eyeh';
  eyeEl.addEventListener('click', ev => {
    const b = ev.target.closest('[data-ey]');
    if (!b) return;
    eyeIdx = +b.dataset.ey;
    syncTravel(); applyCam();
  });
  dockEl().appendChild(eyeEl);

  let id = null;
  const R = 44;
  const setKnob = (dx, dy) => {
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, R / d);
    const x = dx * k, y = dy * k;
    joyKnob.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    joyVec.x = x / R; joyVec.y = y / R;
  };
  joyEl.addEventListener('pointerdown', e => {
    id = e.pointerId; joyEl.setPointerCapture(id);
    const r = joyEl.getBoundingClientRect();
    setKnob(e.clientX - (r.x + r.width / 2), e.clientY - (r.y + r.height / 2));
    e.preventDefault();
  });
  joyEl.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const r = joyEl.getBoundingClientRect();
    setKnob(e.clientX - (r.x + r.width / 2), e.clientY - (r.y + r.height / 2));
  });
  const drop = e => {
    if (e.pointerId !== id) return;
    id = null; joyVec.x = 0; joyVec.y = 0;
    joyKnob.style.transform = 'translate(0,0)';
  };
  joyEl.addEventListener('pointerup', drop);
  joyEl.addEventListener('pointercancel', drop);

  const st = document.createElement('style');
  st.textContent =
    '#joy{position:relative;width:112px;height:112px;order:9;' +
    'display:none;border-radius:56px;border:1px solid rgba(255,255,255,.2);' +
    'background:rgba(20,20,24,.55);backdrop-filter:blur(10px);touch-action:none}' +
    '#joy.on{display:block}' +
    '#joy i{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;' +
    'border-radius:22px;background:rgba(253,204,97,.92);box-shadow:0 2px 10px rgba(0,0,0,.45);' +
    'pointer-events:none;transition:transform .05s linear}' +
    '#travel,#eyeh{display:none;gap:2px;align-items:center;' +
    'padding:3px 3px 3px 10px;border-radius:19px;' +
    'border:1px solid rgba(255,255,255,.18);background:rgba(20,20,24,.9)}' +
    '#travel{order:-2}#eyeh{order:-1}' +
    '#travel.on,#eyeh.on{display:flex}' +
    '#travel>i,#eyeh>i{font-style:normal;font-size:11.5px;color:#b9b1a3;' +
    'font-weight:600;margin-right:3px}' +
    '#eyeh>u{text-decoration:none;font-size:11px;color:#8d867a;margin:0 5px 0 3px}' +
    '#travel button,#eyeh button{border:0;background:none;color:#b9b1a3;cursor:pointer;' +
    'font:700 12px/1 inherit;padding:0 9px;height:30px;border-radius:15px}' +
    '#travel button.sel,#eyeh button.sel{background:#f2b64c;color:#231702}' +
    '@media (max-width:560px){#joy{width:96px;height:96px}' +
    '#travel button,#eyeh button{padding:0 7px;font-size:11px;height:28px}}' +
    // 넓은 화면에서는 조종 단추를 화면 한복판에서 치운다.
    //
    // 경로를 만들어 두고 시점을 켜면 걸음 · 눈높이 · 빠르기 · 따라가기 ·
    // 조이스틱이 **다섯 줄로 가운데에 쌓여** 정작 걸어갈 앞이 보이지 않았다.
    // (아이패드 가로에서 특히 그렇다.) 조종은 왼쪽 아래에 세로로 모으고
    // 조이스틱은 오른쪽 아래로 보낸다 — 가운데는 비워 둔다.
    '@media (min-width:700px){' +
    'body.fpv #travel,body.fpv #eyeh,body.fpv #spdBtn{position:fixed;left:14px;z-index:27}' +
    'body.fpv #spdBtn{bottom:14px}body.fpv #eyeh{bottom:60px}body.fpv #travel{bottom:106px}' +
    'body.uibig.fpv #eyeh{bottom:68px}body.uibig.fpv #travel{bottom:122px}' +
    'body.fpv #joy{position:fixed;right:18px;bottom:64px;z-index:27}}';
  document.head.appendChild(st);
  syncTravel();
}

function syncTravel() {
  document.body.classList.toggle('fpv', !!fpv);
  if (!travelEl) return;
  travelEl.className = fpv ? 'on' : '';
  travelEl.innerHTML = '<i>' + escapeHTML(L.s('걸음', 'Pace')) + '</i>' +
    TRAVEL.map((t, i) =>
    '<button data-tv="' + i + '"' + (i === travelIdx ? ' class="sel"' : '') + '>' +
    escapeHTML(L.cur === 'ko' ? t.ko : t.en) + '</button>').join('');
  if (eyeEl) {
    eyeEl.className = fpv ? 'on' : '';
    eyeEl.innerHTML = '<i>' + escapeHTML(L.s('눈높이', 'Eye')) + '</i>' +
      EYES.map((v, i) =>
      '<button data-ey="' + i + '"' + (i === eyeIdx ? ' class="sel"' : '') + '>' +
      (v < 10 ? v.toFixed(1) : v) + '</button>').join('') +
      '<u>m</u>';
  }
  if (joyEl) joyEl.className = fpv ? 'on' : '';
  syncSpeedBtn();
}

function setFpv(on) {
  fpv = on;
  if (fpv) {
    lookMode = false;
    if (lookBtn) lookBtn.style.background = '';
    cam.dist = 4;                       // 가까이 — 촘촘한 조각이 뜨도록
    cam.el = 0.62;                      // 눈높이로 앞을 본다
  } else {
    cam.dist = 60;
    cam.el = 0.9;
  }
  if (fpvBtn) fpvBtn.style.background = fpv ? 'rgba(253,204,97,.25)' : '';
  stopFly();
  syncTravel();
  applyCam();
}

// ── 카메라 몰기 ───────────────────────────────────────────
function applyCam() {
  cam.el = Math.max(0.12, Math.min(1.5, cam.el));
  // 높이 자료가 110 m 눈금이다. 그보다 더 다가가면 보여 줄 것이 없고
  // 뭉개진 화면만 남는다 — 3 km 에서 멈춘다.
  cam.dist = Math.max(3.0, Math.min(4200, cam.dist));
  const y = groundAt(cam.tx, cam.tz);
  if (fpv) {
    // 그 자리에 서서 앞을 본다. cam.el 이 고개를 들고 내리는 몫을 한다.
    const eye = y + eyeM_() * 0.001 * VEXAG;
    camera.position.set(cam.tx, eye, cam.tz);
    const pitch = 0.62 - cam.el;                    // 0.62 = 눈높이
    camera.lookAt(cam.tx - Math.sin(cam.az) * 10,
                  eye + Math.tan(Math.max(-1.2, Math.min(1.2, pitch))) * 10,
                  cam.tz - Math.cos(cam.az) * 10);
    syncFog(); updateDetail(); updateRegions(); updateHUD();
    return;
  }
  const r = cam.dist * Math.cos(cam.el);
  camera.position.set(cam.tx + r * Math.sin(cam.az), y + cam.dist * Math.sin(cam.el),
                      cam.tz + r * Math.cos(cam.az));
  // 낮게 기울였을 때 카메라가 산 속으로 들어가 화면이 캄캄해지던 것을 막는다
  const gy = groundAt(camera.position.x, camera.position.z);
  if (camera.position.y < gy + 0.6) camera.position.y = gy + 0.6;
  camera.lookAt(cam.tx, y, cam.tz);
  // 길은 세계 눈금으로 그리므로 멀어지면 실오라기가 되고 다가가면 밭두렁이 된다.
  // 배쯤 달라졌을 때만 다시 굽는다 — 끌 때마다 다시 만들 일은 아니다.
  if (routePts && Math.abs(Math.log(cam.dist / (ribbonDist || 1))) > 0.3) drawRoute();
  syncFog();
  updateDetail();
  updateRegions();
  updateHUD();
}

/** 그 자리의 **눈에 보이는 겉면** — 물이면 물낯, 뭍이면 땅이다.
 *
 *  길은 물낯 위에 얹으면서(floorMeters) 따라가는 동그라미와 카메라는
 *  바다 **밑바닥**을 밟고 있었다. 그래서 바울의 뱃길에서 길만 물 위에
 *  또렷하고 동그라미는 물 아래로 가라앉았다. 같은 잣대를 쓰게 한다. */
function surfaceY(lat, lon) {
  const g = groundY(lat, lon);
  const f = floorMeters(lat, lon) * 0.001 * VEXAG;
  return g > f ? g : f;
}

function groundAt(x, z) { return surfaceY(latOfZ(z), lonOfX(x)); }

/** 화면에서 끈 만큼 땅이 따라오게 — 눈금은 거리와 기울기에서 나온다 */
function panBy(dx, dy, dist) {
  stopFly();                                  // 사람이 끌면 날아가던 것은 그만둔다
  const d = dist || cam.dist;
  const k = 2 * d * Math.tan(camera.fov * Math.PI / 360) / Math.max(innerHeight, 1);
  const kz = k / Math.max(Math.sin(cam.el), 0.22);   // 낮게 볼수록 위아래로 더 멀다
  const sa = Math.sin(cam.az), ca = Math.cos(cam.az);
  cam.tx -= dx * k * ca + dy * kz * sa;
  cam.tz += dx * k * sa - dy * kz * ca;
}

/** 그 곳으로 **날아간다.**
 *
 *  예전에는 이름을 누르면 화면이 그 자리로 툭 갈아 끼워졌다. 어디에서
 *  어디로 옮겨 갔는지 알 수가 없어, 누를 때마다 땅을 잃어버렸다.
 *  앱처럼 날아간다 — 가는 동안 살짝 물러났다가 목표로 내려앉는다.
 *
 *  **높이는 건드리지 않는다.** 예전에는 누를 때마다 26~90 km 로 확 당겨서,
 *  멀리서 내려다보다가 이름 하나 눌렀을 뿐인데 화면이 통째로 뒤집혔다.
 *  보는 높이는 보는 사람이 정한다 — 날아간 뒤에도 떠날 때의 높이 그대로다.
 *  (dist 를 딱 집어 준 때만 따른다) */
let flyAnim = null, flyT = 0;

function flyTo(s, dist, now) {
  highlight = s.ko;
  const d1 = dist || cam.dist;
  const km = Math.hypot(s.x - cam.tx, s.z - cam.tz);
  // 그냥 옮기는 자리 셋.
  //   · 지도 위의 이름을 **손으로 곧장 찍은** 때 — 이미 눈에 보이는 곳이라
  //     날아갈 것이 없다. 찍은 자리가 스르르 밀려나면 되레 성가시다.
  //   · 시점으로 걷는 중
  //   · 코앞 — 짧은 거리에 애니메이션을 걸면 굼떠 보이기만 한다
  if (now || fpv || (km < 0.8 && Math.abs(d1 - cam.dist) < 0.8)) {
    stopFly();
    cam.tx = s.x; cam.tz = s.z; cam.dist = d1;
    applyCam();
    return;
  }
  const base = Math.max(cam.dist, d1);
  flyAnim = {
    t: 0,
    // 멀수록 오래 — 앱과 같은 잣대 (0.9초 + 220 km 마다 1초, 최대 2.6초)
    dur: Math.min(900 + km * 4.5, 2600),
    x0: cam.tx, z0: cam.tz, x1: s.x, z1: s.z,
    d0: cam.dist, d1: d1,
    // 가는 동안만 살짝 물러난다. 짧은 걸음이면 거의 물러나지 않는다.
    lift: Math.min(0.85, km / Math.max(base * 4, 1))
  };
  flyT = 0;
}

function stopFly() { flyAnim = null; flyT = 0; }

/** 한 판 만큼 날아간다 */
function stepFly(dt) {
  const f = flyAnim;
  if (!f) return;
  f.t += dt;
  const u = Math.max(0, Math.min(1, f.t / f.dur));
  const e = u * u * (3 - 2 * u);                       // 가다가 부드럽게 선다
  cam.tx = f.x0 + (f.x1 - f.x0) * e;
  cam.tz = f.z0 + (f.z1 - f.z0) * e;
  cam.dist = (f.d0 + (f.d1 - f.d0) * e) * (1 + Math.sin(u * Math.PI) * f.lift);
  if (u >= 1) {
    cam.tx = f.x1; cam.tz = f.z1; cam.dist = f.d1;
    stopFly();
  }
  applyCam();
}

// 눌러 두고 있는 자판. tick 이 프레임마다 이만큼씩 흘려 준다.
const HELD = new Set();
const KEYMAP = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
                '+', '=', '-', '_', '[', ']', 'q', 'Q', 'e', 'E'];
let keyT = 0, SHIFT = false;
function stepKeys() {
  if (!HELD.size) { keyT = 0; return; }
  const now = performance.now();
  const dt = keyT ? Math.min(0.1, (now - keyT) / 1000) : 0.016;
  keyT = now;
  const fast = SHIFT ? 2.4 : 1;
  const px = 900 * dt * fast;                 // 한 초에 화면 900 px 만큼
  let dx = 0, dz = 0, moved = false;
  if (HELD.has('ArrowLeft'))  { dx += px; moved = true; }
  if (HELD.has('ArrowRight')) { dx -= px; moved = true; }
  if (HELD.has('ArrowUp'))    { dz += px; moved = true; }
  if (HELD.has('ArrowDown'))  { dz -= px; moved = true; }
  if (moved) panBy(dx, dz);
  if (HELD.has('+') || HELD.has('=')) { cam.dist *= Math.exp(-1.6 * dt); moved = true; }
  if (HELD.has('-') || HELD.has('_')) { cam.dist *= Math.exp( 1.6 * dt); moved = true; }
  if (HELD.has('[')) { cam.el -= 0.9 * dt; moved = true; }
  if (HELD.has(']')) { cam.el += 0.9 * dt; moved = true; }
  if (HELD.has('q') || HELD.has('Q')) { cam.az -= 1.1 * dt; moved = true; }
  if (HELD.has('e') || HELD.has('E')) { cam.az += 1.1 * dt; moved = true; }
  if (moved) { stopFly(); applyCam(); }
}

function bindControls() {
  const el = renderer.domElement;
  const pts = new Map();                 // 지금 눌려 있는 손가락·단추
  let mode = null, last = null, twoD = 0, twoA = 0, twoMid = null;

  // 화면 **전체**에서 받는다. 예전에는 그림판(canvas)에서만 받았는데,
  // 이름표가 그림판 위에 덮여 있어서 그 위에서 굴리면 사건이 그림판까지
  // 못 오고 **바깥 쪽(구글 사이트)** 이 대신 움직였다.
  // 화면 위에 얹힌 것들은 지도가 아니다. 여기에 빠뜨리면 그 위에서 누른
  // 손가락을 그림판이 가로채, 단추가 눌리지 않는다.
  const overUI = t => !!(t && t.closest &&
    t.closest('#top, #panel, #gate, #card, #goBtn, #spdBtn, #clrBtn, #mkClrBtn, ' +
              '#joy, #travel, #eyeh, #bareBtn'));

  // 지도 위에 떠 있는 이름표와 경로 표지.
  //
  // 마우스와 트랙패드에서 지명이 눌리지 않던 참 까닭이 여기 있었다.
  // 이름표를 누르면 아래 pointerdown 이 그림판으로 손가락을 **가로챈다**
  // (setPointerCapture). 그러면 뒤이어 오는 mouseup 도 그림판으로 가고,
  // click 은 이름표가 아니라 그림판에서 일어난다 — 이름표의 손잡이는
  // 영영 부르지 못한다. 손가락(터치)은 제 나름의 규칙이 있어 멀쩡했으니
  // 아이패드에서는 되고 맥에서만 안 되었던 것이다.
  //
  // 그렇다고 이름표에서 손을 아주 떼면 안 된다. 이름표 위에 손가락을
  // 얹고 밀었을 때 지도가 따라오지 않기 때문이다. **끌기는 그대로 두고
  // 가로채기만 건너뛴다.** 누른 것인지 문지른 것인지는 이름표가 제
  // 누름 자리로 따로 가린다(labSlid).
  const overLab = t => !!(t && t.closest && t.closest('.lab, .rmark'));

  // 왼쪽 단추로 그냥 끌면 **옮기기**. 지도는 그게 맞다.
  // 돌리고 기울이는 것은 오른쪽 단추(또는 ⇧·⌘·ctrl 을 누른 채) — 손가락은 둘.
  const orbitish = e => e.button === 2 || e.button === 1
    || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;

  addEventListener('pointerdown', e => {
    if (overUI(e.target)) return;
    stopFly();                                // 손을 대면 날아가던 것은 그만둔다
    moved = 0; downAt = { x: e.clientX, y: e.clientY };
    if (!overLab(e.target)) { try { el.setPointerCapture(e.pointerId); } catch (_) {} }
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
    if (downAt) moved = Math.max(moved,
      Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y));
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
    // 시점으로 서 있을 때는 끄는 것이 곧 고개를 돌리는 것이다 — 사방 360도.
    else if (fpv || lookMode || mode === 'orbit') { cam.az -= dx * 0.005; cam.el += dy * 0.005; }
    else                  { panBy(dx, dy); }
    applyCam();
  });

  const end = e => {
    // 지도를 톡 누르면 옆 판이 닫힌다. ✕ 는 손가락에 견주어 작아서,
    // 폰에서는 몇 번을 눌러도 안 닫힌다는 말을 들었다. (끌었을 때는 그대로)
    if (e.type === 'pointerup' && !overUI(e.target) && !overLab(e.target)
        && moved <= TAPSLOP)
      panel.classList.remove('open');
    pts.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (pts.size === 1) {
      const v = [...pts.values()][0];
      mode = 'pan'; last = { x: v.x, y: v.y };
    } else if (pts.size === 0) { mode = null; last = null; downAt = null; }
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  addEventListener('lostpointercapture', end);
  addEventListener('contextmenu', e => { if (!overUI(e.target)) e.preventDefault(); });

  // 바퀴와 트랙패드.
  //
  // 마우스 바퀴는 세로로 크고 뚝뚝 끊겨 오고, 트랙패드는 잘게 이어 오며
  // 가로로도 온다. 그 차이로 갈라서 손버릇에 맞춘다.
  //   · 두 손가락으로 밀기       → 지도가 따라 움직인다
  //   · 두 손가락 오므리기(⌃)    → 다가가고 물러선다
  //   · ⌥ 를 누른 채 두 손가락   → 돌리고 기울인다
  //   · 마우스 바퀴              → 화살표가 가리키는 곳으로 다가간다
  // preventDefault 를 꼭 해야 한다. 안 하면 이 창이 아니라 이 창을 담고 있는
  // 쪽이 대신 굴러간다.
  addEventListener('wheel', e => {
    if (overUI(e.target)) return;
    e.preventDefault();
    if (e.ctrlKey) {                       // 오므리기 — 브라우저가 ⌃ 를 붙여 보낸다
      zoomAt(Math.exp(e.deltaY * 0.012), e.clientX, e.clientY);
      return;
    }
    if (e.altKey) {                        // ⌥ + 두 손가락 — 돌리고 기울이기
      // 손가락이 가는 쪽과 반대로 돌던 것을 바로잡는다.
      //
      // 끌 때는 「손가락이 간 만큼」(dx, dy)이 들어오는데, 바퀴는 그 반대인
      // 「내용이 밀려난 만큼」(deltaX, deltaY)이 들어온다. 옮기기 쪽은 그래서
      // 부호를 뒤집어 쓰는데(panBy(-deltaX, -deltaY)) 여기만 그대로 썼다.
      // 그래서 트랙패드로 ⌥ 를 누른 채 밀면 상하좌우가 죄다 거꾸로 돌았다.
      cam.az += e.deltaX * 0.006;
      cam.el -= e.deltaY * 0.006;
      applyCam();
      return;
    }
    const pad = e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 40);
    if (pad) { panBy(-e.deltaX * 1.1, -e.deltaY * 1.1); applyCam(); }
    else zoomAt(Math.exp(e.deltaY * 0.0012), e.clientX, e.clientY);
  }, { passive: false });

  // 맥북 트랙패드로 오므리고 벌리기.
  //
  // 크롬과 파이어폭스는 이것을 ⌃ 를 붙인 wheel 로 보내 주는데, **사파리는
  // 제스처로만 보낸다.** 그런데 여기서는 「쪽 넓히기」를 막으려고 그 셋을
  // 통째로 삼키고 있었다 — 그래서 맥에서는 확대·축소가 아예 먹지 않았다.
  // 막되, 그 값으로 다가가고 물러선다.
  let gsc = 0;
  addEventListener('gesturestart', e => {
    if (overUI(e.target)) return;
    e.preventDefault();
    gsc = e.scale || 1;
  }, { passive: false });
  addEventListener('gesturechange', e => {
    if (overUI(e.target)) return;
    e.preventDefault();
    const sc = e.scale || 1;
    if (gsc > 0.01 && sc > 0.01) zoomAt(gsc / sc, e.clientX, e.clientY);
    gsc = sc;
  }, { passive: false });
  addEventListener('gestureend', e => {
    gsc = 0;
    if (!overUI(e.target)) e.preventDefault();
  }, { passive: false });
  addEventListener('touchmove', e => {
    if (!overUI(e.target) && e.cancelable) e.preventDefault();
  }, { passive: false });

  // 자판으로도 — 화살표로 옮기고, +/- 로 다가가고, [ ] 로 기울인다
  // 자판. 한 번 누를 때마다 뚝뚝 옮기던 것을, **누르고 있는 동안** 부드럽게
  // 이어 흐르도록 바꿨다. 손을 떼면 곧 멎는다.
  //   ← → ↑ ↓  옮기기        ⇧ 를 함께 누르면 빠르게
  //   + −       다가가고 물러서기
  //   Q E       왼쪽·오른쪽으로 돌기
  //   [ ]       눕히고 세우기
  addEventListener('keydown', e => {
    SHIFT = e.shiftKey;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (KEYMAP.indexOf(e.key) < 0) return;
    HELD.add(e.key);
    e.preventDefault();
  });
  addEventListener('keyup', e => { SHIFT = e.shiftKey; HELD.delete(e.key); });
  addEventListener('blur', () => HELD.clear());
}

/** 화면의 한 점을 붙든 채 다가가거나 물러선다 */
function zoomAt(f, cx, cy) {
  stopFly();
  const before = cam.dist;
  cam.dist = Math.max(3.0, Math.min(4200, cam.dist * f));
  const moved = 1 - cam.dist / before;
  if (Math.abs(moved) > 1e-4 && cx != null) {
    panBy(-(cx - innerWidth / 2) * moved, -(cy - innerHeight / 2) * moved, before);
  }
  applyCam();
}

/** 화면 위 단추 — 마우스가 없는 화면에서도 다가가고 기울일 수 있게 */
/** 위쪽 단추 — 그림쇠만 두면 눌러 보기 전에는 무엇인지 알 수가 없다.
 *  그림쇠 옆에 **글자**를 붙인다. 좁은 화면에서는 글자가 접힌다. */
// 툴바 그림 — 기호 글자를 쓰면 글자꼴마다 크기도 밑선도 달라 제각각으로 보인다.
// 같은 16×16 칸에 같은 굵기로 그려 둔다.
const ICO = {
  home:   '<path d="M2.3 7.5 8 2.6l5.7 4.9"/><path d="M3.9 6.9v6.5h8.2V6.9"/>' +
          '<path d="M6.6 13.4V9.7h2.8v3.7"/>',
  relief: '<path d="M1.5 13.2 6 5.1l2.7 4.7 1.7-2.7 4.1 6.1z"/>',
  look:   '<path d="M1 8s2.6-4.4 7-4.4S15 8 15 8s-2.6 4.4-7 4.4S1 8 1 8z"/>' +
          '<circle cx="8" cy="8" r="2"/>',
  layers: '<path d="M2.2 4.3h11.6M2.2 8h11.6M2.2 11.7h11.6"/>',
  route:  '<path d="M3.2 13.4c0-3.5 3-3.5 3-6.2s-3-2.7-3-4.6"/>' +
          '<path d="M6.6 2.6h6.3M10.9 1l2 1.6-2 1.6"/>',
  eye2:   '<circle cx="8" cy="2.6" r="1.6"/>' +
          '<path d="M8 4.6v4.2M8 8.8 5.6 14M8 8.8 10.4 14M4.6 6.2 8 5.4l3.4.8"/>'
};
function svgIco(d) {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
         'stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
}

const TOOLBTNS = [];
/** 말을 바꾸면 툴바 이름도 함께 바뀌게 */
function syncToolLabels() {
  for (const t of TOOLBTNS) { t.b.innerHTML = t.label(); t.b.title = t.title(); }
  syncQualBtn();
}

function addViewButtons() {
  const tools = document.getElementById('tools');
  const mk = (label, title, fn) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.title = title();
    b.innerHTML = label();
    onTap(b, fn);
    tools.insertBefore(b, tools.firstChild);
    TOOLBTNS.push({ b: b, label: label, title: title });
    return b;
  };
  const tag = (icon, word) => '<i>' + icon + '</i><u>' + escapeHTML(word) + '</u>';
  const btnCSS = document.createElement('style');
  btnCSS.textContent =
    '#tools .btn{display:inline-flex;align-items:center;gap:5px;padding:9px 12px;white-space:nowrap}' +
    // 그림은 저마다 같은 칸 안에 놓여 밑선이 어긋나지 않는다
    '#tools .btn i{display:inline-flex;align-items:center;justify-content:center;' +
    'width:18px;height:18px;flex:0 0 18px;font-style:normal;opacity:.9;line-height:1}' +
    '#tools .btn i svg{width:16px;height:16px;display:block}' +
    '#tools .btn i.txt{font:700 11.5px/1 inherit;letter-spacing:-.02em}' +
    '#tools .btn u{text-decoration:none;font-size:12.5px;font-weight:600}' +
    '#tools .btn u.big{font-size:14px;font-weight:700}' +
    // 찾기 칸은 아무리 좁아도 글자 몇 자는 보여야 한다. 예전에는 단추들에
    // 밀려 「지명」 넉 자짜리 알약이 되어 버렸다.
    '#search{flex:1 1 220px;min-width:170px}' +
    '@media (max-width:700px){#tools .btn u{display:none}#tools .btn{padding:9px 10px}}' +
    // 폰에서는 찾기 칸이 단추들에 밀려 손톱만 해진다. 아래로 한 줄 내려
    // 화면 너비를 다 쓰게 한다. 글씨도 16px — 그보다 작으면 사파리가
    // 칸을 누를 때마다 화면을 확 당긴다.
    '@media (max-width:900px){' +
      '#top{flex-wrap:wrap;gap:6px}' +
      '#search{flex:1 1 100%;max-width:none;order:2}' +
      '#q{padding:12px 14px;font-size:16px}' +
      '#tools,#qualPick,#live,#hud{order:1}' +
      // 윗줄과 찾기 칸의 오른쪽 끝을 맞춘다. 예전에는 윗줄이 왼쪽에
      // 몰려 끝나서, 찾기 칸만 오른쪽으로 조금 더 나가 보였다.
      '#tools{flex:1 1 auto;justify-content:space-between}' +
      '#qualPick{flex:0 0 auto}' +
    '}';
  document.head.appendChild(btnCSS);
  // 넣는 차례가 거꾸로다 (맨 앞에 끼우므로).
  // 확대·각도 단추는 걷어냈다 — 바퀴와 손가락이 이미 하는 일이다.
  mk(() => tag(svgIco(ICO.route), L.s('길', 'Journeys')),
     () => L.s('여정과 경로', 'Journeys and routes'), openRoutes);
  mk(() => tag(svgIco(ICO.layers), L.s('표시', 'Display')),
     () => L.s('지도에 무엇을 띄울지', 'What the map shows'), openLayers);
  lookBtn = mk(() => tag(svgIco(ICO.look), L.s('둘러보기', 'Look')),
    () => L.s('제자리에서 사방을 봅니다', 'Turn in place'), () => {
    lookMode = !lookMode;
    lookBtn.style.background = lookMode ? 'rgba(253,204,97,.25)' : '';
  });
  const hypsBtn = mk(() => tag(svgIco(ICO.relief), L.s('표고', 'Relief')),
    () => L.s('땅 높이를 색으로 봅니다', 'Colour the land by height'), () => {
    HYPS = !HYPS;
    try { localStorage.setItem('theland.hyps', HYPS ? '1' : '0'); } catch (e) {}
    hypsBtn.style.background = HYPS ? 'rgba(253,204,97,.25)' : '';
    syncHyps();
  });
  hypsBtn.style.background = HYPS ? 'rgba(253,204,97,.25)' : '';

  fpvBtn = mk(() => tag(svgIco(ICO.eye2), L.s('시점', 'On foot')),
    () => L.s('땅에 내려서서 봅니다', 'Stand on the ground'), () => setFpv(!fpv));
  makeJoy();

  // 관리용 암호로 들어왔을 때만 — 켜져 있는 등
  if (window.__ADMIN) makeLive();
  // 화질도 돌려 가며 누르는 것이 아니라 **바로 고르는** 것이다 —
  // 하에서 상으로 한 번에 갈 수 있어야 한다.
  // 화면을 갈아엎지 않는다. 보던 자리 그대로 그림만 바뀐다.
  qualBtn = document.createElement('div');
  qualBtn.id = 'qualPick';
  qualBtn.className = 'card';
  qualBtn.title = L.s('지형을 얼마나 자세히 그릴지', 'How detailed the land is');
  onTap(qualBtn, ev => {
    const b = ev.target.closest('[data-q]');
    if (b && b.dataset.q !== QUAL) setQual(b.dataset.q);
  });
  tools.parentNode.insertBefore(qualBtn, tools);
  syncQualBtn();
  const qCSS = document.createElement('style');
  qCSS.textContent =
    '#qualPick{display:inline-flex;align-items:center;gap:2px;padding:3px 4px 3px 10px;' +
    'border-radius:12px}' +
    '#qualPick>i{font-style:normal;font-size:12.5px;font-weight:600;opacity:.8;' +
    'margin-right:4px;white-space:nowrap}' +
    '#qualPick button{border:0;background:none;color:#b9b1a3;cursor:pointer;' +
    'font:700 12.5px/1 inherit;padding:0 9px;height:30px;border-radius:15px}' +
    '#qualPick button.sel{background:rgba(253,204,97,.92);color:#231702}' +
    '#qualPick button[disabled]{opacity:.45;cursor:default}' +
    '@media (max-width:700px){#qualPick{padding:3px}#qualPick>i{display:none}' +
    '#qualPick button{padding:0 7px;font-size:11.5px}}';
  document.head.appendChild(qCSS);

  makeBareBtn();

  // 처음은 늘 「하」로 연다. 연결을 넘겨짚어 알림을 띄우던 것은 걷어냈다 —
  // 와이파이인데도 데이터라고 하는 일이 있었다. 화질은 위 단추로 바로 고른다.
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
      '<a class="ref" href="' + escapeHTML(verseURL(e.ref) || '#') +
      '" target="_blank" rel="noopener">' + escapeHTML(L.ref(e.ref)) + ' ↗</a></div>';
  }
  body.innerHTML = html;
  body.scrollTop = 0;
  panel.classList.add('open');
}
onTap(document.getElementById('closeBtn'), () => panel.classList.remove('open'));

// ── 문장에서 곳 찾아내기 ──────────────────────────────────
//
// 「브엘세바에서 므깃도로」처럼 한 줄을 통째로 치면, 그 안에 든 지명을
// **나온 차례대로** 집어낸다. 앱에서 잘 쓰던 것이라 여기에도 둔다.
// 성구를 붙여 넣어도 그 안의 곳들이 다 잡힌다.
// 여느 우리말과 똑같이 생긴 이름은 아예 찾지 않는다.
// 「…이 **아님**」 「**바라**보니」 「-**기나** 하다」 「**웃다**」 가 매번 걸리면
// 이름표가 쓰레기로 차서 오히려 손이 더 간다. 지도에서 눌러 찾으면 된다.
const STOPWORDS = new Set(['아님', '바라', '기나', '웃다']);

// 여느 말과 똑같이 생겼지만 버릴 수는 없는 이름.
// 블레셋의 가자는 다섯 도시 가운데 하나이고, 마리는 유프라테스의 큰 성이며,
// 아이는 여호수아가 친 성이다. 그래서 막는 대신, 뒤에 **자리를 가리키는 말**이
// 붙었을 때만 지명으로 본다.
//   · 「함께 가자」 「가자고」 → 아니다 · 「가자에서」 「가자로」 → 지명
//   · 「소 두 마리」 → 아니다 · 「마리에서」 → 지명
//   · 「아이가 울었다」 → 아니다 · 「아이로 올라가」 → 지명
const NEEDS_PARTICLE = new Set(['가자', '마리', '아이', '아담', '가인', '아인']);

// 「아이가 울었다」의 가, 「마리를 끌고」의 를 까지 받아 주면 도로 걸린다.
// 이 이름들만큼은 **어디서·어디로** 를 뜻하는 말이 붙었을 때만 지명으로 본다.
const PLACE_PARTICLES = ['에서부터', '에게서', '에게로', '에서는', '에서도',
  '으로는', '으로도', '으로', '에서', '에게', '까지', '부터',
  '에는', '에도', '로는', '로도', '에', '로'];
const PLACE_FOLLOWERS = [' 사람', ' 성', ' 땅', ' 왕', ' 주민', ' 지역', ' 근처', ' 부근',
  ' 쪽', ' 및', '성', '왕', '인'];
// 한 글자 이름은 「돌을 던지다」의 돌처럼 겹치기 쉽다.
// 어디서·어디까지를 뜻하는 말이 붙었을 때만 지명으로 본다.
const LOCATIVE = ['에서부터', '에서는', '에서도', '에게서', '에서', '까지', '부터',
  '으로는', '으로도', '으로', '에는', '에도', '에'];
// 앞에 수를 세는 말이 오면 지명이 아니다 — 「소 두 마리」 「양 열 마리」
const COUNTER_HEADS = new Set('0123456789한두세네섯곱덟홉열몇러백천만'.split(''));

function looksLikePlace(t, i, len) {
  let b = i - 1;
  if (b >= 0 && t[b] === ' ') b--;
  if (b >= 0 && COUNTER_HEADS.has(t[b])) return false;
  const tail = t.slice(i + len);
  if (!tail) return false;
  for (const p of PLACE_PARTICLES) if (tail.indexOf(p) === 0) return true;
  for (const f of PLACE_FOLLOWERS) if (tail.indexOf(f) === 0) return true;
  return ',·、;'.indexOf(tail[0]) >= 0;
}
function oneLetterLooksLikePlace(t, i, len) {
  const tail = t.slice(i + len);
  if (!tail) return false;
  for (const p of LOCATIVE) if (tail.indexOf(p) === 0) return true;
  return ',·、;'.indexOf(tail[0]) >= 0;
}

let SCANKEYS = null, SCANSORT = null;
function buildScanKeys() {
  if (SCANKEYS) return;
  SCANKEYS = new Map();
  const put = (k, s) => {
    k = (k || '').trim();
    if (!k || STOPWORDS.has(k)) return;
    if (!SCANKEYS.has(k)) SCANKEYS.set(k, []);
    const a = SCANKEYS.get(k);
    if (!a.some(x => x.ko === s.ko)) a.push(s);
  };
  const add = (k, s) => {
    if (!k) return;
    put(k, s);
    const b = k.replace(/[-\s]/g, '');
    if (b !== k) put(b, s);
    if (k.indexOf('-') >= 0) put(k.replace(/-/g, ' '), s);
  };
  for (const s of SITES) {
    if (s.rank > 4) continue;
    add(s.ko, s);
    if (s.en && s.en.length >= 3) add(s.en, s);
    const l = s.ko.indexOf('('), r = s.ko.lastIndexOf(')');
    if (l > 0 && r > l) {
      add(s.ko.slice(0, l), s);
      for (const p of s.ko.slice(l + 1, r).split(/[;,]/)) add(p, s);
    }
  }
  // 긴 이름부터 본다 — 「벧엘」이 있는데 「벧」까지 잡으면 안 된다
  SCANSORT = [...SCANKEYS.keys()].sort((a, b) => b.length - a.length);
}

/** 글에서 지명을 나온 차례대로 집어낸다 (앱의 TextScan 과 같은 규칙) */
function scanText(t) {
  if (!t || t.length < 4) return [];
  buildScanKeys();
  const lower = t.toLowerCase();
  const taken = new Array(t.length).fill(false);
  const raw = [];
  for (const k of SCANSORT) {
    const latin = /[a-zA-Z]/.test(k);
    const hay = latin ? lower : t;
    const needle = latin ? k.toLowerCase() : k;
    let from = 0;
    for (;;) {
      const i = hay.indexOf(needle, from);
      if (i < 0) break;
      from = i + needle.length;
      let free = true;
      for (let x = i; x < i + needle.length; x++) if (taken[x]) { free = false; break; }
      // 로마자는 낱말 경계를 지킨다 — 「Dan」이 「Jordan」 안에서 걸리면 안 된다
      if (free && latin) {
        const bch = i > 0 ? hay[i - 1] : ' ';
        const ach = i + needle.length < hay.length ? hay[i + needle.length] : ' ';
        if (/[a-z0-9]/.test(bch) || /[a-z0-9]/.test(ach)) free = false;
      }
      if (free && NEEDS_PARTICLE.has(k) && !looksLikePlace(t, i, k.length)) free = false;
      if (free && k.length === 1 && !oneLetterLooksLikePlace(t, i, k.length)) free = false;
      if (!free) continue;
      for (let x = i; x < i + needle.length; x++) taken[x] = true;
      raw.push({ at: i, cands: SCANKEYS.get(k) });
    }
  }
  raw.sort((a, b) => a.at - b.at);

  // 헷갈리지 않는 곳(후보가 하나뿐인 것)을 기둥으로 삼는다.
  const anchors = raw.filter(r => r.cands.length === 1).map(r => r.cands[0]);
  const reach = c => {
    if (!anchors.length) return 0;
    let best = 1e9;
    for (const a of anchors) { const d = kmLL(a, c); if (d < best) best = d; }
    return best;
  };

  const out = [];
  let last = null;
  for (const r of raw) {
    const opts = r.cands.length > 1 && anchors.length
      ? r.cands.slice().sort((a, b) => reach(a) - reach(b))
      : r.cands;
    const pick = opts[0];
    // 잇달아 같은 곳이면 한 번만. 한참 뒤에 다시 나오면 그때 또 들른 것이다.
    if (last === pick.ko) continue;
    last = pick.ko;
    out.push({ s: pick, options: opts });
  }
  return out;
}

/** 문장에서 집어낸 곳들로 길을 세운다 */
function routeFromText(list) {
  plan.start = list[0];
  plan.end = list.length > 1 ? list[list.length - 1] : null;
  plan.via = list.slice(1, -1);
  setRoute(planStops());
  frameRoute();
  showCard(list[0]);
}

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
  let head = '';
  const found = q.length >= 5 ? scanText(q) : [];
  window.__scan = found;
  window.__pick = null;
  if (found.length >= 1) head = scanRow();
  window.__hitRest = out.map((o, i) =>
    '<div class="hit" data-i="' + o.s.i + '">' +
    '<button class="hmark' + (MARKED.has(o.s.ko) ? ' on' : '') + '" data-mark="' + o.s.i + '">' +
    escapeHTML(MARKED.has(o.s.ko) ? L.s('표시 끄기', 'Unmark') : L.s('표시', 'Mark')) + '</button>' +
    '<b>' + escapeHTML(L.place(o.s.ko)) +
    '</b><s>' + escapeHTML(o.sub) + '</s></div>').join('');
  hitsEl.innerHTML = head + window.__hitRest;
});
/** 문장에서 찾은 곳들을 이름표로 늘어놓는다.
 *  같은 이름이 여러 곳인 것(라마·베델…)은 눌러서 고를 수 있다. */
function scanRow() {
  const found = window.__scan || [];
  const pickAt = window.__pick;
  const chips = found.map((h, i) =>
    '<button class="schip' + (h.options.length > 1 ? ' many' : '') +
    (pickAt === i ? ' open' : '') + '" data-pick="' + i + '">' +
    escapeHTML(L.place(h.s.ko)) +
    (h.options.length > 1 ? '<u>' + h.options.length + '</u>' : '') + '</button>').join('');
  let opts = '';
  if (pickAt != null && found[pickAt] && found[pickAt].options.length > 1) {
    opts = '<div class="sopts">' + found[pickAt].options.map((o, k) =>
      '<button data-opt="' + k + '"' + (o.ko === found[pickAt].s.ko ? ' class="sel"' : '') + '>' +
      escapeHTML(L.place(o.ko)) + '<s>' + escapeHTML(L.region(o.region)) + '</s></button>').join('') +
      '</div>';
  }
  return '<div class="hit sentence"><b>' +
    escapeHTML(L.s('이 문장에서 ' + found.length + '곳', found.length + ' places in this line')) +
    '</b><span class="schips">' + chips + '</span>' + opts +
    '<span class="sbtns">' +
    '<button data-scan="mark">' + escapeHTML(L.s('표시하기', 'Mark on map')) + '</button>' +
    '<button data-scan="route" class="go">' +
    escapeHTML(found.length >= 2 ? L.s('경로 만들기', 'Build route')
                                 : L.s('이 곳으로', 'Go here')) + '</button>' +
    '</span></div>';
}

hitsEl.addEventListener('click', e => {
  // 어느 라마인지 고르기
  const chip = e.target.closest('[data-pick]');
  if (chip) {
    e.stopPropagation();
    const i = +chip.dataset.pick;
    const h = (window.__scan || [])[i];
    if (h && h.options.length > 1) {
      window.__pick = (window.__pick === i) ? null : i;
      hitsEl.innerHTML = scanRow() + (window.__hitRest || '');
    }
    return;
  }
  const op = e.target.closest('[data-opt]');
  if (op) {
    e.stopPropagation();
    const h = (window.__scan || [])[window.__pick];
    if (h) h.s = h.options[+op.dataset.opt];
    window.__pick = null;
    hitsEl.innerHTML = scanRow() + (window.__hitRest || '');
    return;
  }
  // 「표시」 — 골라 둔 곳은 자잘한 마을이라도 늘 지도에 뜬다.
  // 이때 찾기 칸은 닫지 않는다. 몇 곳을 잇달아 골라 둘 수 있어야 한다.
  const mk = e.target.closest('[data-mark]');
  if (mk) {
    e.stopPropagation();
    const site = SITES[+mk.dataset.mark];
    toggleMark(site);
    mk.className = 'hmark' + (MARKED.has(site.ko) ? ' on' : '');
    mk.textContent = MARKED.has(site.ko) ? L.s('표시 끄기', 'Unmark') : L.s('표시', 'Mark');
    return;
  }
  const sc = e.target.closest('[data-scan]');
  if (sc) {
    e.stopPropagation();
    const list = window.__scan || [];
    // 앱과 같다 — 경로는 만들지 않고 색깔로만 짚어 주는 길을 따로 둔다.
    // 같은 곳이 여러 번 나와도 표시는 한 번이면 된다.
    const sites = list.map(h => h.s);
    const seen = new Set(), uniq = [];
    for (const st of sites) if (!seen.has(st.ko)) { seen.add(st.ko); uniq.push(st); }
    if (sc.dataset.scan === 'mark') {
      for (const st of uniq) MARKED.add(st.ko);
      saveMarked(); updateLabels();
      if (uniq.length) flyTo(uniq[0]);
      toast(L.s(uniq.length + '곳을 표시했습니다', 'Marked ' + uniq.length + ' places'));
    } else if (sites.length >= 2) {
      routeFromText(sites);
    } else if (uniq.length) {
      flyTo(uniq[0]); showCard(uniq[0]);
    }
    hitsEl.innerHTML = ''; qEl.blur();
    return;
  }
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
// 처음 단추에도 글자를 붙인다
document.getElementById('homeBtn').innerHTML =
  '<i>' + svgIco(ICO.home) + '</i><u class="big">예루살렘</u>';
onTap(document.getElementById('homeBtn'), () => {
  const s = siteByName.get('예루살렘');
  if (s) flyTo(s, 260); else { stopFly(); cam.tx = 0; cam.tz = 0; cam.dist = 260; applyCam(); }
});
function applyLang() {
  document.getElementById('langBtn').innerHTML =
    L.cur === 'ko' ? '<i class="txt">EN</i><u>English</u>'
                   : '<i class="txt">한</i><u>한국어</u>';
  document.documentElement.lang = L.cur;
  document.getElementById('homeBtn').innerHTML =
    '<i>' + svgIco(ICO.home) + '</i><u class="big">' + L.s('예루살렘', 'Jerusalem') + '</u>';
  syncToolLabels();
  syncTravel();
  document.title = L.s('약속의 땅', 'The Promised Land');
  qEl.placeholder = L.s('지명 · 인물 · 낱말 또는 문장을 입력하세요',
                        'Type a place, a person, a word — or a whole line');
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

/** 두 곳을 잇는 항로·발자취가 지도에 그려져 있으면 그 사이 점들을 돌려준다.
 *
 *  딱 맞는 짝이 없으면 **가까운 짝**의 굽이만 빌린다 — 발자취는 지도가 그려 둔
 *  지점을 그대로 밟지 않기 때문이다. 두 끝점은 원래 자리를 쓰므로 경로가
 *  엉뚱한 데서 시작하거나 끝나지 않는다. (앱의 laneVia 와 같다) */
function laneVia(a, b) {
  const k = a + '\u0000' + b, k2 = b + '\u0000' + a;
  if (LANEMAP.has(k)) return LANEMAP.get(k);
  if (LANEMAP.has(k2)) return LANEMAP.get(k2).slice().reverse();
  return null;
}

/** 딱 맞는 항로가 없을 때, 가까운 짝의 **굽이만** 빌린다.
 *  옛길로 이을 수 있으면 그쪽이 낫다 — 그래서 이것은 마지막에만 쓴다. */
function laneNear(a, b) {
  const sa = siteByName.get(a), sb = siteByName.get(b);
  if (!sa || !sb || kmLL(sa, sb) < 40) return null;
  let bd = 1e9, best = null;
  for (const l of LANES) {
    const la = siteByName.get(l.a), lb = siteByName.get(l.b);
    if (!la || !lb) continue;
    const fwd = Math.max(kmLL(sa, la), kmLL(sb, lb));
    if (fwd <= 110 && fwd < bd) { bd = fwd; best = l.via; }
    const rev = Math.max(kmLL(sa, lb), kmLL(sb, la));
    if (rev <= 110 && rev < bd) { bd = rev; best = l.via.slice().reverse(); }
  }
  return best;
}

/** 옛길 위로 a 에서 b 까지. 길이 멀면 곧게 잇는다.
 *
 *  차례가 있다.
 *    ① 지도에 이 두 곳을 잇는 굽이가 **그대로** 그려져 있으면 그것 (뱃길이 여기 든다)
 *    ② 없으면 **옛길**을 따라간다 — 뭍에서는 이쪽이 맞다
 *    ③ 옛길로도 못 이으면 그때 가까운 짝의 굽이를 빌린다
 *  예전에는 ③을 ②보다 먼저 써서, 뭍길인데도 엉뚱한 뱃길의 굽이를 뒤집어쓰는
 *  구간이 있었다. */
function roadPath(a, b) {
  const via = laneVia(a.ko, b.ko);
  if (via && via.length) return [a, ...via.map(p => ({ lat: p[0], lon: p[1] })), b];
  const road = roadOnly(a, b);
  if (road) return road;
  const near = laneNear(a.ko, b.ko);
  if (near && near.length) return [a, ...near.map(p => ({ lat: p[0], lon: p[1] })), b];
  return [a, b];
}

/** 옛길만으로 이어 본다. 못 이으면 null. */
function roadOnly(a, b) {
  const A = nearestNode(a), B = nearestNode(b);
  if (A.km > 35 || B.km > 35 || A.i < 0 || B.i < 0) return null;
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
  if (!isFinite(dist[B.i])) return null;
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
/** 대해의 물가 — 지형 셰이더가 쓰는 것과 같은 어림선 */
function coastLonJS(la) {
  const mx = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
  if (la < 31.29) return mx(33.900, 34.230, (la - 31.05) / 0.24);
  if (la < 31.80) return mx(34.230, 34.620, (la - 31.29) / 0.51);
  if (la < 32.33) return mx(34.620, 34.840, (la - 31.80) / 0.53);
  if (la < 32.72) return mx(34.840, 34.935, (la - 32.33) / 0.39);
  if (la < 32.95) return mx(34.935, 35.074, (la - 32.72) / 0.23);
  if (la < 33.27) return mx(35.074, 35.190, (la - 32.95) / 0.32);
  return mx(35.190, 35.390, (la - 33.27) / 0.33);
}

/** 이 자리의 호수 수면 높이(m). 호수 밖이면 null. */
function lakeLevel(lat, lon) {
  for (const l of LAKES) {
    let inside = false; const r = l.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if ((r[i][0] > lat) !== (r[j][0] > lat) &&
          lon < (r[j][1] - r[i][1]) * (lat - r[i][0]) / (r[j][0] - r[i][0]) + r[i][1]) inside = !inside;
    if (inside) return l.level;
  }
  return null;
}

/** 길이 이 자리에서 딛는 **가장 낮은 높이**(m).
 *
 *  바다 위를 지나는 뱃길이 해저 등고를 따라 오르내리면 배가 물속을 기어가는
 *  꼴이 된다. 앱은 siteGroundMeters 에서 max(땅, 수면) 을 쓴다 — 물 위에서는
 *  수면을 밟는다. 여기서도 같게 한다.
 *
 *  다만 해수면보다 낮아도 **마른 땅**인 곳이 있다 — 요르단 지구대, 아라바,
 *  카타라 저지. 거기서는 땅을 그대로 밟아야 한다. */
function floorMeters(lat, lon) {
  const lv = lakeLevel(lat, lon);
  if (lv != null) return lv;
  const h = groundY(lat, lon) / (0.001 * VEXAG);
  if (h >= 0) return -30000;
  if (lat > 31.05 && lat < 33.75 && lon > 34.20 && lon < 36.30
      && lon > coastLonJS(lat) + 0.06) return -30000;
  if (lat > 29.62 && lat <= 31.05 && lon > 34.95 && lon < 35.80) return -30000;
  if (lat > 28.30 && lat < 30.60 && lon > 25.80 && lon < 29.60) return -30000;
  return 0;
}

// ── 젖은 정도 — 앱의 moistureAt 을 그대로 옮긴 것 ──────────
//
// 논밭이 어디에 있는가는 결국 「어디가 젖어 있는가」다. 앱은 지형을 구울 때마다
// 이 값을 재지만, 여기서는 지도 전체를 **한 번만** 재어 작은 그림 한 장에 담고
// 셰이더가 그것을 읽는다. (700×380, 한 칸이 6 km 쯤)

function sstepJS(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

/** 지구대(요르단 골짜기)의 경도 — 위도별 조절점을 선으로 잇는다 */
const RIFT_CTRL = [
  [30.20, 35.150], [30.36, 35.145], [30.53, 35.195], [30.69, 35.285],
  [30.86, 35.335], [30.97, 35.425], [31.25, 35.440], [31.60, 35.470],
  [31.90, 35.530], [32.30, 35.550], [32.70, 35.570], [33.10, 35.610],
  [33.60, 35.700]
];
function riftLonJS(la) {
  const c = RIFT_CTRL;
  if (la <= c[0][0]) return c[0][1];
  if (la >= c[c.length - 1][0]) return c[c.length - 1][1];
  for (let i = 0; i < c.length - 1; i++)
    if (la >= c[i][0] && la <= c[i + 1][0]) {
      const t = (la - c[i][0]) / (c[i + 1][0] - c[i][0]);
      return c[i][1] + (c[i + 1][1] - c[i][1]) * t;
    }
  return c[c.length - 1][1];
}
/** 중앙 산지 분수령 — 비그늘의 경계 */
function watershedLonJS(la) {
  const c = coastLonJS(la), r = riftLonJS(la);
  return c + (r - c) * 0.62;
}

/** 점에서 선분까지 (km) */
function segKm(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t, qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

/** 요르단 강가 — 사막 한가운데의 초록 띠(조르) */
const JORDAN = [
  [33.20, 35.62], [33.07, 35.61], [32.92, 35.60], [32.70, 35.57],
  [32.50, 35.53], [32.30, 35.54], [32.10, 35.54], [31.90, 35.53], [31.78, 35.54]
];
function riparianJS(la, lo) {
  if (la < 31.70 || la > 33.25 || lo < 35.35 || lo > 35.80) return 0;
  const px = lo * KM_LON, py = la * KM_LAT;
  let best = Infinity;
  for (let i = 0; i < JORDAN.length - 1; i++) {
    const a = JORDAN[i], b = JORDAN[i + 1];
    const d = segKm(px, py, a[1] * KM_LON, a[0] * KM_LAT, b[1] * KM_LON, b[0] * KM_LAT);
    if (d < best) best = d;
  }
  return 1 - sstepJS(best / 0.55);
}

/** 큰 강가는 사막 한가운데라도 초록이다 */
function riverFactorJS(la, lo) {
  let best = 0;
  const px = lo * KM_LON, py = la * KM_LAT;
  for (const r of BIGRIVERS) {
    if (!r.pts || r.pts.length < 2) continue;
    let d = Infinity;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      if (Math.min(a[0], b[0]) - 1.2 > la || Math.max(a[0], b[0]) + 1.2 < la) continue;
      if (Math.min(a[1], b[1]) - 1.2 > lo || Math.max(a[1], b[1]) + 1.2 < lo) continue;
      const dd = segKm(px, py, a[1] * KM_LON, a[0] * KM_LAT, b[1] * KM_LON, b[0] * KM_LAT);
      if (dd < d) d = dd;
    }
    if (isFinite(d)) {
      const f = 1 - sstepJS(d / Math.max(r.widthKm || 6, 1));
      if (f > best) best = f;
    }
  }
  return best;
}

/** 나일 삼각주 — 카이로 꼭짓점에서 바다 쪽으로 벌어지는 초록 삼각형 */
function deltaFactorJS(la, lo) {
  if (la < 29.90 || la > 31.70 || lo < 29.80 || lo > 32.45) return 0;
  const t = (la - 30.05) / (31.55 - 30.05);
  if (t < -0.06) return 0;
  const tc = Math.max(t, 0);
  const half = 0.16 + 1.02 * tc;
  const axis = 31.24 - 0.26 * tc;
  const dx = Math.abs(lo - axis);
  const edge = 1 - sstepJS((dx - half * 0.70) / Math.max(half * 0.30, 0.05));
  const north = 1 - sstepJS((la - 31.44) / 0.20);
  return Math.min(1, Math.max(0, edge)) * Math.min(1, Math.max(0, north)) * 0.62;
}

function levantMoist(la, lo, e) {
  let m = 0.12 + 0.88 * sstepJS((la - 30.45) / (33.30 - 30.45));
  m += 0.22 * sstepJS((e - 150) / 750);
  const ws = watershedLonJS(la), rift = riftLonJS(la);
  // 비그늘의 세기는 **위도를 탄다.**
  //
  //   · 유다·사마리아(31~32.3°) — 마루가 높고 그 너머가 사해(-400 m)라
  //     비가 거의 넘어오지 못한다. 유다 광야가 여기서 생긴다.
  //   · 갈릴리·골란(32.6° 위) — 마루가 낮아지고 바다가 가까워 비그늘이
  //     훨씬 얕다. 상부 갈릴리는 오히려 이 땅에서 비가 가장 많은 곳이다.
  //
  // 한 값(0.95)을 위도와 무관하게 쓰던 것이 하솔·게네사렛·골란을 사막으로
  // 만들었다. 남쪽 값은 그대로 두고 북쪽만 얕게 한다.
  const shade = 0.95 - 0.60 * sstepJS((la - 32.30) / 0.90);
  const eastDry = 0.90 - 0.55 * sstepJS((la - 32.30) / 0.90);
  if (lo > ws && lo < rift) {
    m -= shade * sstepJS((lo - ws) / Math.max(rift - ws, 0.05));
  } else if (lo >= rift) {
    const east = sstepJS((lo - rift) / 0.45);
    const plateau = 0.20 + 0.60 * sstepJS((la - 30.9) / (32.6 - 30.9));
    const dry = m - eastDry;
    m = dry + (plateau - dry) * east;
  }
  if (e < 0) m -= 0.35 * sstepJS(-e / 350);
  if (lo < coastLonJS(la) + 0.03) m -= 0.15;
  m = Math.max(m, riparianJS(la, lo) * 0.52);
  return Math.min(1, Math.max(0, m));
}

function wideMoist(la, lo, e) {
  let m;
  if (lo <= 26.6 && la >= 34.2) {                    // 지중해 유럽
    m = 0.52 + 0.22 * sstepJS((la - 35.0) / 7.0);
    m -= 0.16 * (1 - sstepJS((la - 34.5) / 3.2));
  } else if (la >= 36.2) {                           // 소아시아
    const pontic = sstepJS((la - 40.2) / 1.1);
    const aegean = 1 - sstepJS((lo - 28.6) / 2.2);
    // 고원은 **타우로스 산맥 북쪽**부터다. 위도만 보고 잘랐더니 그 남쪽
    // 킬리키아 평야(타르수스)까지 고원으로 쳐서 사막이 되어 있었다.
    // 실제로는 이 해안이 소아시아에서 비가 가장 많은 축에 든다.
    const plateau = sstepJS((lo - 30.5) / 1.6) * (1 - sstepJS((lo - 38.5) / 2.0))
                  * (1 - sstepJS((la - 39.6) / 1.2))
                  * sstepJS((la - 37.15) / 0.7);
    m = 0.46 + 0.44 * pontic + 0.22 * aegean - 0.30 * plateau;
    m -= 0.34 * sstepJS((39.2 - la) / 1.6) * sstepJS((lo - 37.0) / 3.0);
    // 킬리키아 평야와 오론테스 하구 — 타우로스 남쪽 해안
    m += 0.30 * sstepJS((la - 35.8) / 0.5) * (1 - sstepJS((la - 37.3) / 0.5))
              * sstepJS((lo - 33.4) / 0.6) * (1 - sstepJS((lo - 36.9) / 0.6));
  } else if (lo <= 33.2 && la <= 31.6) {             // 이집트·리비아 사막
    m = 0.02 + 0.30 * sstepJS((la - 30.2) / 1.1);
  } else if (la <= 30.6 && lo > 33.2) {              // 시나이 남부·북서 아라비아
    m = 0.03 + 0.06 * sstepJS((e - 700) / 1200);
  } else if (lo >= 46.6) {                           // 자그로스·카스피 남안
    m = 0.12 + 0.44 * sstepJS((e - 700) / 1400) + 0.52 * sstepJS((la - 37.8) / 1.2);
    m -= 0.10 * sstepJS((31.8 - la) / 1.5);
  } else if (lo >= 38.5) {                           // 시리아 사막·메소포타미아
    m = 0.06 + 0.30 * sstepJS((la - 33.0) / 3.6);
  } else {                                           // 레반트 바깥 테두리
    m = 0.10 + 0.42 * sstepJS((la - 31.0) / 4.0) - 0.25 * sstepJS((lo - 36.4) / 1.8);
  }
  m += 0.20 * sstepJS((e - 300) / 1400);
  if (e < 0) m -= 0.20;
  m = Math.max(m, riverFactorJS(la, lo) * 0.85);
  m = Math.max(m, deltaFactorJS(la, lo));
  return Math.min(1, Math.max(0, m));
}

/** 1 = 가나안 정밀 구역 한복판, 0 = 바깥 */
function coreBlendJS(la, lo) {
  const m = 0.5;
  return Math.min(Math.min(sstepJS((lo - 33.90) / m), sstepJS((36.90 - lo) / m)),
                  Math.min(sstepJS((la - 30.20) / m), sstepJS((33.60 - la) / m)));
}

function moistAt(la, lo, e) {
  const t = coreBlendJS(la, lo);
  if (t > 0.999) return levantMoist(la, lo, e);
  const w = wideMoist(la, lo, e);
  if (t < 0.001) return w;
  return w + (levantMoist(la, lo, e) - w) * t;
}

// 지도 전체의 젖은 정도를 그림 한 장으로. 셰이더가 이것을 읽어 논밭을 그린다.
let moistTex = null;
const MOISTB = { lon0: 11.0, lat0: 21.0, lonSpan: 41.0006, latSpan: 22.0 };
function buildMoist(done) {
  if (moistTex) { if (done) done(); return; }
  const W = 700, H = 380;
  const data = new Uint8Array(W * H);
  // 이십육만 칸마다 땅 높이를 물어 보는 일이라, 한 판에 다 하면 그만큼 멎는다.
  // 마흔 줄씩 끊는다 — 나오는 그림은 한 칸도 다르지 않다.
  let jj0 = 0;
  const band = () => {
    const jj1 = Math.min(H, jj0 + 40);
    for (let jj = jj0; jj < jj1; jj++) {
      const la = MOISTB.lat0 + (jj + 0.5) / H * MOISTB.latSpan;
      for (let ii = 0; ii < W; ii++) {
        const lo = MOISTB.lon0 + (ii + 0.5) / W * MOISTB.lonSpan;
        const e = groundY(la, lo) / (0.001 * VEXAG);
        data[jj * W + ii] = Math.round(255 * moistAt(la, lo, e));
      }
    }
    jj0 = jj1;
    if (jj0 < H) { requestAnimationFrame(band); return; }
    finish();
  };
  requestAnimationFrame(band);
  function finish() {
  moistTex = new THREE.DataTexture(data, W, H, THREE.LuminanceFormat);
  moistTex.minFilter = THREE.LinearFilter;
  moistTex.magFilter = THREE.LinearFilter;
  moistTex.wrapS = THREE.ClampToEdgeWrapping;
  moistTex.wrapT = THREE.ClampToEdgeWrapping;
  moistTex.needsUpdate = true;
  for (const m of terrainMats)
    if (m.uniforms && m.uniforms.moistT) { m.uniforms.moistT.value = moistTex; m.uniforms.farmOn.value = 1; }
  if (done) done();
  }
}

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
const drapeMats = [];      // 길·강이 쓰는 재질 — 지형 그림이 바뀌면 함께 간다

function tileBounds(t) {
  const x0 = worldX(t.lonMin), z0 = worldZ(t.latMax);
  return new THREE.Vector4(x0, z0, worldX(t.lonMax) - x0, worldZ(t.latMin) - z0);
}

// 땅에 붙는 것을 눈 쪽으로 얼마나 밀어 줄 것인가 (거리의 몇 곱).
//
// 예전에는 길과 강의 깊이 견주기를 아예 꺼 두었다. 그러면 하늘에서 볼 때는
// 능선에 안 먹히니 좋았지만, 낮게 내려서면 **산 너머의 강이 앞산을 뚫고**
// 비쳐 보였다 — 「지형이 투명하다」는 말이 여기서 나왔다.
// 그래서 견주기는 켜 두되, 눈 쪽으로 거리의 2 % 만큼 밀어 놓는다.
//   · 제 발밑의 땅과는 2 % 차이로 이기니 능선에 먹히지 않는다.
//   · 앞을 가로막은 산은 그보다 훨씬 가까우니 여전히 가려 준다.
// 화면 위 자리는 조금도 움직이지 않는다 — 시선을 따라 밀 뿐이다.
const DEPTH_PUSH = 0.02;
// 지금 걷고 있는 길은 조금 더 세게 — 이것만은 늘 보여야 한다.
const ROUTE_PUSH = 0.035;

function drapeMaterial(color, opacity, lift, through, fade, push, grain, len) {
  const mt = new THREE.ShaderMaterial({
    transparent: true, depthTest: through !== true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true,
    // 지형은 판과 판의 이음매를 이기려고 -20 까지 당겨 놓았다. 여기가 -8
    // 이면 비탈에서 늘 진다 — 다가갈수록 강과 길이 땅에 먹히던 까닭이다.
    polygonOffsetFactor: -34, polygonOffsetUnits: -16,
    uniforms: {
      hA: { value: hTexA }, bA: { value: hBoundA || new THREE.Vector4(0,0,1,1) },
      hB: { value: hTexB || hTexA }, bB: { value: hBoundB || hBoundA || new THREE.Vector4(0,0,1,1) },
      hasB: { value: hTexB ? 1 : 0 },
      vex: { value: VEXAG }, lift: { value: lift },
      push: { value: push == null ? DEPTH_PUSH : push },
      grain: { value: grain ? 1 : 0 },
      len: { value: len || 1 },
      rGeo: { value: new THREE.Vector4(ORIGIN.lon, ORIGIN.lat, KM_LON, KM_LAT) },
      rB: { value: roadBnd || new THREE.Vector4(0, 0, 1, 1) },
      rOn: { value: (grain && roadTex && roadShow) ? 1 : 0 },
      fadeOn: { value: fade ? 1 : 0 },
      tint: { value: new THREE.Color(color) }, alpha: { value: opacity }
    },
    vertexShader: [
      'uniform sampler2D hA; uniform vec4 bA;',
      'uniform sampler2D hB; uniform vec4 bB;',
      'uniform float hasB, vex, lift, push;',
      'attribute float edge;',
      'attribute float floorM;',
      'attribute float fadeT;',
      'varying float vEdge;',
      'varying float vFade;',
      'varying vec3 vW;',
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
      '  p.y = max(h, floorM) * 0.001 * vex + lift;',
      '  vEdge = edge; vFade = fadeT; vW = p;',
      '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
      '  mv.xyz *= (1.0 - push);',       // 눈 쪽으로 살짝 — 화면 자리는 그대로
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 tint; uniform float alpha; uniform float fadeOn;',
      'uniform float grain; uniform float len;',
      'uniform vec4 rGeo; uniform vec4 rB; uniform float rOn;',
      'varying float vEdge;',
      'varying float vFade;',
      'varying vec3 vW;',
      'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.545); }',
      'float vn(vec2 p){',
      '  vec2 i = floor(p), f = fract(p);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),',
      '             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);',
      '}',
      'void main(){',
      '  float e = abs(vEdge);',
      '  float a = alpha;',
      '  vec3 c = tint;',
      '  if (grain > 0.5) {',
      '    // 흙길 — 자로 자른 띠가 아니라 발과 수레가 다져 놓은 자국이다.',
      '    float s = vFade * len;                    // 첫머리에서 몇 km 왔는가',
      '    float side = step(0.0, vEdge);            // 왼쪽 길섶과 오른쪽 길섶은 따로 논다',
      '    // ① 길섶이 들쭉날쭉하게 — 폭이 조금씩 늘고 준다',
      '    float w = 0.76 + 0.36 * vn(vec2(mod(s * 4.5, 512.0), mix(1.7, 7.3, side)));',
      '    e = e / w;',
      '    // ② 다져진 정도도 고르지 않다 — 진했다 옅었다 한다',
      '    a *= 0.70 + 0.46 * vn(vec2(mod(s * 1.6, 512.0), 0.5));',
      '    // ③ 바퀴와 발이 낸 두 줄기 고랑, 그 사이 가운데는 조금 어둡다',
      '    float rut = 1.0 - smoothstep(0.06, 0.34, abs(e - 0.46));',
      '    c = mix(c, c * 1.10, rut * 0.5);',
      '    c = mix(c, c * 0.86, (1.0 - smoothstep(0.0, 0.18, e)) * 0.7);',
      '  }',
      '  // 땅에 길을 새겨 둔 자리에서는, 다가갈수록 **길 띠만** 스러진다 —',
      '  // 둘이 겹치면 길이 두 겹으로 보이기 때문이다. 강과 경로는 땅에',
      '  // 새긴 것이 없으니 여기에 걸리면 안 된다. grain 이 그 표다.',
      '  // (이 조건을 빠뜨려 다가가면 요단강이 통째로 사라졌다)',
      '  if (grain > 0.5 && rOn > 0.5) {',
      '    float lo = rGeo.x + vW.x / rGeo.z;',
      '    float la = rGeo.y - vW.z / rGeo.w;',
      '    if (lo > rB.x && lo < rB.x + rB.z && la > rB.y && la < rB.y + rB.w)',
      '      a *= smoothstep(70.0, 150.0, length(vW - cameraPosition));',
      '  }',
      '  // 속은 꽉 차고 테두리만 또렷하게. 예전에는 가장자리로 갈수록',
      '  // 옅게 흩어져 길이 번진 자국처럼 보였다.',
      '  a *= (1.0 - smoothstep(0.76, 1.0, e));',
      '  // 첫머리와 끝머리는 스러지게 — 길이 허공에서 뚝 끊기지 않도록',
      '  if (fadeOn > 0.5) a *= smoothstep(0.0, 0.045, vFade) * (1.0 - smoothstep(0.955, 1.0, vFade));',
      '  c = mix(c, c * 0.5, smoothstep(0.42, 0.88, e));',
      '  if (a < 0.01) discard;',
      '  gl_FragColor = vec4(c, a);',
      '}'
    ].join('\n')
  });
  mt.userData.through = through === true;
  return mt;
}

// 하늘에서 내려다볼 때는 길과 색을 땅 위에 **덮어** 그리는 편이 낫다.
// 그런데 시점으로 땅에 내려서면 이야기가 달라진다 — 산 너머의 길이
// 산을 뚫고 비쳐 보이면 어디가 가려진 곳인지 알 수가 없다.
const dd = { fpv: null, n: -1 };
function syncDrapeDepth() {
  if (dd.fpv === fpv && dd.n === drapeMats.length) return;
  dd.fpv = fpv; dd.n = drapeMats.length;
  for (const m of drapeMats) {
    const want = fpv ? true : !m.userData.through;
    if (m.depthTest !== want) { m.depthTest = want; m.needsUpdate = true; }
  }
}

/** 땅에 붙는 실 하나. 가운데가 진하고 가장자리는 스러진다. */
function drapeLine(pts, widthKm, color, lift, opt) {
  opt = opt || {};
  const pos = [], edge = [], flr = [], fdt = [], idx = [];
  const n = pts.length;
  // 첫머리·끝머리를 스러지게 하려면 「어디쯤 왔는가」를 알아야 한다
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + kmLL(pts[i - 1], pts[i]));
  const total = arc[n - 1] || 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, n - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = worldX(q.lon) - worldX(o.lon), dz = worldZ(q.lat) - worldZ(o.lat);
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * widthKm / 2, nz = dx / len * widthKm / 2;
    const x = worldX(p.lon), z = worldZ(p.lat);
    const fl = floorMeters(p.lat, p.lon), ft = arc[i] / total;
    pos.push(x + nx, 0, z + nz);  edge.push(-1); flr.push(fl); fdt.push(ft);
    pos.push(x, 0, z);            edge.push(0); flr.push(fl); fdt.push(ft);
    pos.push(x - nx, 0, z - nz);  edge.push(1); flr.push(fl); fdt.push(ft);
    if (i < n - 1) {
      const a = i * 3, b = a + 3;
      idx.push(a, a+1, b,  a+1, b+1, b,  a+1, a+2, b+1,  a+2, b+2, b+1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute('floorM', new THREE.Float32BufferAttribute(flr, 1));
  g.setAttribute('fadeT', new THREE.Float32BufferAttribute(fdt, 1));
  g.setIndex(idx);
  const mat = drapeMaterial(color, opt.opacity != null ? opt.opacity : 0.8, lift,
                            opt.through, opt.fade, opt.push, opt.grain, total);
  drapeMats.push(mat);
  const m = new THREE.Mesh(g, mat);
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


// ── 경로 리본 — 앱과 같은 갈매기표 ─────────────────────────
//
// 삼각형을 하나씩 박아 넣던 것은 조잡했다. 앱은 **갈매기표가 새겨진 띠**를
// 길 위에 흘려보낸다. 여기서도 그렇게 한다 — 128×32 짜리 무늬 한 장을
// 길이만큼 되풀이해 붙이면, 굽은 데서도 화살표가 저절로 길을 따라 휜다.
let chevTex = null;
function chevronTexture() {
  if (chevTex) return chevTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(252,189,77,0.92)';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = 'rgba(71,43,13,0.55)';
  for (let k = 0; k < 2; k++) {
    const x0 = k * 64 + 12;
    g.beginPath();
    g.moveTo(x0, 5); g.lineTo(x0 + 20, 16); g.lineTo(x0, 27);
    g.lineTo(x0 + 8, 27); g.lineTo(x0 + 28, 16); g.lineTo(x0 + 8, 5);
    g.closePath(); g.fill();
  }
  chevTex = new THREE.CanvasTexture(c);
  chevTex.wrapS = THREE.RepeatWrapping;
  chevTex.wrapT = THREE.ClampToEdgeWrapping;
  chevTex.minFilter = THREE.LinearFilter;
  return chevTex;
}

function chevronMaterial(lift, period) {
  // 예전에는 여기서 깊이 견주기를 껐는데, syncDrapeDepth 가 through 표시가
  // 없는 재질을 모두 「견주는 것」으로 되돌려 놓았다. 그래서 어두운 테두리만
  // 산을 덮고 그 위의 갈매기표는 산에 잘려 나가, 길이 갈가리 찢겨 보였다.
  // 이제 테두리와 갈매기표가 **같은 규칙**을 쓴다.
  const mt = new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -34, polygonOffsetUnits: -16,
    uniforms: {
      hA: { value: hTexA }, bA: { value: hBoundA || new THREE.Vector4(0,0,1,1) },
      hB: { value: hTexB || hTexA }, bB: { value: hBoundB || hBoundA || new THREE.Vector4(0,0,1,1) },
      hasB: { value: hTexB ? 1 : 0 },
      vex: { value: VEXAG }, lift: { value: lift },
      push: { value: ROUTE_PUSH },
      map: { value: chevronTexture() }, period: { value: period }
    },
    vertexShader: [
      'uniform sampler2D hA; uniform vec4 bA;',
      'uniform sampler2D hB; uniform vec4 bB;',
      'uniform float hasB, vex, lift, period, push;',
      'attribute vec2 uv2;',
      'attribute float floorM;',
      'varying vec2 vT;',
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
      '  p.y = max(h, floorM) * 0.001 * vex + lift;',
      '  vT = vec2(uv2.x / period, uv2.y);',
      '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
      '  mv.xyz *= (1.0 - push);',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D map;',
      'varying vec2 vT;',
      'void main(){',
      '  vec4 t = texture2D(map, vT);',
      '  if (t.a < 0.02) discard;',
      '  gl_FragColor = t;',
      '}'
    ].join('\n')
  });
  mt.userData.through = false;
  return mt;
}

/** 갈매기표 띠 하나 */
function chevronRibbon(pts, widthKm, lift) {
  const pos = [], uv2 = [], flr = [], idx = [];
  let arc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) arc += kmLL(pts[i - 1], pts[i]);
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = worldX(q.lon) - worldX(o.lon), dz = worldZ(q.lat) - worldZ(o.lat);
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * widthKm / 2, nz = dx / len * widthKm / 2;
    const x = worldX(p.lon), z = worldZ(p.lat);
    const fl = floorMeters(p.lat, p.lon);
    pos.push(x + nx, 0, z + nz); uv2.push(arc, 0); flr.push(fl);
    pos.push(x - nx, 0, z - nz); uv2.push(arc, 1); flr.push(fl);
    if (i < pts.length - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv2', new THREE.Float32BufferAttribute(uv2, 2));
  g.setAttribute('floorM', new THREE.Float32BufferAttribute(flr, 1));
  g.setIndex(idx);
  // 앱과 같은 되풀이 간격 — 너비의 2.4 배마다 갈매기표 두 개
  const cmat = chevronMaterial(lift, Math.max(widthKm * 2.4, 1e-4));
  drapeMats.push(cmat);
  const m = new THREE.Mesh(g, cmat);
  m.renderOrder = 7;
  m.frustumCulled = false;
  return m;
}

// ── 들르는 곳 표시 ────────────────────────────────────────
//
// 길만 그어 놓으면 어디가 출발이고 어디가 도착인지 알 수가 없다.
// 앱처럼 **눈에 바로 보이게** — 땅에는 기둥을, 화면에는 이름표를 세운다.
const markPool = [];
let markPins = null, stopKm = [];
const SLOT_COLOR = { start: 0x6fd08a, via: 0xf2b64c, end: 0xff8a6a };

// 땅에 꽂던 고깔은 걷어냈다 — 앱도 그런 것을 세우지 않는다.
// 들르는 곳은 **이름표**가 말해 주고, 고깔은 따라갈 때 지금 있는 자리에만 쓴다.
function buildPins() {
  if (markPins) { scene.remove(markPins); disposeObj(markPins); markPins = null; }
  // 들를 곳마다 시작에서 여기까지 몇 km 인지 재 둔다 (이름표에 적는다)
  stopKm = [];
  if (!routePts || !routeStops.length) return;
  let acc = 0, k = 0;
  stopKm[0] = 0;
  for (let i = 1; i < routePts.length && k < routeStops.length; i++) {
    acc += kmLL(routePts[i - 1], routePts[i]);
    const s = routeStops[k + 1];
    if (!s) break;
    if (Math.abs(routePts[i].lat - s.lat) < 0.02 && Math.abs(routePts[i].lon - s.lon) < 0.02) {
      k++; stopKm[k] = acc;
    }
  }
  for (let i = 0; i < routeStops.length; i++) if (stopKm[i] == null) stopKm[i] = null;
}


// ── 지파와 민족의 땅 ───────────────────────────────────────
//
// 앱은 지파·민족을 **색으로 칠한 땅**으로 보여 준다. 이름만 띄우면 어디부터
// 어디까지인지 알 수가 없다. 경계 다각형과 색을 그대로 가져와 땅에 입힌다.
let AREAS = { tribes: [], nations: [] };
const areaMesh = { tribe: null, nation: null, first: null, divided: null };

function drapeArea(ring, color, opacity) {
  const tri = earClip(ring);
  const pos = [], edge = [], flr = [], idx = [];
  const fdt = [];
  for (const p of ring) { pos.push(worldX(p[1]), 0, worldZ(p[0])); edge.push(0); flr.push(-30000); fdt.push(0.5); }
  for (const t of tri) idx.push(t[0], t[1], t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute('floorM', new THREE.Float32BufferAttribute(flr, 1));
  g.setAttribute('fadeT', new THREE.Float32BufferAttribute(fdt, 1));
  g.setIndex(idx);
  // 땅빛을 **덮는** 색이다. 깊이를 견주면 산등성이가 색을 뚫고 올라와
  // 지파·민족 땅이 산 밑으로 깔린 것처럼 보인다. 견주지 않고 덮는다.
  const mat = drapeMaterial(color, opacity, 0.006, true, false, 0.05);
  drapeMats.push(mat);
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 2;
  m.frustumCulled = false;
  return m;
}

// 어느 지파·민족을 띄울지. 비어 있으면 그 갈래를 통째로 본다는 뜻이다.
const AREAKIND = { tribe: 'tribes', nation: 'nations', first: 'first', divided: 'divided' };
const AREARANK = { tribe: 5, nation: 6, first: 11, divided: 12 };
const areaSel = { tribe: new Set(), nation: new Set(), first: new Set(), divided: new Set() };
try {
  const sv = JSON.parse(localStorage.getItem('theland.areasel') || 'null');
  if (sv) for (const k in areaSel) (sv[k] || []).forEach(n => areaSel[k].add(n));
} catch (e) {}
function saveAreaSel() {
  try {
    const o = {}; for (const k in areaSel) o[k] = [...areaSel[k]];
    localStorage.setItem('theland.areasel', JSON.stringify(o));
  } catch (e) {}
}
function areaShown(kind, ko) {
  return areaSel[kind].size === 0 || areaSel[kind].has(ko);
}

function buildAreas(kind) {
  const list = AREAS[AREAKIND[kind]] || [];
  const g = new THREE.Group();
  for (const a of list) {
    if (!a.poly || a.poly.length < 3) continue;
    if (!areaShown(kind, a.ko)) continue;
    const c = new THREE.Color(a.color[0], a.color[1], a.color[2]);
    // 앱과 같이 **색으로만** 나눈다. 테두리를 두르니 지도가 아니라
    // 색칠 공부처럼 보였다. 진하기도 앱과 같게 (0.60).
    g.add(drapeArea(a.poly, c.getHex(), 0.60));
  }
  return g;
}

function syncAreas(force) {
  for (const kind in AREAKIND) {
    const layer = LAYERS.find(l => l.k === kind);
    const want = !!(layer && layer.on);
    if (force && areaMesh[kind]) {
      scene.remove(areaMesh[kind]); disposeObj(areaMesh[kind]); areaMesh[kind] = null;
    }
    if (want && !areaMesh[kind]) {
      areaMesh[kind] = buildAreas(kind);
      scene.add(areaMesh[kind]);
    } else if (!want && areaMesh[kind]) {
      scene.remove(areaMesh[kind]);
      disposeObj(areaMesh[kind]);
      areaMesh[kind] = null;
    }
  }
}

// ── 따라가는 자리 표식과 걸음 빠르기 ────────────────────────
let runnerEl = null;

// 빠르기는 **가로 게이지**로 잡는다.
//
// 예전에는 ×0.5 ~ ×4 네 칸뿐이었다. 긴 길에서는 네 칸을 다 올려도 굼떴고,
// 시점으로 걸을 때는 땅 하나를 건너는 데 하루가 걸렸다. 손잡이 하나로
// 잇달아 고르게 한다 — 맨 왼쪽 ×0.75, 맨 오른쪽 ×200.
// 눈금은 **곱셈으로** 늘어나므로 왼쪽은 촘촘하고 오른쪽은 성큼성큼 뛴다.
// 처음 자리는 게이지의 5 % — 예전의 ×1 과 같은 빠르기다.
const SPD_MIN = 0.75, SPD_MAX = 200;
const FOLLOW_BASE = 3.0;           // ×1 일 때 길 위를 초속 3 km 로 간다
let spdP = 0.05;
try {
  const v = parseFloat(localStorage.getItem('theland.spd'));
  if (v >= 0 && v <= 1) spdP = v;
} catch (e) {}
function spdMul() { return SPD_MIN * Math.pow(SPD_MAX / SPD_MIN, spdP); }
function spdLabel() {
  const m = spdMul();
  return '\u00d7' + (m < 10 ? m.toFixed(1) : Math.round(m));
}

function syncRunner() {
  if (!runnerEl) {
    runnerEl = document.createElement('div');
    runnerEl.id = 'runner';
    labelRoot.appendChild(runnerEl);
    const st = document.createElement('style');
    st.textContent =
      '#runner{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;' +
      'border-radius:13px;display:none;pointer-events:none;' +
      'background:radial-gradient(circle,#fff8e2 0 34%,rgba(255,210,122,.65) 36% 62%,' +
      'rgba(255,210,122,0) 64%);box-shadow:0 0 14px rgba(255,200,90,.8)}' +
      '#runner.on{display:block;animation:rpulse 1.4s ease-in-out infinite}' +
      '@keyframes rpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.28)}}' +
      '#spdBtn{display:none;align-items:center;gap:11px;padding:7px 15px;' +
      'border:1px solid rgba(255,255,255,.18);border-radius:21px;' +
      'background:rgba(20,20,24,.9)}' +
      '#spdBtn.on{display:flex}' +
      '#spdBtn>i{font-style:normal;font-size:12px;color:#b9b1a3;font-weight:600}' +
      '#spdBtn>u{text-decoration:none;font:700 12.5px/1 ui-monospace,monospace;' +
      'color:#f2b64c;min-width:48px;text-align:right}' +
      '#spdBtn input{-webkit-appearance:none;appearance:none;width:190px;height:4px;' +
      'margin:0;border-radius:2px;outline:none;cursor:pointer;' +
      'background:linear-gradient(90deg,#f2b64c,rgba(255,255,255,.24))}' +
      '#spdBtn input::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;' +
      'border-radius:10px;background:#f2b64c;box-shadow:0 1px 5px rgba(0,0,0,.5)}' +
      '#spdBtn input::-moz-range-thumb{width:20px;height:20px;border:0;border-radius:10px;' +
      'background:#f2b64c;box-shadow:0 1px 5px rgba(0,0,0,.5)}' +
      '@media (max-width:560px){#spdBtn{padding:6px 12px;gap:9px}' +
      '#spdBtn input{width:132px}}';
    document.head.appendChild(st);
  }
  if (!following || !routePts) { runnerEl.className = ''; return; }
  const p = followAt(followKm);
  const v = new THREE.Vector3(worldX(p.lon), surfaceY(p.lat, p.lon) + 0.15, worldZ(p.lat));
  v.project(camera);
  if (v.z > 1) { runnerEl.className = ''; return; }
  runnerEl.className = 'on';
  runnerEl.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
  runnerEl.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
}

// 빠르기는 **바로 고르는** 것이다. 예전에는 한 번 누를 때마다 다음 칸으로
// 넘어가서, 가운데에서 처음으로 돌아가려면 끝까지 한 바퀴를 돌아야 했다.
let spdBtn = null, spdRange = null, spdOut = null;
function syncSpeedBtn() {
  if (!spdBtn) {
    spdBtn = document.createElement('div');
    spdBtn.id = 'spdBtn';
    spdBtn.innerHTML = '<i></i><input type="range" min="0" max="1000" step="1"><u></u>';
    spdRange = spdBtn.querySelector('input');
    spdOut = spdBtn.querySelector('u');
    spdRange.value = Math.round(spdP * 1000);
    // 끄는 동안에도 곧바로 반영된다 — 손을 떼야 바뀌면 얼마나 빠른지 알 수 없다
    const slide = () => {
      spdP = Math.max(0, Math.min(1, +spdRange.value / 1000));
      try { localStorage.setItem('theland.spd', String(spdP)); } catch (e) {}
      spdOut.textContent = spdLabel();
    };
    spdRange.addEventListener('input', slide);
    spdRange.addEventListener('change', slide);
    dockEl().appendChild(spdBtn);
  }
  // 길을 따라갈 때뿐 아니라 **시점으로 걸을 때도** 쓴다
  const on = (routePts && routePts.length > 1) || fpv;
  spdBtn.className = on ? 'on' : '';
  spdBtn.title = L.s('걸음 빠르기', 'Travel speed');
  spdBtn.querySelector('i').textContent = L.s('빠르기', 'Speed');
  if (document.activeElement !== spdRange) spdRange.value = Math.round(spdP * 1000);
  spdOut.textContent = spdLabel();
}

// 길 전체를 한 번에 물린다. 판을 열지 않고도 지울 수 있어야 한다.
let clrBtn = null;
function syncClrBtn() {
  if (!clrBtn) {
    clrBtn = document.createElement('button');
    clrBtn.id = 'clrBtn';
    onTap(clrBtn, () => {
      plan.start = null; plan.end = null; plan.via = [];
      clearRoute();
      updateStopMarks(); updateLabels();
      if (cardSite) showCard(cardSite);
      if (panelIsRoutes && panel.classList.contains('open')) openRoutes();
      toast(L.s('경로를 지웠습니다', 'Route cleared'));
    });
    actsEl().appendChild(clrBtn);
    const st = document.createElement('style');
    st.textContent =
      '#clrBtn{display:none;border:1px solid rgba(255,255,255,.18);cursor:pointer;' +
      'padding:0 15px;height:42px;border-radius:21px;background:rgba(20,20,24,.9);' +
      'color:#f4c7bd;font:700 13px/1 inherit}' +
      '#clrBtn.on{display:block}' +
      '@media (max-width:560px){#clrBtn{padding:0 12px;font-size:12.5px}}';
    document.head.appendChild(st);
  }
  const sig = ((routeStops && routeStops.length) ? 1 : 0) + '|' + L.cur;
  if (sig === clrBtn._sig) return;
  clrBtn._sig = sig;
  clrBtn.className = (routeStops && routeStops.length) ? 'on' : '';
  clrBtn.textContent = L.s('\u2715 경로 지우기', '\u2715 Clear route');
}

// 표시해 둔 곳도 한 번에 물릴 수 있어야 한다. 성구 한 줄에서 열댓 곳을
// 표시해 놓고 하나씩 다시 눌러 끄는 것은 일이 아니라 벌이다.
let mkClrBtn = null;
function syncMarkClr() {
  if (!mkClrBtn) {
    mkClrBtn = document.createElement('button');
    mkClrBtn.id = 'mkClrBtn';
    onTap(mkClrBtn, () => {
      const n = MARKED.size;
      if (!n) return;
      MARKED.clear(); saveMarked();
      updateLabels(); syncMarkClr();
      if (cardSite) showCard(cardSite);
      toast(L.s('표시를 지웠습니다 (' + n + '곳)', 'Cleared ' + n + ' marks'));
    });
    actsEl().appendChild(mkClrBtn);
    const st = document.createElement('style');
    st.textContent =
      '#mkClrBtn{display:none;border:1px solid rgba(255,255,255,.18);cursor:pointer;' +
      'padding:0 15px;height:42px;border-radius:21px;background:rgba(20,20,24,.9);' +
      'color:#fbe0a6;font:700 13px/1 inherit}' +
      '#mkClrBtn.on{display:block}' +
      '@media (max-width:560px){#mkClrBtn{padding:0 12px;font-size:12.5px}}';
    document.head.appendChild(st);
  }
  const n = MARKED.size;
  const sig = n + '|' + L.cur;
  if (sig === mkClrBtn._sig) return;
  mkClrBtn._sig = sig;
  mkClrBtn.className = n ? 'on' : '';
  mkClrBtn.textContent = L.s('\u2715 표시 지우기 (' + n + ')', '\u2715 Clear marks (' + n + ')');
}

// 길이 서면 지도 위에 바로 뜨는 단추. 판을 열고 또 누를 까닭이 없다.
let goBtn = null;
function syncGoBtn() {
  if (!goBtn) {
    goBtn = document.createElement('button');
    goBtn.id = 'goBtn';
    onTap(goBtn, () => {
      toggleFollow(); syncGoBtn();
      toast(following ? L.s('길을 따라갑니다', 'Travelling the route')
                      : L.s('멈췄습니다', 'Stopped'));
      if (panelIsRoutes && panel.classList.contains('open')) openRoutes(); });
    actsEl().appendChild(goBtn);
    const st = document.createElement('style');
    st.textContent =
      '#goBtn{display:none;align-items:center;gap:7px;border:0;cursor:pointer;' +
      'padding:0 20px;height:42px;border-radius:21px;background:#f2b64c;color:#231702;' +
      'font:700 14px/1 inherit;box-shadow:0 4px 18px rgba(0,0,0,.45)}' +
      '#goBtn.on{display:flex}' +
      '#goBtn.going{background:rgba(20,20,24,.9);color:#f2b64c;' +
      'border:1px solid rgba(242,182,76,.6)}';
    document.head.appendChild(st);
  }
  const has = !!(routePts && routePts.length > 1);
  const sig = (has ? 1 : 0) + '|' + (following ? 1 : 0) + '|' + L.cur;
  if (sig === goBtn._sig) return;
  goBtn._sig = sig;
  goBtn.className = (has ? 'on' : '') + (following ? ' going' : '');
  goBtn.textContent = following ? L.s('■  멈추기', '■  Stop') : L.s('▶  따라가기', '▶  Travel it');
}

function updateStopMarks() {
  syncGoBtn();
  syncSpeedBtn();
  syncClrBtn();
  syncMarkClr();
  syncRunner();
  const need = routeStops.length;
  while (markPool.length < need) {
    const el = document.createElement('div');
    el.className = 'rmark';
    el.addEventListener('pointerdown', ev => {
      labDown = { x: ev.clientX, y: ev.clientY };
    });
    onTap(el, ev => {
      if (labSlid(ev)) return;
      const s = el._site; if (s) { flyTo(s, 0, true); showCard(s); }
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
    const km = stopKm[i];
    const sub = slot === 'start' ? L.s('출발', 'Start')
              : slot === 'end'   ? L.s('도착', 'End') : L.s('경유', 'Via');
    el.className = 'rmark ' + slot;
    el.innerHTML = '<b>' + (i + 1) + '</b><span><em>' + escapeHTML(L.place(s.ko)) + '</em>' +
      escapeHTML(sub + (km ? ' · ' + (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km' : '')) +
      '</span>';
    el.style.display = '';
    el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
    el.style.top  = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  }
}

// ── 화면 아래 단추 자리 ─────────────────────────────────────
//
// 빠르기 · 따라가기 · 경로 지우기 · 곳 카드를 저마다 「바닥에서 몇 픽셀」로
// 띄워 두었더니, 폰에서는 서로 겹치고 「도착」이 아래로 흘러내렸다.
// 이제 한 통에 담아 **세로로 쌓는다** — 무엇이 몇 개든 겹치지 않는다.
let dockDiv = null, actsDiv = null;
function dockEl() {
  if (!dockDiv) {
    dockDiv = document.createElement('div');
    dockDiv.id = 'dock';
    document.body.appendChild(dockDiv);
    const st = document.createElement('style');
    st.textContent =
      '#dock{position:fixed;left:0;right:0;bottom:14px;z-index:26;display:flex;' +
      'flex-direction:column;align-items:center;gap:8px;padding:0 10px;' +
      'pointer-events:none}' +
      '#dock>*{pointer-events:auto}' +
      '#spdBtn{order:1}#acts{order:2}#card{order:3}' +
      '#acts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}' +
      '@media (max-width:560px){#dock{bottom:10px;gap:6px}}';
    document.head.appendChild(st);
  }
  return dockDiv;
}
function actsEl() {
  if (!actsDiv) { actsDiv = document.createElement('div'); actsDiv.id = 'acts'; dockEl().appendChild(actsDiv); }
  return actsDiv;
}

const markCSS = document.createElement('style');
markCSS.textContent =
  // 앱의 지점 표지 그대로 — 어두운 알약에 갈래빛 테두리, 번호 뱃지,
  // 세리프 이름, 그 아래 갈래와 누적 거리.
  '.rmark{position:absolute;transform:translate(-50%,-118%);white-space:nowrap;' +
  'pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:9px;' +
  'padding:6px 12px 6px 6px;border-radius:15px;background:rgba(13,13,18,.84);' +
  'box-shadow:0 3px 14px rgba(0,0,0,.6);z-index:2;backdrop-filter:blur(6px)}' +
  '.rmark b{display:flex;align-items:center;justify-content:center;width:22px;height:22px;' +
  'border-radius:11px;font:700 12px/1 system-ui;color:#111}' +
  '.rmark span{display:flex;flex-direction:column;gap:1px;font:500 10.5px/1.25 system-ui}' +
  '.rmark em{font:600 13px/1.2 Georgia,"Apple SD Gothic Neo",serif;font-style:normal;' +
  'color:#fff;letter-spacing:.02em}' +
  '.rmark.start{border:1.5px solid rgba(133,224,140,.85)} .rmark.start b{background:#85e08c}' +
  '.rmark.start span{color:#85e08c}' +
  '.rmark.via{border:1.5px solid rgba(255,212,102,.85)} .rmark.via b{background:#ffd466}' +
  '.rmark.via span{color:#ffd466}' +
  '.rmark.end{border:1.5px solid rgba(255,143,112,.85)} .rmark.end b{background:#ff8f70}' +
  '.rmark.end span{color:#ff8f70}';
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
  stopFly();
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  // 눈이 느끼는 빠르기는 「한 초에 화면 몇 개를 지나는가」다.
  //
  // 예전에는 길이만 보고 「마흔 초에 다 걷도록」 잡았다. 그래서 이천 킬로미터
  // 짜리 길에서는 한 초에 오십 킬로미터씩 흘러, 스물여섯 킬로미터가 담기는
  // 화면이 초당 두 장씩 지나갔다 — ×0.5 로 줄여도 화면 한 장이다.
  // 이제 **보는 거리**로 상한을 둔다. 한 초에 화면 삼분의 일쯤 —
  // 그 안에서 긴 길은 빠르게, 짧은 길은 느긋하게 간다.
  // 길이도 보는 거리도 셈에 넣지 않는다.
  //
  // 예전에는 「길이가 얼마든 한 분 반쯤에 다 걷도록」 잡혀 있었다. 그래서
  // 바울의 전 여정처럼 만 킬로미터에 가까운 길에서는 게이지를 맨 왼쪽까지
  // 내려도 한 초에 백 킬로미터씩 흘렀다 — 게이지가 아무 뜻이 없었다.
  // 이제 밑바탕은 초속 3 km 하나로 두고, **게이지가 곱하는 몫이 곧
  // 빠르기다.** 긴 길은 게이지를 올려서 넘긴다.
  followKm += dt * FOLLOW_BASE * spdMul();
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
  // 앱과 같은 모양 — 어두운 테두리 위에 갈매기표 띠
  // 멀리 물러설수록 굵게 잡되 한도를 둔다. 예전에는 한도가 없어서, 멀리서
  // 그려 둔 띠를 그대로 안고 내려오면 골짜기를 통째로 덮는 담요가 되었다.
  const w = Math.max(0.35, Math.min(5.5, cam.dist * 0.0055));
  routeMesh = new THREE.Group();
  routeMesh.add(drapeLine(routePts, w * 1.5, 0x2a1b08, 0.018,
                          { opacity: 0.72, order: 6, push: ROUTE_PUSH }));
  routeMesh.add(chevronRibbon(routePts, w, 0.022));
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
  stopFly();
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

// ── 길을 땅에 새긴다 ───────────────────────────────────────
//
// 옛길은 포장 도로가 아니라 발과 수레가 다져 놓은 흙바닥이다. 리본으로
// 얹으면 다가갈수록 「땅 위에 붙인 띠」로 보인다. 그래서 가까이서는
// 지형 셰이더가 **땅빛 자체를 물들이게** 한다.
//
// 길 자국은 이미 받아 둔 자료에서 그때그때 구워 낸다 — 내려받을 파일은
// 하나도 늘지 않는다. 굵게 → 가늘게 네 번 덧그어 가장자리에 옅은 마루를
// 남겨 두면, 셰이더가 그 마루를 잘라 「가까이선 좁게, 멀리선 넓게」를 한다.
let roadTex = null, roadBnd = null, roadShow = false;
const BLANK1 = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.LuminanceFormat);

function bakeRoadMask(tile) {
  if (roadTex || !tile || !ROADS.length) return;
  const kmW = (tile.lonMax - tile.lonMin) * KM_LON;
  const kmH = (tile.latMax - tile.latMin) * KM_LAT;
  const W = 2048, H = Math.max(64, Math.round(W * kmH / kmW));
  const mpp = kmW * 1000 / W;                       // 한 칸이 덮는 실제 거리(m)
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const px = lon => (lon - tile.lonMin) / (tile.lonMax - tile.lonMin) * W;
  const py = lat => (tile.latMax - lat) / (tile.latMax - tile.latMin) * H;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.globalCompositeOperation = 'lighter';
  for (const [mul, a] of [[7.0, 0.16], [4.2, 0.30], [2.4, 0.52], [1.0, 1.0]]) {
    g.strokeStyle = 'rgba(255,255,255,' + a + ')';
    for (const r of ROADS) {
      if (!r.pts || r.pts.length < 2) continue;
      const real = r.rank === 0 ? 190 : 120;        // 다져진 길바닥 너비(m)
      g.lineWidth = Math.max(1.0, real / mpp) * mul;
      g.beginPath();
      for (let i = 0; i < r.pts.length; i++) {
        const x = px(r.pts[i][1]), y = py(r.pts[i][0]);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
  }
  const im = g.getImageData(0, 0, W, H).data;
  const buf = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < buf.length; i++, j += 4) buf[i] = im[j];
  roadTex = new THREE.DataTexture(buf, W, H, THREE.LuminanceFormat);
  roadTex.minFilter = roadTex.magFilter = THREE.LinearFilter;
  roadTex.wrapS = roadTex.wrapT = THREE.ClampToEdgeWrapping;
  roadTex.generateMipmaps = false;
  roadTex.needsUpdate = true;
  roadBnd = new THREE.Vector4(tile.lonMin, tile.latMin,
                              tile.lonMax - tile.lonMin, tile.latMax - tile.latMin);
  cv.width = cv.height = 1;                          // 큰 그림판은 놓아 준다
}

/** 땅에 새긴 길을 켜고 끈다 (지형 판이 새로 서면 스스로 따라온다) */
function syncRoadMask() {
  for (const m of terrainMats) {
    if (!m.uniforms.roadT) continue;
    m.uniforms.roadT.value = roadTex || BLANK1;
    if (roadBnd) m.uniforms.roadB.value = roadBnd;
    m.uniforms.roadOn.value = (roadTex && roadShow) ? 1 : 0;
  }
  for (const m of drapeMats) {
    // 길에만 걸어야 한다 — 강·경로까지 스러뜨리면 안 된다
    if (!m.uniforms.rOn || !m.uniforms.grain || m.uniforms.grain.value < 0.5) continue;
    if (roadBnd) m.uniforms.rB.value = roadBnd;
    m.uniforms.rOn.value = (roadTex && roadShow) ? 1 : 0;
  }
}

function toggleRoads() {
  if (roadsMesh) {
    scene.remove(roadsMesh);
    roadsMesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    roadsMesh = null;
    roadShow = false; syncRoadMask();
    return false;
  }
  bakeRoadMask(canaanTile);
  roadShow = true;
  roadsMesh = new THREE.Group();
  for (const r of ROADS) {
    // 땅을 촘촘히 따라가야 능선에서 파먹히지 않는다 (110 m 마디)
    const pts = smoothPath(r.pts.map(p => ({ lat: p[0], lon: p[1] })), 0.12);
    const wide = Math.max(0.30, cam.dist * 0.0013) * (r.rank === 0 ? 1.6 : 1);
    // 산등성이가 길을 뚫고 올라와 길이 산 밑으로 파고든 것처럼 보였다.
    // 길은 땅 위에 얹는 것이니 덮어 그린다.
    // 흙빛에 가깝게, 그리고 옅게. 밝은 살구빛을 0.62 로 얹었더니 산등성이에
    // 우윳빛 냇물을 부어 놓은 꼴이었다. 길은 땅보다 조금 밝을 뿐이다.
    drapeRuns(roadsMesh, pts, wide, r.rank === 0 ? 0xa89a76 : 0x968a6e, 0.012,
              { opacity: r.rank === 0 ? 0.42 : 0.28, order: 5, fade: true, grain: true });
  }
  scene.add(roadsMesh);
  syncRoadMask();
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

/** 물의 낯 — 땅보다 눈 쪽으로 살짝 밀어 그린다.
 *
 *  지형은 판과 판의 이음매를 이기려고 폴리곤 옵셋을 세게 당겨 놓았다(-20).
 *  수면은 그냥 놓여 있으니 늘 그 밑으로 깔렸다 — 소금 바다가 통째로
 *  사라진 것이 그래서였다. 길·강에 쓰던 것과 같은 수를 쓴다. */
function waterMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -34, polygonOffsetUnits: -16,
    uniforms: { tint: { value: new THREE.Color(color) },
                alpha: { value: opacity }, push: { value: 0.03 } },
    vertexShader: [
      'uniform float push;',
      'void main(){',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  mv.xyz *= (1.0 - push);',
      '  gl_Position = projectionMatrix * mv;',
      '}'].join('\n'),
    fragmentShader: [
      'uniform vec3 tint; uniform float alpha;',
      'void main(){ gl_FragColor = vec4(tint, alpha); }'].join('\n')
  });
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
    const m = new THREE.Mesh(g, waterMaterial(0x1d4e6b, 0.93));
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
              dry ? 0x4d87a6 : 0x2f6f95, 0.022,
              { opacity: dry ? 0.55 : 0.8, order: 4, fade: true });
  }
  // 가나안 바깥의 큰 강 — 나일·유프라테스·티그리스·오론테스·할리스…
  // 광역 지형은 화소가 커서 강바닥이 담기지 않는다. 그래서 애굽도
  // 메소포타미아도 소아시아도 물 한 줄기 없이 말라 있었다. 앱이 그러듯
  // 물줄기를 따로 그어 준다 — 굵기는 앱이 쓰는 강폭을 그대로 따른다.
  for (const r of BIGRIVERS) {
    if (!r.pts || r.pts.length < 2) continue;
    const pts = smoothPath(r.pts.map(p => ({ lat: p[0], lon: p[1] })), 0.8);
    const wide = Math.max(0.8, Math.min(4.0, (r.channelM || 200) / 420));
    // 광역 판은 꼭짓점이 몇 km 씩 떨어져 있어, 골짜기를 가로지르는 면이
    // 실제 강바닥보다 높이 걸린다. 그대로 두면 다가갈수록 강이 땅에
    // 파묻혀 사라졌다 — 그래서 이 물줄기만은 좀 더 세게 밀어 준다.
    drapeRuns(riverMesh, pts, wide, 0x2f6f95, 0.014,
              { opacity: 0.86, order: 4, fade: true, push: 0.045 });
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
  // 판은 **열려 있을 때만** 다시 그린다. 닫아 둔 것을 제멋대로 열지 않는다.
  if (panelIsRoutes && panel.classList.contains('open')) openRoutes();
}

let cardEl = null;
function showCard(s) {
  cardSite = s;
  if (!cardEl) {
    cardEl = document.createElement('div');
    cardEl.id = 'card';
    dockEl().appendChild(cardEl);
    onTap(cardEl, ev => {
      const slot = ev.target.dataset.slot;
      if (slot) { assign(cardSite, slot); return; }
      if (ev.target.id === 'cMinus') {
        unassign(cardSite); setRoute(planStops()); showCard(cardSite);
        if (panelIsRoutes && panel.classList.contains('open')) openRoutes();
        return;
      }
      if (ev.target.id === 'cX') { cardEl.classList.remove('on'); highlight = null; return; }
      if (ev.target.id === 'cInfo') { openPlace(cardSite); return; }
      // 이름을 눌러도 열리게 두되, 그 밖에는 옆 판이 저절로 나오지 않는다
      if (ev.target.closest('#cName')) openPlace(cardSite);
    });
  }
  const eps = (byPlace.get(s.ko) || []).length;
  const note = NOTES.has(s.ko);
  const here = slotOf(s);
  const pill = (k, t) => '<button class="cslot' + (here === k ? ' on' : '') + '" data-slot="' + k + '">' + t + '</button>';
  cardEl.innerHTML =
    '<div id="cName">' + escapeHTML(L.place(s.ko)) +
    '<small>' + escapeHTML(L.region(s.region)) +
    ' · ' + Math.round(s.y / (0.001 * VEXAG)) + ' m' +
    ' · ' + s.lat.toFixed(3) + '°N ' + s.lon.toFixed(3) + '°E' +
    (eps ? ' · <b>' + L.s('사건 ' + eps, eps + ' records') + '</b>' : '') + '</small></div>' +
    '<span class="cgap"></span>' +
    // 기록이 있는 곳에만 「정보」를 둔다 — 누구나 알아보게 글자로.
    (eps || note ? '<button id="cInfo">' + escapeHTML(L.s('정보', 'Info')) + '</button>' : '') +
    pill('start', L.s('출발', 'Start')) + pill('via', L.s('경유', 'Via')) + pill('end', L.s('도착', 'End')) +
    // 이미 길에 든 곳이면 그 자리에서 뺄 수 있어야 한다 (앱과 같다)
    (here ? '<button id="cMinus" title="' + L.s('길에서 빼기', 'Remove from route') + '">⊖</button>' : '') +
    '<button id="cX">✕</button>';
  cardEl.classList.add('on');
}

const cardCSS = document.createElement('style');
cardCSS.textContent =
  '#card{display:none;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;' +
  'row-gap:7px;max-width:min(620px,96vw);width:max-content;' +
  'padding:9px 8px 9px 14px;border-radius:15px;background:var(--panel);' +
  'border:1px solid var(--line);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
  'pointer-events:none}' +
  '#card.on{display:flex;pointer-events:auto;animation:cardIn .18s ease}' +
  '@keyframes cardIn{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}' +
  '#cName{font:600 15px/1.25 Georgia,"Apple SD Gothic Neo",serif;color:var(--ink);cursor:pointer;' +
  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}' +
  '#cInfo{border:1px solid rgba(253,204,97,.5);background:rgba(253,204,97,.12);' +
  'color:#fdcc61;font:600 12px/1 inherit;cursor:pointer;padding:0 12px;height:30px;' +
  'border-radius:15px;margin-right:2px}' +
  '#cInfo:hover{background:rgba(253,204,97,.22)}' +
  '#cName small{display:block;font:400 10.5px/1.4 system-ui;color:rgba(255,255,255,.55)}' +
  '#cName small b{color:rgba(253,204,97,.85);font-weight:400}' +
  '.cgap{flex:1;min-width:8px}' +
  '.cslot{border:0;font:600 12px/1 inherit;color:rgba(255,255,255,.9);cursor:pointer;' +
  'padding:0 12px;height:30px;border-radius:15px;background:rgba(255,255,255,.14)}' +
  '.cslot.on{background:#f5e6c2;color:rgba(0,0,0,.85)}' +
  // 좁은 화면에서는 단추 하나만 아래로 흘러내려 보기 흉했다.
  // 이름은 윗줄에, 단추는 모두 아랫줄에 나란히 세운다.
  '@media (max-width:560px){' +
    '#card{width:min(96vw,430px);max-width:96vw;padding:10px 12px;justify-content:center}' +
    '#cName{flex:1 1 100%;max-width:none;text-align:center;white-space:normal}' +
    '.cgap{display:none}' +
    '#card>button{flex:0 0 auto}' +
  '}' +
  // 닫기·빼기는 손가락으로 눌러야 하는 것이다. 26px 짜리 회색 십자가는
  // 보이지도 않고 눌리지도 않았다.
  '#cX,#cMinus{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);' +
  'color:rgba(255,255,255,.9);font:400 19px/1 inherit;' +
  'cursor:pointer;width:36px;height:36px;border-radius:18px;flex:0 0 auto;' +
  'display:inline-flex;align-items:center;justify-content:center}' +
  '#cX:hover,#cMinus:hover{background:rgba(255,255,255,.18)}' +
  '#cMinus{color:#ff9d80;font-size:22px;border-color:rgba(255,140,110,.35)}' +
  '@media (max-width:560px){#card{left:8px;right:8px;transform:translateY(120%);max-width:none;width:auto}' +
  '#card.on{transform:none}.cslot{padding:0 9px}}';
document.head.appendChild(cardCSS);

// ── 경로 판 ───────────────────────────────────────────────
function openLayers() {
  panelIsRoutes = false;
  document.getElementById('pTitle').textContent = L.s('표시', 'Display');
  document.getElementById('pSub').textContent =
    L.s('지도에 어떤 이름을 띄울지 고릅니다', 'Choose which names the map shows');
  // 갈래마다 지금 지도에 몇 곳이 걸려 있는지도 함께 적어 준다
  const cnt = {};
  for (const s of SITES) cnt[s.rank] = (cnt[s.rank] || 0) + 1;
  let html = '<div class="note" style="border:0;padding-bottom:2px">' +
    escapeHTML(L.s('갈래를 눌러 켜고 끕니다. 켜면 그 아래에서 얼마나 자세히 볼지 고를 수 있습니다.',
                   'Tap a layer to turn it on or off. When it is on, choose how much detail below it.')) +
    '</div>' +
    '<div class="lrow on" style="cursor:default"><i>\u25cf</i><span><b>' +
      escapeHTML(L.s('툴바 크기', 'Toolbar size')) + '</b>' +
      escapeHTML(L.s('단추와 글씨를 한 단계 크게 볼 수 있습니다',
                     'Make the buttons and text one step larger')) + '</span></div>' +
    '<div class="dpick">' +
      '<button data-ui="0"' + (UIBIG ? '' : ' class="sel"') + '>' +
      escapeHTML(L.s('보통', 'Normal')) + '</button>' +
      '<button data-ui="1"' + (UIBIG ? ' class="sel"' : '') + '>' +
      escapeHTML(L.s('크게', 'Large')) + '</button>' +
    '</div>';

  html += LAYERS.map(l => {
    const n = l.ranks.reduce((a, r2) => a + (cnt[r2] || 0), 0);
    let row = '<div class="lrow' + (l.on ? ' on' : '') + '" data-layer="' + l.k + '">' +
      '<i>' + (l.on ? '●' : '○') + '</i>' +
      '<span><b>' + escapeHTML(L.cur === 'ko' ? l.ko : l.en) +
      '<u>' + n + escapeHTML(L.s('곳', '')) + '</u></b>' +
      escapeHTML(L.cur === 'ko' ? l.hintKo : l.hintEn) + '</span></div>';
    // 켜 둔 갈래마다 「얼마나 자세히」를 따로 고른다
    if (l.on && !AREAKIND[l.k]) {
      row += '<div class="dpick" data-lay="' + l.k + '">' + DETAILS.map((d, i) =>
        '<button data-detail="' + i + '"' + (i === DET[l.k] ? ' class="sel"' : '') + '>' +
        escapeHTML(L.cur === 'ko' ? d.ko : d.en) + '</button>').join('') + '</div>';
    }
    // 지파·민족은 켜 두었을 때 낱낱이 고를 수 있다. 하나도 고르지 않으면 다 본다.
    if (AREAKIND[l.k] && l.on) {
      const list = AREAS[AREAKIND[l.k]];
      if (list && list.length) {
        row += '<div class="chips">' +
          '<button class="chip' + (areaSel[l.k].size ? '' : ' sel') +
          '" data-area="' + l.k + '" data-name="*">' +
          escapeHTML(L.s('모두', 'All')) + '</button>' +
          list.map(a => {
            const c = a.color;
            const rgb = 'rgb(' + Math.round(c[0]*255) + ',' + Math.round(c[1]*255) +
                        ',' + Math.round(c[2]*255) + ')';
            return '<button class="chip' + (areaSel[l.k].has(a.ko) ? ' sel' : '') +
              '" data-area="' + l.k + '" data-name="' + escapeHTML(a.ko) + '">' +
              '<s style="background:' + rgb + '"></s>' +
              escapeHTML(L.place(a.ko)) + '</button>';
          }).join('') + '</div>';
      }
    }
    return row;
  }).join('');
  document.getElementById('pb').innerHTML = html;
  panel.classList.add('open');
}

// ── 관리 판 — 몇 사람이 들어왔는가 ─────────────────────────
//
// 깃허브 페이지는 파일을 내주기만 할 뿐 아무것도 기억하지 못한다.
// 그래서 셈은 바깥의 조그만 셈 지기(abacus)에 맡겨 두고, 여기서는 읽기만 한다.
// 관리용 암호로 들어왔을 때만 툴바에 단추가 붙는다.
function ymdJS(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2)
                         + '-' + ('0' + d.getDate()).slice(-2);
}
async function readCount(k) {
  try {
    const r = await fetch((window.__CNT || '') + 'get/' + (window.__NS || '') + '/' + k,
                          { cache: 'no-store' });
    if (r.status === 404) return 0;          // 아직 한 번도 안 세어진 칸
    if (!r.ok) return null;
    const o = await r.json();
    return o.value || 0;
  } catch (e) { return null; }
}

// 지금 몇 창이 열려 있는가 — 툴바에 켜 두는 등 하나.
// 판을 열어 표를 보는 것이 아니라, 사람 모양 옆에 수가 적히고 주황 불이 깜빡인다.
//
// 등을 누르면 **관리자 몇 · 일반 몇**으로 갈라서 보여 준다. 수 하나만 적혀
// 있으면 그것이 나 자신인지 남인지 알 길이 없어, 세어 놓고도 쓸 데가 없었다.
// 그래서 관리용 암호로 들어온 창은 따로 「a-」 칸을 두들기게 했다.
let liveEl = null, liveTimer = 0, livePop = null;
const liveNum = { adm: null, gen: null };
async function tickLive() {
  if (!liveEl) return;
  const mk = window.__MKEY;
  if (!mk) return;
  // 지난 칸과 이번 칸을 함께 본다.
  //   · 지난 칸은 다 채워졌지만 한 마디(1분)가 늦다.
  //   · 이번 칸은 곧바로 차오르지만 아직 두들기지 않은 창이 빠져 있다.
  // 큰 쪽이 지금 열려 있는 창 수에 가장 가깝다. 예전에는 지난 칸만 보아서
  // 방금 들어온 내 창이 한참 뒤에야 나타났다.
  const now = new Date(), ago = new Date(Date.now() - 60000);
  const [g0, g1, a0, a1] = await Promise.all([
    readCount(mk(ago)), readCount(mk(now)),
    readCount(mk(ago, 'a-')), readCount(mk(now, 'a-'))]);
  const pick = (x, y) => (x == null && y == null) ? null : Math.max(x || 0, y || 0);
  const gen = pick(g0, g1), adm = pick(a0, a1);
  liveNum.gen = gen; liveNum.adm = adm;
  const tot = (gen == null && adm == null) ? null : (gen || 0) + (adm || 0);
  liveEl.querySelector('b').textContent = (tot == null ? '—' : tot);
  if (livePop && livePop.classList.contains('on')) fillLive();
}

function fillLive() {
  if (!livePop) return;
  const n = v => (v == null ? '—' : String(v));
  const g = liveNum.gen, a = liveNum.adm;
  const tot = (g == null && a == null) ? null : (g || 0) + (a || 0);
  livePop.innerHTML =
    '<h4>' + escapeHTML(L.s('지금 열려 있는 창', 'Open right now')) + '</h4>' +
    '<div class="lrw"><i class="a"></i><span>' + escapeHTML(L.s('관리자', 'Admin')) +
      '<u>' + escapeHTML(L.s('보고 계신 이 창도 여기 들어 있습니다',
                             'this window is counted here')) + '</u></span>' +
      '<b>' + n(a) + '</b></div>' +
    '<div class="lrw"><i class="g"></i><span>' + escapeHTML(L.s('일반', 'Visitors')) +
      '<u>' + escapeHTML(L.s('일반 암호로 들어오신 분들', 'came in with the plain password')) +
      '</u></span><b>' + n(g) + '</b></div>' +
    '<div class="lrw tot"><i></i><span>' + escapeHTML(L.s('합계', 'Total')) +
      '</span><b>' + n(tot) + '</b></div>' +
    '<p>' + escapeHTML(L.s('최근 1분 사이에 열려 있던 창의 수입니다. 창을 닫으면 1분쯤 뒤에 저절로 빠집니다.',
                           'Windows open within the last minute; a closed one drops off about a minute later.')) +
    '</p>';
}

function toggleLive() {
  if (!livePop) return;
  const on = !livePop.classList.contains('on');
  livePop.classList.toggle('on', on);
  if (!on) return;
  fillLive();
  const r = liveEl.getBoundingClientRect();
  livePop.style.top = Math.round(r.bottom + 8) + 'px';
  livePop.style.left = Math.round(Math.max(8, Math.min(innerWidth - 258, r.left))) + 'px';
  tickLive();
}
function makeLive() {
  liveEl = document.createElement('div');
  liveEl.id = 'live';
  liveEl.className = 'card';
  liveEl.title = L.s('지금 열려 있는 창 — 눌러서 갈라 보기',
                     'Windows open right now — tap for the breakdown');
  liveEl.innerHTML =
    '<i class="dot"></i>' +
    '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
    '<circle cx="8" cy="4.6" r="3"/><path d="M1.6 15c0-3.5 2.9-5.6 6.4-5.6s6.4 2.1 6.4 5.6z"/>' +
    '</svg><b>·</b>';
  const tools = document.getElementById('tools');
  tools.parentNode.insertBefore(liveEl, tools);

  livePop = document.createElement('div');
  livePop.id = 'livePop';
  livePop.className = 'card';
  document.body.appendChild(livePop);
  onTap(liveEl, () => toggleLive());
  // 바깥을 누르면 닫는다 (등과 팝업 자신은 빼고)
  document.addEventListener('pointerdown', ev => {
    if (!livePop.classList.contains('on')) return;
    if (ev.target.closest && ev.target.closest('#live, #livePop')) return;
    livePop.classList.remove('on');
  });

  const st = document.createElement('style');
  st.textContent =
    '#live{display:inline-flex;align-items:center;gap:7px;padding:0 13px;height:38px;' +
    'border-radius:12px;color:var(--ink);white-space:nowrap;cursor:pointer;' +
    '-webkit-tap-highlight-color:transparent}' +
    '#live:hover{border-color:rgba(255,255,255,.22)}' +
    '#livePop{position:fixed;z-index:40;width:250px;padding:12px 14px 10px;display:none;' +
    'box-shadow:0 12px 34px rgba(0,0,0,.5)}' +
    '#livePop.on{display:block}' +
    '#livePop h4{margin:0 0 8px;font:600 12.5px/1 inherit;color:var(--dim);letter-spacing:.02em}' +
    '#livePop .lrw{display:flex;align-items:center;gap:9px;padding:8px 0}' +
    '#livePop .lrw+.lrw{border-top:1px solid rgba(255,255,255,.07)}' +
    '#livePop .lrw i{width:9px;height:9px;border-radius:5px;flex:0 0 auto}' +
    '#livePop .lrw i.a{background:#fdcc61;box-shadow:0 0 8px rgba(253,204,97,.65)}' +
    '#livePop .lrw i.g{background:#7fc8a9}' +
    '#livePop .lrw span{flex:1;font-size:13px;color:var(--ink);line-height:1.25}' +
    '#livePop .lrw u{display:block;text-decoration:none;font-size:10.5px;' +
    'color:#8d867a;margin-top:3px;line-height:1.4}' +
    '#livePop .lrw b{font:700 17px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--gold)}' +
    '#livePop .tot{border-top:1px solid rgba(255,255,255,.16)}' +
    '#livePop .tot span{color:var(--dim);font-size:12px}' +
    '#livePop .tot b{color:var(--ink);font-size:15px}' +
    '#livePop p{margin:9px 0 0;font-size:10.8px;line-height:1.55;color:#8d867a}' +
    '#live svg{width:13px;height:13px;opacity:.85}' +
    '#live b{font:700 15px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--gold);' +
    'min-width:1ch;text-align:center}' +
    '#live .dot{width:9px;height:9px;border-radius:5px;background:#ff8a2b;' +
    'box-shadow:0 0 9px rgba(255,138,43,.95);animation:onair 1.5s ease-in-out infinite}' +
    '@keyframes onair{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.68)}}' +
    '@media (prefers-reduced-motion:reduce){#live .dot{animation:none}}' +
    '@media (max-width:700px){#live{padding:0 10px;gap:6px}}';
  document.head.appendChild(st);
  tickLive();
  clearInterval(liveTimer);
  liveTimer = setInterval(tickLive, 20000);
}

let panelIsRoutes = false;
// 어느 주제를 펼쳐 두었는지 기억한다 — 판을 다시 그려도 접히지 않게.
const openGroups = new Set();

const jgrpCSS = document.createElement('style');
jgrpCSS.textContent =
  // 닫기 단추 — 손가락이 닿는 크기로. 옆에 붙은 작은 글씨는 밀려나지 않게 줄인다.
  '#closeBtn{flex:0 0 auto;min-width:44px;height:44px;display:flex;' +
  'align-items:center;justify-content:center;font-size:16px;border-radius:12px;' +
  'border:1px solid rgba(255,255,255,.16)}' +
  '#ph small{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;' +
  'white-space:nowrap}' +
  // 얼마나 자세히 — 다섯 칸
  '.dpick{display:flex;flex-wrap:wrap;gap:3px;margin:0 0 12px 26px}' +
  '.dpick button{flex:1 1 auto;border:1px solid rgba(255,255,255,.14);' +
  'background:none;color:#b9b1a3;cursor:pointer;font:600 11.5px/1 inherit;' +
  'padding:0 6px;height:30px;border-radius:9px;white-space:nowrap}' +
  '.dpick button.sel{background:rgba(253,204,97,.92);color:#231702;border-color:transparent}' +
  '.dhint{display:block;color:#8d867a;font-size:11.5px}' +
  // 관리 판의 숫자 줄
  '.arow{display:flex;align-items:baseline;gap:10px;padding:6px 0}' +
  '.arow span{flex:1;color:#cfc8ba;font-size:13px}' +
  '.arow b{font:700 16px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--gold)}' +

  // 찾은 목록의 「표시」 단추
  '.hit{position:relative;padding-right:74px}' +
  '.hmark{position:absolute;right:10px;top:50%;transform:translateY(-50%);' +
  'border:1px solid rgba(255,255,255,.18);background:none;color:#b9b1a3;' +
  'font:600 11.5px/1 inherit;padding:0 9px;height:26px;border-radius:13px;cursor:pointer}' +
  '.hmark.on{background:rgba(253,204,97,.9);color:#231702;border-color:transparent}' +
  '.hit.sentence{padding-right:12px}' +
  '.sbtns{display:flex;gap:6px;margin-top:8px}' +
  '.sbtns button{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);' +
  'color:var(--ink);font:600 12px/1 inherit;padding:0 12px;height:30px;' +
  'border-radius:15px;cursor:pointer}' +
  '.sbtns button:hover{background:rgba(255,255,255,.12)}' +
  '.sbtns button.go{background:#f5e6c2;color:rgba(0,0,0,.85);border-color:transparent}' +
  '.schips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}' +
  '.schip{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.16);' +
  'background:rgba(255,255,255,.05);color:var(--ink);font:600 12px/1 inherit;' +
  'padding:0 10px;height:27px;border-radius:14px;cursor:default}' +
  '.schip.many{cursor:pointer;border-color:rgba(253,204,97,.55)}' +
  '.schip.many u{text-decoration:none;font-size:10px;color:#231702;background:rgba(253,204,97,.9);' +
  'border-radius:8px;padding:1px 5px}' +
  '.schip.open{background:rgba(253,204,97,.18)}' +
  '.sopts{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;padding:8px;' +
  'border-radius:10px;background:rgba(255,255,255,.05)}' +
  '.sopts button{border:1px solid rgba(255,255,255,.16);background:none;color:var(--ink);' +
  'font:600 12px/1.3 inherit;padding:6px 10px;border-radius:10px;cursor:pointer;text-align:left}' +
  '.sopts button.sel{background:rgba(253,204,97,.9);color:#231702;border-color:transparent}' +
  '.sopts button s{display:block;text-decoration:none;font-size:10.5px;opacity:.7;margin-top:2px}' +
  // 지파·민족 낱낱이
  '.chips{display:flex;flex-wrap:wrap;gap:4px;padding:2px 0 12px 26px}' +
  '.chips .chip{display:inline-flex;align-items:center;gap:5px;cursor:pointer;' +
  'border:1px solid rgba(255,255,255,.14);background:none;color:#b9b1a3;' +
  'font:600 11.5px/1 inherit;padding:0 9px;height:28px;border-radius:14px}' +
  '.chips .chip.sel{background:rgba(255,255,255,.14);color:#f2ece0;' +
  'border-color:rgba(255,255,255,.3)}' +
  '.chips .chip s{width:9px;height:9px;border-radius:3px;text-decoration:none;' +
  'display:inline-block}' +
  '.jgrp{border-bottom:1px solid rgba(255,255,255,.07)}' +
  '.jgrp>summary{list-style:none;cursor:pointer;padding:13px 2px;display:flex;' +
  'align-items:center;gap:8px}' +
  '.jgrp>summary::-webkit-details-marker{display:none}' +
  '.jgrp>summary::before{content:"\u203a";font-size:17px;color:#8d867a;' +
  'transition:transform .16s;display:inline-block;width:10px}' +
  '.jgrp[open]>summary::before{transform:rotate(90deg)}' +
  '.jgrp>summary b{font-size:14.5px;font-weight:600;flex:1}' +
  '.jgrp>summary u{text-decoration:none;font-size:11.5px;color:#8d867a;' +
  'border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:1px 7px}' +
  '.jall{padding:2px 2px 8px 18px}' +
  '.jgrp .ep{padding-left:18px}' +
  '.jgrp .ep:last-child{border-bottom:0}';
document.head.appendChild(jgrpCSS);

function jrnCard(i) {
  const p = PRESETS[i];
  return '<div class="ep jrn" data-j="' + i + '"><h3>' +
    escapeHTML(L.cur === 'ko' ? p.ko : p.en) + '</h3><p>' +
    escapeHTML(L.cur === 'ko' ? p.detailKo : p.detailEn) + '</p><span class="ref">' +
    p.stops.length + L.s('곳', ' stops') + '</span></div>';
}

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
  // 앱과 같이 **주제만 접힌 채로** 보이고, 누르면 그 안의 여정이 펼쳐진다.
  h += '<div class="note" style="border:0;padding-bottom:2px"><em>' +
    escapeHTML(L.s('성경 여정', 'Bible journeys')) + '</em>' +
    escapeHTML(L.s('주제를 누르면 그 안의 여정이 펼쳐집니다.',
                   'Tap a theme to open the journeys inside it.')) + '</div>';
  const used = new Set();
  h += JGROUPS.map((g, gi) => {
    const rows = (g.names || []).map(n => PRESETS.findIndex(p => p.ko === n))
                                .filter(i2 => i2 >= 0);
    rows.forEach(i2 => used.add(i2));
    if (!rows.length) return '';
    // 토막이 둘 이상이면 「한번에 보기」 — 그 묶음의 길을 한 줄로 잇는다.
    // (이미 한 줄짜리만 모아 둔 묶음에는 붙이지 않는다 — 이을 것이 없다)
    const solo = (g.names || []).filter(n => !WHOLEKO.has(n));
    const all = solo.length >= 2
      ? '<div class="jall"><button class="rbtn" data-all="' + gi + '">' +
        escapeHTML(L.s('한번에 보기', 'See it all')) + '</button></div>' : '';
    return '<details class="jgrp" data-g="' + gi + '"' +
      (openGroups.has(gi) ? ' open' : '') + '><summary><b>' +
      escapeHTML(L.cur === 'ko' ? g.ko : g.en) + '</b><u>' + rows.length +
      escapeHTML(L.s('개', '')) + '</u></summary>' + all +
      rows.map(jrnCard).join('') + '</details>';
  }).join('');
  // 어느 주제에도 들지 못한 여정이 있으면 빠뜨리지 않는다
  const rest = PRESETS.map((p, i) => i).filter(i => !used.has(i));
  if (rest.length) h += rest.map(jrnCard).join('');
  b.innerHTML = h;
  b.scrollTop = 0;
  panel.classList.add('open');
}

// details 는 toggle 이 위로 오르지 않는다 — 붙잡는 쪽에서 받는다.
document.getElementById('pb').addEventListener('toggle', ev => {
  const d = ev.target;
  if (!d || !d.classList || !d.classList.contains('jgrp')) return;
  if (d.open) openGroups.add(+d.dataset.g); else openGroups.delete(+d.dataset.g);
}, true);

onTap(document.getElementById('pb'), ev => {
  // 묶음 하나를 한 줄로 — 「한번에 보기」
  const ab = ev.target.closest('[data-all]');
  if (ab) {
    const g = JGROUPS[+ab.dataset.all];
    if (!g) return;
    const whole = g.all ? PRESETS.find(x => x.ko === g.all) : null;
    let stops;
    if (whole) stops = whole.stops;
    else {
      stops = [];
      for (const n of (g.names || [])) {
        if (WHOLEKO.has(n)) continue;
        const q = PRESETS.find(x => x.ko === n);
        if (!q) continue;
        for (const st of q.stops) { if (stops[stops.length - 1] === st) continue; stops.push(st); }
      }
    }
    following = false; followKm = 0;
    const km = setRoute(stops.map(n => siteByName.get(n)).filter(Boolean));
    frameRoute();
    openRoutes();
    document.getElementById('pSub').textContent =
      Math.round(km) + L.s(' km · ' + stops.length + '곳', ' km · ' + stops.length + ' stops');
    return;
  }
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
  const ub = ev.target.closest('[data-ui]');
  if (ub) {
    UIBIG = ub.dataset.ui === '1';
    applyUIBig(); openLayers(); updateLabels();
    return;
  }
  const dp = ev.target.closest('[data-detail]');
  if (dp) {
    const lay = dp.parentNode && dp.parentNode.dataset.lay;
    if (lay && DET[lay] != null) { DET[lay] = +dp.dataset.detail; saveDetail(); }
    updateLabels(); openLayers();
    return;
  }
  const ch = ev.target.closest('[data-area]');
  if (ch) {
    const kind = ch.dataset.area, nm = ch.dataset.name;
    if (nm === '*') areaSel[kind].clear();
    else if (areaSel[kind].has(nm)) areaSel[kind].delete(nm);
    else areaSel[kind].add(nm);
    saveAreaSel(); syncAreas(true); updateLabels(); openLayers();
    return;
  }
  const lr = ev.target.closest('.lrow');
  if (lr) {
    const l = LAYERS.find(x => x.k === lr.dataset.layer);
    if (l) { l.on = !l.on; syncLayers(); syncAreas(true); updateLabels(); openLayers(); }
    return;
  }
  const del = ev.target.dataset.del;
  if (del != null) { unassign(SITES[+del]); setRoute(planStops()); openRoutes(); return; }
  const go = ev.target.closest('[data-go]');
  if (go) { const s = SITES[+go.dataset.go]; if (s) { flyTo(s); showCard(s); } return; }
  const act = ev.target.dataset.act;
  if (act === 'fit')  { following = false; frameRoute(); }
  if (act === 'follow') { toggleFollow(); syncGoBtn(); openRoutes(); }
  if (act === 'clr')  { plan.start = null; plan.end = null; plan.via = [];
                        clearRoute(); openRoutes(); }
  if (act === 'roads'){ toggleRoads(); openRoutes(); }
});

const labSizeCSS = document.createElement('style');
labSizeCSS.textContent =
  // 브라우저가 이름표 위의 손가락을 「스크롤일지도 모른다」며 붙잡고
  // 있지 않게 한다. (짚을 자리는 넓히지 않는다 — 글자 둘레가 벌어지면
  // 이름표끼리 서로 밀어내 지도가 성겨 보인다)
  '.lab{touch-action:manipulation}' +
  // 상 — 큰 도시
  '.lab.r0{font-size:19px;font-weight:800;letter-spacing:.01em}' +
  '.lab.r1{font-size:15.5px;font-weight:700}' +
  // 중 — 성읍
  '.lab.r2{font-size:13.5px;font-weight:600}' +
  '.lab.r3{font-size:12.5px;font-weight:500}' +
  // 지형(산·산맥·골짜기)은 도시만큼 큰 것들이다. 작게 쓰면 안 보인다.
  '.lab.r4,.lab.r8,.lab.r9{font-size:17px;font-weight:700;letter-spacing:.05em}' +
  // 지파와 민족은 넓은 땅 이름 — 더 크고 옅게
  // 지파·민족 — 앱과 같이 색 판 위의 큰 흰 글씨. 넓은 땅의 이름이라
  // 성읍 이름보다 커야 한다.
  '.lab.r5,.lab.r6,.lab.r11,.lab.r12{font-size:22px;font-weight:800;' +
  'letter-spacing:.15em;color:#fff;' +
  'padding:5px 15px;border-radius:17px;border:2px solid rgba(255,255,255,.55);' +
  'text-shadow:0 2px 5px rgba(0,0,0,.6);box-shadow:0 3px 12px rgba(0,0,0,.42)}' +
  '@media (max-width:560px){.lab.r5,.lab.r6,.lab.r11,.lab.r12{font-size:18px;padding:4px 12px}}' +
  '.lab.r7{font-size:16px;font-weight:700;color:#b6d9ea;letter-spacing:.06em}' +
  // 도피 도시 — 붉은 세모 (여호수아 20장의 여섯 성)
  '.lab.refuge i{width:0;height:0;border-radius:0;background:none;' +
  'border-left:5px solid transparent;border-right:5px solid transparent;' +
  'border-bottom:9px solid #e03d2e;box-shadow:none;' +
  'filter:drop-shadow(0 0 3px rgba(0,0,0,.6));vertical-align:0}' +
  // 손으로 고른 곳은 눈에 띄게 커진다
  '.lab.on{transform:translate(-50%,-50%) scale(1.5);z-index:3;' +
  'text-shadow:0 1px 4px #000,0 0 14px #000,0 0 22px rgba(0,0,0,.9)}' +
  // 주요 도시 — 앱은 큰 도시를 1.55 곱으로 키운다. 이름만 보아도 어디쯤인지
  // 잡히는 곳들이라, 성읍 수백 개 사이에서 확실히 도드라져야 한다.
  '.lab.r0.key{font-size:29px;font-weight:800;letter-spacing:.02em;' +
  'text-shadow:0 2px 5px #000,0 0 12px #000,0 0 20px rgba(0,0,0,.85)}' +
  '.lab.r1.key{font-size:24px;font-weight:800;' +
  'text-shadow:0 2px 5px #000,0 0 12px #000,0 0 18px rgba(0,0,0,.8)}' +
  '.lab.key i{width:7px;height:7px;border-radius:4px;margin-right:6px}' +
  '.lab.r4.bigr{font-size:23px}' +
  '@media (max-width:560px){.lab.r0{font-size:16px}.lab.r1{font-size:13.5px}' +
  '.lab.r2{font-size:12px}.lab.r3{font-size:11px}' +
  '.lab.r4,.lab.r8,.lab.r9{font-size:13px}.lab.r5,.lab.r6{font-size:14.5px}' +
  '.lab.r0.key{font-size:25px}.lab.r1.key{font-size:21px}.lab.r4.bigr{font-size:17.5px}}' +
  // 표시해 둔 곳 — 앱 MarkOverlay 와 같은 모양.
  // 검은 알약에 그 곳 색의 테두리, 왼쪽에 번호 알, 오른쪽에 흰 이름.
  '.lab.mark{display:inline-flex;align-items:center;gap:8px;' +
  'border:2px solid;border-radius:999px;padding:4px 14px 4px 4px;' +
  'color:#fff;font-size:15px;font-weight:600;font-style:normal;letter-spacing:.01em;' +
  'text-shadow:0 1px 2px rgba(0,0,0,.75);box-shadow:0 2px 10px rgba(0,0,0,.6);z-index:4}' +
  '.lab.mark em{font-style:normal;min-width:21px;height:21px;padding:0 5px;' +
  'border-radius:11px;display:inline-flex;align-items:center;justify-content:center;' +
  'font:700 12.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(0,0,0,.78)}' +
  '.lab.mark i{display:none}' +
  // 표시한 곳은 등급이 무엇이든 알약 크기로 맞춘다 — 주요 도시라고
  // 29px 짜리 알약이 되면 지도를 다 가린다.
  '.lab.r0.mark,.lab.r1.mark,.lab.r4.mark,.lab.r0.key.mark,.lab.r1.key.mark,' +
  '.lab.r5.mark,.lab.r6.mark,.lab.r7.mark,.lab.r8.mark,.lab.r9.mark,' +
  '.lab.r11.mark,.lab.r12.mark{font-size:15px;font-weight:600;letter-spacing:.01em;' +
  'padding:4px 14px 4px 4px}' +
  '@media (max-width:560px){.lab.mark{font-size:13px;padding:3px 11px 3px 3px;gap:6px}' +
  '.lab.mark em{min-width:18px;height:18px;font-size:11px}}';
document.head.appendChild(labSizeCSS);

// ── 툴바 「크게」 ──────────────────────────────────────────
//
// 글씨만 키우면 단추 높이가 제각각이 되어 줄이 삐뚤어진다. 높이·여백·
// 아이콘을 **함께** 키워 한 줄로 나란히 서게 한다.
const uiBigCSS = document.createElement('style');
uiBigCSS.textContent =
  'body.uibig #tools .btn{padding:12px 15px;gap:7px}' +
  'body.uibig #tools .btn u{font-size:15px}' +
  'body.uibig #tools .btn u.big{font-size:17px}' +
  'body.uibig #tools .btn i svg{width:20px;height:20px}' +
  'body.uibig #tools .btn i.txt{font-size:14px}' +
  'body.uibig #q{font-size:16.5px;padding:13px 14px}' +
  'body.uibig #qico{width:18px;height:18px;margin-left:14px}' +
  'body.uibig #hud b{font-size:16px}' +
  'body.uibig #hud{padding:11px 14px}' +
  'body.uibig #qualPick{padding:4px 5px 4px 12px}' +
  'body.uibig #qualPick>i{font-size:14px}' +
  'body.uibig #qualPick button{height:38px;padding:0 13px;font-size:14px}' +
  'body.uibig #live{height:46px;padding:0 16px;gap:9px}' +
  'body.uibig #live svg{width:16px;height:16px}' +
  'body.uibig #live b{font-size:18px}' +
  'body.uibig #live .dot{width:11px;height:11px;border-radius:6px}' +
  'body.uibig #card{padding:12px 16px;gap:8px}' +
  'body.uibig #cName b{font-size:16.5px}' +
  'body.uibig .cslot{font-size:14px;height:40px;padding:0 14px}' +
  'body.uibig #cX,body.uibig #cMinus{width:42px;height:42px;font-size:22px}' +
  'body.uibig #cMinus{font-size:25px}' +
  'body.uibig #goBtn,body.uibig #clrBtn,body.uibig #mkClrBtn{' +
  'height:50px;padding:0 19px;font-size:15px;border-radius:25px}' +
  'body.uibig #spdBtn{padding:9px 18px;gap:13px}' +
  'body.uibig #spdBtn input{width:230px;height:5px}' +
  'body.uibig #spdBtn>u{font-size:14px;min-width:54px}' +
  'body.uibig #spdBtn>i,body.uibig #travel>i,body.uibig #eyeh>i{font-size:13.5px}' +
  'body.uibig #spdBtn button,body.uibig #travel button,body.uibig #eyeh button{' +
  'height:38px;padding:0 13px;font-size:14px;border-radius:19px}' +
  'body.uibig #eyeh>u{font-size:13px}' +
  'body.uibig #joy{width:132px;height:132px;border-radius:66px}' +
  'body.uibig #joy i{width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:26px}' +
  '@media (max-width:560px){' +
    'body.uibig #tools .btn{padding:11px 12px}' +
    'body.uibig #qualPick button{height:34px;padding:0 10px;font-size:13px}' +
    'body.uibig #goBtn,body.uibig #clrBtn,body.uibig #mkClrBtn{height:46px;font-size:14px}' +
    'body.uibig #joy{width:112px;height:112px}' +
  '}';
document.head.appendChild(uiBigCSS);
applyUIBig();

/** 화면 아래에 잠깐 뜨는 알림 */
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  // 툴바가 폰에서는 두세 줄이 된다. 그 아래로 내려 놓는다.
  const top = document.getElementById('top');
  if (top) el.style.top = (top.getBoundingClientRect().height + 10) + 'px';
  // 예전에는 여섯 초를 머물렀다. 「멈췄습니다」 한마디를 그렇게 오래
  // 볼 까닭이 없다 — 눈에 들어올 만큼만 두고 곧 걷는다.
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 2000);
}
// ── 지도만 보기 ────────────────────────────────────────────
// 단추와 판을 통째로 감춘다. 감추는 단추 하나만 남는다.
let bareBtn = null, bare = false;
function makeBareBtn() {
  bareBtn = document.createElement('button');
  bareBtn.id = 'bareBtn';
  onTap(bareBtn, () => {
    bare = !bare;
    document.body.classList.toggle('bare', bare);
    bareBtn.textContent = bare ? '⛶' : '⛶';
    bareBtn.title = bare ? L.s('단추 다시 보기', 'Show the buttons')
                         : L.s('지도만 보기', 'Map only');
    bareBtn.style.background = bare ? 'rgba(253,204,97,.9)' : 'var(--panel)';
    bareBtn.style.color = bare ? '#231702' : 'var(--ink)';
  });
  bareBtn.textContent = '⛶';
  bareBtn.title = L.s('지도만 보기', 'Map only');
  document.body.appendChild(bareBtn);
  const st = document.createElement('style');
  st.textContent =
    '#bareBtn{position:fixed;right:12px;bottom:14px;z-index:45;width:38px;height:38px;' +
    'border-radius:12px;border:1px solid var(--line);background:var(--panel);' +
    'color:var(--ink);font:16px/1 inherit;cursor:pointer;' +
    'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}' +
    'body.bare #top,body.bare #dock,body.bare #panel,body.bare .toast,' +
    'body.bare #joy,body.bare #travel,body.bare #eyeh{display:none}' +
    '@media (max-width:560px){#bareBtn{right:10px;bottom:10px}}';
  document.head.appendChild(st);
}

const toastCSS = document.createElement('style');
toastCSS.textContent =
  '.toast{position:fixed;left:50%;top:112px;transform:translateX(-50%);z-index:40;' +
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
  '.jrn{cursor:pointer} .jrn:hover h3{color:var(--gold)}' +
  'a.ref{text-decoration:none;border-bottom:1px dotted rgba(253,204,97,.5)}' +
  'a.ref:hover{border-bottom-style:solid;color:#ffe0a0}' +
  '.lrow{padding:11px 2px;cursor:pointer;display:flex;align-items:flex-start;gap:10px;border-bottom:1px solid rgba(255,255,255,.07)}' +
  '.lrow i{font-style:normal;color:rgba(255,255,255,.3);font-size:13px;width:13px;padding-top:1px}' +
  '.lrow.on i{color:var(--gold)}' +
  '.lrow span{display:flex;flex-direction:column;gap:2px;font:400 12px/1.4 inherit;color:rgba(255,255,255,.5)}' +
  '.lrow b{font:600 14px/1.3 inherit;color:rgba(255,255,255,.55);display:flex;align-items:baseline;gap:7px}' +
  '.lrow.on b{color:var(--ink)}' +
  '.lrow u{text-decoration:none;font:400 11px/1 ui-monospace,monospace;color:#8d867a}' +
  '.lrow:hover b{color:var(--gold)}' +
  '.hit.sentence{background:rgba(253,204,97,.10)}' +
  '.hit.sentence b{color:var(--gold)}';
document.head.appendChild(routeCSS);

// ── 돌리기 ────────────────────────────────────────────────
let fpvT = 0;
function tick() {
  requestAnimationFrame(tick);
  syncDrapeDepth();
  stepKeys();
  if (flyAnim) { const n = performance.now(); stepFly(flyT ? Math.min(120, n - flyT) : 16); flyT = n; }
  if (fpv) { const n = performance.now(); stepFpv(fpvT ? Math.min(120, n - fpvT) : 16); fpvT = n; }
  else fpvT = 0;
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

    // 고른 화질의 그림이 아직 안 올라가 있으면 본이름으로 물러선다 —
    // 그림 한 장 없다고 지도가 통째로 안 뜨면 안 된다.
    const texC = await loadTexture(qualFile(canaan.file, canaan))
      .catch(() => loadTexture(canaan.file));
    say(L.s('가나안 지형', 'Canaan terrain'), 65);
    baseCanaan = makeTerrain(canaan, 600, 680, texC);
    canaanTex = texC; canaanTile = canaan;
    hTexA = texC; hBoundA = tileBounds(canaan);
    scene.add(baseCanaan);
    const canaanClip = tileRect(canaan, SEAM_KM);

    addLakes();
    syncAreas();
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
      // 여기부터는 무거운 일이 줄줄이 이어진다. 예전에는 이것을 **한 판에**
      // 몰아 했다 — 그래서 지도가 뜨자마자 1초 남짓 얼어붙었다. 이제 한 가지
      // 일을 마칠 때마다 한 판씩 쉬어 간다. 하는 일도, 나오는 그림도 같다.
      inSteps([
      // 길을 땅에 붙이려면 땅 높이를 촘촘히 알아야 한다. 600×680(550 m)로는
      // 능선에서 길이 파묻히거나 떠올랐다.
      next => buildGridAsync(canaan, texC.image, 1500, 1700, next),
      next => { applyCam(); next(); },
      next => buildMoist(next),   // 땅빛은 젖은 정도로 칠한다 — 격자가 있어야 굽는다
      next => { addRivers(); next(); },   // 강은 땅 높이를 알아야 얹을 수 있다
      next => { toggleRoads(); applyCam(); next(); },  // 옛길은 앱처럼 처음부터
      next => { next();

      loadTexture(qualFile(region.file, region))
      .catch(() => loadTexture(region.file))
      .then(texR => {
        // 3280×1760 짜리 그림을 420×240 으로 세우면 여덟 칸에 꼭짓점 하나다.
      // 가나안 밖이 유독 뭉개져 보이던 까닭이 그것이다. 그림만큼 세운다.
      hTexB = texR; hBoundB = tileBounds(region);
      const m = makeTerrain(region, 1000, 540, texR, canaanClip);
        m.renderOrder = -1;
        worldMesh = m; worldClips = [canaanClip];
        applyWorldClips();
        scene.add(m);
        buildGridAsync(region, texR.image, 420, 240, () => {
          applyCam();                   // 가나안 밖 지명도 땅 위로 올라온다
          setTimeout(warmGrids, 1200);  // 마지막으로, 조각 판의 격자를 미리
        });
      }).catch(e => console.warn('넓은 세계를 못 불러왔습니다', e));
      }]);
    }, 80);

  } catch (e) {
    die(L.s('여는 중에 막혔습니다', 'Could not open'), e);
  }
})();
