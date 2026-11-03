// Help & Settings: every listed shortcut really works, the tour fits every screen, settings persist and take effect.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const req = createRequire(import.meta.url);
const S = req(path.join(MOCKUPS, 'shared', 'settings.js')), H = req(path.join(MOCKUPS, 'shared', 'help.js'));
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };

// ---- pure ----
const bad = S.sanitize({ exportFormat: 'gif', exportQuality: 500, workRes: 1234, speed: 'x', motion: 'zzz', grain: 'yes', shareExpiry: '7', stripMeta: false, evil: 1 });
ok(!('exportFormat' in bad) && bad.exportQuality === 100 && !('workRes' in bad) && !('speed' in bad) && !('motion' in bad) && !('grain' in bad) && !('shareExpiry' in bad) && bad.stripMeta === false && !('evil' in bad), 'settings: garbage is dropped, numbers are clamped, real values survive');
ok(JSON.stringify(S.sanitize(null)) === '{}' && JSON.stringify(S.sanitize('x')) === '{}', 'settings: a corrupt store reads as empty, never throws');
let wc = true; for (const [w, h, l] of [[4032, 2520, 1920], [2520, 4032, 1280], [800, 600, 1920], [1, 5000, 960], [6000, 6000, 2560]]) { const c = S.workCopy(w, h, l); if (Math.max(c.w, c.h) > l || c.w < 1 || c.h < 1 || (w <= l && h <= l && (c.w !== w || c.h !== h)) || Math.abs(c.w / c.h - w / h) > 0.02 * (w / h) + 1 / Math.min(c.w, c.h)) wc = false; }
ok(wc, 'workCopy: long edge capped, aspect kept, never upscaled');
const ids = H.flat().map((i) => i.id), keys = H.flat().flatMap((i) => i.keys);
ok(new Set(ids).size === ids.length && new Set(keys).size === keys.length, 'shortcuts: no duplicate ids or keys');

// ---- Studio: the sheet is honest ----
const b = await chromium.launch();
const open = async (file, vp = { width: 1440, height: 900 }, ctx) => { const p = await (ctx || b).newPage({ viewport: vp }); p.on('pageerror', (e) => errs.push(file + ' PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(file + ': ' + m.text()); }); await p.goto(mock(file)); await p.waitForTimeout(800); return p; };
const st = await open('studio.html'); await st.evaluate(() => localStorage.clear()); await st.reload(); await st.waitForTimeout(700);
const ev = (f) => st.evaluate(f);
const probes = {
  play: async () => { const a = await ev(() => __mock.d.running); await st.keyboard.press('Space'); const b2 = await ev(() => __mock.d.running); await st.keyboard.press('Space'); return a === true && b2 === false && (await ev(() => __mock.d.running)) === true; },
  restart: async () => { await st.waitForTimeout(500); const p1 = await ev(() => __mock.d.pass); await st.keyboard.press('r'); return p1 > 3 && (await ev(() => __mock.d.pass)) < p1; },
  compare: async () => { await st.keyboard.down('c'); const a = await ev(() => __mock.d.comparing); await st.keyboard.up('c'); return a && !(await ev(() => __mock.d.comparing)); },
  peek: async () => { await st.keyboard.press('t'); const a = await st.locator('#peekChip').isVisible(); await st.keyboard.press('t'); return a && !(await st.locator('#peekChip').isVisible()); },
  paint: async () => { await st.keyboard.press('p'); const a = await st.locator('#ov.paint').count(); await st.keyboard.press('p'); return a === 1 && (await st.locator('#ov.paint').count()) === 0; },
  pro: async () => { await st.keyboard.press('Tab'); const a = await ev(() => document.body.classList.contains('pro-open')); await st.keyboard.press('Tab'); return a && !(await ev(() => document.body.classList.contains('pro-open'))); },
  new: async () => { await st.keyboard.press('n'); const a = await st.locator('#intake.on').count(); await st.keyboard.press('Escape'); return a === 1 && (await st.locator('#intake.on').count()) === 0; },
  rename: async () => { await st.keyboard.press('F2'); const a = await st.locator('.nm-in').count(); await st.keyboard.press('Escape'); return a === 1 && (await st.locator('.nm-in').count()) === 0; },
  export: async () => { await st.keyboard.press('e'); const a = await st.locator('.xd').count(); await st.keyboard.press('Escape'); return a === 1 && (await st.locator('.xd').count()) === 0; },
  runs: async () => { await st.keyboard.press('g'); const a = await st.locator('#strip.on').count(); await st.keyboard.press('g'); return a === 1 && (await st.locator('#strip.on').count()) === 0; },
  help: async () => { await st.keyboard.press('?'); const a = await st.locator('.hp').count(); await st.keyboard.press('?'); return a === 1 && (await st.locator('.hp').count()) === 0; },
  esc: async () => { await st.keyboard.press('Tab'); await st.keyboard.press('Escape'); return !(await ev(() => document.body.classList.contains('pro-open'))); },
};
ok(JSON.stringify(Object.keys(probes).sort()) === JSON.stringify([...ids].sort()), 'every shortcut in the sheet has a check, and every check is in the sheet (' + ids.length + ')');
for (const i of H.flat()) { let r = false; try { r = await probes[i.id](); } catch (e) { r = false; } ok(r, `shortcut ${i.keys.join('+')} — ${i.what}`); await st.waitForTimeout(120); }
await st.keyboard.press('?'); await st.waitForTimeout(250);
ok((await st.locator('.hp-row').count()) === ids.length && (await st.locator('.hp-row kbd').allTextContents()).join() === keys.join(), 'the sheet lists exactly the shortcuts, in order');
const pass0 = await ev(() => __mock.d.pass); await st.keyboard.press('r'); await st.keyboard.press('t'); await st.waitForTimeout(150);
ok(!(await st.locator('#peekChip').isVisible()) && (await ev(() => __mock.d.pass)) >= pass0, 'while the sheet is open, other shortcuts stay quiet');
const hb = await st.locator('.hp-card').boundingBox(); ok(hb.x >= 0 && hb.y >= 0 && hb.x + hb.width <= 1440 && hb.y + hb.height <= 900, 'the sheet sits inside the window');
await st.click('.hp [data-x]'); ok(!(await st.locator('.hp').count()), 'the × closes it');
await st.click('#bHelp'); await st.waitForTimeout(200); ok(await st.locator('.hp').count() === 1, 'the ? button in the top bar opens it'); await st.keyboard.press('Escape');

// ---- the tour ----
const tourRun = async (file, vp, label, minSteps) => {
  const p = await open(file, vp); await p.evaluate(() => localStorage.removeItem('pixelsort.mock.toured')); await p.reload(); await p.waitForTimeout(1200);
  const live = await p.locator('.tr-root').count(); if (!live) { ok(false, label + ': the tour starts on ?first'); return p; }
  const total = +(await p.textContent('.tr-root small')).match(/of (\d+)/)[1]; ok(total >= minSteps, label + ': ' + total + ' steps'); let allOk = true, bad = [];
  for (let n = 1; n <= total; n++) {
    await p.waitForTimeout(550);
    const r = await p.evaluate(() => { const c = document.querySelector('.tr-card').getBoundingClientRect(), h = document.querySelector('.tr-hole').getBoundingClientRect(); return { c: [c.left, c.top, c.right, c.bottom], h: [h.left, h.top, h.right, h.bottom], W: innerWidth, H: innerHeight }; });
    const inside = r.c[0] >= 0 && r.c[1] >= 0 && r.c[2] <= r.W && r.c[3] <= r.H, overlap = !(r.c[2] <= r.h[0] || r.c[0] >= r.h[2] || r.c[3] <= r.h[1] || r.c[1] >= r.h[3]);
    const holeSane = r.h[2] > r.h[0] + 10 && r.h[3] > r.h[1] + 10;
    if (!inside || !holeSane || (overlap && n > 1 && file.startsWith('studio'))) { allOk = false; bad.push(n + (inside ? '' : ' offscreen') + (overlap ? ' covers its target' : '')); }
    if (n < total) await p.keyboard.press('ArrowRight');
  }
  ok(allOk, label + ': every card stays on screen and (past the first) clear of what it points at' + (bad.length ? ' — ' + bad.join(', ') : ''));
  return p;
};
let tp = await tourRun('studio.html?first', { width: 1440, height: 900 }, 'Studio tour @1440', 7);
await tp.keyboard.press('Enter'); await tp.waitForTimeout(300);
ok(!(await tp.locator('.tr-root').count()) && /tour/i.test(await tp.textContent('#toast')), 'Studio tour: Done closes it and says so');
await tp.reload(); await tp.waitForTimeout(1200); ok(!(await tp.locator('.tr-root').count()), 'Studio tour: seen once, it does not return by itself on ?first');
await tp.goto(mock('studio.html?tour')); await tp.waitForTimeout(1200); ok(await tp.locator('.tr-root').count() === 1, 'Studio tour: ?tour (from Help) starts it again');
await tp.keyboard.press('r'); await tp.waitForTimeout(100); ok((await tp.textContent('.tr-root small')).startsWith('1 of'), 'Studio tour: it owns the keyboard — R did not restart or skip');
await tp.keyboard.press('ArrowRight'); await tp.keyboard.press('ArrowLeft'); ok((await tp.textContent('.tr-root small')).startsWith('1 of') && (await tp.locator('[data-back]').evaluate((e) => getComputedStyle(e).visibility)) === 'hidden', 'Studio tour: arrows go forward and back; Back is hidden on step 1');
await tp.keyboard.press('Escape'); await tp.waitForTimeout(200); ok(!(await tp.locator('.tr-root').count()) && /Skipped/.test(await tp.textContent('#toast')), 'Studio tour: Esc skips it');
await tourRun('studio.html?first', { width: 840, height: 627 }, 'Studio tour @840', 6);
await tourRun('phone.html?first', { width: 390, height: 844 }, 'Phone tour', 5);

// ---- Settings page ----
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
let sp = await open('settings.html', undefined, ctx);
ok((await sp.textContent('#wrChips .on')).includes('1920') && /1920 × 1200/.test(await sp.textContent('#wrNote')), 'Settings: desktop defaults to a 1920 px working copy (4032×2520 → 1920×1200)');
await sp.click('#wrChips [data-v="960"]'); ok(/960 × 600/.test(await sp.textContent('#wrNote')), 'Settings: choosing 960 updates the preview and memory estimate');
await sp.reload(); await sp.waitForTimeout(400); ok((await sp.textContent('#wrChips .on')).startsWith('960'), 'Settings: it persists across a reload');
await sp.click('#wrChips [data-v="1920"]'); ok(!(await sp.locator('#wrChips .on').textContent()).startsWith('960') && /default/.test(await sp.textContent('#wrChips .on')), 'Settings: picking the default again clears the override');
ok(!(await sp.locator('#qRow').isVisible()), 'Settings: PNG has no quality slider');
await sp.click('#fmtChips [data-v="webp"]'); ok(await sp.locator('#qRow').isVisible() && /Smaller than JPEG/.test(await sp.textContent('#fmtNote')), 'Settings: WebP shows quality and its note');
await sp.fill('#qRange', '70'); await sp.dispatchEvent('#qRange', 'input'); await sp.click('#tgStrip');
await sp.goto(mock('studio.html')); await sp.waitForTimeout(700); await sp.keyboard.press('e'); await sp.waitForTimeout(400);
ok((await sp.locator('[data-fmt] .on').textContent()) === 'WebP' && (await sp.inputValue('[data-qr]')) === '70' && !(await sp.locator('[data-tog="strip"] .sw').evaluate((e) => e.classList.contains('on'))), 'Settings → Export: the dialog opens with WebP, quality 70, strip-metadata off');
await sp.keyboard.press('Escape');
await sp.goto(mock('settings.html')); await sp.waitForTimeout(400);
ok((await sp.locator('#tgGrain .sw').evaluate((e) => e.classList.contains('on'))) && (await sp.evaluate(() => getComputedStyle(document.querySelector('.grain')).display)) !== 'none', 'Settings: grain starts on');
await sp.focus('#tgGrain'); await sp.keyboard.press('Space'); await sp.waitForTimeout(200);
ok((await sp.evaluate(() => document.documentElement.dataset.grain)) === 'off' && (await sp.evaluate(() => getComputedStyle(document.querySelector('.grain')).display)) === 'none', 'Settings: the toggle works from the keyboard and hides the grain at once');
await sp.goto(mock('studio.html')); await sp.waitForTimeout(500); ok((await sp.evaluate(() => getComputedStyle(document.querySelector('.grain')).display)) === 'none', 'Settings → Studio: grain is off there too');
await sp.goto(mock('settings.html')); await sp.click('#motChips [data-v="reduce"]'); await sp.waitForTimeout(150);
ok((await sp.evaluate(() => document.documentElement.dataset.motion)) === 'reduce' && (await sp.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.btn')).transitionDuration))) < 0.001, 'Settings: "Always reduce" stops transitions');
await sp.goto(mock('studio.html')); await sp.waitForTimeout(500); ok((await sp.evaluate(() => document.documentElement.dataset.motion)) === 'reduce', 'Settings → Studio: reduced motion carries over');
await sp.goto(mock('settings.html')); await sp.evaluate(() => localStorage.setItem('pixelsort.mock.presets', JSON.stringify([{ id: 'u1', name: 'Mine', spec: { mode: 'random', angle: { around: [0, 20] } }, user: true }, { id: 'u2', name: 'Plain', spec: { mode: 'edges' }, user: true }]))); await sp.reload(); await sp.waitForTimeout(300);
ok((await sp.locator('#mine .it').count()) === 2 && /rolls a little/.test(await sp.textContent('#mine .it')), 'Settings: lists the presets saved in Studio, marking the ones that roll');
await sp.click('#mine .it >> nth=0 >> button'); ok((await sp.locator('#mine .it').count()) === 1, 'Settings: a preset can be deleted here');
await sp.click('#btnReset'); await sp.waitForTimeout(200);
ok((await sp.evaluate(() => document.documentElement.dataset.grain)) === 'on' && !(await sp.evaluate(() => document.documentElement.dataset.motion)) && (await sp.locator('#fmtChips .on').textContent()) === 'PNG', 'Settings: Reset puts everything back');
await sp.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sp.click('#btnKeys'); await sp.waitForTimeout(250);
const kb = await sp.locator('.hp-card').boundingBox(); ok(kb.y >= 0 && kb.y + kb.height <= 900, 'Settings: the shortcut sheet opens in view even when the page is scrolled down');
await sp.keyboard.press('Escape');
const credits = await sp.textContent('.credits'); ok(/Kim Asendorf/.test(credits) && /satyarth\/pixelsort/.test(credits) && /MIT/.test(await sp.textContent('.ver')) && (await sp.locator('.credits a[href^="https://"]').count()) >= 3, 'Settings: credits name Kim Asendorf and satyarth/pixelsort, with working links, and the licence');
await sp.setViewportSize({ width: 390, height: 844 }); await sp.waitForTimeout(300);
ok((await sp.evaluate(() => document.documentElement.scrollWidth)) <= 390 && (await sp.textContent('#wrChips .on')).includes('1280'), 'Settings @390: no sideways scroll, and the phone default is 1280');
const tall = await sp.$$eval('.wrap button, .wrap a.btn', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 36).map((e) => e.textContent.trim().slice(0, 14))); ok(tall.length === 0, 'Settings @390: every button is at least 36 px tall' + (tall.length ? ' — too short: ' + tall.join(', ') : ''));

console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nHELP & SETTINGS CHECKS PASSED'); console.log(errs.join('\n') || 'no page errors');
if (fails.length || errs.length) process.exitCode = 1; await b.close();
