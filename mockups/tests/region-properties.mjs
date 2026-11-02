import { chromium, mock, shared } from './lib.mjs';
const b = await chromium.launch();
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(mock('index.html'));
await p.addScriptTag({ path: shared('demo-engine.js') });
await p.addScriptTag({ path: shared('regions.js') });
const res = await p.evaluate(() => {
  const out = []; let checks = 0;
  const fail = (m) => out.push(m);
  for (const [W,H] of [[120,80],[61,97]]) for (const shape of Regions.SHAPES.map(s=>s.id)) for (const pattern of ['all','checker','thirds','random']) {
    const c = document.createElement('canvas');
    const d = new PixelDemo(c, { w: W, h: H, params: { angle: 20, mode: 'random', length: 10, randomness: 10, seed: 5 } });
    const t = Regions.tessellate(W, H, { shape, size: 28, gap: 2, rotate: 13, seed: 3 });
    const cls = Regions.classify(t, pattern, 3, 9);
    // class defs: class1 frozen, class2 angle 100 + key hue, class3 angle 300
    const defs = { 0: {}, 1: { frozen: true }, 2: { angle: 100, key: 'hue' }, 3: { angle: 300 } };
    d.setRegions({ labels: t.labels, classOfCell: cls, defs });
    checks++;
    // bijection: every pixel in exactly one line
    const seen = new Uint8Array(W*H); const total = d.lineStarts[d.lineStarts.length-1];
    if (total !== W*H) fail(`COVERAGE ${shape}/${pattern} ${W}x${H}: ${total}/${W*H}`);
    for (let i = 0; i < total; i++) { if (seen[d.P[i]]++) { fail(`DUP ${shape}/${pattern}`); break; } }
    d.instant();
    const o = Array.from(d.orig).sort(), n = Array.from(d.px).sort();
    for (let i = 0; i < o.length; i++) if (o[i] !== n[i]) { fail(`PERMUTATION ${shape}/${pattern}`); break; }
    // frozen class pixels never move
    for (let i = 0; i < W*H; i++) if (d.rclass[i] === 1 && d.px[i] !== d.orig[i]) { fail(`FROZEN MOVED ${shape}/${pattern}`); break; }
    // intervals never cross cells, and are sorted
    for (let k = 0; k < d.ivA.length; k++) {
      const cell0 = t.labels[d.P[d.ivA[k]]];
      for (let q = d.ivA[k]; q < d.ivB[k]; q++) {
        if (t.labels[d.P[q]] !== cell0) { fail(`CROSSED CELLS ${shape}/${pattern}`); k = 1e9; break; }
        if (q + 1 < d.ivB[k] && d.key[d.P[q]] > d.key[d.P[q+1]]) { fail(`UNSORTED ${shape}/${pattern}`); k = 1e9; break; }
      }
    }
    // stepper == instant under regions
    const inst = d.px.slice(); d.params.algo = 'oddeven'; d.reset(); let g = 0; while (!d.done && g++ < 4000) d.step();
    for (let i = 0; i < inst.length; i++) if (inst[i] !== d.px[i]) { fail(`STEPPER!=INSTANT ${shape}/${pattern}`); break; }
  }
  return { out, checks };
});
console.log(res.out.length ? res.out.slice(0,15).join('\n') + `\n(${res.out.length} failures)` : `ALL REGION PROPERTIES HOLD (${res.checks} configurations)`);
console.log(errs.join('\n')||'no page errors');
if (res.out.length || errs.length) process.exitCode = 1;
await b.close();
