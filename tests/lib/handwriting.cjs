// Simulated children's handwriting for recognition tests. Deterministic (seeded), so results repeat.

function rng(seed = 7) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

// Follow a guide stroke with a gentle random wobble (used for "this is a correct attempt").
function trace(stroke, rand, wobble = 0.012) {
  const pts = [];
  for (let i = 1; i < stroke.length; i++) {
    const [a, b] = [stroke[i - 1], stroke[i]];
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.004));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([a[0] + (b[0] - a[0]) * t + (rand() - 0.5) * wobble, a[1] + (b[1] - a[1]) * t + (rand() - 0.5) * wobble]);
    }
  }
  pts.push(stroke[stroke.length - 1]);
  return { pts };
}

// A shaky child: smooth low-frequency wobble + jitter + whole-letter offset + over/under-shooting the ends.
function child(stroke, rand, { wob, off, shoot, jitter = 0.005 }) {
  const pts = [];
  let ph = rand() * 6;
  const s = stroke.slice();
  if (s.length > 1) {
    const ext = (a, b, k) => [a[0] + (a[0] - b[0]) * k, a[1] + (a[1] - b[1]) * k];
    s[0] = ext(s[0], s[1], shoot * (rand() - 0.3));
    s[s.length - 1] = ext(s[s.length - 1], s[s.length - 2], shoot * (rand() - 0.3));
  }
  for (let i = 1; i < s.length; i++) {
    const [a, b] = [s[i - 1], s[i]];
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.004));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      ph += 0.08;
      pts.push([
        a[0] + (b[0] - a[0]) * t + Math.sin(ph) * wob + (rand() - 0.5) * jitter + off[0],
        a[1] + (b[1] - a[1]) * t + Math.cos(ph * 0.7) * wob + (rand() - 0.5) * jitter + off[1],
      ]);
    }
  }
  pts.push([s[s.length - 1][0] + off[0], s[s.length - 1][1] + off[1]]);
  return { pts };
}

// How shaky the simulated child is. Units = fraction of the paper. 한글/숫자/선 are drawn large;
// English letters sit between 4 lines and are smaller, so the same hand wobble is relatively bigger.
const SHAKINESS = {
  big: {
    neat: { wob: 0.01, off: [0, 0], shoot: 0.05, jitter: 0.006 },
    shaky: { wob: 0.025, off: [0.015, -0.01], shoot: 0.15, jitter: 0.006 },
    'very shaky': { wob: 0.035, off: [0.025, 0.02], shoot: 0.2, jitter: 0.006 },
  },
  english: {
    neat: { wob: 0.006, off: [0, 0], shoot: 0.05, jitter: 0.004 },
    shaky: { wob: 0.014, off: [0.008, -0.006], shoot: 0.12, jitter: 0.004 },
    'very shaky': { wob: 0.02, off: [0.012, 0.01], shoot: 0.18, jitter: 0.004 },
  },
};

// 🥇 혼자 쓰기 (no guide): the child writes the letter from memory — any size, a bit squashed or
// tilted, and each stroke placed a little off. sev = how much (0 = only size, 1 = normal, 1.5 = sloppy).
function freeHand(strokes, rand, prm, sev = 1) {
  const sc = 0.6 + rand() * 0.5, asp = 1 + (rand() - 0.5) * 0.3 * sev, rot = (rand() - 0.5) * 0.2 * sev;
  return strokes.map((s) => {
    const off = [(rand() - 0.5) * 0.05 * sev, (rand() - 0.5) * 0.05 * sev];
    return { pts: child(s, rand, prm).pts.map(([x, y]) => {
      x = (x - 0.5) * asp + off[0]; y = (y - 0.5) / asp + off[1];
      return [0.5 + (x * Math.cos(rot) - y * Math.sin(rot)) * sc, 0.5 + (x * Math.sin(rot) + y * Math.cos(rot)) * sc];
    }) };
  });
}

const pathLen = (s) => s.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - s[k][0], p[1] - s[k][1]), 0);
const STRAY = (rand) => trace([[0.04, 0.92], [0.3, 0.97]], rand, 0.004); // a line in an empty corner

module.exports = { rng, trace, child, freeHand, SHAKINESS, pathLen, STRAY };
