import { describe, expect, test } from 'vitest';
import {
	DIGEST_RE,
	NO_ANSWER_MS,
	SLOW_MS,
	STALE_HEARTBEAT_MS,
	VERSION_RE,
	createSim,
	deriveView,
	short,
	staleTab,
	validRequest,
	type ViewInput
} from './updater';

const iso = (t: number) => new Date(t).toISOString();
const info = { version: 'r13.327bb45', deployment: 'docker', updater: 'ready', heartbeatAgeMs: 60000 };
const base: ViewInput = {
	info,
	available: null,
	checkPending: false,
	updatePending: false,
	result: null,
	startedAt: null,
	now: 1e12
};
const K = (o: ViewInput) => deriveView({ ...base, ...o }).kind;

describe('deriveView', () => {
	test('the resting states', () => {
		expect(K({ info: null })).toBe('loading');
		expect(K({})).toBe('up_to_date');
		expect(K({ info: { ...info, updater: 'not installed' } })).toBe('no_updater');
		expect(deriveView({ ...base, info: { ...info, heartbeatAgeMs: STALE_HEARTBEAT_MS + 1 } })).toMatchObject({
			kind: 'no_updater',
			stale: true
		});
		expect(K({ info: { ...info, heartbeatAgeMs: STALE_HEARTBEAT_MS } })).toBe('up_to_date');
		expect(K({ checkPending: true })).toBe('checking');
		expect(K({ available: { update_available: true, latest: 'bbb' } })).toBe('available');
		expect(K({ available: { update_available: false } })).toBe('up_to_date');
		expect(K({ checkPending: true, available: { update_available: true, latest: 'b' } })).toBe('checking');
	});
	test('Update is blocked while an export or a save runs, and says why', () => {
		const avail = { update_available: true, latest: 'b' };
		expect(deriveView({ ...base, available: avail, busy: { exporting: true } })).toMatchObject({
			blocked: 'Finish your export first.'
		});
		expect(deriveView({ ...base, available: avail, busy: { saving: true } })).toMatchObject({
			blocked: expect.stringMatching(/saving/)
		});
		expect(deriveView({ ...base, available: avail, busy: {} })).toMatchObject({ blocked: null });
	});
	const run: ViewInput = {
		startedAt: 1e12 - 5000,
		startedFromVersion: 'r13.327bb45',
		runningVersion: 'r13.327bb45',
		updatePending: true
	};
	const fin = (extra: object = {}): ViewInput => ({
		...run,
		updatePending: false,
		result: { status: 'ok', finished_at: iso(1e12 - 1000), ...extra }
	});
	test('while updating', () => {
		expect(K(run)).toBe('updating');
		expect(deriveView({ ...base, ...run, serverUnreachable: true })).toMatchObject({ reconnecting: true });
		expect(deriveView({ ...base, ...run, startedAt: 1e12 - SLOW_MS - 1 })).toMatchObject({ slow: true });
		expect(deriveView({ ...base, ...run })).toMatchObject({ slow: false });
	});
	test('finishing', () => {
		expect(K({ ...fin(), runningVersion: 'r14.9a1c4e2' })).toBe('done');
		expect(K(fin())).not.toBe('done'); // the swap has not landed
		expect(deriveView({ ...base, ...fin({ status: 'failed', rollback: 'ok' }) })).toMatchObject({
			kind: 'failed',
			rollbackFailed: false
		});
		expect(deriveView({ ...base, ...fin({ status: 'failed', rollback: 'failed' }) })).toMatchObject({
			rollbackFailed: true
		});
		expect(K(fin({ status: 'skipped', detail: 'Already up to date.' }))).toBe('up_to_date');
	});
	test('an old result from an earlier run is not read as this run’s', () => {
		const old: ViewInput = {
			...run,
			updatePending: false,
			result: { status: 'failed', finished_at: iso(1e12 - 5000 - 3600000), rollback: 'ok' },
			pendingClearedAt: 1e12 - 1000
		};
		expect(K(old)).toBe('updating');
	});
	test('no answer 90 s after the request vanished is a failure, not silence; not before', () => {
		expect(K({ ...run, updatePending: false, pendingClearedAt: 1e12 - NO_ANSWER_MS - 1 })).toBe('failed');
		expect(K({ ...run, updatePending: false, pendingClearedAt: 1e12 - NO_ANSWER_MS + 5000 })).toBe('updating');
	});
	test('never throws, whatever it is given', () => {
		for (const o of [null, undefined, {}, { info: {} }, { startedAt: 5 }, { info, available: {} }] as (
			ViewInput | null | undefined
		)[])
			expect(deriveView(o).kind).toBeTruthy();
	});
});

describe('guards', () => {
	test('the app writes only the word "latest", never an image name', () => {
		expect(validRequest('latest')).toBe(true);
		for (const bad of ['ghcr.io/evil/img@sha256:' + 'a'.repeat(64), '', 'latest ', null])
			expect(validRequest(bad)).toBe(false);
	});
	test('version strings and digests', () => {
		expect(VERSION_RE.test('r13.327bb45')).toBe(true);
		for (const bad of ['latest', 'r13.', '13.327bb45']) expect(VERSION_RE.test(bad)).toBe(false);
		expect(DIGEST_RE.test('sha256:' + 'a'.repeat(64))).toBe(true);
		expect(DIGEST_RE.test('sha256:' + 'A'.repeat(64))).toBe(false);
		expect(DIGEST_RE.test('sha256:' + 'a'.repeat(63))).toBe(false);
		expect(short('sha256:' + 'ab12'.repeat(16))).toBe('ab12ab12ab12');
	});
	test('an open tab is flagged stale only when both versions are real and differ', () => {
		expect(staleTab('r13.327bb45', 'r14.9a1c4e2')).toBe(true);
		expect(staleTab('r13.327bb45', 'r13.327bb45')).toBe(false);
		expect(staleTab('dev', 'r14.9a1c4e2')).toBe(false);
		expect(staleTab('r13.327bb45', null)).toBe(false);
	});
});

describe('simulator (fake clock)', () => {
	const T = { check: 100, pull: 200, down: 100 };
	test('check finds an update, the update lands, then nothing newer', async () => {
		let t = 1e12;
		const sim = createSim({ now: () => t, timing: T });
		await sim.check();
		expect((await sim.getAvailable()).check_pending).toBe(true);
		t += 150;
		expect((await sim.getAvailable()).available?.update_available).toBe(true);
		await sim.start('latest');
		t += 250; // the container is being replaced: everything fails
		await expect(sim.getVersion()).rejects.toThrow();
		t += 100;
		expect((await sim.getStatus()).result?.status).toBe('ok');
		expect((await sim.getVersion()).version).toBe(sim.S.latest);
		expect((await sim.getAvailable()).available).toBeNull();
	});
	test('the fail scenario brings the old version back; refusing anything but "latest"', async () => {
		let t = 1e12;
		const sim = createSim({ now: () => t, timing: T, scenario: 'fail' });
		await expect(sim.start('ghcr.io/x')).rejects.toThrow(/latest/);
		await sim.start('latest');
		t += 400;
		expect((await sim.getStatus()).result).toMatchObject({ status: 'failed', rollback: 'ok' });
		expect((await sim.getVersion()).version).toBe('r13.327bb45');
	});
});
