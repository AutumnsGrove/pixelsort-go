// Presets: the roll logic as pure properties (these are the spec for the Go port), then the Studio picker.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const P = createRequire(import.meta.url)(path.join(MOCKUPS, 'shared', 'presets.js'));
const fails = []; const errs = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };

// ---- pure properties ----
const base = { mode: 'random', length: 40, randomness: 10, lo: .2, hi: .82, edge: 26, angle: 0, key: 'luma', reverse: false };
const inRange = (v, [lo, hi, step = 1]) => v >= lo - 1e-9 && v <= hi + 1e-9 && Math.abs(((v - lo) / step) - Math.round((v - lo) / step)) < 1e-6;
ok(P.BUILTIN.map((p) => p.name).join() === 'Main,File,Random,Kims,Gentle,Intense,Waves,Edges', 'the eight built-ins from the Python app, in order');

let bad = 0;
for (const p of P.BUILTIN) for (let s = 1; s <= 400; s++) {
  const r = P.roll(p, P.mulberry32(s), base);
  for (const [k, v] of Object.entries(p.spec)) {
    if (Array.isArray(v) && !inRange(r[k], v)) bad++;
    else if (v && v.pick && !v.pick.includes(r[k])) bad++;
    else if (typeof v !== 'object' && r[k] !== v) bad++;
  }
  for (const k of P.OWNED) if (!(k in r)) bad++;                       // every owned field is always set
  if (r.lo >= r.hi) bad++;                                              // a rolled band is never empty or inverted
}
ok(bad === 0, 'every roll stays in its range, step and pick-list, sets every owned field, keeps lo < hi (8 presets x 400 seeds)');

const a = P.roll(P.BUILTIN[0], P.mulberry32(5), base), b = P.roll(P.BUILTIN[0], P.mulberry32(5), base);
ok(JSON.stringify(a) === JSON.stringify(b), 'same seed, same roll');
const distinct = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(P.roll(P.BUILTIN[0], P.mulberry32(i), base)))).size;
ok(distinct > 40, 'Main re-rolls: different seeds give different results (' + distinct + '/50 distinct) — the Python app gave one');
ok(['gentle', 'intense', 'waves', 'edges'].every((id) => !P.rolls(P.BUILTIN.find((p) => p.id === id))), 'Gentle, Intense, Waves and Edges are fixed recipes');
ok(['main', 'file', 'random', 'kims'].every((id) => P.rolls(P.BUILTIN.find((p) => p.id === id))), 'Main, File, Random and Kims roll');
const gent = P.roll(P.BUILTIN.find((p) => p.id === 'gentle'), Math.random, base);
ok(gent.randomness === 5 && gent.length === 25 && gent.lo === .3 && gent.hi === .7 && gent.key === 'luma', 'Gentle matches the Python values exactly');

const spec = P.fromParams({ ...base, angle: 350, length: 100, randomness: 3 }, true);
let wrapOk = true; for (let s = 0; s < 300; s++) { const r = P.roll({ spec }, P.mulberry32(s), base); if (r.angle < 0 || r.angle > 359 || !(r.angle >= 330 || r.angle <= 10) || r.randomness < 0 || r.randomness > 13 || r.length < 70 || r.length > 130) wrapOk = false; }
ok(wrapOk, 'a saved "roll a little" preset wraps angle across 0 and stays within its spread');
ok(!P.rolls({ spec: P.fromParams(base, false) }), 'a saved plain preset is exact');
ok(P.diff({ ...base }, { ...base }).length === 0 && P.diff({ ...base }, { ...base, angle: 9 }).join() === 'angle', 'diff names the fields you changed after applying');

// ---- the Studio picker ----
const b2 = await chromium.launch();
const pg = await b2.newPage({ viewport: { width: 1440, height: 900 } });
pg.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await pg.goto(mock('studio.html')); await pg.evaluate(() => localStorage.removeItem('pixelsort.mock.presets')); await pg.reload(); await pg.waitForTimeout(900);
const params = () => pg.evaluate(() => __mock.d.params);
ok((await pg.textContent('#kPreset')) === 'custom', 'before choosing, the dock says "custom"');
await pg.click('#kPresetBox'); await pg.waitForTimeout(400);
ok((await pg.locator('.pcard').count()) === 8, 'the picker shows all eight built-ins');
const box = await pg.locator('#pop').boundingBox();
ok(box.x >= 0 && box.x + box.width <= 1440 && box.y >= 0, 'the wide popover stays on screen');
await pg.click('.pcard[data-p="kims"]'); await pg.waitForTimeout(500);
let q = await params();
ok(q.mode === 'threshold' && q.angle === 90 && q.hi >= .15 && q.hi <= .84, 'picking Kims applies threshold at 90° ('+q.hi+')');
ok((await pg.textContent('#kPreset')) === 'Kims' && (await pg.textContent('#kPresetL')) === 'Preset', 'the dock names it, with no "edited" tag yet');
await pg.click('#reroll'); await pg.waitForTimeout(300);
const seen = new Set(); for (let i = 0; i < 12; i++) { await pg.click('#reroll'); seen.add((await params()).hi); }
ok(seen.size > 3, '"Roll again" gives fresh values each time (' + seen.size + ' distinct in 12)');
await pg.click('.pcard[data-p="gentle"]'); await pg.waitForTimeout(300);
ok(!(await pg.locator('#reroll').count()), 'a fixed preset offers no "roll again"');
q = await params(); ok(q.length === 25 && q.randomness === 5, 'Gentle applies its exact values');
await pg.mouse.click(30, 450);
await pg.click('[data-k="chaos"]'); await pg.fill('#pr', '40'); await pg.dispatchEvent('#pr', 'input'); await pg.waitForTimeout(300);
ok((await pg.textContent('#kPresetL')) === 'Preset · edited' && (await pg.textContent('#kPreset')) === 'Gentle', 'changing a knob marks the preset "edited"');
await pg.mouse.click(30, 450);
// save + delete
await pg.click('#kPresetBox'); await pg.waitForTimeout(300);
await pg.click('#pSave'); await pg.waitForTimeout(150); ok(!(await pg.locator('.pyours .chip').count()), 'saving without a name does nothing');
await pg.fill('#pName', 'Gentle'); await pg.click('#pSave'); await pg.waitForTimeout(150); ok(!(await pg.locator('.pyours .chip').count()), 'a name that is taken is refused');
await pg.fill('#pName', 'Mine'); await pg.click('#pSpread'); await pg.click('#pSave'); await pg.waitForTimeout(300);
ok((await pg.locator('.pyours .chip').count()) === 1 && (await pg.textContent('#kPreset')) === 'Mine' && (await pg.textContent('#kPresetL')) === 'Preset', 'saving adds it and makes it the active preset');
await pg.click('.pcard[data-p="intense"]'); await pg.waitForTimeout(300);
await pg.click('.pyours .chip'); await pg.waitForTimeout(300);
q = await params(); ok(q.randomness >= 30 && q.randomness <= 50 && q.mode === 'threshold' && q.key === 'luma' && (q.angle >= 340 || q.angle <= 20), 'applying the saved one restores its recipe, rolled a little (unsorted 40 ±10: ' + q.randomness + ', angle ' + q.angle + ')');
await pg.reload(); await pg.waitForTimeout(700); await pg.click('#kPresetBox'); await pg.waitForTimeout(300);
ok((await pg.locator('.pyours .chip').count()) === 1, 'saved presets survive a reload');
await pg.click('.pyours .chip u'); await pg.waitForTimeout(200); ok(!(await pg.locator('.pyours .chip').count()), 'the × deletes it');
await pg.evaluate(() => localStorage.removeItem('pixelsort.mock.presets'));

// ---- the phone sheet shares the same presets ----
const ph = await b2.newPage({ viewport: { width: 900, height: 900 } });
ph.on('pageerror', (e) => errs.push('PHONE PAGEERR ' + e.message)); ph.on('console', (m) => { if (m.type() === 'error') errs.push('phone: ' + m.text()); });
await ph.goto(mock('phone.html')); await ph.evaluate(() => localStorage.removeItem('pixelsort.mock.presets')); await ph.reload(); await ph.waitForTimeout(800);
const pp = () => ph.evaluate(() => __mock && __mock.d ? __mock.d.params : null).catch(() => null);
await ph.click('#sheet .grab'); await ph.waitForTimeout(500);
ok((await ph.locator('#presets .pcard').count()) === 8, 'phone: the rail shows all eight built-ins');
ok((await ph.textContent('#vPre')) === 'custom', 'phone: label starts as "custom"');
await ph.locator('#presets .pcard[data-id="gentle"]').scrollIntoViewIfNeeded(); await ph.click('#presets .pcard[data-id="gentle"]'); await ph.waitForTimeout(400);
ok((await ph.textContent('#vPre')) === 'Gentle' && (await ph.inputValue('#sLen')) === '25' && (await ph.inputValue('#sRnd')) === '5', 'phone: Gentle applies and the sliders follow (25 px, 5 %)');
ok(!(await ph.locator('#pRoll').isVisible()), 'phone: a fixed preset has no "Roll again"');
await ph.fill('#sRnd', '40'); await ph.dispatchEvent('#sRnd', 'input'); await ph.waitForTimeout(200);
ok((await ph.textContent('#vPre')) === 'Gentle · edited', 'phone: moving a slider marks it edited');
await ph.locator('#presets .pcard[data-id="main"]').scrollIntoViewIfNeeded(); await ph.click('#presets .pcard[data-id="main"]'); await ph.waitForTimeout(300);
ok(await ph.locator('#pRoll').isVisible() && (await ph.textContent('#pRoll')) === 'Roll Main again', 'phone: a rolling preset offers "Roll Main again"');
const seenA = new Set(); for (let i = 0; i < 10; i++) { await ph.click('#pRoll'); seenA.add(await ph.inputValue('#sRnd') + '/' + await ph.inputValue('#sLen')); }
ok(seenA.size > 3, 'phone: rolling again gives different values (' + seenA.size + ' of 10)');
await ph.click('#pSaveBtn'); await ph.fill('#pName', 'Phone one'); await ph.click('#pSave'); await ph.waitForTimeout(300);
ok((await ph.locator('#presets .pcard').count()) === 9 && (await ph.textContent('#vPre')) === 'Phone one', 'phone: saving adds a card and activates it');
ok(await ph.locator('#pDel').isVisible(), 'phone: a saved preset can be deleted');
await ph.click('#pDel'); await ph.waitForTimeout(200); ok((await ph.locator('#presets .pcard').count()) === 8 && (await ph.textContent('#vPre')) === 'custom', 'phone: delete removes it');
await ph.evaluate(() => localStorage.removeItem('pixelsort.mock.presets'));
console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nPRESET CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b2.close();
