// Export: the planner's properties (spec for the Go planner), then the dialog in Studio and on the phone.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const E = createRequire(import.meta.url)(path.join(MOCKUPS, 'shared', 'export-model.js'));
const fails = [], errs = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };

// ---- planner properties ----
let bad = 0, n = 0;
for (const dev of Object.keys(E.DEVICES)) for (let mp = 0.5; mp <= 160; mp *= 1.37) for (const ar of [1, 1.5, 1.78, 0.67]) {
  const h = Math.round(Math.sqrt((mp * 1e6) / ar)), w = Math.round(h * ar), p = E.plan(w, h, dev); n++;
  if (p.verdict !== 'toolarge') {
    if (p.memMB > p.budgetMB + 1e-9) bad++;                                                  // never plan past the budget
    const i = E.BAND_STEPS.indexOf(p.bands); if (i < 0) bad++;
    if (i > 0 && E.memoryMB(w * h, E.BAND_STEPS[i - 1]) <= p.budgetMB) bad++;                // and never more bands than needed
    if ((p.bands === 1) !== (p.verdict === 'ok')) bad++;
  } else {
    if (E.memoryMB(w * h, 64) <= p.budgetMB) bad++;                                          // "too large" really is too large
    const s = E.suggestScale(w, h, dev);
    if (s !== null && E.plan(Math.round(w * s), Math.round(h * s), dev).verdict === 'toolarge') bad++;   // a suggestion always fits
  }
}
ok(bad === 0, 'plan: fits the budget, uses the fewest bands, and "too large" is honest; suggested scales fit (' + n + ' sizes)');
ok(E.plan(8660, 5774, 'phone').verdict === 'toolarge' && E.plan(8660, 5774, 'desktop').verdict === 'ok', 'a 50 MP photo: too large for a phone, fine on a desktop');
const p24 = E.plan(6000, 4000, 'phone'); ok(p24.verdict === 'banded' && p24.bands === 2, '24 MP on a phone: exported in 2 bands');
ok(E.plan(4032, 2520, 'phone').verdict === 'ok', '10 MP on a phone: one pass');
ok(E.memoryMB(50e6, 64) > 8 * 50, 'banding never goes below the 8 B/px floor');
ok(E.suggestScale(8660, 5774, 'phone') === 0.75, '50 MP on a phone suggests 75 %');
let cover = true; for (const [L, B] of [[2520, 1], [2520, 7], [5774, 64], [10, 64]]) { const r = E.bandRanges(L, B); if (r[0][0] !== 0 || r[B - 1][1] !== L || r.some((x, i) => i && x[0] !== r[i - 1][1])) cover = false; }
ok(cover, 'band ranges tile the lines exactly, with no gap or overlap');
ok(E.estimateBytes('jpeg', 95, 1e7) > E.estimateBytes('jpeg', 50, 1e7) && E.estimateBytes('webp', 90, 1e7) < E.estimateBytes('jpeg', 90, 1e7) && E.estimateBytes('png', 0, 1e7) > E.estimateBytes('jpeg', 100, 1e7), 'size estimates: quality up = bigger, WebP < JPEG < PNG');
ok(E.filename('Sunset Ridge!', 'Main · 31°', 'jpeg', '0f3a') === 'sunset-ridge-main-31-0f3a.jpg' && /^[a-z0-9.-]+$/.test(E.filename('../../etc/passwd', '<x>', 'png', '')), 'filenames are slugs — no slashes, spaces or symbols');

// ---- Studio ----
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
pg.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await pg.goto(mock('studio.html')); await pg.waitForTimeout(800);
await pg.keyboard.press('e'); await pg.waitForTimeout(400);
ok(await pg.locator('.xd').isVisible(), 'Studio: E opens the export dialog');
ok((await pg.textContent('[data-act="go"]')).startsWith('Export PNG'), 'Studio: PNG is the default');
ok(!(await pg.locator('[data-q]').isVisible()), 'Studio: no quality slider for lossless PNG');
await pg.click('[data-fmt] [data-v="jpeg"]'); ok(await pg.locator('[data-q]').isVisible(), 'Studio: JPEG shows a quality slider');
const sz = async () => pg.textContent('[data-act="go"]');
const s92 = await sz(); await pg.fill('[data-qr]', '50'); await pg.dispatchEvent('[data-qr]', 'input'); ok((await sz()) !== s92, 'Studio: the size estimate follows quality (' + s92.replace('Export ', '') + ' → ' + (await sz()).replace('Export ', '') + ')');
await pg.click('[data-mockphoto] [data-w="8660"]'); await pg.click('[data-mockdev] [data-v="phone"]'); await pg.waitForTimeout(300);
ok((await pg.textContent('[data-verdict]')).includes('Too large') && await pg.locator('[data-act="go"]').isDisabled(), 'Studio: 50 MP on a phone is refused, Export disabled');
ok(await pg.locator('.xd-sizes button.off').count() >= 1, 'Studio: sizes that do not fit are dimmed');
await pg.click('[data-fit]'); await pg.waitForTimeout(300);
ok(!(await pg.locator('[data-act="go"]').isDisabled()) && (await pg.textContent('.xd-sizes .on b')) === '75%', 'Studio: "Export at 75%" makes it possible');
await pg.click('[data-mockphoto] [data-w="6000"]'); await pg.waitForTimeout(250);
ok((await pg.textContent('[data-verdict]')).includes('2 bands'), 'Studio: 24 MP on a phone says it will use 2 bands');
await pg.click('[data-act="go"]'); await pg.waitForTimeout(450);
ok((await pg.locator('.xd').getAttribute('data-view')) === 'running' && (await pg.locator('[data-rbands] i').count()) === 2, 'Studio: running shows one cell per band');
ok((await pg.textContent('[data-rband]')).startsWith('Band'), 'Studio: and says which band it is on');
await pg.click('[data-act="cancel"]'); await pg.waitForTimeout(200);
ok((await pg.locator('.xd').getAttribute('data-view')) === 'setup', 'Studio: Cancel returns to setup, nothing saved');
await pg.click('[data-mockdev] [data-v="desktop"]'); await pg.click('[data-mockphoto] button >> nth=0'); await pg.click('[data-act="go"]');
await pg.waitForFunction(() => document.querySelector('.xd').dataset.view === 'done', null, { timeout: 8000 });
ok(/sunset-ridge-.*\.jpg/.test(await pg.textContent('[data-dp]')), 'Studio: finishing names the file (' + (await pg.textContent('[data-dp]')).split('\n')[0].slice(0, 40) + '…)');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
ok((await pg.locator('.xd').count()) === 0 && (await pg.evaluate(() => document.activeElement && document.activeElement.tagName)) !== undefined, 'Studio: Esc closes it');
ok(!(await pg.locator('.propanel').evaluate((e) => document.body.classList.contains('pro-open'))), 'Studio: Esc did not also toggle other panels');

// ---- Phone ----
const ph = await b.newPage({ viewport: { width: 390, height: 844 } });
ph.on('pageerror', (e) => errs.push('PHONE PAGEERR ' + e.message)); ph.on('console', (m) => { if (m.type() === 'error') errs.push('phone: ' + m.text()); });
await ph.goto(mock('phone.html')); await ph.waitForTimeout(800);
await ph.click('#icSave'); await ph.waitForTimeout(400);
ok(await ph.locator('#phone .xd.xd-sheet').isVisible(), 'Phone: the save icon opens the export sheet inside the phone');
ok((await ph.locator('[data-mockdev] .on').textContent()) === 'Phone', 'Phone: the device defaults to phone');
const box = await ph.locator('.xd-card').boundingBox(); ok(box.x >= -1 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845, 'Phone: the sheet fits the screen');
await ph.click('[data-mockphoto] [data-w="8660"]'); await ph.waitForTimeout(250);
ok((await ph.textContent('[data-verdict]')).includes('Too large'), 'Phone: 50 MP is refused honestly');
const tap = await ph.locator('[data-act="close"]').first().boundingBox(); ok(tap.height >= 44, 'Phone: buttons are at least 44 px tall');
await ph.click('[data-act="close"] >> nth=0'); ok((await ph.locator('.xd').count()) === 0, 'Phone: Cancel closes the sheet');

console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nEXPORT CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b.close();
