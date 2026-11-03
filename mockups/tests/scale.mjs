// Scaling from 7 runs to 2,000: the virtual list's maths, the fake data, grouping, search — then Studio, Archive and phone.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const req = createRequire(import.meta.url);
const V = req(path.join(MOCKUPS, 'shared', 'virtual-list.js')), D = req(path.join(MOCKUPS, 'shared', 'runs-data.js'));
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };
function rnd(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- virtual list maths ----
{ const r = rnd(5); let bad = 0, tests = 0, maxLive = 0;
  for (let trial = 0; trial < 60; trial++) {
    const n = 1 + Math.floor(r() * 3000), rows = Array.from({ length: n }, () => ({ h: 20 + Math.floor(r() * 120) })), off = V.layout(rows), total = off[n], over = Math.floor(r() * 500), vh = 100 + Math.floor(r() * 900);
    if (Math.abs(total - rows.reduce((a, x) => a + x.h, 0)) > 1e-6) bad++;
    let prev = [-1, -1];
    for (let st = -50; st < total + 100; st += Math.max(1, Math.floor(vh / 3))) {
      tests++; const [s, e] = V.range(off, st, vh, over);
      for (let i = 0; i < n; i++) { const hit = off[i] < st + vh && off[i + 1] > st; if (hit && !(i >= s && i < e)) { bad++; break; } if (i > e + 2 && off[i] > st + vh + over + 200) break; }
      if (s < 0 || e > n || s > e) bad++;
      if (s < prev[0] || e < prev[1]) { if (st > 0 && st < total) bad++; }
      prev = [Math.max(prev[0], s), Math.max(prev[1], e)]; maxLive = Math.max(maxLive, e - s);
    }
    for (let k = 0; k < 40; k++) { const y = r() * total, i = V.rowAt(off, y); if (!(off[i] <= y && y < off[i + 1])) bad++; }
  }
  ok(bad === 0, 'virtual list: every row touching the viewport is rendered, ranges stay in bounds and only move forward (' + tests + ' scroll positions, 60 lists)');
  ok(maxLive < 80, 'virtual list: never more than ' + maxLive + ' rows live, however long the list (≤ 3,000 rows)');
  const e = V.layout([]); ok(V.range(e, 0, 500, 100)[1] === 0 && V.rowAt(e, 10) === 0, 'virtual list: an empty list renders nothing and does not throw');
}

// ---- data + grouping + search ----
const A = D.make(2000), B = D.make(2000);
ok(JSON.stringify(A) === JSON.stringify(B) && A.length === 2000, 'runs data: deterministic, 2,000 runs');
ok(A.every((x, i) => i === 0 || x.age >= A[i - 1].age) && A[0].age === 0 && A[1999].age <= 540, 'runs data: newest first, spanning about 18 months');
const stars = A.filter((x) => x.starred).length; ok(stars > 80 && stars < 260, 'runs data: roughly 8 % starred (' + stars + ')');
ok([0, 1, 2, 6, 7, 13, 14].map(D.groupLabel).join('|') === 'Today|Yesterday|This week|This week|Last week|Last week|' + D.groupLabel(14), 'grouping: Today / Yesterday / This week / Last week boundaries');
ok(/^(Oct|Sep|Nov) 2026$/.test(D.groupLabel(14)) && /2025$/.test(D.groupLabel(400)), 'grouping: older runs read "Oct 2026", "Sep 2025"…');
for (const cols of [1, 3, 4, 7]) {
  const { rows, jumps } = D.rows(A, { cols, headH: 30, rowH: 120 }); const items = rows.filter((r) => r.type === 'cards').flatMap((r) => r.items);
  ok(items.length === 2000 && items.every((x, i) => x.id === A[i].id), `rows(${cols} cols): every run appears once, in order`);
  ok(rows.every((r) => r.type === 'head' || r.items.length <= cols) && rows.filter((r) => r.type === 'cards').slice(0, -1).every((r, i, a) => r.items.length === cols || a[i + 1]), `rows(${cols} cols): no card row is wider than ${cols}`);
  ok(jumps.every((j) => rows[j.row].type === 'head' && rows[j.row].label === j.label) && new Set(jumps.map((j) => j.label)).size === jumps.length, `rows(${cols} cols): each date appears as one header, and the jump index points at it (${jumps.length} headers)`);
  ok(rows.every((r, i) => r.type !== 'head' || !rows[i - 1] || rows[i - 1].type === 'cards') && rows[0].type === 'head', `rows(${cols} cols): a header never follows another header and the list starts with one`);
}
ok(!D.rows(A, { cols: 3, sort: 'big' }).rows.some((r) => r.type === 'head'), 'rows: sorting by size is flat — no date headers');
ok(D.filter(A, {}).length === 2000 && D.filter(A, { q: '' }).length === 2000, 'search: empty query keeps everything');
const rainy = D.filter(A, { q: 'rain' }); ok(rainy.length > 0 && rainy.length < 400 && rainy.every((x) => /rain/i.test(x.name)), 'search: "rain" finds only matching names (' + rainy.length + ')');
ok(D.filter(A, { q: 'RAIN' }).length === rainy.length, 'search: case-insensitive');
const both = D.filter(A, { q: 'rain cellular' }); ok(both.length < rainy.length && both.every((x) => /rain/i.test(x.name) && /cellular/i.test(x.name)), 'search: several words must all match (' + both.length + ')');
ok(D.filter(A, { q: 'hue threshold' }).every((x) => x.p.key === 'hue' && x.p.mode === 'threshold'), 'search: finds by sort key and mode, not just name');
ok(D.filter(A, { starred: true }).length === stars && D.filter(A, { q: 'zzzzqq' }).length === 0, 'search: starred-only works; nonsense finds nothing');

// ---- Studio filmstrip ----
const b = await chromium.launch();
const open = async (file, vp = { width: 1440, height: 900 }) => { const p = await b.newPage({ viewport: vp }); p.on('pageerror', (e) => errs.push(file + ' PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(file + ': ' + m.text()); }); await p.goto(mock(file)); await p.waitForTimeout(700); return p; };
let s = await open('studio.html?runs=2000'); await s.keyboard.press('g'); await s.waitForTimeout(500);
const cells = () => s.locator('#cells .cell').count();
ok((await cells()) > 0 && (await cells()) < 40, 'Studio strip: 2,000 runs, but only ' + await cells() + ' cards in the page');
ok(/2,000/.test(await s.textContent('#strip h5')), 'Studio strip: the header counts all 2,000');
ok(/Today/.test(await s.textContent('#cells')), 'Studio strip: starts at "Today"');
await s.evaluate(() => { const st = document.getElementById('strip'); st.scrollTo(0, st.scrollHeight); }); await s.waitForTimeout(500);
ok((await cells()) < 40 && /1[78] mo ago/.test(await s.textContent('#cells')) && !/Today|yesterday/.test(await s.textContent('#cells')), 'Studio strip: scrolled to the bottom, only a few cards exist and they are the oldest (18 months)');
const imgs = await s.locator('#cells .cell img').count(); ok(imgs === (await cells()), 'Studio strip: thumbnails exist only for visible cards (' + imgs + ')');
await s.evaluate(() => document.getElementById('strip').scrollTo(0, 0)); await s.waitForTimeout(300);
await s.click('#stripStar'); await s.waitForTimeout(400); const nStar = await s.evaluate(() => document.querySelectorAll('#cells .cell').length);
ok(/\d+ starred|★/.test(await s.textContent('#strip h5')) && (await cells()) > 0, 'Studio strip: the ★ filter narrows it (' + (await s.textContent('#strip h5')).replace(/\s+/g, ' ').trim() + ')');
await s.click('#stripStar'); await s.waitForTimeout(300);
await s.fill('#stripSearch', 'rain'); await s.waitForTimeout(500);
ok((await s.locator('#cells .cell').allTextContents()).every((t) => /rain/i.test(t)) && (await cells()) > 0, 'Studio strip: search shows only matching runs');
await s.fill('#stripSearch', 'zzzzqq'); await s.waitForTimeout(400); ok(/No runs match/.test(await s.textContent('#cells')), 'Studio strip: no matches says so');
await s.fill('#stripSearch', ''); await s.waitForTimeout(400);
const jumps = await s.locator('#stripJump button').count(); ok(jumps >= 10, 'Studio strip: a jump rail lists the dates (' + jumps + ')');
await s.click('#stripJump button >> nth=-3'); await s.waitForTimeout(700); const lab = await s.evaluate(() => document.querySelector('#stripJump button.on') && document.querySelector('#stripJump button.on').textContent);
ok(await s.evaluate(() => document.getElementById('strip').scrollTop) > 500 && !!lab, 'Studio strip: clicking a date jumps there and the rail marks it (' + lab + ')');
await s.waitForFunction(() => new Promise((res) => { const el = document.getElementById('strip'); const a = el.scrollTop; setTimeout(() => res(el.scrollTop === a), 250); }), null, { timeout: 8000 }); await s.waitForTimeout(250);
const vis = await s.evaluate(() => { const c = [...document.querySelectorAll('#cells .cell')].findIndex((e) => { const r = e.getBoundingClientRect(); return r.top > 150 && r.bottom < 700; }); return c; }); await s.locator('#cells .cell').nth(vis).click(); await s.waitForTimeout(300); ok(/Reopened/.test(await s.textContent('#toast')), 'Studio strip: a card reopens its run');
s = await open('studio.html'); await s.keyboard.press('g'); await s.waitForTimeout(400);
ok((await s.locator('#cells .cell').count()) === 7 && !(await s.locator('#stripSearch').isVisible()), 'Studio strip: the normal 7-run strip is unchanged (no search or rail clutter)');

// ---- Archive ----
let g = await open('gallery.html?runs=2000');
ok(/2,000/.test(await g.textContent('#nAll')) && (await g.locator('#grid .fr').count()) < 80 && (await g.locator('#grid .fr').count()) > 0, 'Archive: 2,000 runs, ' + await g.locator('#grid .fr').count() + ' cards in the page');
ok(/Today/.test(await g.textContent('#grid')), 'Archive: grouped by date, starting at Today');
const pageH = await g.evaluate(() => document.documentElement.scrollHeight); ok(pageH > 20000, 'Archive: the page is as tall as 2,000 runs would be (' + pageH + ' px)');
await g.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await g.waitForTimeout(600);
ok((await g.locator('#grid .fr').count()) < 80 && /1[78] mo ago/.test(await g.textContent('#grid')), 'Archive: at the bottom it is still light, and the cards are the oldest');
await g.evaluate(() => window.scrollTo(0, 0)); await g.waitForTimeout(400);
await g.fill('#q', 'kims'); await g.waitForTimeout(500);
ok((await g.locator('#grid .fr .cap b').allTextContents()).every((t) => /kims/i.test(t)) && (await g.locator('#grid .fr').count()) > 0, 'Archive: the search box really filters (it did nothing before)');
await g.fill('#q', ''); await g.waitForTimeout(300);
await g.click('#grid .fr >> nth=0 >> .cb', { force: true }); await g.waitForTimeout(200); ok((await g.textContent('#bN')) === '1', 'Archive: selecting a card works in the virtual grid');
await g.evaluate(() => window.scrollTo(0, 9000)); await g.waitForTimeout(400); await g.click('#grid .fr >> nth=2 >> .cb', { force: true }); await g.waitForTimeout(200);
ok((await g.textContent('#bN')) === '2', 'Archive: a selection survives scrolling away and adding another from far below');
await g.evaluate(() => window.scrollTo(0, 0)); await g.waitForTimeout(400); ok(await g.locator('#grid .fr.sel').count() === 1, 'Archive: and the first one is still ticked when you come back');
await g.click('#sort'); await g.selectOption('#sort', 'big'); await g.waitForTimeout(400); ok(!/Today/.test(await g.textContent('#grid')), 'Archive: sorting by size drops the date headers');
g = await open('gallery.html'); ok((await g.locator('#grid .fr').count()) === 14 && !(await g.locator('#grid .grp').count()), 'Archive: the normal archive is unchanged');

// ---- Phone ----
const p = await open('phone.html?runs=2000', { width: 390, height: 844 }); await p.click('#sheet .grab'); await p.click('#sheet .grab'); await p.click('#tabs [data-t="runs"]'); await p.waitForTimeout(600);
ok((await p.locator('#grid .th').count()) > 0 && (await p.locator('#grid .th').count()) < 60, 'Phone: 2,000 runs, ' + await p.locator('#grid .th').count() + ' thumbnails in the page');
ok(/Today/.test(await p.textContent('#grid')) && /2,000/.test(await p.textContent('#phUsed') + await p.textContent('#p-runs .lbl')), 'Phone: dated, and says how many there are');
await p.evaluate(() => { const pn = document.getElementById('p-runs'); pn.scrollTo(0, pn.scrollHeight); }); await p.waitForTimeout(500); ok((await p.locator('#grid .th').count()) < 60, 'Phone: still light at the bottom');
ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'Phone: no sideways scroll');
await p.evaluate(() => document.getElementById('p-runs').scrollTo(0, 0)); await p.waitForTimeout(400);
await p.click('#grid .th >> nth=1'); await p.waitForTimeout(250); ok(await p.locator('#selbar.on').count() === 1 && /Send 1/.test(await p.textContent('#bShare')), 'Phone: selecting a thumbnail shows the Send bar');
await p.evaluate(() => document.getElementById('p-runs').scrollTo(0, 20000)); await p.waitForTimeout(400); await p.evaluate(() => document.getElementById('p-runs').scrollTo(0, 0)); await p.waitForTimeout(400);
ok(await p.locator('#grid .th.sel').count() === 1, 'Phone: the ticked thumbnail is still ticked after scrolling away and back');
await p.fill('#phQ', 'kims'); await p.waitForTimeout(500); { const n = await p.locator('#grid .th').count(); ok(n > 0 && n < 40, 'Phone: search narrows the grid (' + n + ' thumbnails)'); }
await p.fill('#phQ', 'zzzzqq'); await p.waitForTimeout(400); ok(/No runs match/.test(await p.textContent('#grid')), 'Phone: no matches says so');
{ const th = await (async () => { await p.fill('#phQ', ''); await p.waitForTimeout(400); return p.locator('#grid .th').first().boundingBox(); })(); ok(th.width >= 44 && th.height >= 44, 'Phone: thumbnails are real tap targets (' + Math.round(th.width) + '×' + Math.round(th.height) + ')'); }

// ---- first paint of the big lists must not scale with their length ----
for (const [file, sel] of [['gallery.html?runs=2000', '#grid .fr'], ['gallery.html?runs=200', '#grid .fr']]) {
  const q = await b.newPage({ viewport: { width: 1440, height: 900 } }); const t0 = Date.now(); await q.goto(mock(file)); await q.waitForSelector(sel); const ms = Date.now() - t0; await q.close();
  file.includes('2000') ? (global.__ms2000 = ms) : (global.__ms200 = ms);
}
ok(global.__ms2000 < 5000 && global.__ms2000 < global.__ms200 * 4 + 1500, 'Archive: 2,000 runs paint in ' + global.__ms2000 + ' ms (200 runs: ' + global.__ms200 + ' ms) — cost follows the screen, not the list');

console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nSCALE CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b.close();
