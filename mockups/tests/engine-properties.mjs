import { chromium, mock, shared } from './lib.mjs';
const b = await chromium.launch();
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(mock('index.html'));
await p.addScriptTag({ path: shared('demo-engine.js') });
const res = await p.evaluate(() => {
  const out = [];
  const angles = [0,1,7,30,45,60,89,90,91,135,180,217,270,333,359];
  const modes = ['random','wave','threshold','edges','ca','none'];
  for (const [W,H] of [[97,61],[1,40],[40,1],[53,53]]) {
    for (const a of angles) for (const mode of modes) {
      const c = document.createElement('canvas');
      const d = new PixelDemo(c, { w: W, h: H, params: { angle: a, mode, length: 9, randomness: 10, seed: 3 } });
      // property 6: line partition is a bijection
      const seen = new Uint8Array(W*H); let bad = 0;
      for (let i = 0; i < W*H; i++) { const q = d.P[i]; if (q < 0 || q >= W*H || seen[q]++) bad++; }
      if (bad) out.push(`BIJECTION FAIL ${W}x${H} a=${a} bad=${bad}`);
      // property 2/1: sorting is a permutation, intervals sorted
      d.instant();
      const o = Array.from(d.orig).sort(), n = Array.from(d.px).sort();
      for (let i = 0; i < o.length; i++) if (o[i] !== n[i]) { out.push(`PERMUTATION FAIL ${W}x${H} a=${a} ${mode}`); break; }
      for (let i = 0; i < d.ivA.length; i++) for (let t = d.ivA[i]; t + 1 < d.ivB[i]; t++) if (d.key[d.P[t]] > d.key[d.P[t+1]]) { out.push(`UNSORTED ${W}x${H} a=${a} ${mode}`); i = 1e9; break; }
      // property 5: stepper == instant (oddeven + insertion), only on the bigger sizes to keep it quick
      if (W === 97 && (mode === 'random' || mode === 'threshold') ) {
        const inst = d.px.slice();
        for (const algo of ['oddeven','insertion']) {
          d.params.algo = algo; d.reset(); let guard = 0; while (!d.done && guard++ < 5000) d.step();
          for (let i = 0; i < inst.length; i++) if (inst[i] !== d.px[i]) { out.push(`STEPPER!=INSTANT ${algo} a=${a} ${mode}`); break; }
        }
      }
    }
  }
  return out;
});
console.log(res.length ? res.slice(0,20).join('\n') + `\n(${res.length} failures)` : 'ALL PROPERTIES HOLD');
console.log(errs.join('\n')||'no page errors');
if (res.length || errs.length) process.exitCode = 1;
await b.close();
