// Region cards: the shared model, then the same flows in Studio's Pro panel and on the phone's Shapes tab.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const R = createRequire(import.meta.url)(path.join(MOCKUPS, 'shared', 'region-cards.js'));
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };

// ---- pure model ----
const d = R.defaults();
ok(R.summary(d[0]) === 'frozen — never moves' && R.summary(d[1]) === 'inherits everything' && R.summary(d[2]) === '90°' && R.summary(d[3]) === '45° · hue', 'summary: the four default cards read right (' + [d[1], d[2], d[3]].map(R.summary).join(' | ') + ')');
const x = R.newClass('t', { angleOn: true, angle: 12, key: 'hue', rev: 'desc', algo: 'insertion', cutOn: true, mode: 'ca', rule: 154 });
ok(R.summary(x) === '12° · hue ↓ · insertion · cellular 154', 'summary: direction, key + order, animation and cutting all appear, in that order');
const defs = R.toDefs({ 0: d[0], 1: R.newClass('a'), 2: x }, 2);
ok(defs[0].frozen === true && defs[1].algo === null && defs[1].mode === null && defs[1].angle === null && defs[1].reverse === null, 'toDefs: an untouched card inherits everything (all nulls)');
ok(defs[2].algo === 'insertion' && defs[2].mode === 'ca' && defs[2].rule === 154 && defs[2].reverse === true && defs[2].angle === 12, 'toDefs: overrides pass through');
ok(R.toDefs({ 0: R.newClass('x', { cutOn: false, mode: 'wave', length: 99 }) }, 0)[0].length === null, 'toDefs: a recipe that is switched off is not sent');

// ---- shared flows ----
const b = await chromium.launch();
async function flows(p, label, o) {
  const defsOf = () => p.evaluate(() => __mock.d.classDefs);
  await o.openShapes();
  ok((await p.locator('#classes .cls').count()) === 3, label + ': checker pattern shows three cards (gaps + two kinds)');
  ok((await p.locator('#classes .cbody').first().isVisible()) === false, label + ': cards start folded');
  await p.click('#classes .cls[data-c="1"] [data-head]'); ok(await p.locator('#classes .cls[data-c="1"].open').count() === 1 && (await p.getAttribute('#classes .cls[data-c="1"] [data-head]', 'aria-expanded')) === 'true', label + ': tapping the header folds the card open (aria-expanded follows)');
  // own animation
  ok((await p.locator('#classes .cls[data-c="1"] [data-f="algo"] button').count()) === 4, label + ': "Watch this kind as" offers global, odd-even, insertion, reveal');
  await p.click('#classes .cls[data-c="1"] [data-f="algo"] [data-v="reveal"]'); await p.waitForTimeout(250);
  let df = await defsOf(); ok(df[1].algo === 'reveal', label + ': choosing "reveal" reaches the engine for that kind only (kind B: ' + df[2].algo + ')');
  ok(await p.evaluate(() => __mock.d.algoCount[2] > 0 && __mock.d.algoCount[0] > 0), label + ': and the sort now really mixes algorithms (' + (await p.evaluate(() => Array.from(__mock.d.algoCount))) + ')');
  ok(/reveal/.test(await p.textContent('#classes .cls[data-c="1"] .csum')), label + ': the folded summary mentions it');
  await p.click('#classes .cls[data-c="1"] [data-f="algo"] [data-v=""]'); await p.waitForTimeout(200); ok((await defsOf())[1].algo === null, label + ': "same as global" clears it');
  // own cutting
  await p.click('#classes .cls[data-c="1"] .sw[data-f="cutOn"]'); await p.waitForTimeout(200);
  ok(await p.locator('#classes .cls[data-c="1"] .cutbox').count() === 1 && (await defsOf())[1].mode === 'random', label + ': switching on own cutting opens the recipe (random by default)');
  await p.click('#classes .cls[data-c="1"] [data-f="mode"] [data-v="ca"]'); await p.waitForTimeout(200);
  ok(await p.locator('#classes .cls[data-c="1"] [data-f="rulepick"]').count() === 1, label + ': cellular shows rule chips');
  await p.click('#classes .cls[data-c="1"] [data-f="rulepick"] [data-v="154"]'); await p.waitForTimeout(200);
  ok((await defsOf())[1].rule === 154 && /cellular 154/.test(await p.textContent('#classes .cls[data-c="1"] .csum')), label + ': picking rule 154 updates the engine and the summary');
  // a number field keeps focus while you type (the "never rebuild a focused input" rule)
  await p.click('#classes .cls[data-c="1"] [data-f="angleOn"]'); await p.waitForTimeout(150);
  await p.focus('#classes .cls[data-c="1"] input[data-f="angle"]'); await p.locator('#classes .cls[data-c="1"] input[data-f="angle"]').selectText(); await p.keyboard.type('135'); await p.waitForTimeout(250);
  ok((await p.evaluate(() => document.activeElement && document.activeElement.dataset.f)) === 'angle' && (await defsOf())[1].angle === 135, label + ': typing a direction keeps focus and reaches the engine (135°)');
  // slider: live preview, then commit
  const before = await p.evaluate(() => __mock.d.params.seed); await p.fill('#classes .cls[data-c="1"] input[data-f="cell"]', '9'); await p.dispatchEvent('#classes .cls[data-c="1"] input[data-f="cell"]', 'input'); await p.waitForTimeout(150);
  ok((await defsOf())[1].cell === 9 && (await p.textContent('#classes .cls[data-c="1"] [data-f="cell"] ~ * , #classes .cls[data-c="1"] .rrow em')) !== null, label + ': a slider updates the engine as you drag (cell 9)');
  await p.dispatchEvent('#classes .cls[data-c="1"] input[data-f="cell"]', 'change'); await p.waitForTimeout(150);
  // keyboard
  await p.focus('#classes .cls[data-c="2"] [data-head]'); await p.keyboard.press('Enter'); ok(await p.locator('#classes .cls[data-c="2"].open').count() === 1, label + ': Enter on a header opens the card');
  await p.focus('#classes .cls[data-c="2"] .sw[data-f="frozen"]'); await p.keyboard.press('Space'); await p.waitForTimeout(200); ok((await defsOf())[2].frozen === true, label + ': Space on a switch toggles it (kind B frozen)');
  ok(await p.evaluate(() => { const t = __mock.d.stats; return t && t.frozen > 0; }), label + ': and the engine sees the frozen pixels');
  // the frozen switch must really hold pixels still
  const held = await p.evaluate(() => { const D = __mock.d; D.params.algo = 'oddeven'; D.instant(); let moved = 0; for (let i = 0; i < D.orig.length; i++) if (D.rclass && D.classDefs[D.rclass[i]] && D.classDefs[D.rclass[i]].frozen && D.px[i] !== D.orig[i]) moved++; return moved; });
  ok(held === 0, label + ': pixels in a frozen kind never move');
  if (o.tap) {
    const small = await p.$$eval('#classes .cls button, #classes .cls select, #classes .cls input[type=number], #classes .cls [data-head]', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)));
    const tiny = await p.$$eval('#classes .cls .sw', (els) => els.filter((e) => e.offsetParent).filter((e) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; return [-20, 20].some((dy) => { const hit = document.elementFromPoint(cx, cy + dy); return !(hit === e); }); }).length);
    ok(small.length === 0 && tiny === 0, label + ': every control in the cards is a real tap target (≥ 40 px; switches get a 44 px hit area)' + (small.length ? ' — too short: ' + small.slice(0, 5).join(', ') : '') + (tiny ? ' — ' + tiny + ' switches too small' : ''));
  }
}
const st = await b.newPage({ viewport: { width: 1440, height: 900 } });
st.on('pageerror', (e) => errs.push('studio ' + e.message)); st.on('console', (m) => { if (m.type() === 'error') errs.push('studio: ' + m.text()); });
await st.goto(mock('studio.html?pro&shape=hexagon')); await st.waitForTimeout(900);
await flows(st, 'Studio', { openShapes: async () => {} });

const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
ph.on('pageerror', (e) => errs.push('phone ' + e.message)); ph.on('console', (m) => { if (m.type() === 'error') errs.push('phone: ' + m.text()); });
await ph.goto(mock('phone.html')); await ph.waitForTimeout(800);
await flows(ph, 'Phone', { tap: true, openShapes: async () => { await ph.click('#sheet .grab'); await ph.click('#sheet .grab'); await ph.click('#tabs [data-t="shapes"]'); await ph.click('#tiles [data-v="hexagon"]'); await ph.waitForTimeout(500); } });
ok((await ph.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'Phone: no sideways scroll with a cellular recipe open');

console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nREGION CARD CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b.close();
