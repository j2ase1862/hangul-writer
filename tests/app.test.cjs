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
  // nothing starts by itself: the child picks a letter first
  expect('entering 한글: nothing picked, asks to choose', said().slice(-2).join('|') === '한글 써 볼까?|써 보고 싶은 글자를 골라 볼까?', said().slice(-2).join('|'));
  expect('no chip is selected', !$$('.scroll-x button').some((b) => b.className.includes('border-orange-400')));
  expect('paper says "위에서 글자를 골라 볼까요?" and 다 했어요 is off', doc.querySelector('.board-area').textContent.includes('골라 볼까요') && btn('다 했어요', '.controls').disabled);
  draw(box(C_BOX, [[[0.08, 0.12], [0.9, 0.12], [0.9, 0.94]]]));
  await sleep(60);
  expect('drawing before picking does nothing', !doc.querySelector('.stamp') && confetti === 0);
  $$('.scroll-x button').find((b) => b.textContent.trim() === 'ㄱ').click(); await sleep(100);
  expect('picking ㄱ says the letter', said().slice(-3).join(' ') === '기역! 기차의 기!', said().slice(-3).join(' '));

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
  expect('무한 반복 also starts with nothing picked', !doc.querySelector('.counter') || btn('다 했어요', '.controls').disabled);
  $$('.scroll-x button').find((b) => b.getAttribute('aria-label') === '기역').click(); await sleep(80);
  btn('칸 도우미').click(); await sleep(60);
  expect('칸 도우미 toggles OFF', btn('칸 도우미').textContent.includes('OFF'));
  draw(box([0.5, 0.5, 0.8, 0.8], [[[0.08, 0.12], [0.9, 0.12], [0.9, 0.94]]]));
  await sleep(60);
  expect('free writing: small ㄱ in a corner counts', /⭐ × 1/.test(doc.querySelector('.counter').textContent), doc.querySelector('.counter').textContent);
  await sleep(2000);
  expect('repeat practice clears itself for the next try', !btn('다 했어요', '.controls').disabled);
  // no guide: ㅇ written for ㅁ (even in three pieces) is not praised — a real ㅁ is
  $$('.scroll-x button').find((b) => b.getAttribute('aria-label') === '미음').click(); await sleep(80);
  const ring = Array.from({ length: 25 }, (_, i) => { const a = -Math.PI / 2 - (i / 24) * Math.PI * 2; return [0.5 + 0.2 * Math.cos(a), 0.5 + 0.2 * Math.sin(a)]; });
  const stars0 = doc.querySelector('.counter').textContent;
  draw([ring.slice(0, 9), ring.slice(8, 17), ring.slice(16)]);
  await sleep(60);
  expect('free writing: ㅇ (3 pieces) for ㅁ is not counted', doc.querySelector('.counter').textContent === stars0 && !btn('다 했어요', '.controls').disabled, doc.querySelector('.counter').textContent);
  btn('다 했어요', '.controls').click(); await sleep(30);
  expect('다 했어요 → "조금 다른 모양이에요"', said().slice(-1)[0] === '음, 조금 다른 모양이에요. 다시 써 볼까?', said().slice(-1)[0]);
  btn('다시 쓰기').click(); await sleep(500);
  draw(box([0.3, 0.3, 0.7, 0.7], [[[0, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 1], [1, 1]]]));
  await sleep(60);
  expect('free writing: a real ㅁ is counted', doc.querySelector('.counter').textContent !== stars0, doc.querySelector('.counter').textContent);
  await sleep(2000);
  // 다시 쓰기 says something different each time (never the same line twice in a row)
  const retries = [];
  for (let i = 0; i < 6; i++) { btn('다시 쓰기').click(); await sleep(120); retries.push(said().slice(-1)[0]); }
  expect('다시 쓰기: never the same line twice in a row', retries.every((t, i) => i === 0 || t !== retries[i - 1]), retries.join(' | '));
  expect('다시 쓰기: several different lines', new Set(retries).size >= 3, retries.join(' | '));

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

  // ---- 단계별 연습 (친구 2 has no medals yet): 3 wins → 🥉 → stage 2 (점선) → 3 wins → 🥈 → stage 3 (혼자)
  tab('자음').click(); await sleep(80);
  $$('.scroll-x button').find((b) => b.textContent.trim() === 'ㅋ').click(); await sleep(120);
  const chips = () => $$('.stage-chip');
  const stageNow = () => chips().findIndex((c) => c.getAttribute('aria-pressed') === 'true') + 1;
  expect('new letter starts at stage 1 (🥉 따라 쓰기)', stageNow() === 1, stageNow());
  expect('stages 2 and 3 are locked at first', chips()[1].className.includes('locked') && chips()[2].className.includes('locked'));
  chips()[2].click(); await sleep(40);
  expect('tapping a locked stage keeps stage 1 and explains', stageNow() === 1 && doc.body.textContent.includes('🔒'));
  const K = box(C_BOX, [[[0.08, 0.1], [0.9, 0.1], [0.9, 0.94]], [[0.1, 0.5], [0.9, 0.5]]]);
  // win(): trace ㅋ; then (unless it's the medal win) press 다시 쓰기 for the next try
  const win = async (thenRefresh = true) => { draw(K); await sleep(80); const ok = btn('다 했어요', '.controls').disabled; if (thenRefresh) { btn('다시 쓰기').click(); await sleep(600); } return ok; };
  expect('stage 1: three wins', (await win()) && (await win()) && (await win(false)));
  await sleep(900);
  expect('3rd win → 🥉 동메달 + "이번엔 점선만 보고 써 볼까?"', said().slice(-2).join('|') === '동메달!|이번엔 점선만 보고 써 볼까?', said().slice(-2).join('|'));
  expect('during the celebration the paper stays on stage 1', stageNow() === 1, stageNow());
  await sleep(3000);
  expect('then moves on to stage 2 (🥈 점선) by itself', stageNow() === 2 && !btn('다 했어요', '.controls').disabled, stageNow());
  expect('stage 2 still judges position: tracing ㅋ passes', await win());
  expect('stage 2: two more wins', (await win()) && (await win(false)));
  btn('다시 쓰기').click(); await sleep(100); // child taps 다시 쓰기 during the 은메달 celebration
  expect('다시 쓰기 during the celebration goes straight to stage 3 (🥇 혼자 쓰기)', stageNow() === 3 && said().slice(-1)[0] === '이번엔 혼자서 써 볼까?', `${stageNow()} / ${said().slice(-1)[0]}`);
  await sleep(500);
  draw(box([0.55, 0.55, 0.85, 0.85], [[[0.08, 0.1], [0.9, 0.1], [0.9, 0.94]], [[0.1, 0.5], [0.9, 0.5]]]));
  await sleep(80);
  expect('stage 3 judges shape only: a small ㅋ in the corner passes', btn('다 했어요', '.controls').disabled);
  const kChip = () => $$('.scroll-x button').find((b) => b.getAttribute('aria-label') === '키읔');
  expect('the ㅋ chip shows its 🥈 medal', kChip().textContent.includes('🥈'), kChip().textContent);
  expect('medals saved per child', JSON.stringify(JSON.parse(w.localStorage.getItem('monggeul.levels.' + w.localStorage.getItem('monggeul.activeProfile').replace(/"/g, '')))['j:ㅋ']) === '[3,3,1]');
  byLabel('설정').click(); await sleep(120);
  await hold($$('.fixed button').find((b) => b.textContent.trim().startsWith('자음')), 3300);
  byLabel('닫기').click(); await sleep(80);
  expect('별·메달 지우기 (자음) also removes the ㅋ medal', !kChip().textContent.includes('🥈'), kChip().textContent);

  // ---- 🏠 → 영어
  byLabel('처음으로').click(); await sleep(80);
  expect('🏠 returns to the start screen', !!card('영어'));
  card('영어').click(); await sleep(120);
  expect('영어 tabs = 대문자·소문자·단어·무한 반복', $$('nav.tabs [role=tab]').map((b) => b.textContent.trim()).join(',') === 'A대문자,a소문자,단어,무한 반복', $$('nav.tabs [role=tab]').map((b) => b.textContent.trim()).join(','));
  expect('entering 영어 asks to choose', said().slice(-2).join('|') === '영어 써 볼까?|써 보고 싶은 글자를 골라 볼까?', said().slice(-2).join('|'));
  $$('.scroll-x button').find((b) => b.textContent.trim() === 'A').click(); await sleep(100);
  const last3 = spoken.slice(-3);
  expect('picking A says "대문자 … Ay! … apple!"', last3.map((x) => x.text).join('|') === '대문자|Ay!|apple!', last3.map((x) => x.text).join('|'));
  expect('English parts use an English voice', last3[1].lang === 'en-US' && last3[2].lang === 'en-US' && last3[0].lang === 'ko-KR', last3.map((x) => x.lang).join(','));
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
