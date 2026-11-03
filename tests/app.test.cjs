// 앱 동작 시험 — runs the real app (index.html's script) in a simulated browser (jsdom) and
// walks through what a child/parent does. node tests/app.test.cjs   (npm install first)
const { JSDOM } = require('jsdom');
const { appScript } = require('./lib/app-source.cjs');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/',
});
const w = dom.window;
const doc = w.document;
const errors = [];
w.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
w.console.error = (...a) => errors.push(a.join(' '));

// ---- browser features jsdom doesn't have
const spoken = []; // { text, lang }
w.speechSynthesis = {
  speaking: false, pending: false, cancel() {}, resume() {}, addEventListener() {},
  getVoices: () => [{ name: 'Yuna', voiceURI: 'yuna', lang: 'ko-KR', localService: true },
    { name: 'Eddy (한국어)', voiceURI: 'eddy', lang: 'ko-KR' }, { name: 'Samantha', voiceURI: 'sam', lang: 'en-US' }],
  speak(u) { if (u.text.trim()) spoken.push({ text: u.text, lang: u.lang }); },
};
w.SpeechSynthesisUtterance = function (t) { this.text = t; };
let confetti = 0;
w.confetti = () => { confetti++; };
w.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() { this.cb([{ contentRect: { width: 900, height: 760 } }]); } disconnect() {} };
const ctx = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
w.HTMLCanvasElement.prototype.getContext = function () { return this._ctx || (this._ctx = ctx()); };
w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500, right: 500, bottom: 500 });
w.URL.createObjectURL = () => 'blob:x';
w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
w.HTMLMediaElement.prototype.pause = function () {};

// ---- the libraries the page loads from CDNs
for (const [k, v] of Object.entries({ window: w, document: doc, navigator: w.navigator, HTMLElement: w.HTMLElement, Node: w.Node, Event: w.Event, requestAnimationFrame: w.requestAnimationFrame })) {
  try { global[k] = v; } catch (e) { /* read-only in this Node version (e.g. navigator) — React doesn't need it */ }
}
w.React = require('react');
w.react = w.React;
w.ReactDOM = Object.assign({}, require('react-dom'), { createRoot: require('react-dom/client').createRoot });
w.htm = require('htm');
w.LucideReact = require('lucide-react');

// stars saved before profiles existed → must move into the first profile
w.localStorage.setItem('monggeul.progress', JSON.stringify({ 'j:ㄷ': 4, 'n:3': 2 }));
w.eval(appScript());

// ---- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $$ = (sel) => [...doc.querySelectorAll(sel)];
const btn = (text, root = '') => $$(`${root} button`).find((b) => b.textContent.replace(/\s+/g, ' ').includes(text));
const byLabel = (label) => $$('button').find((b) => (b.getAttribute('aria-label') || '').startsWith(label));
const tab = (name) => $$('nav.tabs [role=tab]').find((b) => b.textContent.includes(name));
const card = (name) => $$('.fixed.scroll-y button').find((b) => b.textContent.includes(name));
const glyph = () => doc.querySelector('.glyph-box').textContent.trim();
const said = () => spoken.map((x) => x.text);
const box = ([x0, y0, x1, y1], strokes) => strokes.map((s) => s.map(([x, y]) => [x0 + x * (x1 - x0), y0 + y * (y1 - y0)]));
const C_BOX = [0.22, 0.22, 0.78, 0.78];
function draw(polys, type = 'pen') {
  const pad = doc.querySelector('.pad');
  polys.forEach((poly, si) => {
    const fire = (t, p) => pad.dispatchEvent(Object.assign(new w.Event(t, { bubbles: true, cancelable: true }),
      { pointerId: 10 + si, pointerType: type, button: 0, clientX: p[0] * 500, clientY: p[1] * 500 }));
    fire('pointerdown', poly[0]);
    for (let i = 1; i < poly.length; i++) {
      const [a, b] = [poly[i - 1], poly[i]];
      for (let k = 1; k <= 30; k++) fire('pointermove', [a[0] + ((b[0] - a[0]) * k) / 30, a[1] + ((b[1] - a[1]) * k) / 30]);
    }
    fire('pointerup', poly[poly.length - 1]);
  });
}
const penTap = (el, cancel = false) => {
  doc.elementFromPoint = () => el;
  const fire = (t) => el.dispatchEvent(Object.assign(new w.Event(t, { bubbles: true, cancelable: true }), { pointerId: 99, pointerType: 'pen', clientX: 10, clientY: 10, button: 0 }));
  fire('pointerdown');
  fire(cancel ? 'pointercancel' : 'pointerup');
};
const hold = async (el, ms) => {
  const fire = (t) => el.dispatchEvent(Object.assign(new w.Event(t, { bubbles: true, cancelable: true }), { pointerId: 7, pointerType: 'touch' }));
  fire('pointerdown'); await sleep(ms); fire('pointerup'); await sleep(50);
};
const stars = (id = 'p1') => JSON.parse(w.localStorage.getItem('monggeul.progress.' + id) || '{}');

let checks = 0;
const failures = [];
function expect(name, ok, detail = '') { checks++; if (!ok) failures.push(`${name}${detail !== '' ? '  → ' + detail : ''}`); }

(async () => {
  await sleep(80);
  // ---- 시작 화면
  expect('start screen shows 한글·숫자·영어·선 긋기', ['한글', '숫자', '영어', '선 긋기'].every((n) => card(n)), $$('.fixed.scroll-y button').map((b) => b.textContent).join('|'));
  expect('old stars moved into profile "우리 아이"', stars()['j:ㄷ'] === 4 && stars()['n:3'] === 2, JSON.stringify(stars()));
  card('한글').click(); await sleep(100);
  expect('한글 tabs = 자음·모음·낱말·무한 반복', $$('nav.tabs [role=tab]').map((b) => b.textContent.trim()).join(',') === 'ㄱ자음,ㅏ모음,가낱말,무한 반복', $$('nav.tabs [role=tab]').map((b) => b.textContent.trim()).join(','));
  expect('says "한글 써 볼까?" then the first letter', said().slice(-4).join(' ') === '한글 써 볼까? 기역! 기차의 기!', said().slice(-4).join(' '));

  // ---- 따라 쓰기: ㄱ traced → 참 잘했어요
  draw(box(C_BOX, [[[0.08, 0.12], [0.9, 0.12], [0.9, 0.94]]]));
  await sleep(60);
  expect('ㄱ traced → star stamp + confetti', !!doc.querySelector('.stamp') && confetti === 1);
  expect('ㄱ traced → 다 했어요 disabled until next', btn('다 했어요', '.controls').disabled);

  // ---- stray line + correct ㄴ → NOT passed; 다 했어요 explains
  byLabel('다음').click(); await sleep(80);
  expect('다음 → ㄴ', glyph() === 'ㄴ', glyph());
  draw([[[0.05, 0.92], [0.3, 0.97]]]);
  draw(box(C_BOX, [[[0.12, 0.06], [0.12, 0.9], [0.94, 0.9]]]));
  await sleep(60);
  expect('stray line + correct ㄴ → no stamp', !btn('다 했어요', '.controls').disabled);
  btn('다 했어요', '.controls').click(); await sleep(30);
  expect('다 했어요 says why (선 밖)', said().slice(-1)[0] === '선 밖에 그은 곳이 있어요. 다시 써 볼까?', said().slice(-1)[0]);

  // ---- ㄷ with a stroke missing → 다 했어요 says a stroke is missing
  btn('다시 쓰기').click(); await sleep(500);
  byLabel('다음').click(); await sleep(80);
  draw(box(C_BOX, [[[0.12, 0.1], [0.9, 0.1]]])); // only stroke 1 of ㄷ
  btn('다 했어요', '.controls').click(); await sleep(30);
  expect('ㄷ missing a stroke → "아직 안 쓴 획"', said().slice(-1)[0] === '아직 안 쓴 획이 있어요. 마저 써 볼까?', said().slice(-1)[0]);

  // ---- 펜슬 전용 모드: after the Pencil was used, fingers/palms don't draw
  expect('Pencil-only toast shown', doc.body.textContent.includes('펜슬 전용 모드가 켜졌어요'));
  btn('다시 쓰기').click(); await sleep(500);
  draw(box(C_BOX, [[[0.12, 0.1], [0.9, 0.1]], [[0.12, 0.1], [0.12, 0.9], [0.94, 0.9]]]), 'touch');
  await sleep(60);
  expect('finger/palm ignored in Pencil-only mode', !btn('다 했어요', '.controls').disabled);
  draw(box(C_BOX, [[[0.12, 0.1], [0.9, 0.1]], [[0.12, 0.1], [0.12, 0.9], [0.94, 0.9]]]), 'pen');
  await sleep(60);
  expect('same ㄷ with the Pencil passes', btn('다 했어요', '.controls').disabled);

  // ---- Apple Pencil taps on buttons (iPadOS often sends no click)
  let g0 = glyph();
  penTap(byLabel('다음')); await sleep(60);
  expect('Pencil tap on 다음 (no click event) moves on', glyph() !== g0, `${g0} → ${glyph()}`);
  g0 = glyph();
  penTap(byLabel('다음'), true); await sleep(60);
  expect('Pencil tap cancelled by the system still counts', glyph() !== g0, `${g0} → ${glyph()}`);
  g0 = glyph();
  const nb = byLabel('다음');
  penTap(nb); nb.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(60);
  const step = (a, b) => 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'.indexOf(b) - 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'.indexOf(a);
  expect('Pencil tap + late native click = exactly one step', step(g0, glyph()) === 1, `${g0} → ${glyph()}`);

  // ---- 낱말: themes, split prompt
  tab('낱말').click(); await sleep(80);
  expect('낱말 has 5 theme buttons', $$('[aria-label="낱말 주제"] button').length === 5);
  $$('[aria-label="낱말 주제"] button').find((b) => b.getAttribute('aria-label') === '음식').click(); await sleep(80);
  $$('.scroll-x button').find((b) => b.textContent.includes('우유')).click(); await sleep(80);
  expect('우유 → "우유! … 우유의 … 우!" (spoken in parts)', said().slice(-3).join('|') === '우유!|우유의|우!', said().slice(-3).join('|'));
  $$('[aria-label="낱말 주제"] button').find((b) => b.getAttribute('aria-label') === '동물').click(); await sleep(80);
  $$('.scroll-x button').find((b) => b.textContent.trim().endsWith('소')).click(); await sleep(80);
  expect('one-letter word 소 → "소! … 같이 써 볼까?"', said().slice(-2).join('|') === '소!|같이 써 볼까?', said().slice(-2).join('|'));

  // ---- 무한 반복 + 칸 도우미 OFF (free writing)
  tab('무한 반복').click(); await sleep(80);
  btn('칸 도우미').click(); await sleep(60);
  expect('칸 도우미 toggles OFF', btn('칸 도우미').textContent.includes('OFF'));
  draw(box([0.5, 0.5, 0.8, 0.8], [[[0.08, 0.12], [0.9, 0.12], [0.9, 0.94]]]));
  await sleep(60);
  expect('free writing: small ㄱ in a corner counts', /⭐ × 1/.test(doc.querySelector('.counter').textContent), doc.querySelector('.counter').textContent);
  await sleep(2000);
  expect('repeat practice clears itself for the next try', !btn('다 했어요', '.controls').disabled);

  // ---- 설정: profiles, voice, speed, reset
  byLabel('설정').click(); await sleep(120);
  btn('새 친구 추가').click(); await sleep(60);
  expect('profile added', $$('input[type=text]').map((i) => i.value).join(',') === '우리 아이,친구 2', $$('input[type=text]').map((i) => i.value).join(','));
  $$('button').find((b) => b.textContent.trim().startsWith('Eddy')).click(); await sleep(40);
  const range = doc.querySelector('input[type=range]');
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(range, '0.6');
  range.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(40);
  const prefs = JSON.parse(w.localStorage.getItem('monggeul.prefs'));
  expect('voice + speed saved', prefs.voice === 'eddy' && prefs.rate === 0.6, JSON.stringify(prefs));
  const before = stars();
  await hold(btn('별 모두 지우기'), 1000);
  expect('1 s hold does NOT delete stars', JSON.stringify(stars()) === JSON.stringify(before));
  await hold($$('.fixed button').find((b) => b.textContent.trim().startsWith('숫자')), 3300);
  expect('3 s hold on 숫자 deletes only number stars', !Object.keys(stars()).some((k) => k.startsWith('n:')) && stars()['j:ㄷ'] >= 4, JSON.stringify(stars()));
  byLabel('닫기').click(); await sleep(60);
  $$('header button').find((b) => (b.getAttribute('aria-label') || '').includes('모은 별')).click(); await sleep(60);
  btn('친구 2').click(); await sleep(100);
  expect('switch profile via header (친구 2 has 0 stars)', $$('header button').find((b) => (b.getAttribute('aria-label') || '').includes('모은 별')).textContent.includes('0'));

  // ---- 🏠 → 영어
  byLabel('처음으로').click(); await sleep(80);
  expect('🏠 returns to the start screen', !!card('영어'));
  card('영어').click(); await sleep(120);
  expect('영어 tabs = 대문자·소문자·단어·무한 반복', $$('nav.tabs [role=tab]').map((b) => b.textContent.trim()).join(',') === 'A대문자,a소문자,단어,무한 반복', $$('nav.tabs [role=tab]').map((b) => b.textContent.trim()).join(','));
  const last4 = spoken.slice(-4);
  expect('says "영어 써 볼까? … 대문자 … Ay! … apple!"', last4.map((x) => x.text).join('|') === '영어 써 볼까?|대문자|Ay!|apple!', last4.map((x) => x.text).join('|'));
  expect('English parts use an English voice', last4[2].lang === 'en-US' && last4[3].lang === 'en-US' && last4[1].lang === 'ko-KR', last4.map((x) => x.lang).join(','));
  expect('26 capital letters', $$('.scroll-x button').length === 26, $$('.scroll-x button').length);
  tab('단어').click(); await sleep(80);
  expect('32 English words', $$('.scroll-x button').length === 32, $$('.scroll-x button').length);

  byLabel('처음으로').click(); await sleep(80);
  card('숫자').click(); await sleep(120);
  expect('숫자 → 20 numbers', $$('.scroll-x button').length === 20, $$('.scroll-x button').length);

  // ----
  const realErrors = errors.filter((e) => !/Not implemented: HTMLCanvasElement|Not implemented: window.scrollTo/.test(e));
  expect('no runtime errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  console.log(`앱 동작 시험: ${checks}건 중 ${checks - failures.length}건 통과`);
  if (failures.length) { console.log('\n❌ 실패:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('✅ 앱 동작 시험 모두 통과');
  process.exit(0);
})().catch((e) => { console.log('❌ 시험 중단:', e && e.stack ? e.stack : e, errors.slice(0, 3)); process.exit(1); });
