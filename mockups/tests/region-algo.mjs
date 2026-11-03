// Per-region animation algorithm: any mix of odd-even / insertion / reveal across regions must end on the same
// image as the instant sort, stay a permutation at every step, and report progress that only moves forward.
import { chromium, mock, shared } from './lib.mjs';
const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(mock('index.html')); await p.addScriptTag({ path: shared('demo-engine.js') }); await p.addScriptTag({ path: shared('regions.js') });
const res = await p.evaluate(() => {
  const out = []; let checks = 0; const ALG = ['oddeven', 'insertion', 'reveal'];
  const perm = (a, b) => { const x = Array.from(a).sort(), y = Array.from(b).sort(); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
  const mixes = [[null, 'insertion', 'reveal', 'oddeven'], ['reveal', 'reveal', 'insertion', null], ['insertion', null, null, null], [null, null, null, null], ['oddeven', 'oddeven', 'oddeven', 'oddeven']];
  for (const [W, H] of [[90, 60], [47, 71]]) for (const shape of ['square', 'hexagon', 'voronoi']) for (const global of ALG) for (const mix of mixes) for (const mode of ['random', 'threshold', 'ca']) {
    const d = new PixelDemo(document.createElement('canvas'), { w: W, h: H, params: { angle: 25, mode, length: 12, randomness: 5, seed: 6, algo: global, lo: .25, hi: .75 } });
    const t = Regions.tessellate(W, H, { shape, size: 26, gap: 2, rotate: 0, seed: 3 }), cls = Regions.classify(t, 'thirds', 3, 9);
    const defs = {}; mix.forEach((a, c) => { defs[c] = { algo: a }; });
    d.setRegions({ labels: t.labels, classOfCell: cls, defs }); checks++;
    const tag = `${shape} ${global} [${mix.join(',')}] ${mode}`;
    // the per-interval algorithm really follows the region
    for (let i = 0; i < d.ivA.length; i++) { const c = d.rclass[d.P[d.ivA[i]]], want = mix[c] || global, got = ALG[d.ivAlgo[i]]; if (want !== got) { out.push(`ALGO MISMATCH ${tag}: interval in class ${c} runs ${got}, wanted ${want}`); break; } }
    d.instant(); const inst = d.px.slice(); d.reset(); d.params.algo = global;
    let g = 0, prev = -1, mono = true, perms = true;
    while (!d.done && g++ < 6000) { d.step(); if (d.progress < prev - 1e-9) mono = false; prev = d.progress; if (g % 7 === 0 && !perm(d.orig, d.px)) perms = false; }
    if (!d.done) out.push(`NEVER FINISHED ${tag}`);
    if (!mono) out.push(`PROGRESS WENT BACKWARDS ${tag}`);
    if (!perms) out.push(`NOT A PERMUTATION mid-sort ${tag}`);
    if (d.progress !== 1) out.push(`PROGRESS != 1 at the end ${tag}`);
    for (let i = 0; i < inst.length; i++) if (inst[i] !== d.px[i]) { out.push(`STEPPER != INSTANT ${tag}`); break; }
  }
  // a mixed sort really runs different algorithms side by side
  const d = new PixelDemo(document.createElement('canvas'), { w: 90, h: 60, params: { mode: 'random', length: 10, randomness: 0, seed: 2, algo: 'oddeven' } });
  const t = Regions.tessellate(90, 60, { shape: 'square', size: 26, gap: 2, rotate: 0, seed: 3 }); d.setRegions({ labels: t.labels, classOfCell: Regions.classify(t, 'thirds', 3, 9), defs: { 0: {}, 1: { algo: 'reveal' }, 2: { algo: 'insertion' }, 3: {} } });
  const fam = Array.from(d.algoCount); if (!(fam[0] > 0 && fam[1] > 0 && fam[2] > 0)) out.push('MIXED SORT DID NOT USE ALL THREE FAMILIES ' + fam);
  return { out, checks, fam };
});
console.log(res.out.length ? res.out.slice(0, 12).join('\n') : `ALL ${res.checks} MIXED-ALGORITHM CONFIGURATIONS HOLD (families in the mixed sort: ${res.fam})`);
console.log(errs.join('\n') || 'no page errors'); if (res.out.length || errs.length) process.exitCode = 1; await b.close();
