// Errors: the catalog's rules, then every failure on every screen — what it says, what is safe, what the buttons do.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const E = createRequire(import.meta.url)(path.join(MOCKUPS, 'shared', 'errors.js'));
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };
const ACTIONS = new Set(['choose', 'close', 'save-and-drop', 'retry', 'reload', 'restart', 'smaller', 'back']);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ---- catalog ----
const codes = Object.keys(E.CATALOG);
ok(codes.length >= 11, 'catalog: ' + codes.length + ' failures described (' + codes.join(', ') + ')');
const ctxs = [{}, { mp: NaN, max: undefined, band: undefined, bands: null, scale: 0.5, device: 'phone', name: '<b>x</b>' }, { reason: 'disk' }, { reason: 'quota' }, { mb: 212, max: 40 }];
let bad = [];
for (const c of codes) for (const x of ctxs) {
  const d = E.describe(c, x), all = [d.title, d.body, d.safe, ...d.actions.map((a) => a.label)].join(' | ');
  if (!d.title || !d.body || !d.safe) bad.push(c + ' missing text');
  if (/undefined|NaN|null|\[object/.test(all)) bad.push(c + ' leaks "' + all.match(/undefined|NaN|null|\[object/)[0] + '"');
  if (d.actions.filter((a) => a.primary).length !== 1) bad.push(c + ' needs exactly one primary action');
  if (!d.actions.every((a) => ACTIONS.has(a.id) && a.label)) bad.push(c + ' has an unknown or unlabeled action');
  if (!['error', 'warn'].includes(d.tone)) bad.push(c + ' tone');
  if (d.title.length > 60) bad.push(c + ' title too long');
  if (/Exception|Error:|stack|\bat \w+\(/.test(d.title + d.body + d.safe)) bad.push(c + ' shows jargon outside Details');
}
ok(bad.length === 0, 'catalog: every failure has a title, a body and a "what is safe" line, one primary action, no "undefined", no stack-trace words' + (bad.length ? ' — ' + [...new Set(bad)].slice(0, 5).join('; ') : ''));
const u = E.describe('nope', {}); ok(u.code === 'unknown' && /Something went wrong/.test(u.title) && u.actions.length === 1, 'catalog: an unknown code still gets a calm, usable message');
ok(/band 3 of 8/.test(E.describe('export-oom', { band: 3, bands: 8 }).body) && /75%/.test(E.describe('export-oom', { scale: .75 }).actions[0].label), 'catalog: export-oom names the band and offers the next size down');
ok(/disk is full/.test(E.describe('save-failed', { reason: 'disk' }).body) && /Exporting still works/.test(E.describe('save-failed', {}).safe), 'catalog: a failed save says why and that exporting still works');

// ---- screens ----
const b = await chromium.launch();
const open = async (file, vp = { width: 1440, height: 900 }) => { const p = await b.newPage({ viewport: vp }); p.on('pageerror', (e) => errs.push(file + ' PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(file + ': ' + m.text()); }); await p.goto(mock(file)); await p.waitForTimeout(800); return p; };
const dlg = (p) => p.locator('.er');
const textOf = async (p) => (await p.textContent('.er-card')).replace(/\s+/g, ' ');

let s = await open('studio.html');
await s.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }); await s.waitForTimeout(400);
ok(await dlg(s).count() === 1 && (await dlg(s).getAttribute('role')) === 'alertdialog' && /notes\.txt/.test(await textOf(s)), 'Studio: a text file as a picture → "That isn’t a picture I can read", naming the file');
ok(/untouched/.test(await textOf(s)), 'Studio: and it says the current picture is untouched');
ok((await s.evaluate(() => document.activeElement.textContent)) === 'Choose another' && (await s.locator('.er-det').count()) === 1 && !(await s.locator('.er-det pre').isVisible()), 'Studio: the primary button has focus, and the technical detail is tucked away');
await s.click('.er-det summary'); ok(/Not an image: text\/plain/.test(await s.textContent('.er-det pre')), 'Studio: Details shows the technical reason');
await s.click('[data-copy]'); await s.waitForTimeout(200); ok(/Press/.test(await s.textContent('[data-copy]')) && (await s.evaluate(() => String(getSelection()))).includes('Not an image'), 'Studio: when the browser refuses the clipboard, Copy does not claim success — it selects the text for ⌘C');
await s.keyboard.press('Escape'); ok(await dlg(s).count() === 0, 'Studio: Esc dismisses it');
await s.setInputFiles('#file', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') }); await s.waitForTimeout(600);
ok(await dlg(s).count() === 1 && /broken/.test(await textOf(s)), 'Studio: a corrupt "png" is caught by the decoder, not just the file type');
await s.click('.er [data-a="choose"]'); await s.waitForTimeout(300); ok(await s.locator('#intake.on').count() === 1 && await dlg(s).count() === 0, 'Studio: "Choose another" goes back to the intake');
await s.keyboard.press('Escape');
s = await open('studio.html?maxmp=0.0000001'); await s.setInputFiles('#file', { name: 'big.png', mimeType: 'image/png', buffer: PNG }); await s.waitForTimeout(600);
ok(await dlg(s).count() === 1 && /too large to open here/.test(await textOf(s)) && /Nothing was changed/.test(await textOf(s)), 'Studio: a picture over the limit is refused before it can hurt the browser');
const links = { blocked: ['link-blocked', /won’t let me fetch/], notimage: ['link-not-image', /isn’t a picture/], huge: ['link-too-large', /212 MB.*40 MB/], slow: ['link-timeout', /too long/] };
for (const k in links) { s = await open('studio.html'); await s.keyboard.press('n'); await s.fill('#urlIn', 'https://example.com/' + k + '.jpg'); await s.click('#urlGo'); await s.waitForTimeout(1100);
  ok((await dlg(s).getAttribute('data-code')) === links[k][0] && links[k][1].test(await textOf(s)), `Studio: a link that fails as "${k}" → ${links[k][0]}`); }
await s.click('.er [data-a="close"]');
{ const c2 = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] }); const q = await c2.newPage(); await q.goto(mock('studio.html')); await q.waitForTimeout(600);
  await q.setInputFiles('#file', { name: 'n.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }); await q.waitForTimeout(300); await q.click('.er-det summary'); await q.click('[data-copy]'); await q.waitForTimeout(250);
  ok((await q.textContent('[data-copy]')) === 'Copied' && (await q.evaluate(() => navigator.clipboard.readText())).includes('Not an image'), 'Studio: when allowed, Copy really copies the detail and says "Copied"'); await c2.close(); }
// engine
s = await open('studio.html?error=engine');
ok(await dlg(s).count() === 1 && /sorting engine didn’t start/.test(await textOf(s)) && /fine — only the sorter is missing/.test(await textOf(s)) && !(await s.evaluate(() => __mock.d.running)), 'Studio: ?error=engine → says the engine is missing and that your pictures and settings are fine; nothing runs');
await s.click('.er [data-a="retry"]'); await s.waitForTimeout(900); ok(await dlg(s).count() === 1, 'Studio: the first Retry fails again (flaky network)');
await s.click('.er [data-a="retry"]'); await s.waitForTimeout(400); ok(await dlg(s).count() === 0 && await s.evaluate(() => __mock.d.running), 'Studio: the second Retry starts the engine');
s = await open('studio.html?error=engine'); await s.click('.er [data-a="reload"]'); await s.waitForTimeout(900); ok(!/error=/.test(s.url()) && await dlg(s).count() === 0, 'Studio: "Reload the page" reloads without the error switch');
s = await open('studio.html?error=crash'); await s.waitForTimeout(2300); ok((await dlg(s).getAttribute('data-code')) === 'engine-crashed' && /still here/.test(await textOf(s)), 'Studio: a crash mid-sort says your picture and settings are still here');
await s.click('.er [data-a="restart"]'); await s.waitForTimeout(400); ok(await s.evaluate(() => __mock.d.running) && await dlg(s).count() === 0, 'Studio: "Restart the sorter" restarts it');
// save banner: must not block
s = await open('studio.html?error=save'); await s.waitForTimeout(1700);
const bn = s.locator('.erb'); ok(await bn.count() === 1 && /disk is full/.test(await bn.textContent()) && /Exporting still works/.test(await bn.textContent()), 'Studio: a failed save is a banner that names the cause and says exporting still works');
await s.keyboard.press('Space'); await s.waitForTimeout(150); ok((await s.evaluate(() => __mock.d.running)) === false, 'Studio: it does not block — Space still pauses the sort');
await s.click('.erb [data-a="retry"]'); await s.waitForTimeout(700); ok(await s.locator('.erb').count() === 1, 'Studio: the first Retry says "Still full" and the banner returns');
await s.click('.erb [data-a="retry"]'); await s.waitForTimeout(250); ok(await s.locator('.erb').count() === 0 && /Saved/.test(await s.textContent('#toast')), 'Studio: the second Retry saves it');
// export out of memory
s = await open('studio.html'); await s.keyboard.press('e'); await s.waitForTimeout(300);
await s.click('[data-mockdev] [data-v="phone"]'); await s.click('[data-mockphoto] [data-w="6000"]'); await s.click('[data-mockfail] [data-v="3"]'); await s.click('[data-act="go"]'); await s.waitForTimeout(1500);
ok((await dlg(s).getAttribute('data-code')) === 'export-oom' && /band 2 of 2/.test(await textOf(s)) && /Export at 75% instead/.test(await textOf(s)), 'Studio: out of memory mid-export → "band 2 of 2", offers 75 %');
ok(/nothing was written/i.test(await textOf(s)) && (await s.locator('.xd').getAttribute('data-view')) === 'setup', 'Studio: and says nothing was written, back at the options');
await s.click('.er [data-a="smaller"]'); await s.waitForTimeout(300); ok((await s.textContent('.xd-sizes .on b')) === '75%' && (await s.locator('[data-mockfail] .on').textContent()) === 'works', 'Studio: "Export at 75%" picks it for you (and the failure is cleared)');
await s.click('[data-act="go"]'); await s.waitForFunction(() => document.querySelector('.xd').dataset.view === 'done', null, { timeout: 8000 }); ok(true, 'Studio: and the retry completes');

// ---- Archive ----
let g = await open('gallery.html?error=share&share'); await g.click('#smGo'); await g.waitForTimeout(1100);
ok((await dlg(g).getAttribute('data-code')) === 'share-failed' && /Nothing was shared/.test(await textOf(g)), 'Archive: a failed share says nothing was shared');
await g.click('.er [data-a="retry"]'); await g.waitForTimeout(1200); ok(await g.locator('#linkbox.on').count() === 1, 'Archive: Retry makes the link');

// ---- Phone ----
let p = await open('phone.html', { width: 390, height: 844 }); await p.click('#icNew'); await p.setInputFiles('#file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }); await p.waitForTimeout(500);
const pb = await p.locator('#phone .er-card').boundingBox(); ok(await p.locator('#phone .er').count() === 1 && pb.x >= 0 && pb.x + pb.width <= 391 && pb.y + pb.height <= 845, 'Phone: the error sits inside the screen');
const btn = await p.locator('.er-foot .btn').first().boundingBox(); ok(btn.height >= 44, 'Phone: its buttons are real tap targets (' + Math.round(btn.height) + ' px)');
await p.click('.er [data-a="choose"]'); ok(await p.locator('#mNew.on').count() === 1, 'Phone: "Choose another" reopens the picker');
await p.close(); p = await open('phone.html?maxmp=0.0000001', { width: 390, height: 844 }); await p.click('#icNew'); await p.setInputFiles('#file', { name: 'big.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(500);
ok(/phone can open up to/.test(await textOf(p)), 'Phone: too-big names the phone, not a generic device');
await p.close(); p = await open('phone.html?error=engine', { width: 390, height: 844 }); ok(await p.locator('#phone .er[data-code="engine-failed"]').count() === 1, 'Phone: ?error=engine shows the engine failure');
await p.close(); p = await open('phone.html?error=save', { width: 390, height: 844 }); await p.waitForTimeout(1500); const eb = await p.locator('#phone .erb').boundingBox(); ok(eb.x >= 0 && eb.x + eb.width <= 391 && (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'Phone: the save banner fits the screen');

console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nERROR CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b.close();
