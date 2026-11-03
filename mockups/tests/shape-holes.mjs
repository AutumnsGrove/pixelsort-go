// Compound shapes: holes (even-odd), several pieces, and the clean-up step (largest/all, keep holes, fill small holes, simplify).
import { chromium, mock, shared } from './lib.mjs';
const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(mock('index.html')); await p.addScriptTag({ path: shared('demo-engine.js') }); await p.addScriptTag({ path: shared('regions.js') });
const res = await p.evaluate(() => {
  const out = [], ok = []; const T = (c, m) => (c ? ok.push(m) : out.push(m));
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
  const DONUT = svg('<path d="M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z"/>');
  const TWO = svg('<path d="M0 0 H40 V40 H0 Z M60 60 H100 V100 H60 Z"/>');
  const TWOEL = svg('<rect x="0" y="0" width="100" height="100"/><circle cx="50" cy="50" r="20"/>');
  const MIXED = svg('<path d="M0 0 H60 V60 H0 Z M15 15 V45 H45 V15 Z M80 80 H100 V100 H80 Z"/>');
  const RELATIVE = svg('<path d="m0 0 h50 v50 h-50 z m10 10 v30 h30 v-30 z"/>');   // relative sub-paths: splitting the text would break these
  const tiny = svg('<path d="M0 0 H100 V100 H0 Z M45 45 V55 H55 V45 Z"/>');
  const raw = (t) => Regions.parseSVGRaw(t);

  // ---- parsing ----
  let r = raw(DONUT); T(!r.error && r.pieces.length === 1 && r.pieces[0].rings.length === 2, 'a path with two sub-paths becomes two rings');
  let s = Regions.buildShape(r, {}); T(s.stats.holes === 1 && s.stats.pieces === 1 && s.more.length === 1, 'the inner ring is a hole (1 piece, 1 hole): ' + s.info);
  T(Regions.buildShape(raw(RELATIVE), {}).stats.holes === 1, 'relative sub-paths (m h v z) split correctly — no text-splitting');
  r = raw(TWO); s = Regions.buildShape(r, {}); T(s.stats.pieces === 2 && s.stats.holes === 0, 'two separate rings in one path are two pieces, not a hole: ' + s.info);
  r = raw(MIXED); s = Regions.buildShape(r, {}); T(s.stats.pieces === 2 && s.stats.holes === 1, 'a donut plus a separate square: 2 pieces and 1 hole');
  r = raw(TWOEL); T(r.pieces.length === 2, 'two elements are two pieces');
  const big = Regions.buildShape(r, { pieces: 'largest' }), all = Regions.buildShape(r, { pieces: 'all' });
  T(big.stats.holes === 0 && big.stats.rings === 1, '"largest" keeps just the biggest element');
  T(all.stats.holes === 1 && all.stats.rings === 2, '"all" keeps both, and the circle inside the square cuts a hole');

  // ---- clean-up options ----
  s = Regions.buildShape(raw(DONUT), { holes: false }); T(s.stats.holes === 0 && s.more.length === 0 && s.stats.droppedRings === 1, '"keep holes" off drops the inner ring');
  s = Regions.buildShape(raw(tiny), { minHole: 0.05 }); T(s.stats.holes === 0, 'a hole under 5 % of the shape is filled in (1 % hole)');
  s = Regions.buildShape(raw(tiny), { minHole: 0.005 }); T(s.stats.holes === 1, '…but kept when the threshold is lower');
  const circ = Regions.buildShape(raw(svg('<circle cx="50" cy="50" r="45"/>')), {}), simp = Regions.buildShape(raw(svg('<circle cx="50" cy="50" r="45"/>')), { simplify: 0.01 });
  T(simp.stats.points < circ.stats.points / 2 && simp.stats.points >= 3, 'simplify cuts a circle from ' + circ.stats.points + ' to ' + simp.stats.points + ' points, never below 3');
  const area = (sh) => Regions.ringArea(sh.poly); T(Math.abs(area(simp) - area(circ)) / area(circ) < 0.06, 'and keeps its area within 6 %');
  T(!Regions.needsTidy(raw(svg('<circle cx="50" cy="50" r="40"/>'))) && Regions.needsTidy(raw(DONUT)) && Regions.needsTidy(raw(TWOEL)), 'a plain shape goes straight in; holes or several pieces ask for a tidy');

  // ---- geometry ----
  for (const [name, sh] of [['donut', Regions.buildShape(raw(DONUT), {})], ['mixed', Regions.buildShape(raw(MIXED), {})]]) {
    const all = [sh.poly].concat(sh.more); let inb = true; all.forEach((rg) => rg.forEach((q) => { if (q[0] < -1e-9 || q[0] > 1 + 1e-9 || q[1] < -1e-9 || q[1] > 1 + 1e-9) inb = false; }));
    T(inb, name + ': every ring fits the unit square together');
  }
  const bits = Regions.polyBits(Regions.buildShape(raw(DONUT), {}).poly, 60, Regions.buildShape(raw(DONUT), {}).more); let mid = bits[30 * 60 + 30], edge = bits[6 * 60 + 6];
  T(mid === 0 && edge === 1, 'even-odd fill: the middle of a donut is empty, its rim is filled');
  const filled = bits.reduce((a, v) => a + v, 0) / 3600; T(filled > 0.65 && filled < 0.8, 'a 100-square with a 40-square hole fills about 0.92² × (1 - 0.16) = 0.71 of the unit box (' + filled.toFixed(2) + ')');

  // ---- starters ----
  const names = Regions.STARTERS.map((x) => x.name); T(['Ring', 'Frame', 'Target'].every((n) => names.includes(n)), 'starters include Ring, Frame and Target');
  const exp = { Ring: 1, Frame: 1, Target: 2 };
  for (const n in exp) { const i = names.indexOf(n); T(Regions.starterMore(i).length === exp[n], n + ' has ' + exp[n] + ' extra ring(s)'); }
  T(Regions.STARTERS.every((x, i) => (['Ring', 'Frame', 'Target'].includes(x.name)) === (Regions.starterMore(i).length > 0)), 'only the compound starters carry extra rings');

  // ---- tiling: holes stay out of every cell, and the sort still works ----
  const W = 130, H = 84;
  for (const n of ['Ring', 'Frame', 'Target']) for (const stagger of [false, true]) {
    const i = names.indexOf(n), poly = Regions.starterPoly(i), more = Regions.starterMore(i);
    const t = Regions.tessellate(W, H, { shape: 'custom', poly, more, size: 40, gap: 2, rotate: 11, stagger, seed: 3 }), plain = Regions.tessellate(W, H, { shape: 'custom', poly, size: 40, gap: 2, rotate: 11, stagger, seed: 3 });
    let a = 0, c = 0; for (let k = 0; k < W * H; k++) { if (t.labels[k]) a++; if (plain.labels[k]) c++; }
    T(a < c * 0.97 && a > c * 0.3, `${n}${stagger ? ' staggered' : ''}: the hole takes pixels out of the cells (${a} vs ${c} without it)`);
    const d = new PixelDemo(document.createElement('canvas'), { w: W, h: H, params: { angle: 20, mode: 'random', length: 10, seed: 4, algo: 'oddeven' } });
    d.setRegions({ labels: t.labels, classOfCell: Regions.classify(t, 'thirds', 3, 9), defs: { 0: { frozen: true }, 1: {}, 2: { algo: 'insertion' }, 3: {} } });
    d.instant(); const inst = d.px.slice(); let moved = 0; for (let k = 0; k < W * H; k++) if (!t.labels[k] && d.px[k] !== d.orig[k]) moved++;
    T(moved === 0, `${n}: pixels in the hole (between cells) never move`);
    d.reset(); let g = 0; while (!d.done && g++ < 5000) d.step(); let same = true; for (let k = 0; k < inst.length; k++) if (inst[k] !== d.px[k]) { same = false; break; }
    T(same, `${n}: stepper == instant with a holed shape`);
  }
  return { out, ok };
});
res.ok.forEach((m) => console.log('  ok  ' + m));
console.log(res.out.length ? '\nFAILURES:\n' + res.out.join('\n') : '\nSHAPE HOLE CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (res.out.length || errs.length) process.exitCode = 1; await b.close();
