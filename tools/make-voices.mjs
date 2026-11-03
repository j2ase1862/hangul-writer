#!/usr/bin/env node
// 몽글몽글 따라 쓰기 — make natural AI voice files with Google Cloud Text-to-Speech.
//
// The app speaks a fixed set of sentences. This script reads them straight out of index.html
// (the block between @@VOICE-DATA-START / @@VOICE-DATA-END), asks Google TTS to say each one,
// and saves audio/<id>.mp3 + audio/manifest.json. The app plays these files and falls back to the
// device voice for anything missing. No npm packages needed (Node 18+).
//
// Usage (PowerShell, from the project folder):
//   $env:GOOGLE_TTS_API_KEY = "your-key"        # set for this terminal only — never commit the key
//   node tools/make-voices.mjs voices             # list Korean voices
//   node tools/make-voices.mjs samples            # audio-samples/*.mp3 — listen and pick a voice
//   node tools/make-voices.mjs samples Chirp3     #   (only voices whose name contains "Chirp3")
//   node tools/make-voices.mjs build ko-KR-Chirp3-HD-Leda          # make all app voice files
//   node tools/make-voices.mjs build ko-KR-Chirp3-HD-Leda --rate 0.9
//
// Re-running build only makes files for new/changed sentences (unless the voice or rate changed).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO = path.join(ROOT, 'audio');
const SAMPLES = path.join(ROOT, 'audio-samples');
const API = 'https://texttospeech.googleapis.com/v1';
const KEY = process.env.GOOGLE_TTS_API_KEY;
const SAMPLE_TEXT = '안녕! 나랑 같이 한글 써 볼까? 기역! 기차의, 기! 우와, 참 잘했어요!';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error('\n❌ ' + msg + '\n');
  process.exit(1);
}

function needKey() {
  if (!KEY) {
    fail('GOOGLE_TTS_API_KEY 환경 변수가 없어요.\n   PowerShell에서 먼저 실행하세요:  $env:GOOGLE_TTS_API_KEY = "발급받은-키"');
  }
}

// Evaluate the app's pure data block to get the exact sentences + the same file-name function.
function loadPhrases() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/\/\* @@VOICE-DATA-START[^*]*\*\/([\s\S]*?)\/\* @@VOICE-DATA-END \*\//);
  if (!m) fail('index.html 안에서 문장 데이터 구간(@@VOICE-DATA-START/END)을 찾지 못했어요.');
  // eslint-disable-next-line no-new-func
  return new Function(m[1] + '\nreturn { phrases: buildPhrases(), phraseId };')();
}

// What we send to Google: drop the quote marks used for emphasis ("사자의, '사'!").
const forTts = (text) => text.replace(/['"]/g, '');

async function api(pathname, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(API + pathname, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, ...(init.headers || {}) },
    });
    if (r.ok) return r.json();
    const body = await r.text();
    // 429 = per-minute quota. Wait it out (Retry-After if given, else 15s, 30s, … up to ~2 min).
    if (r.status === 429 && attempt < 7) {
      const wait = Number(r.headers.get('retry-after')) * 1000 || Math.min(15000 * attempt, 120000);
      process.stdout.write(`\n  ⏳ 요청이 많아 ${Math.round(wait / 1000)}초 쉬었다가 다시 해요…`);
      await sleep(wait);
      continue;
    }
    if (r.status >= 500 && attempt < 5) { await sleep(2000 * attempt); continue; }
    const err = new Error(`Google TTS 오류 ${r.status}: ${body.slice(0, 400)}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
}

let rateUnsupportedWarned = false;
async function synthesize(text, voice, rate) {
  const req = (withRate) => api('/text:synthesize', {
    method: 'POST',
    body: JSON.stringify({
      input: { text: forTts(text) },
      voice: { languageCode: 'ko-KR', name: voice },
      audioConfig: { audioEncoding: 'MP3', ...(withRate && rate ? { speakingRate: rate } : {}) },
    }),
  });
  try {
    return Buffer.from((await req(true)).audioContent, 'base64');
  } catch (e) {
    // Some newer voice families may not accept speakingRate — retry at their natural speed.
    if (e.status === 400 && rate && /rate|pace|speaking/i.test(e.body || '')) {
      if (!rateUnsupportedWarned) { console.warn(`⚠️  ${voice}는 말 빠르기 설정을 지원하지 않아 기본 빠르기로 만들어요.`); rateUnsupportedWarned = true; }
      return Buffer.from((await req(false)).audioContent, 'base64');
    }
    throw e;
  }
}

// Google sometimes answers a lone syllable ("라!") with ~0.3s of silence (~1 KB). Real speech is
// always bigger, so treat tiny files as failures and retry the syllable written differently.
const MIN_BYTES = 1800;
async function synthesizeChecked(text, voice, rate) {
  const core = forTts(text).replace(/[!?.~,\s]/g, '');
  const variants = [text];
  if (core.length <= 2) variants.push(`${core}.`, core, `${core}~`, `${core}!!`, `${core}, `);
  for (const v of variants) {
    const mp3 = await synthesize(v, voice, rate);
    if (mp3.length >= MIN_BYTES) return mp3;
  }
  const err = new Error('소리가 비어 있는 파일만 돌아왔어요 (무음)');
  err.silent = true;
  throw err;
}

async function listVoices() {
  const { voices = [] } = await api('/voices?languageCode=ko-KR');
  return voices
    .filter((v) => (v.languageCodes || []).some((c) => c.toLowerCase() === 'ko-kr'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const family = (name) => (name.match(/ko-KR-([A-Za-z0-9]+(?:-HD)?)/) || [])[1] || '?';
const genderKo = (g) => ({ FEMALE: '여성', MALE: '남성', NEUTRAL: '중성' }[g] || '');

async function cmdVoices() {
  needKey();
  const voices = await listVoices();
  if (!voices.length) fail('한국어 목소리를 찾지 못했어요.');
  console.log(`\n한국어 목소리 ${voices.length}개 (Chirp3-HD > Neural2 > Wavenet > Standard 순으로 자연스러워요)\n`);
  for (const v of voices) console.log(`  ${v.name.padEnd(34)} ${family(v.name).padEnd(10)} ${genderKo(v.ssmlGender)}`);
  console.log('\n다음: node tools/make-voices.mjs samples   (들어 보고 고르기)\n');
}

async function cmdSamples(filter) {
  needKey();
  let voices = (await listVoices()).filter((v) => !/Standard/i.test(v.name)); // Standard = old robotic voices
  if (filter) voices = voices.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase()));
  if (!voices.length) fail('조건에 맞는 목소리가 없어요.');
  fs.mkdirSync(SAMPLES, { recursive: true });
  console.log(`\n샘플 ${voices.length}개를 만들어요: "${SAMPLE_TEXT}"\n`);
  for (const v of voices) {
    try {
      const mp3 = await synthesize(SAMPLE_TEXT, v.name, 0.9);
      fs.writeFileSync(path.join(SAMPLES, `${v.name}.mp3`), mp3);
      console.log(`  ✅ ${v.name}  (${genderKo(v.ssmlGender)})`);
    } catch (e) {
      console.log(`  ⚠️  ${v.name}: ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`\n📁 ${SAMPLES} 폴더의 mp3를 들어 보고 마음에 드는 목소리 이름으로:`);
  console.log('   node tools/make-voices.mjs build <목소리 이름>\n');
}

async function cmdBuild(voice, rate) {
  needKey();
  if (!voice) fail('목소리 이름을 적어 주세요. 예: node tools/make-voices.mjs build ko-KR-Chirp3-HD-Leda');
  const { phrases, phraseId } = loadPhrases();
  fs.mkdirSync(AUDIO, { recursive: true });
  const manifestPath = path.join(AUDIO, 'manifest.json');
  const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const sameVoice = old && old.voice === voice && old.rate === rate;

  const items = phrases.map((text) => ({ id: phraseId(text), text }));
  const ids = new Set(items.map((i) => i.id));
  if (ids.size !== items.length) fail('문장 파일 이름이 겹쳐요 (해시 충돌). 문장을 조금 바꿔 주세요.');

  // File names are hashes of the sentence, so an existing file already holds this exact sentence.
  // Keep it as long as the voice/rate are unchanged (also resumes a run that stopped part-way).
  const fileOk = (id) => { const f = path.join(AUDIO, id + '.mp3'); return fs.existsSync(f) && fs.statSync(f).size >= MIN_BYTES; };
  const todo = items.filter((i) => !(sameVoice && fileOk(i.id))); // tiny = silent → make again
  const chars = todo.reduce((a, i) => a + forTts(i.text).length, 0);
  console.log(`\n목소리 ${voice}${rate ? ` · 빠르기 ${rate}` : ''}`);
  console.log(`문장 ${items.length}개 중 새로 만들 것 ${todo.length}개 (약 ${chars}자)\n`);

  let done = 0, failed = 0;
  const silent = [];
  const queue = todo.slice();
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      try {
        fs.writeFileSync(path.join(AUDIO, it.id + '.mp3'), await synthesizeChecked(it.text, voice, rate));
        done++;
        process.stdout.write(`\r  ${done}/${todo.length} 만드는 중…`);
      } catch (e) {
        if (e.silent) {
          // Leave it out: the app then says that sentence with the device voice instead of silence.
          silent.push(it.text);
          const f = path.join(AUDIO, it.id + '.mp3');
          if (fs.existsSync(f)) fs.unlinkSync(f);
          console.log(`\n  ⚠️  "${it.text}": ${e.message} → 이 문장은 기기 음성으로 말해요`);
          continue;
        }
        failed++;
        console.log(`\n  ⚠️  "${it.text}": ${e.message.split('\n')[0]}`);
        if (e.status === 400 || e.status === 403) { queue.length = 0; console.log('\n' + e.message); }
      }
    }
  };
  await Promise.all([worker(), worker()]); // 2 at a time stays well under Google's per-minute quota
  if (failed) {
    fail(`${failed}개를 만들지 못했어요. 위 오류를 확인해 주세요.\n` +
      `   같은 명령을 다시 실행하면 이미 만든 파일은 건너뛰고 나머지만 만들어요. (manifest는 아직 바꾸지 않았어요)`);
  }

  // Remove files for sentences the app no longer says.
  let removed = 0;
  for (const f of fs.readdirSync(AUDIO)) {
    if (f.endsWith('.mp3') && !ids.has(f.slice(0, -4))) { fs.unlinkSync(path.join(AUDIO, f)); removed++; }
  }
  const manifest = {
    provider: 'google-cloud-tts',
    voice,
    rate: rate || null,
    generated: new Date().toISOString(),
    clips: Object.fromEntries(items.filter((i) => fileOk(i.id)).map((i) => [i.id, i.text])),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const size = fs.readdirSync(AUDIO).filter((f) => f.endsWith('.mp3')).reduce((a, f) => a + fs.statSync(path.join(AUDIO, f)).size, 0);
  const made = Object.keys(manifest.clips).length;
  console.log(`\n\n✅ 완료: ${made}/${items.length}개 문장 (${(size / 1024 / 1024).toFixed(1)}MB)${removed ? `, 안 쓰는 파일 ${removed}개 삭제` : ''}`);
  if (silent.length) console.log(`ℹ️  무음이라 뺀 문장 ${silent.length}개 (기기 음성으로 말해요): ${silent.join(', ')}`);
  console.log(`📁 ${AUDIO}\n`);
}

// Offline check: print the sentence list (no key needed)
function cmdList() {
  const { phrases, phraseId } = loadPhrases();
  for (const t of phrases) console.log(`${phraseId(t)}  ${t}`);
  console.log(`\n${phrases.length}개 문장, 약 ${phrases.reduce((a, t) => a + forTts(t).length, 0)}자`);
}

const [cmd, arg, ...rest] = process.argv.slice(2);
const rateIdx = rest.indexOf('--rate');
const rate = rateIdx >= 0 ? Number(rest[rateIdx + 1]) : (cmd === 'build' && arg ? 0.9 : undefined);

const run = { voices: cmdVoices, samples: () => cmdSamples(arg), build: () => cmdBuild(arg, rate), list: cmdList }[cmd];
if (!run) {
  console.log('사용법: node tools/make-voices.mjs <voices | samples [이름일부] | build <목소리> [--rate 0.9] | list>');
  process.exit(1);
}
Promise.resolve(run()).catch((e) => fail(e.message));
