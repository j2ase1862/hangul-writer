// npm test — runs every automatic test and prints one summary.
const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  ['판정 시험 (따라 쓰기 인식)', 'recognition.test.cjs'],
  ['앱 동작 시험', 'app.test.cjs'],
  ['오프라인 시험 (서비스 워커)', 'sw.test.cjs'],
];
let failed = 0;
for (const [name, file] of suites) {
  console.log(`\n▶ ${name}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n❌ ${failed}개 시험 묶음이 실패했어요.` : '\n✅ 모든 시험 통과');
console.log('ℹ️  화면 배치·음성 파일 검사는 브라우저에서: npm run serve → http://127.0.0.1:8765/tests/browser-checks.html');
process.exit(failed ? 1 : 0);
