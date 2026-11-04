// 따라 쓰기 판정 시험 — runs the app's real evaluate() against simulated handwriting.
//   node tests/recognition.test.cjs
// Fails (exit 1) if an honest attempt is rejected, or a wrong one (stray line / missing stroke /
// strokes merged where not allowed / missing i·j dot) is accepted.
const { loadRecognizer } = require('./lib/app-source.cjs');
const { rng, trace, child, freeHand, SHAKINESS, pathLen } = require('./lib/handwriting.cjs');

const { evaluate, ITEMS, SYLLABLES, rivalsOf } = loadRecognizer();
const opt = (it, extra = {}) => ({ allowJoined: !!it.allowJoined, ...extra });

let checks = 0;
const failures = [];
function expect(name, ok, detail = '') {
  checks++;
  if (!ok) failures.push(`${name}${detail ? '  → ' + detail : ''}`);
}
const result = (r) => (r.pass ? 'pass' : `fail(${r.reason})`);

// ---------------------------------------------------------------------------------------------
// 1. Every item, written neatly / shakily / very shakily, must pass (auto check and 다 했어요)
// ---------------------------------------------------------------------------------------------
const groups = [
  ['한글·숫자·선', 'big', [...ITEMS.lines, ...ITEMS.consonants, ...ITEMS.vowels, ...ITEMS.numbers, ...SYLLABLES]],
  ['영어', 'english', [...ITEMS.upper, ...ITEMS.lower, ...ITEMS.ewords]],
];
for (const [group, scale, items] of groups) {
  for (const [level, prm] of Object.entries(SHAKINESS[scale])) {
    const rand = rng(level.length * 11 + items.length);
    for (const it of items) {
      const user = it.strokes.map((s) => child(s, rand, prm));
      const auto = evaluate(it.strokes, user, opt(it));
      const done = evaluate(it.strokes, user, opt(it, { lenient: true }));
      expect(`[${group}] ${level} "${it.glyph || it.name}" auto check passes`, auto.pass, result(auto));
      expect(`[${group}] ${level} "${it.glyph || it.name}" 다 했어요 passes`, done.pass, result(done));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Wrong attempts must fail — for every multi-stroke item
// ---------------------------------------------------------------------------------------------
const rand = rng(99);
const allItems = [...ITEMS.lines, ...ITEMS.consonants, ...ITEMS.vowels, ...ITEMS.numbers, ...SYLLABLES,
  ...ITEMS.upper, ...ITEMS.lower, ...ITEMS.ewords];
// a stray line placed in whichever corner is farthest from this item's guide (really off the letter)
function strayFor(it) {
  const pts = [].concat(...it.strokes);
  const corners = [[[0.04, 0.92], [0.3, 0.97]], [[0.7, 0.92], [0.96, 0.97]], [[0.04, 0.03], [0.3, 0.08]], [[0.7, 0.03], [0.96, 0.08]]];
  const gap = ([a, b]) => Math.min(...pts.map((p) => Math.min(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(p[0] - b[0], p[1] - b[1]),
    Math.hypot(p[0] - (a[0] + b[0]) / 2, p[1] - (a[1] + b[1]) / 2))));
  const best = corners.reduce((x, y) => (gap(y) > gap(x) ? y : x));
  return trace(best, rand, 0.004);
}
for (const it of allItems) {
  const name = it.glyph || it.name;
  const all = it.strokes.map((s) => trace(s, rand, 0.008));
  for (const lenient of [false, true]) {
    const mode = lenient ? '다 했어요' : 'auto';
    // a stray line anywhere → never "참 잘했어요"
    const stray = evaluate(it.strokes, [strayFor(it), ...all], opt(it, { lenient }));
    expect(`"${name}" + stray line (${mode}) fails as stray`, !stray.pass && stray.reason === 'stray', result(stray));
    // each stroke missing in turn → must fail
    if (it.strokes.length > 1) {
      for (let k = 0; k < it.strokes.length; k++) {
        const r = evaluate(it.strokes, all.filter((_, i) => i !== k), opt(it, { lenient }));
        expect(`"${name}" without stroke ${k + 1} (${mode}) fails`, !r.pass, result(r));
      }
    }
  }
  // a stroke drawn in two pieces (pen lifted half-way) still counts
  if (pathLen(it.strokes[0]) > 0.1) {
    const p = all[0].pts, mid = Math.floor(p.length / 2);
    const r = evaluate(it.strokes, [{ pts: p.slice(0, mid + 1) }, { pts: p.slice(mid) }, ...all.slice(1)], opt(it, { lenient: true }));
    expect(`"${name}" with first stroke in two pieces passes`, r.pass, result(r));
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Joined strokes: not allowed in 한글/숫자, allowed in English (only with enough ink)
// ---------------------------------------------------------------------------------------------
const joinedOf = (it) => [{ pts: [].concat(...it.strokes.map((s) => trace(s, rand, 0.006).pts)) }];
for (const g of ['ㄷ', 'ㄹ', 'ㅂ', 'ㅎ', '4']) {
  const it = allItems.find((x) => x.glyph === g);
  const r = evaluate(it.strokes, joinedOf(it), opt(it, { lenient: true }));
  expect(`한글/숫자 "${g}" written as one line fails as joined`, !r.pass && r.reason === 'joined', result(r));
}
for (const g of ['a', 'd', 'q', 'k', 't', 'x', 'A', 'E']) {
  const it = ITEMS.lower.concat(ITEMS.upper).find((x) => x.glyph === g);
  const r = evaluate(it.strokes, joinedOf(it), opt(it, { lenient: true }));
  expect(`English "${g}" written in one go passes`, r.pass, result(r));
}
// a bare circle is an "o", not a joined "a"
{
  const a = ITEMS.lower.find((x) => x.glyph === 'a');
  const r = evaluate(a.strokes, [trace(a.strokes[0], rand, 0.006)], opt(a, { lenient: true }));
  expect('English "a" drawn as a circle only fails', !r.pass, result(r));
}

// ---------------------------------------------------------------------------------------------
// 4. i / j dots: must be there; a quick tap counts
// ---------------------------------------------------------------------------------------------
for (const it of [...ITEMS.lower, ...ITEMS.ewords].filter((x) => x.strokes.some((s) => pathLen(s) < 0.035))) {
  const dots = it.strokes.map((s, i) => (pathLen(s) < 0.035 ? i : -1)).filter((i) => i >= 0);
  const noDot = it.strokes.filter((_, i) => !dots.includes(i)).map((s) => trace(s, rand, 0.006));
  const tapped = it.strokes.map((s, i) => (dots.includes(i) ? { pts: [s[0], [s[0][0] + 0.002, s[0][1] + 0.001]] } : trace(s, rand, 0.006)));
  const r1 = evaluate(it.strokes, noDot, opt(it, { lenient: true }));
  const r2 = evaluate(it.strokes, tapped, opt(it, { lenient: true }));
  expect(`"${it.glyph}" without its dot fails`, !r1.pass, result(r1));
  expect(`"${it.glyph}" with a tapped dot passes`, r2.pass, result(r2));
}

// ---------------------------------------------------------------------------------------------
// 5. Free writing (칸 도우미 OFF): shape anywhere / any size
// ---------------------------------------------------------------------------------------------
{
  const it = ITEMS.consonants.find((x) => x.glyph === 'ㅂ');
  const small = it.strokes.map((s) => ({ pts: trace(s, rand, 0.006).pts.map(([x, y]) => [0.55 + x * 0.4, 0.55 + y * 0.4]) }));
  expect('free mode: small ㅂ in a corner passes', evaluate(it.strokes, small, { free: true }).pass);
  expect('free mode: ㅂ missing a stroke fails', !evaluate(it.strokes, small.slice(1), { free: true, lenient: true }).pass);
}

// ---------------------------------------------------------------------------------------------
// 6. 🥇 혼자 쓰기 (no guide): a look-alike letter is not praised (ㅇ written for ㅁ, 3 for 8…),
//    while honest free writing (any size, a bit squashed/tilted, strokes a little off) still passes
// ---------------------------------------------------------------------------------------------
{
  const r6 = rng(5);
  const free = (it, user, lenient = true) => evaluate(it.strokes, user, { free: true, lenient, allowJoined: !!it.allowJoined, rivals: rivalsOf(it) });
  const find = (g) => allItems.find((x) => (x.glyph || x.name) === g);
  const neat = (it) => freeHand(it.strokes, r6, SHAKINESS[it.kind === 'english' ? 'english' : 'big'].neat, 0.5);

  // the reported case: ㅇ for ㅁ — in one go, or in three pieces
  const m = find('ㅁ'), o = find('ㅇ');
  const circle = neat(o);
  const p = circle[0].pts, t = Math.floor(p.length / 3);
  const pieces = [{ pts: p.slice(0, t + 1) }, { pts: p.slice(t, 2 * t + 1) }, { pts: p.slice(2 * t) }];
  for (const lenient of [false, true]) {
    const mode = lenient ? '다 했어요' : 'auto';
    expect(`혼자 쓰기: ㅇ for ㅁ fails (${mode})`, !free(m, circle, lenient).pass, result(free(m, circle, lenient)));
    expect(`혼자 쓰기: ㅇ in 3 pieces for ㅁ fails (${mode})`, !free(m, pieces, lenient).pass, result(free(m, pieces, lenient)));
    const sq = neat(m);
    expect(`혼자 쓰기: ㅁ for ㅇ fails (${mode})`, !free(o, sq, lenient).pass, result(free(o, sq, lenient)));
  }
  for (const [want, wrote] of [['8', '3'], ['ㅈ', 'ㅅ'], ['ㅅ', 'ㅈ'], ['ㅓ', 'ㅕ'], ['ㅣ', 'ㅏ'], ['d', 'b'], ['o', 'c'], ['C', 'O'], ['ㄹ', 'ㅌ']]) {
    const r = free(find(want), neat(find(wrote)));
    expect(`혼자 쓰기: ${wrote} for ${want} fails`, !r.pass, result(r));
  }

  // every letter written for every other letter of its group (낱말 글자: every 4th, for time)
  const groups = [
    ['자모', [...ITEMS.consonants, ...ITEMS.vowels], 0],
    ['숫자', ITEMS.numbers.filter((x) => x.glyph.length === 1), 0],
    ['대문자', ITEMS.upper, 0],
    ['소문자', ITEMS.lower, 5],     // a few rare ones remain (l ← i: a dot is tiny; o ← a)
    ['낱말 글자', SYLLABLES.filter((_, i) => i % 4 === 0), 2],
  ];
  for (const [name, items, allowed] of groups) {
    const wrong = [];
    for (const target of items) for (const drawn of items) {
      if (drawn !== target && free(target, neat(drawn)).pass) wrong.push(`${target.glyph}←${drawn.glyph}`);
    }
    expect(`혼자 쓰기 [${name}]: other letters accepted ≤ ${allowed}`, wrong.length <= allowed, `${wrong.length}: ${wrong.slice(0, 12).join(' ')}`);
    // honest writing (neat / shaky, normal misplacement) that the shape check accepts must not be
    // turned down by the look-alike comparison
    const scale = name.endsWith('문자') ? 'english' : 'big';
    const lost = [];
    let n = 0;
    for (const level of ['neat', 'shaky']) for (const it of items) for (let rep = 0; rep < 2; rep++) {
      const user = freeHand(it.strokes, r6, SHAKINESS[scale][level], 1);
      if (!evaluate(it.strokes, user, { free: true, lenient: true, allowJoined: !!it.allowJoined }).pass) continue;
      n++;
      if (!free(it, user).pass) lost.push(`${it.glyph}(${level})`);
    }
    expect(`혼자 쓰기 [${name}]: honest writing still passes (≥ 97%)`, lost.length <= n * 0.03, `${lost.length}/${n}: ${lost.slice(0, 12).join(' ')}`);
  }
}

// ---------------------------------------------------------------------------------------------
console.log(`판정 시험: ${checks}건 중 ${checks - failures.length}건 통과`);
if (failures.length) {
  console.log(`\n❌ ${failures.length}건 실패:\n  ` + failures.slice(0, 40).join('\n  ') + (failures.length > 40 ? `\n  … 외 ${failures.length - 40}건` : ''));
  process.exit(1);
}
console.log('✅ 판정 시험 모두 통과');
