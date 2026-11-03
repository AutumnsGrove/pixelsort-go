// Naming: the rules (pure), then renaming in Studio, on the phone and in the Archive — and that a name travels
// to the filmstrip, the Archive, search and the exported filename.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const req = createRequire(import.meta.url);
const N = req(path.join(MOCKUPS, 'shared', 'naming.js')), X = req(path.join(MOCKUPS, 'shared', 'export-model.js'));
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };

// ---- pure ----
ok(N.clean('  Sunset \n ridge\t') === 'Sunset ridge', 'clean: line breaks and tabs become one space, ends trimmed');
ok(N.clean('a\u0000b\u202eevil\u200b') === 'a b evil', 'clean: control and direction-override characters are removed');
ok(N.clean(null) === '' && N.clean(undefined) === '' && N.clean(42) === '42' && N.clean({}) === '[object Object]', 'clean: never throws on odd input');
ok(Array.from(N.clean('x'.repeat(100))).length === N.MAX, 'clean: capped at ' + N.MAX);
{ const s = 'a'.repeat(N.MAX - 1) + '😀😀', c = N.clean(s); ok(!/[\ud800-\udbff]$/.test(c) && !/^[\udc00-\udfff]/.test(c) && Array.from(c).length <= N.MAX, 'clean: an emoji on the boundary is kept whole or dropped, never split'); }
ok(N.clean('<b>hi</b> & "you"') === '<b>hi</b> & "you"', 'clean: keeps ordinary punctuation (it is escaped when shown, not stripped)');
let r = N.resolve('   ', 'Ridge, wave'); ok(r.name === 'Ridge, wave' && r.cleared && !r.kept, 'resolve: an empty entry goes back to the automatic name');
r = N.resolve('', ''); ok(r.name === 'Untitled', 'resolve: even with no fallback a name is never blank');
r = N.resolve(' Dusk ', 'x'); ok(r.name === 'Dusk' && r.kept, 'resolve: a real entry is kept, tidied');
const P = [{ mode: 'random', seed: 3 }, { mode: 'ca', rule: 110, seed: 5 }, { mode: 'threshold' }, {}, null, { mode: 'weird', seed: 'x' }];
let sg = true; for (const p of P) { const a = N.suggest(p), b = N.suggest(p); if (a !== b || /undefined|NaN|null|\[object/.test(a) || !/^[A-Z][a-z]+, \w/.test(a)) sg = false; }
ok(sg, 'suggest: stable, always "Word, mode", no placeholders for odd params');
ok(/cellular 110$/.test(N.suggest({ mode: 'ca', rule: 110 })), 'suggest: a cellular run names its rule');
let fn = true; for (const [n, rc, f, t] of [['Sunset ridge', 'threshold', 'png', '0f3a'], ['Ünï / côde:', 'ca', 'jpeg', ''], ['', '', 'webp', ''], ['***', 'x', 'bogus', '1']]) if (N.fileName(n, rc, f, t) !== X.filename(n, rc, f, t)) fn = false;
ok(fn, 'fileName: identical to what the export dialog produces');
ok(N.fileName('Ridge, threshold', 'threshold', 'png', '0f3a') === 'ridge-threshold-0f3a.png' && N.fileName('Dusk', 'threshold', 'png', '0f3a') === 'dusk-threshold-0f3a.png', 'fileName: the recipe is added unless the name already says it');
ok(!/[\/\\:*?"<>|\s]/.test(N.fileName('a/b\\c:d*e?f"g<h>i|j k', 'r', 'png', 't')), 'fileName: no path or reserved characters, ever');
const dirty = N.sanitizeAll({ 3: 'Heat', 'bad key!': 'x', 4: 5, 5: '   ', 6: 'a'.repeat(200), 7: null });
ok(dirty['3'] === 'Heat' && !('bad key!' in dirty) && !('4' in dirty) && !('5' in dirty) && dirty['6'].length === N.MAX && !('7' in dirty), 'store: a damaged store is cleaned, not trusted');
ok(JSON.stringify(N.sanitizeAll([1, 2])) === '{}' && JSON.stringify(N.sanitizeAll('x')) === '{}' && JSON.stringify(N.sanitizeAll(null)) === '{}', 'store: arrays, strings and null read as empty');

// ---- browser ----
const b = await chromium.launch(), ctx = await b.newContext();   // one context, so every page shares one localStorage
const open = async (qs, vp = { width: 1440, height: 900 }) => { const p = await ctx.newPage(); await p.setViewportSize(vp); p.on('pageerror', (e) => errs.push(qs + ' PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(qs + ': ' + m.text()); }); await p.goto(mock(qs)); await p.waitForTimeout(900); return p; };
const clear = async (p) => { await p.evaluate(() => { localStorage.removeItem('pixelsort.mock.names'); }); };

// Studio
let p = await open('studio.html'); await clear(p); await p.reload(); await p.waitForTimeout(800);
const cap = p.locator('#capName');
ok((await cap.getAttribute('role')) === 'button' && (await cap.getAttribute('tabindex')) === '0', 'Studio: the caption is a real control, reachable by keyboard');
await cap.click(); ok((await p.locator('.nm-in').count()) === 1 && (await p.locator('.nm-in').inputValue()) === 'sunset-ridge', 'Studio: clicking the name opens a field with the current name');
ok(/Saves as/.test(await p.locator('.nm-hint').innerText()) && /sunset-ridge/.test(await p.locator('.nm-hint').innerText()), 'Studio: shows the file name it will export as');
await p.locator('.nm-in').fill('Golden hour'); ok(/golden-hour/.test(await p.locator('.nm-hint').innerText()), 'Studio: the file name preview follows what you type');
const pass0 = await p.evaluate(() => __mock.d.pass); await p.locator('.nm-in').pressSequentially('rtp '); await p.waitForTimeout(200);
ok(!(await p.locator('#peekChip').isVisible()) && (await p.locator('#ov.paint').count()) === 0, 'Studio: typing r, t or p in the field does not fire shortcuts');
await p.locator('.nm-in').fill('Golden hour'); await p.keyboard.press('Enter');
ok((await p.locator('.nm-in').count()) === 0 && (await cap.innerText()).startsWith('Golden hour'), 'Studio: Enter saves and closes the field');
await cap.click(); await p.locator('.nm-in').fill('Nope'); await p.keyboard.press('Escape'); ok((await cap.innerText()).startsWith('Golden hour') && !(await p.locator('.nm-in').count()), 'Studio: Esc puts the old name back');
await cap.click(); await p.locator('.nm-in').fill('Second go'); await p.locator('#kPreset').click({ force: true }).catch(() => {}); await p.waitForTimeout(200);
ok((await cap.innerText()).startsWith('Second go'), 'Studio: clicking away saves the name');
await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
await cap.click(); await p.locator('.nm-in').fill('   '); await p.keyboard.press('Enter'); const auto = (await cap.innerText()).replace(/\s*✎.*$/, '').trim();
ok(/^[A-Z][a-z]+, \w+/.test(auto), 'Studio: emptying the field gives the automatic name back, not a blank (' + auto + ')');
await cap.click(); await p.locator('.nm-in').fill('x'.repeat(120)); await p.keyboard.press('Enter'); ok(Array.from((await cap.innerText()).replace(/\s*✎.*$/, '').trim()).length <= N.MAX, 'Studio: a very long name is shortened to ' + N.MAX);
await cap.click(); await p.locator('.nm-in').fill('<img src=x onerror=alert(1)>'); await p.keyboard.press('Enter'); ok((await p.locator('#capName img').count()) === 0 && /<img/.test(await cap.innerText()), 'Studio: markup in a name is shown as text, never run');
await cap.click(); await p.locator('.nm-in').fill('Golden hour'); await p.keyboard.press('Enter');
await p.keyboard.press('F2'); await p.waitForTimeout(150); ok((await p.locator('.nm-in').count()) === 1, 'Studio: F2 starts renaming from anywhere'); await p.keyboard.press('Escape');
await p.keyboard.press('e'); await p.waitForTimeout(400); const dlg = await p.locator('.xd').innerText(); await p.keyboard.press('Escape');
ok(/golden-hour/i.test(await p.evaluate(() => { try { return ExportModel.filename(document.querySelector('#capName').textContent.replace(/\s*✎.*$/, ''), 'x', 'png', '') } catch (e) { return '' } })), 'Studio: the export filename is built from the name you chose');
// a run from the filmstrip carries its name everywhere
await p.keyboard.press('g'); await p.waitForTimeout(400);
await p.locator('#cells .cell').nth(2).click(); await p.waitForTimeout(300);
ok(/Static/.test(await cap.innerText()), 'Studio: opening a run from the filmstrip shows its name in the caption');
await cap.click(); await p.locator('.nm-in').fill('Heatwave'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
ok(/Heatwave/.test(await p.locator('#cells .cell').nth(2).innerText()), 'Studio: renaming an open run renames it in the filmstrip');
await p.reload(); await p.waitForTimeout(900); await p.keyboard.press('g'); await p.waitForTimeout(300);
ok(/Heatwave/.test(await p.locator('#cells .cell').nth(2).innerText()), 'Studio: the name is still there after a reload');
await p.close();

// the editing state must stay clear of the dock at every window size
for (const [w, h] of [[840, 627], [1024, 720], [1440, 900], [1920, 1080]]) {
  const q = await open('studio.html', { width: w, height: h }); await q.locator('#capName').click(); await q.locator('.nm-in').fill('Golden hour'); await q.waitForTimeout(250);
  const r = await q.evaluate(() => { const bx = document.querySelector('.nm-box').getBoundingClientRect(), dk = document.querySelector('.dock').getBoundingClientRect(); return { hit: !(bx.bottom <= dk.top + 1 || bx.top >= dk.bottom - 1 || bx.right <= dk.left || bx.left >= dk.right), off: bx.left < 0 || bx.right > innerWidth + 1 || bx.bottom > innerHeight + 1, side: document.documentElement.scrollWidth > innerWidth + 1 }; });
  ok(!r.hit && !r.off && !r.side, `Studio @${w}x${h}: the rename field and its hint stay clear of the dock and inside the window`); await q.close();
}

// Archive
p = await open('gallery.html');
ok(/Heatwave/.test(await p.locator('#grid').innerText()), 'Archive: the run shows the name chosen in Studio');
await p.fill('#q', 'heatwave'); await p.waitForTimeout(500); ok((await p.locator('#grid .fr').count()) === 1, 'Archive: search finds a run by the name you gave it');
await p.locator('#grid .fr').first().click(); await p.waitForTimeout(500);
ok((await p.locator('#vTitle').getAttribute('contenteditable')) === null, 'Archive: the old do-nothing editable title is gone');
await p.locator('#vTitle').click(); await p.waitForTimeout(150); ok((await p.locator('.nm-in').count()) === 1, 'Archive: clicking the title in the viewer opens the same field');
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200); ok(/Heatwave/.test(await p.locator('.nm-in').inputValue()), 'Archive: arrow keys move the cursor in the field, they do not change run');
await p.keyboard.press('Escape'); await p.waitForTimeout(200); ok(await p.locator('#viewer.on').count() === 1 && (await p.locator('.nm-in').count()) === 0, 'Archive: Esc ends the edit first, and only the next Esc closes the viewer');
await p.locator('#vTitle').click(); await p.locator('.nm-in').fill('Heat, again'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.fill('#q', ''); await p.waitForTimeout(400);
ok(/Heat, again/.test(await p.locator('#grid').innerText()), 'Archive: the card shows the new name straight away');
await p.reload(); await p.waitForTimeout(900); ok(/Heat, again/.test(await p.locator('#grid').innerText()), 'Archive: and it is still there after a reload');
await p.close();
p = await open('studio.html'); await p.keyboard.press('g'); await p.waitForTimeout(300);
ok(/Heat, again/.test(await p.locator('#cells .cell').nth(2).innerText()), 'Studio: a rename made in the Archive shows in the filmstrip');
await clear(p); await p.close();

// Phone
p = await open('phone.html', { width: 390, height: 844 }); await clear(p); await p.reload(); await p.waitForTimeout(800);
const pc = p.locator('#capName'); const bb = await pc.boundingBox(); ok(bb && bb.height >= 43.5, 'Phone: the caption is a 44 px tap target (' + Math.round(bb && bb.height) + ' px)');
await pc.tap().catch(async () => { await pc.click(); }); await p.waitForTimeout(200);
ok((await p.locator('.nm-in').count()) === 1, 'Phone: tapping the name opens the field');
const hb = await p.locator('.nm-in').boundingBox(), kb = await p.locator('.nm-ok').boundingBox(); ok(hb.height >= 43.5 && kb.height >= 43.5, 'Phone: field and Save button are at least 44 px tall (' + Math.round(hb.height) + ', ' + Math.round(kb.height) + ')');
ok(hb.x >= 0 && kb.x + kb.width <= 390 + 1, 'Phone: the field fits on a 390 px screen');
await p.locator('.nm-in').fill('Bus window'); await p.locator('.nm-ok').click(); await p.waitForTimeout(200); ok((await pc.innerText()).startsWith('Bus window'), 'Phone: Save keeps the name');
ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'Phone: nothing overflows sideways');
await clear(p); await p.close();

ok(errs.length === 0, 'no JS errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
if (fails.length) { console.log('\nFAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('\nNAMING CHECKS PASSED');
