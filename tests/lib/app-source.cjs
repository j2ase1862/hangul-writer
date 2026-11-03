// Reads pieces of index.html so tests run against the real app code (no copies to keep in sync).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const readHtml = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

// The pure-data block (letters, words, stroke shapes, spoken sentences) — no DOM needed.
function dataBlock(html = readHtml()) {
  const m = html.match(/\/\* @@VOICE-DATA-START[^*]*\*\/([\s\S]*?)\/\* @@VOICE-DATA-END \*\//);
  if (!m) throw new Error('index.html: @@VOICE-DATA-START/END block not found');
  return m[1];
}

// The handwriting check function, cut out of the app script.
function evaluateSource(html = readHtml()) {
  const start = html.indexOf('  function evaluate(guide, user');
  if (start < 0) throw new Error('index.html: evaluate() not found');
  return html.slice(start, html.indexOf('\n  }\n', start) + 4);
}

// { evaluate, ITEMS, SYLLABLES, buildPhrases, phraseId } evaluated together, like in the app
function loadRecognizer() {
  const html = readHtml();
  // eslint-disable-next-line no-new-func
  return new Function(`${dataBlock(html)}\n${evaluateSource(html)}\nreturn { evaluate, ITEMS, SYLLABLES, buildPhrases, phraseId };`)();
}

// The whole app script (the inline <script> that defines App)
function appScript() {
  const html = readHtml();
  const blocks = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]);
  const app = blocks.find((b) => b.includes('function App()'));
  if (!app) throw new Error('index.html: app script not found');
  return app;
}

module.exports = { ROOT, readHtml, dataBlock, evaluateSource, loadRecognizer, appScript };
