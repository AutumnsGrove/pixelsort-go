// The "tidy this shape" step in Studio, saved compound shapes, and the compound starters on the phone.
import { chromium, mock } from './lib.mjs';
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
const DONUT = svg('<path d="M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z"/>');
const MIXED = svg('<path d="M0 0 H60 V60 H0 Z M15 15 V45 H45 V15 Z M80 80 H100 V100 H80 Z"/>');
const PLAIN = svg('<circle cx="50" cy="50" r="40"/>');
const SMALLHOLE = svg('<path d="M0 0 H100 V100 H0 Z M45 45 V55 H55 V45 Z"/>');
const b = await chromium.launch();
const st = await b.newPage({ viewport: { width: 1440, height: 900 } });
st.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); st.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await st.goto(mock('studio.html?pro')); await st.evaluate(() => localStorage.removeItem('pixelsort.mock.shapes')); await st.reload(); await st.waitForTimeout(800);
const labelled = () => st.evaluate(() => { const L = __mock.d.labels; if (!L) return -1; let n = 0; for (let i = 0; i < L.length; i++) if (L[i]) n++; return n; });
await st.click('#tiles [data-v="custom"]'); await st.waitForTimeout(300);
const paste = async (t) => { await st.fill('#svgText', t); await st.click('#svgParse'); await st.waitForTimeout(350); };

ok((await st.locator('#starters .shp').count()) === 11, 'Studio: the library has 11 starters, including Ring, Frame and Target');
await paste(PLAIN); ok(!(await st.locator('#svgClean').isVisible()) && (await st.locator('#mine .shp').count()) === 1, 'Studio: a plain circle goes straight into My shapes — no tidy step');
await paste(DONUT);
ok(await st.locator('#svgClean').isVisible() && /1 hole/.test(await st.textContent('#cleanStats')), 'Studio: a donut opens the tidy panel and says "1 hole" (' + (await st.textContent('#cleanStats')) + ')');
ok((await st.locator('#cleanHoles').isVisible()) && !(await st.locator('#cleanPieces').isVisible()), 'Studio: it offers "Keep the holes" but no piece choice (one piece)');
ok((await st.locator('#mine .shp').count()) === 1, 'Studio: nothing is added until you say so');
await st.click('#cleanHoles'); await st.waitForTimeout(150);
ok(/0 holes|1 piece · /.test(await st.textContent('#cleanStats')) && !/hole/.test(await st.textContent('#cleanStats')) && /1 ring left out/.test(await st.textContent('#cleanStats')), 'Studio: switching holes off reports it ("' + (await st.textContent('#cleanStats')) + '")');
await st.focus('#cleanHoles'); await st.keyboard.press('Space'); await st.waitForTimeout(100); ok(/1 hole/.test(await st.textContent('#cleanStats')), 'Studio: the switch works from the keyboard');
await st.click('#cleanCancel'); ok(!(await st.locator('#svgClean').isVisible()) && (await st.locator('#mine .shp').count()) === 1, 'Studio: Cancel closes it and adds nothing');

await paste(SMALLHOLE);
ok(await st.locator('#cleanMinRow').isVisible(), 'Studio: with a hole present, "Fill holes smaller than" appears');
await st.fill('#cleanMin', '5'); await st.dispatchEvent('#cleanMin', 'input'); await st.waitForTimeout(100);
{ const s5 = await st.textContent('#cleanStats'); ok(!/ hole/.test(s5) && /1 ring left out/.test(s5), 'Studio: a 1 % hole is filled in at a 5 % threshold (' + s5 + ')'); }
await st.click('#cleanCancel');

await paste(svg('<rect x="0" y="0" width="100" height="100"/><circle cx="50" cy="50" r="20"/>'));
ok(await st.locator('#cleanPieces').isVisible(), 'Studio: two elements offer "just the largest / all of them"');
{ const a = await st.textContent('#cleanStats'); await st.click('#cleanPieceChips [data-v="all"]'); await st.waitForTimeout(100); const c = await st.textContent('#cleanStats'); ok(!/ hole/.test(a) && /1 hole/.test(c), 'Studio: "all of them" turns the circle into a hole (' + a + ' → ' + c + ')'); }
await st.click('#cleanCancel');
await paste(MIXED);
ok(!(await st.locator('#cleanPieces').isVisible()), 'Studio: one element means no "which pieces" choice, even with several sub-paths');
ok(/2 pieces · 1 hole/.test(await st.textContent('#cleanStats')), 'Studio: a donut plus a loose square reads "2 pieces · 1 hole"');
const pts0 = +(await st.textContent('#cleanStats')).match(/(\d+) points/)[1];
await st.fill('#cleanSimp', '15'); await st.dispatchEvent('#cleanSimp', 'input'); await st.waitForTimeout(100);
const pts1 = +(await st.textContent('#cleanStats')).match(/(\d+) points/)[1]; ok(pts1 < pts0 && pts1 >= 6, 'Studio: Simplify cuts the points (' + pts0 + ' → ' + pts1 + ') but keeps every ring');
await st.fill('#cleanSimp', '0'); await st.dispatchEvent('#cleanSimp', 'input');
await st.click('#cleanAdd'); await st.waitForTimeout(500);
ok(!(await st.locator('#svgClean').isVisible()) && (await st.locator('#mine .shp').count()) === 2, 'Studio: Add puts it in My shapes and closes the panel');
ok(await st.locator('#mine .shp.on').count() === 1, 'Studio: and selects it');

// compare against the same outline with the hole dropped
await paste(DONUT); await st.click('#cleanHoles'); await st.click('#cleanAdd'); await st.waitForTimeout(500);
const noHole = await labelled();
await paste(DONUT); await st.click('#cleanAdd'); await st.waitForTimeout(500);
const holed = await labelled();
ok(holed > 0 && holed < noHole, 'Studio: the hole takes pixels out of the cells, on the picture (' + holed + ' vs ' + noHole + ' without it)');
const saved = await st.evaluate(() => JSON.parse(localStorage.getItem('pixelsort.mock.shapes'))); ok(saved[0].more && saved[0].more.length === 1 && saved[1].more.length === 0, 'Studio: saved shapes keep their extra rings (' + saved.map((s) => s.more.length).join(',') + ')');
await st.reload(); await st.waitForTimeout(800); await st.click('#tiles [data-v="custom"]'); await st.waitForTimeout(300); await st.click('#mine .shp >> nth=0'); await st.waitForTimeout(400);
ok((await labelled()) === holed, 'Studio: after a reload the holed shape tiles exactly the same');
// starters with holes
for (const [n, i] of [['Ring', 8], ['Frame', 9], ['Target', 10]]) { await st.click(`#starters .shp[data-k="s${i}"]`); await st.waitForTimeout(350); const c = await labelled(); await st.click('#starters .shp[data-k="s0"]'); await st.waitForTimeout(250); ok(c > 0, `Studio: ${n} starter tiles the picture (${c} px in cells)`); }
// a hole must be a real gap for the sort
await st.click('#starters .shp[data-k="s8"]'); await st.waitForTimeout(400);
const held = await st.evaluate(() => { const D = __mock.d; D.params.algo = 'oddeven'; D.instant(); let moved = 0; for (let i = 0; i < D.orig.length; i++) if (!D.labels[i] && D.px[i] !== D.orig[i]) moved++; return moved; });
ok(held === 0, 'Studio: nothing in the Ring\'s hole or gaps moves');

// ---- phone ----
const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
ph.on('pageerror', (e) => errs.push('phone ' + e.message)); ph.on('console', (m) => { if (m.type() === 'error') errs.push('phone: ' + m.text()); });
await ph.goto(mock('phone.html')); await ph.waitForTimeout(800);
await ph.click('#sheet .grab'); await ph.click('#sheet .grab'); await ph.click('#tabs [data-t="shapes"]'); await ph.click('#tiles [data-v="custom"]'); await ph.waitForTimeout(500);
ok((await ph.locator('#starters .shpchip').count()) === 11, 'Phone: 11 starters on the rail');
const pl = () => ph.evaluate(() => { const L = __mock.d.labels; let n = 0; for (let i = 0; i < L.length; i++) if (L[i]) n++; return n; });
await ph.click('#starters .shpchip[data-i="0"]'); await ph.waitForTimeout(400); const star = await pl();
await ph.click('#starters .shpchip[data-i="9"]'); await ph.waitForTimeout(400); const frame = await pl();
ok(star > 0 && frame > 0 && ph.url().includes('phone'), 'Phone: Frame tiles the picture (' + frame + ' px in cells)');
const pHeld = await ph.evaluate(() => { const D = __mock.d; D.params.algo = 'oddeven'; D.instant(); let m = 0; for (let i = 0; i < D.orig.length; i++) if (!D.labels[i] && D.px[i] !== D.orig[i]) m++; return m; });
ok(pHeld === 0, 'Phone: nothing in the Frame\'s hole moves');

console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nTIDY CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b.close();
