// "What can move" overlay: the engine's sortable() map must agree with real sorting, and both UIs must show it.
import { chromium, mock, shared } from './lib.mjs';
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };
const b = await chromium.launch();

// ---- engine property: a pixel marked "cannot move" never moves; widening a band never shrinks the set ----
const e = await b.newPage(); e.on('pageerror', (x) => errs.push(x.message));
await e.goto(mock('index.html')); await e.addScriptTag({ path: shared('demo-engine.js') }); await e.addScriptTag({ path: shared('regions.js') });
const r = await e.evaluate(() => {
  const out = []; let checks = 0;
  for (const [W, H] of [[120, 80], [61, 97]]) for (const mode of ['threshold', 'random', 'edges', 'ca', 'wave', 'none']) for (const angle of [0, 37, 90]) for (const withMask of [false, true]) for (const withRegions of [false, true]) {
    const d = new PixelDemo(document.createElement('canvas'), { w: W, h: H, params: { mode, angle, lo: .3, hi: .65, length: 12, seed: 4 } });
    if (withMask) { const m = new Uint8Array(W * H); for (let y = 10; y < 40; y++) for (let x = 20; x < 70 && x < W; x++) m[y * W + x] = 1; d.setMask(m); }
    if (withRegions) { const t = Regions.tessellate(W, H, { shape: 'hexagon', size: 30, gap: 2, rotate: 0, seed: 3 }); d.setRegions({ labels: t.labels, classOfCell: Regions.classify(t, 'thirds', 3, 9), defs: { 0: { frozen: true }, 1: {}, 2: { mode: 'threshold', lo: .45, hi: .6 }, 3: { frozen: true } } }); }
    const s = d.sortable(); d.instant(); checks++;
    let moved = 0, free = 0; for (let i = 0; i < W * H; i++) { if (s[i]) free++; else if (d.px[i] !== d.orig[i]) moved++; }
    if (moved) out.push(`MOVED ${mode} a${angle} mask${withMask} reg${withRegions}: ${moved} px marked held-still changed`);
    if (mode === 'threshold' && !withRegions && !withMask && free === 0) out.push('EMPTY threshold band');
  }
  // widening a threshold band can only add pixels
  const d = new PixelDemo(document.createElement('canvas'), { w: 80, h: 60, params: { mode: 'threshold', lo: .4, hi: .6 } }); let prev = -1, mono = true;
  for (const [lo, hi] of [[.4, .6], [.35, .65], [.2, .8], [0, 1]]) { d.params.lo = lo; d.params.hi = hi; const n = d.sortable().reduce((a, v) => a + v, 0); if (n < prev) mono = false; prev = n; }
  return { out, checks, mono, all: prev === 80 * 60 };
});
ok(r.out.length === 0, 'engine: pixels marked "held still" never move (' + r.checks + ' configs: modes x angles x mask x regions)' + (r.out.length ? ' ' + r.out.slice(0, 3).join(' | ') : ''));
ok(r.mono && r.all, 'engine: widening a band only adds pixels; 0–1 frees everything');

// ---- Studio ----
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
pg.on('pageerror', (x) => errs.push('PAGEERR ' + x.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await pg.goto(mock('studio.html')); await pg.waitForTimeout(800);
const pct = async () => +((await pg.textContent('#peekT')).match(/(\d+)%/) || [0, -1])[1];
await pg.evaluate(() => __mock.d.setParams({ mode: 'threshold', lo: .3, hi: .7 })); await pg.press('body', 't'); await pg.waitForTimeout(400);
ok(await pg.locator('#peekChip').isVisible(), 'Studio: T shows the overlay chip');
const p1 = await pct(); ok(p1 > 0 && p1 < 100, 'Studio: a .30–.70 band frees part of the picture (' + p1 + '% can move)');
const alpha = await pg.evaluate(() => { const c = document.getElementById('pk').getContext('2d').getImageData(0, 0, 640, 400).data; let t = 0, h = 0; for (let i = 3; i < c.length; i += 4) { if (c[i] === 120) t++; else if (c[i] === 150) h++; } return { t, h }; });
ok(alpha.t > 0 && alpha.h > 0, 'Studio: the canvas has both tinted (free) and darkened (held) pixels');
ok(Math.abs(alpha.t / 256000 * 100 - p1) < 1, 'Studio: the tinted share matches the chip');
ok((await pg.evaluate(() => __mock.d.comparing)) && !(await pg.evaluate(() => __mock.d.running)), 'Studio: shows the original, and holds the animation');
await pg.keyboard.press('Space'); await pg.waitForTimeout(200); ok(!(await pg.evaluate(() => __mock.d.running)), 'Studio: Play does nothing while the overlay is on');
await pg.evaluate(() => __mock.d.setParams({ lo: .1, hi: .9 })); await pg.waitForTimeout(300);
ok((await pct()) > p1, 'Studio: a wider band raises the figure live (' + p1 + ' → ' + (await pct()) + ')');
const p2 = await pct();
await pg.evaluate(() => __mock.ed.add({ kind: 'ellipse', cx: .5, cy: .5, w: .5, h: .5 })); await pg.waitForTimeout(500);
const p3 = await pct(); ok(p3 < p2 - 5, 'Studio: adding a protect shape lowers it (' + p2 + ' → ' + p3 + '%)');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
ok(!(await pg.locator('#peekChip').isVisible()) && !(await pg.evaluate(() => __mock.d.comparing)), 'Studio: Esc leaves the overlay and shows the sort again');
ok(await pg.evaluate(() => __mock.d.running), 'Studio: and the animation resumes');
await pg.click('#peek'); await pg.waitForTimeout(300); ok(await pg.locator('#peekChip').isVisible(), 'Studio: the dock button toggles it too');
await pg.click('#peekChip'); ok(!(await pg.locator('#peekChip').isVisible()), 'Studio: clicking the chip leaves it');

// ---- Phone ----
const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
ph.on('pageerror', (x) => errs.push('PHONE PAGEERR ' + x.message)); ph.on('console', (m) => { if (m.type() === 'error') errs.push('phone: ' + m.text()); });
await ph.goto(mock('phone.html')); await ph.waitForTimeout(800); await ph.click('#sheet .grab'); await ph.waitForTimeout(500);
ok(await ph.locator('#lenBox').isVisible() && !(await ph.locator('#modeCtl [data-p]').count()), 'Phone: random mode shows run length and no band sliders');
await ph.click('#rMode [data-v="threshold"]'); await ph.waitForTimeout(300);
ok(!(await ph.locator('#lenBox').isVisible()) && (await ph.locator('#modeCtl [data-p]').count()) === 2, 'Phone: threshold swaps run length for "Sort from / up to"');
await ph.fill('#modeCtl [data-p="lo"]', '0.35'); await ph.dispatchEvent('#modeCtl [data-p="lo"]', 'input'); await ph.dispatchEvent('#modeCtl [data-p="lo"]', 'change');
ok(Math.abs((await ph.evaluate(() => __mock.d.params.lo)) - .35) < 1e-9, 'Phone: the band slider drives the engine');
await ph.fill('#modeCtl [data-p="hi"]', '0.2'); await ph.dispatchEvent('#modeCtl [data-p="hi"]', 'input');
ok((await ph.evaluate(() => __mock.d.params.hi)) >= .35 + .02 - 1e-9, 'Phone: the band can never invert (hi stays above lo)');
await ph.click('#rMode [data-v="edges"]'); ok((await ph.locator('#modeCtl [data-p="edge"]').count()) === 1, 'Phone: edges shows sensitivity');
await ph.click('#rMode [data-v="cellular"]'); ok((await ph.locator('#modeCtl [data-r]').count()) === 6 && (await ph.locator('#modeCtl [data-p="cell"]').count()) === 1, 'Phone: cellular shows rule chips and cell size');
await ph.click('#rMode [data-v="threshold"]'); await ph.click('#peekTog'); await ph.waitForTimeout(400);
const ptxt = await ph.textContent('#peekT'); ok(await ph.locator('#peekChip').isVisible() && /% can move/.test(ptxt), 'Phone: the toggle shows the overlay (' + ptxt + ')');
await ph.click('#peekChip'); ok(!(await ph.locator('#peekChip').isVisible()), 'Phone: the chip leaves it');

console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nPEEK CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b.close();
