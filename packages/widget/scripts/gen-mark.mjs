// Prints the static path data for src/mark.ts: the Vitrina brand mark (two
// rings and the amber core) in isometric, ported from the landing's
// components/brand/Iso.tsx — pyramidScene("core", 1, 1.5) without the detail
// layer (no hatching, no vertex nodes), which is what reads at 28–64 px.
//
//   node scripts/gen-mark.mjs   → paste the output over the MARK block in src/mark.ts
const C = 0.866;
const P = ([x, y, z]) => [(x - y) * C, (x + y) * 0.5 - z];
const f = (n) => String(Math.round(n * 10) / 10);
const d = (q, close = true) =>
  q.map((v, i) => (i ? 'L' : 'M') + P(v).map(f).join(' ')).join('') + (close ? 'Z' : '');
const sq = (s, z) => [[-s, -s, z], [s, -s, z], [s, s, z], [-s, s, z]];

function ring(a, b, z, t) {
  const top = z + t;
  const floor = z + Math.min(2, t / 2);
  return {
    ground: [
      [[a, -a, z], [a, a, z], [a, a, top], [a, -a, top]],
      [[-a, a, z], [a, a, z], [a, a, top], [-a, a, top]],
      sq(a, top),
      sq(b, top),
    ],
    faint: [
      [[-b, -b, top], [b, -b, top], [b, -b, floor], [-b, -b, floor]],
      [[-b, -b, top], [-b, b, top], [-b, b, floor], [-b, -b, floor]],
    ],
  };
}

const k = 1.5;
const r0 = ring(100, 74, 0, 20);
const r1 = ring(56, 36, 62, 16);
const r1top = 62 + 16;
const z0 = r1top + 0.5 + 44;
const place = ([x, y, z]) => [x * k, y * k, z0 + z * k];
const [x0, y0, x1, y1, z1] = [-18, -18, 18, 18, 34];
const core = {
  side: [[x1, y0, 0], [x1, y1, 0], [x1, y1, z1], [x1, y0, z1]].map(place),
  front: [[x0, y1, 0], [x1, y1, 0], [x1, y1, z1], [x0, y1, z1]].map(place),
  top: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(place),
};
const stem = [[0, 0, r1top], [0, 0, z0]];

// Painter's order: each ring's ground faces then its faint back walls.
const all = [...r0.ground, ...r0.faint, ...r1.ground, ...r1.faint, ...Object.values(core), stem].flat().map(P);
const xs = all.map((p) => p[0]);
const ys = all.map((p) => p[1]);
const pad = 6;
const vb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];

const out = {
  viewBox: vb.map(f).join(' '),
  // [ring0 ground, ring0 faint, ring1 ground, ring1 faint]
  layers: [r0.ground, r0.faint, r1.ground, r1.faint].map((fs) => fs.map((q) => d(q)).join('')),
  stem: d(stem, false),
  side: d(core.side),
  front: d(core.front),
  top: d(core.top),
};
console.log(JSON.stringify(out, null, 2));
