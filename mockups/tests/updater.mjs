// Updates: the state machine's rules (pure, with a fake clock), then every scenario in the Settings page.
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, mock, MOCKUPS } from './lib.mjs';

const U = createRequire(import.meta.url)(path.join(MOCKUPS, 'shared', 'updater.js'));
const fails = [], errs = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok  ' + m); };
const iso = (t) => new Date(t).toISOString();

// ---- pure: deriveView ----
const info = { version: 'r13.327bb45', deployment: 'docker', updater: 'ready', heartbeatAgeMs: 60000 };
const base = { info, available: null, checkPending: false, updatePending: false, result: null, startedAt: null, now: 1e12 };
const K = (o) => U.deriveView(Object.assign({}, base, o)).kind;
ok(K({ info: null }) === 'loading', 'no answer yet: loading');
ok(K({}) === 'up_to_date', 'nothing found: up to date');
ok(K({ info: Object.assign({}, info, { updater: 'not installed' }) }) === 'no_updater', 'updater not installed: says so');
ok(U.deriveView(Object.assign({}, base, { info: Object.assign({}, info, { heartbeatAgeMs: U.STALE_HEARTBEAT_MS + 1 }) })).stale === true, 'watcher gone quiet: not set up, marked stale');
ok(K({ info: Object.assign({}, info, { heartbeatAgeMs: U.STALE_HEARTBEAT_MS }) }) === 'up_to_date', 'watcher exactly on the limit still counts as alive');
ok(K({ checkPending: true }) === 'checking', 'a check in flight: checking');
ok(K({ available: { update_available: true, latest: 'bbb' } }) === 'available', 'newer version: available');
ok(K({ available: { update_available: false } }) === 'up_to_date', 'checked, nothing newer: up to date');
ok(K({ checkPending: true, available: { update_available: true, latest: 'b' } }) === 'checking', 'checking outranks a stale "available"');
ok(U.deriveView(Object.assign({}, base, { available: { update_available: true, latest: 'b' }, busy: { exporting: true } })).blocked === 'Finish your export first.', 'export running: Update is blocked, and says why');
ok(U.deriveView(Object.assign({}, base, { available: { update_available: true, latest: 'b' }, busy: { exporting: false, saving: false } })).blocked === null, 'nothing running: not blocked');
const run = { startedAt: 1e12 - 5000, startedFromVersion: 'r13.327bb45', runningVersion: 'r13.327bb45', updatePending: true };
ok(K(run) === 'updating', 'request in flight: updating');
ok(U.deriveView(Object.assign({}, base, run, { serverUnreachable: true })).reconnecting === true, 'server vanished mid-update: expected, says it is restarting');
ok(U.deriveView(Object.assign({}, base, run, { startedAt: 1e12 - U.SLOW_MS - 1 })).slow === true && !U.deriveView(Object.assign({}, base, run)).slow, 'slow note appears only after five minutes');
const fin = (extra) => Object.assign({}, run, { updatePending: false, result: Object.assign({ status: 'ok', finished_at: iso(1e12 - 1000) }, extra) });
ok(K(fin({ status: 'ok' }) && Object.assign({}, fin(), { runningVersion: 'r14.9a1c4e2' })) === 'done', 'ok and the version changed: done');
ok(K(fin()) !== 'done', 'ok but still the old version: not "done" (the swap has not landed)');
ok(K(fin({ status: 'failed', rollback: 'ok' })) === 'failed' && !U.deriveView(Object.assign({}, base, fin({ status: 'failed', rollback: 'ok' }))).rollbackFailed, 'failed with rollback: failed, previous version is back');
ok(U.deriveView(Object.assign({}, base, fin({ status: 'failed', rollback: 'failed' }))).rollbackFailed === true, 'failed and rollback failed: distinct');
ok(K(Object.assign({}, fin({ status: 'failed', finished_at: iso(1e12 - 60000) }), { updatePending: false })) !== 'failed' || false, 'an old result from an earlier run is not read as this run\'s');
ok(K(Object.assign({}, run, { updatePending: false, result: { status: 'failed', finished_at: iso(run.startedAt - 3600000), rollback: 'ok' }, pendingClearedAt: 1e12 - 1000 })) === 'updating', 'request gone but only an old result: still waiting, not a stale failure');
ok(K(Object.assign({}, run, { updatePending: false, pendingClearedAt: 1e12 - U.NO_ANSWER_MS - 1 })) === 'failed', 'no answer 90 s after the request vanished: reported as a failure, not silence');
ok(K(Object.assign({}, run, { updatePending: false, pendingClearedAt: 1e12 - U.NO_ANSWER_MS + 5000 })) === 'updating', '...but not before 90 s');
ok(K(fin({ status: 'skipped', detail: 'Already up to date.' })) === 'up_to_date', 'skipped: up to date');
for (const o of [null, undefined, {}, { info: {} }, { startedAt: 5 }, { info, available: {} }]) { let t = true; try { const v = U.deriveView(o); t = !!v.kind; } catch (e) { t = false; } ok(t, 'deriveView never throws on ' + JSON.stringify(o)); }

// ---- pure: guards ----
ok(U.validRequest('latest') && !U.validRequest('ghcr.io/evil/img@sha256:' + 'a'.repeat(64)) && !U.validRequest('') && !U.validRequest('latest ') && !U.validRequest(null), 'the app writes only the word "latest", never an image name');
ok(U.VERSION_RE.test('r13.327bb45') && !U.VERSION_RE.test('latest') && !U.VERSION_RE.test('r13.') && !U.VERSION_RE.test('13.327bb45'), 'version strings: r<count>.<sha>');
ok(U.DIGEST_RE.test('sha256:' + 'a'.repeat(64)) && !U.DIGEST_RE.test('sha256:' + 'A'.repeat(64)) && !U.DIGEST_RE.test('sha256:' + 'a'.repeat(63)), 'digests: exactly sha256: + 64 lowercase hex');
ok(U.short('sha256:' + 'ab12'.repeat(16)) === 'ab12ab12ab12', 'short digest is 12 characters');
ok(U.staleTab('r13.327bb45', 'r14.9a1c4e2') && !U.staleTab('r13.327bb45', 'r13.327bb45') && !U.staleTab('dev', 'r14.9a1c4e2') && !U.staleTab('r13.327bb45', null), 'an open tab is flagged stale only when both versions are real and differ');

// ---- pure: the simulator, with a fake clock ----
{
  let t = 1e12; const T = { check: 100, pull: 200, down: 100 };
  const walk = async (scenario) => {
    t = 1e12; const sim = U.createSim({ scenario, now: () => t, timing: T });
    await sim.check(); t += 99; let a = await sim.getAvailable(); const before = a.check_pending;
    t += 2; a = await sim.getAvailable();
    const out = { sim, before, after: a };
    await sim.start('latest'); t += 50; out.early = await sim.getStatus();
    t += 160; try { await sim.getVersion(); out.downThrew = false; } catch (e) { out.downThrew = true; }
    t += 100; out.end = await sim.getStatus(); out.ver = (await sim.getVersion()).version; return out;
  };
  let w = await walk('ready');
  ok(w.before === true && w.after.check_pending === false && w.after.available.update_available, 'sim: a check takes its time, then finds the newer version');
  ok(w.early.pending && !w.early.result, 'sim: while the watcher works the request is pending and there is no result');
  ok(w.downThrew, 'sim: the server really disappears while it is replaced');
  ok(!w.end.pending && w.end.result.status === 'ok' && w.ver === 'r14.9a1c4e2', 'sim: healthy: new version, result ok');
  ok((await w.sim.getAvailable()).available === null, 'sim: after updating nothing newer is on offer');
  w = await walk('fail'); ok(w.end.result.status === 'failed' && w.end.result.rollback === 'ok' && w.ver === 'r13.327bb45', 'sim fail: old version is back, result says rolled back');
  w = await walk('rollbackfail'); ok(w.end.result.rollback === 'failed', 'sim rollbackfail: result says the rollback failed too');
  w = await walk('silent'); ok(!w.end.pending && w.end.result === null, 'sim silent: request vanishes with no answer');
  w = await walk('uptodate'); ok(w.after.available.update_available === false, 'sim uptodate: a check finds nothing');
  const s2 = U.createSim({ scenario: 'ready', now: () => t }); let refused = false; try { await s2.start('ghcr.io/x/y@sha256:' + 'a'.repeat(64)); } catch (e) { refused = true; } ok(refused, 'sim: refuses any request body but "latest"');
  const s3 = U.createSim({ scenario: 'none', now: () => t }); ok((await s3.getVersion()).updater === 'not installed', 'sim none: reports no updater');
}

// ---- the Settings page ----
const b = await chromium.launch();
const open = async (qs, vp = { width: 1280, height: 900 }) => { const p = await b.newPage({ viewport: vp }); p.on('pageerror', (e) => errs.push(qs + ' PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(qs + ': ' + m.text()); }); await p.goto(mock('settings.html' + qs)); await p.waitForFunction(() => document.querySelector('#upMount').dataset.kind && document.querySelector('#upMount').dataset.kind !== 'loading', null, { timeout: 5000 }).catch(() => {}); return p; };
const kind = (p) => p.locator('#upMount').getAttribute('data-kind');
const waitKind = (p, k, ms = 8000) => p.waitForFunction((k2) => document.querySelector('#upMount').dataset.kind === k2, k, { timeout: ms }).then(() => true, () => false);
const text = (p) => p.locator('#upMount').innerText();

// default: up to date -> check -> available -> update -> done -> up to date
let p = await open('?updatefast');
ok((await kind(p)) === 'up_to_date' && /Up to date/.test(await text(p)) && /r13\.327bb45/.test(await text(p)), 'page: starts up to date and shows the running version');
ok((await p.locator('.set#updates').count()) === 1 && (await p.locator('.jump a[href="#updates"]').count()) === 1, 'page: Updates has a section and a jump link');
await p.click('[data-act=check]'); ok(await waitKind(p, 'checking', 3000) || await waitKind(p, 'available', 3000), 'page: Check starts a check');
ok(await waitKind(p, 'available'), 'page: the check finds a newer version'); ok(/r14\.9a1c4e2|9a1c4e2/.test(await text(p)), 'page: it names the newer version');
ok(/backed up/.test(await text(p)) && /old one comes back/.test(await text(p)), 'page: says the backup and the rollback up front');
await p.click('[data-act=update]'); ok(await waitKind(p, 'updating', 3000), 'page: Update now starts updating');
ok((await p.locator('[data-act]').count()) === 0, 'page: no buttons while it updates (nothing to double-click)');
ok(await waitKind(p, 'done', 8000), 'page: finishes as done'); ok(/Updated to r14\.9a1c4e2/.test(await text(p)), 'page: names the new version');
ok(await waitKind(p, 'up_to_date', 6000) && /r14\.9a1c4e2/.test(await text(p)), 'page: settles to up to date on the new version');
await p.close();

// failure paths
p = await open('?update=fail&updatefast'); await p.click('[data-act=check]'); await waitKind(p, 'available'); await p.click('[data-act=update]');
ok(await waitKind(p, 'failed', 8000), 'fail: ends as failed'); let tx = await text(p);
ok(/previous version is running again/i.test(tx) && /try again/i.test(tx) && /restored the backup|backup/i.test(tx), 'fail: says the old version is back, shows the reason, offers Try again');
ok(!/undefined|NaN|\[object/.test(tx), 'fail: no leaked placeholders'); await p.close();

p = await open('?update=rollbackfail&updatefast'); await p.click('[data-act=check]'); await waitKind(p, 'available'); await p.click('[data-act=update]');
ok(await waitKind(p, 'failed', 8000), 'rollbackfail: ends as failed'); tx = await text(p);
ok(/may not be running properly/.test(tx) && /Check the server/.test(tx) && (await p.locator('[data-act]').count()) === 0, 'rollbackfail: sends her to the server, no Try again'); await p.close();

p = await open('?update=none'); ok((await kind(p)) === 'no_updater' && /aren’t set up/.test(await text(p)) && (await p.locator('[data-act]').count()) === 0 && /docs\/update\.md/.test(await text(p)), 'none: says updates aren\'t set up, with where to look, and no buttons'); await p.close();
p = await open('?update=stale'); ok((await kind(p)) === 'no_updater' && /gone quiet/.test(await text(p)), 'stale: says the helper has gone quiet'); await p.close();
p = await open('?update=uptodate&updatefast'); await p.click('[data-act=check]'); await waitKind(p, 'checking', 2000); await p.waitForTimeout(500); ok((await kind(p)) === 'up_to_date', 'uptodate: a check that finds nothing stays up to date'); await p.close();

// blocked while an export runs
p = await open('?update=available&busyexport');
ok((await kind(p)) === 'available' && (await p.locator('[data-act=update]').isDisabled()) && /Finish your export/.test(await text(p)), 'busy: Update is disabled and says why'); await p.close();

// layout at phone and small desktop widths, every state
for (const [w, h] of [[390, 844], [840, 627], [1920, 1080]]) for (const q of ['?update=available', '?update=fail', '?update=none']) {
  p = await open(q + '&updatefast', { width: w, height: h });
  if (q.includes('fail')) { await p.click('[data-act=update]').catch(() => {}); await waitKind(p, 'failed', 8000); }
  const r = await p.evaluate(() => { const d = document.documentElement, out = []; if (d.scrollWidth > innerWidth + 1) out.push('page scrolls sideways'); const c = document.querySelector('.up-card'); if (c) { const b = c.getBoundingClientRect(); if (b.left < -1 || b.right > innerWidth + 1) out.push('card off screen'); c.querySelectorAll('button').forEach((x) => { const bb = x.getBoundingClientRect(); if (bb.height < 43.5 || bb.right > innerWidth + 1) out.push('button ' + Math.round(bb.height) + 'px / off screen'); }); } return out; });
  ok(r.length === 0, `layout ${q} @${w}: ${r.join(', ') || 'fits, buttons ≥ 44 px'}`); await p.close();
}
ok(errs.length === 0, 'no JS errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
if (fails.length) { console.log('\nFAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('\nUPDATER CHECKS PASSED');
