// States: storage at 80 % / 100 %, empty, offline — the wording rules, then Archive, Studio and phone.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const A = createRequire(import.meta.url)(path.join(MOCKUPS, 'shared', 'states.js'));
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };

// ---- pure rules (PLAN.md §6: warn at 80 %, at 100 % still saves, never auto-deletes) ----
const lv = (g) => A.usage(g).level;
ok(lv(0) === 'ok' && lv(39.9) === 'ok' && lv(40) === 'warn' && lv(49.9) === 'warn' && lv(50) === 'full' && lv(51.3) === 'full', 'usage levels: ok below 40 GB, warn from 40, full from 50');
ok(A.usage(39.99).pct === 79 && A.usage(40).pct === 80 && A.usage(49.9).pct === 99 && A.usage(51.3).pct === 102, 'the percentage never rounds up into the next state (49.9 GB reads 99 %)');
ok(A.status({ used: 20, offline: false }) === null, 'nothing is said when all is well');
const w = A.status({ used: 41, offline: false }), f = A.status({ used: 52, offline: false });
ok(/80|82/.test(w.text) && /never|nothing is deleted/i.test(w.sub), 'warn: says the percentage and that nothing is deleted');
ok(/full/i.test(f.text) && /still save/i.test(f.sub) && /nothing is deleted/i.test(f.sub) && f.kind === 'full', 'full: says new runs still save and nothing is deleted');
const o = A.status({ used: 52, offline: true }, { pending: 3 });
ok(o.kind === 'offline' && /sorting still works/i.test(o.text) && /3 runs/.test(o.sub), 'offline outranks full, and says sorting still works and how many runs are waiting');
ok(/1 run will/.test(A.status({ offline: true }, { pending: 1 }).sub), 'singular: "1 run will save"');
ok(/Can’t reach your server/.test(A.status({ offline: true }, { surface: 'archive' }).text), 'the Archive words offline differently (nothing is sorted there)');
let segOk = true; for (const [u, b] of [[0, 0], [38.2, 1.4], [51.3, 1.4], [0.5, 1.4]]) { const s = A.segments(u, b), sum = s.results + s.originals + s.thumbs + s.bin; if (Math.abs(sum - u) > 1e-9 || Object.values(s).some((v) => v < 0)) segOk = false; }
ok(segOk, 'meter segments add up to the total and are never negative');
const q = A.fromQuery('?used=40.5&offline&empty'); ok(q.used === 40.5 && q.offline && q.empty && A.fromQuery('').used === null, 'the mockup switches parse');

const b = await chromium.launch();
const open = async (file, vp = { width: 1440, height: 900 }) => { const p = await b.newPage({ viewport: vp }); p.on('pageerror', (e) => errs.push(file + ' PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(file + ': ' + m.text()); }); await p.goto(mock(file)); await p.waitForTimeout(700); return p; };

// ---- Archive ----
let g = await open('gallery.html');
ok(!(await g.locator('#stBanner.on').count()) && (await g.textContent('#uNum')) === '38.2', 'Archive: 38.2 GB — no banner');
g = await open('gallery.html?used=40');
ok((await g.locator('#stBanner.warn').count()) === 1 && /80% full/.test(await g.textContent('#stText')) && (await g.getAttribute('#meter u', 'data-l')) === 'warn at 40 GB', 'Archive: 40 GB shows the warn banner (80 % full)');
g = await open('gallery.html?used=51.3');
ok((await g.locator('#stBanner.full').count()) === 1 && /102%/.test(await g.textContent('#uPct')) && (await g.getAttribute('#meter u', 'data-l')) === 'limit 50 GB', 'Archive: 51.3 GB shows the full banner, 102 %, and moves the limit mark');
const widths = await g.$$eval('#meter i', (els) => els.map((e) => parseFloat(e.style.width))); ok(Math.abs(widths.reduce((a, c) => a + c, 0) - 100) < 0.01, 'Archive: over budget, the meter still fills exactly its width (' + widths.reduce((a, c) => a + c, 0).toFixed(1) + '%)');
await g.click('#stAct'); await g.waitForTimeout(600); ok(await g.locator('#smart.on').count() === 1, 'Archive: "Free up space" opens the smart-select menu');
await g.click('.tab[data-t="trash"]'); await g.click('#emptyBtn'); await g.click('#cfYes'); await g.waitForTimeout(300);
ok((await g.textContent('#uNum')) === '49.9' && (await g.locator('#stBanner.warn').count()) === 1 && /99% full/.test(await g.textContent('#stText')), 'Archive: emptying the bin frees 1.4 GB and drops "full" to a warning (49.9 GB, 99 %)');
// empty
g = await open('gallery.html?empty');
ok((await g.textContent('#empty h3')) === 'Nothing sorted yet.' && (await g.locator('#empty a[href="studio.html"]').count()) === 1, 'Archive (empty): "Nothing sorted yet." with a way into Studio');
ok(!(await g.locator('#toolbar').isVisible()) && (await g.textContent('#uNum')) === '0.0' && (await g.textContent('#nAll')) === '0', 'Archive (empty): no toolbar, 0.0 GB, counts at 0');
const heads = []; for (const t of ['starred', 'trash', 'albums']) { await g.click(`.tab[data-t="${t}"]`); heads.push(await g.textContent('#empty h3')); }
ok(heads.join('|') === 'No stars yet.|The bin is empty.|No links out in the world.', 'Archive (empty): each tab explains itself (' + heads.join(' / ') + ')');
ok(!(await g.locator('#banner.on').count()), 'Archive (empty): no "bin empties itself" banner over an empty bin');
// offline
g = await open('gallery.html?offline');
ok((await g.locator('#stBanner.offline').count()) === 1 && /Can’t reach your server/.test(await g.textContent('#stText')), 'Archive (offline): says it can’t reach the server');
const starsBefore = await g.locator('.fr.starred').count();
await g.hover('.fr >> nth=0'); await g.click('.fr >> nth=0 >> .star', { force: true }); await g.waitForTimeout(250);
ok(/offline/i.test(await g.textContent('#toast')) && (await g.locator('.fr.starred').count()) === starsBefore, 'Archive (offline): starring is refused with a clear reason');
await g.click('.fr >> nth=0 >> .img'); await g.waitForTimeout(300); ok(await g.locator('#viewer.on').count() === 1, 'Archive (offline): viewing a run still works');
await g.keyboard.press('Escape'); await g.click('#stAct'); await g.waitForTimeout(150); ok((await g.locator('#stBanner.offline').count()) === 1, 'Archive (offline): the first Retry fails');
await g.click('#stAct'); await g.waitForTimeout(250); ok(!(await g.locator('#stBanner.on').count()), 'Archive (offline): the second Retry brings it back');

// ---- Studio ----
let s = await open('studio.html?used=51.3');
ok((await s.locator('.st-pill.full').count()) === 1 && /still save/.test(await s.textContent('.st-pill')), 'Studio: a full Archive shows a pill that says runs still save');
await s.click('.st-pill [data-x]'); ok(!(await s.locator('.st-pill').count()), 'Studio: the storage pill can be dismissed');
s = await open('studio.html?used=51.3'); await s.click('.st-pill [data-a]'); await s.waitForTimeout(500);
ok(/gallery\.html\?used=51\.3&smart/.test(s.url()), 'Studio: "Free up space" jumps to the Archive with the menu open');
s = await open('studio.html?used=41'); ok((await s.locator('.st-pill.warn').count()) === 1 && /82% full/.test(await s.textContent('.st-pill')), 'Studio: 41 GB shows the 80 % warning');
s = await open('studio.html?offline');
ok((await s.locator('.st-pill.offline').count()) === 1 && /sorting still works/i.test(await s.textContent('.st-pill')) && /3 runs/.test(await s.textContent('.st-pill')), 'Studio (offline): says sorting still works and 3 runs are waiting');
ok(await s.evaluate(() => __mock.d.running), 'Studio (offline): it keeps sorting');
await s.keyboard.press('e'); await s.waitForTimeout(300); ok(await s.locator('.xd').count() === 1, 'Studio (offline): export is local, so it still opens'); await s.keyboard.press('Escape');
await s.keyboard.press('n'); await s.fill('#urlIn', 'https://example.com/a.jpg'); await s.click('#urlGo'); await s.waitForTimeout(250);
ok(/offline/i.test(await s.textContent('#toast')) && /can’t load/.test(await s.textContent('#toast')), 'Studio (offline): link loading explains itself instead of failing silently'); await s.keyboard.press('Escape');
await s.click('.st-pill [data-a]'); await s.waitForTimeout(150); ok(await s.locator('.st-pill').count() === 1, 'Studio (offline): the first Retry fails');
await s.click('.st-pill [data-a]'); await s.waitForTimeout(250); ok(!(await s.locator('.st-pill').count()) && /Back online/.test(await s.textContent('#toast')), 'Studio (offline): the second works and says how many saved');
// the browser's own events
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const rp = await ctx.newPage(); rp.on('pageerror', (e) => errs.push('studio-ev ' + e.message));
await rp.goto(mock('studio.html')); await rp.waitForTimeout(600); ok(!(await rp.locator('.st-pill').count()), 'Studio: online and under 80 % — nothing in the way');
await ctx.setOffline(true); await rp.waitForTimeout(400); ok((await rp.locator('.st-pill.offline').count()) === 1, 'Studio: the browser going offline shows the pill by itself');
await ctx.setOffline(false); await rp.waitForTimeout(400); ok(!(await rp.locator('.st-pill').count()), 'Studio: and coming back removes it');
s = await open('studio.html?empty'); await s.keyboard.press('Escape'); await s.keyboard.press('g'); await s.waitForTimeout(500); ok(/Nothing here yet/.test(await s.textContent('#cells')), 'Studio (empty): the runs strip says it is empty');

// ---- Phone ----
const pv = { width: 390, height: 844 };
let p = await open('phone.html?offline', pv); const pill = p.locator('#phone .st-pill.st-compact'); const pb = await pill.boundingBox();
ok(await pill.count() === 1 && pb.x >= 0 && pb.x + pb.width <= 391 && pb.height < 130, 'Phone (offline): the pill sits inside the screen');
const rb = await pill.locator('[data-a]').boundingBox(); ok(rb.height >= 44, 'Phone (offline): Retry is a real tap target (' + Math.round(rb.height) + ' px)');
p = await open('phone.html?used=51.3', pv); ok(await p.locator('#phone .st-pill.full').count() === 1, 'Phone: a full Archive shows the pill');
await p.click('.st-pill [data-a]'); await p.waitForTimeout(500); ok(await p.locator('#p-runs.on').count() === 1 && /51\.3/.test(await p.textContent('#phUsed')), 'Phone: "Free up space" opens the Runs tab, which shows 51.3 / 50 GB');
p = await open('phone.html?empty', pv); await p.click('#tabs [data-t="runs"]'); await p.waitForTimeout(400); ok(/Nothing here yet/.test(await p.textContent('#grid')), 'Phone (empty): the Runs tab says it is empty');

console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nSTATE CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b.close();
