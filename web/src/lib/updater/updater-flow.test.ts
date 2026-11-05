import { describe, expect, test } from 'vitest';
import { createSim, type Scenario, type View } from '../updater';
import { HttpUpdateClient } from './http-client';
import { UpdateController, type Timers } from './controller';

type Call = { url: string; init?: RequestInit };
const jsonRes = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

describe('HttpUpdateClient', () => {
	function fake(handler: (c: Call) => Response) {
		const calls: Call[] = [];
		const f = (async (url: string, init?: RequestInit) => {
			calls.push({ url, init });
			return handler({ url, init });
		}) as unknown as typeof fetch;
		return { calls, client: new HttpUpdateClient(f) };
	}

	test('each endpoint is mapped', async () => {
		const { client, calls } = fake(({ url }) => {
			if (url === '/api/version')
				return jsonRes({ version: 'r1.abc1234', deployment: 'docker', updater: 'ready', heartbeat_age_s: 120 });
			if (url === '/api/update/available')
				return jsonRes({ available: { update_available: true, latest: 'x' }, check_pending: true });
			if (url === '/api/update/status') return jsonRes({ pending: true, result: null });
			return jsonRes({ ok: true }, 202);
		});
		expect(await client.getVersion()).toEqual({
			version: 'r1.abc1234',
			deployment: 'docker',
			updater: 'ready',
			heartbeatAgeMs: 120_000
		});
		expect(await client.getAvailable()).toEqual({
			available: { update_available: true, latest: 'x' },
			check_pending: true
		});
		expect(await client.getStatus()).toEqual({ pending: true, result: null });
		await client.check();
		await client.start('latest');
		expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
			'GET /api/version',
			'GET /api/update/available',
			'GET /api/update/status',
			'POST /api/update/check',
			'POST /api/update/start'
		]);
		expect(JSON.parse(calls[4]!.init!.body as string)).toEqual({ target: 'latest' });
	});

	test('start refuses to send anything but "latest"', async () => {
		const { client, calls } = fake(() => jsonRes({}, 202));
		await expect(client.start('ghcr.io/evil/x@sha256:' + 'a'.repeat(64))).rejects.toThrow(/latest/);
		expect(calls).toHaveLength(0);
	});

	test('a server without updates answers 404: not an error, just nothing', async () => {
		const { client } = fake(() => jsonRes({ error: { code: 'not_found' } }, 404));
		expect(await client.getAvailable()).toEqual({ available: null, check_pending: false });
		expect(await client.getStatus()).toEqual({ pending: false, result: null });
	});

	test('a busy upload is a readable error; a dead network rejects for the caller to interpret', async () => {
		const busy = fake(() => jsonRes({ error: { code: 'conflict' } }, 409));
		await expect(busy.client.start('latest')).rejects.toThrow(/upload is still running/);
		const dead = new HttpUpdateClient((async () => {
			throw new TypeError('Failed to fetch');
		}) as unknown as typeof fetch);
		await expect(dead.getVersion()).rejects.toThrow('Failed to fetch');
	});

	test('a missing heartbeat reads as null', async () => {
		const { client } = fake(() => jsonRes({ version: 'v', deployment: 'dev' }));
		expect(await client.getVersion()).toMatchObject({ updater: 'not installed', heartbeatAgeMs: null });
	});
});

// ---- the whole flow, with the simulator as the watcher and a manual clock ----
function harness(scenario: Scenario, busy: () => { exporting?: boolean; saving?: boolean } = () => ({})) {
	let t = 1_700_000_000_000;
	const queue: { at: number; f: () => void }[] = [];
	const timers: Timers = {
		set: (f, ms) => {
			const e = { at: t + ms, f };
			queue.push(e);
			return e;
		},
		clear: (h) => {
			const i = queue.indexOf(h as (typeof queue)[number]);
			if (i >= 0) queue.splice(i, 1);
		}
	};
	const sim = createSim({ scenario, now: () => t, timing: { check: 100, pull: 200, down: 100 } });
	const views: View[] = [];
	const reloads: string[] = [];
	const c = new UpdateController({
		client: sim,
		now: () => t,
		timers,
		busy,
		onView: (v) => views.push(v),
		onReload: (v) => reloads.push(v),
		pollMs: 50
	});
	const advance = async (ms: number) => {
		const end = t + ms;
		for (;;) {
			queue.sort((a, b) => a.at - b.at);
			const next = queue[0];
			if (!next || next.at > end) break;
			queue.shift();
			t = next.at;
			next.f();
			for (let i = 0; i < 10; i++) await Promise.resolve();
		}
		t = end;
		await Promise.resolve();
	};
	return { c, sim, views, reloads, advance, queue };
}

describe('UpdateController with the simulated watcher', () => {
	test('up to date, check finds one, update lands, the page asks to reload on the new version', async () => {
		const h = harness('ready');
		await h.c.start();
		expect(h.c.view.kind).toBe('up_to_date');
		expect(h.queue).toHaveLength(0); // idle: nothing is polling
		await h.c.check();
		expect(h.c.view.kind).toBe('checking');
		await h.advance(500);
		expect(h.c.view.kind).toBe('available');
		await h.c.update();
		expect(h.c.view.kind).toBe('updating');
		await h.advance(1000);
		expect(h.c.view.kind).toBe('done');
		expect(h.reloads).toEqual([h.sim.S.latest]);
		expect(h.views.some((v) => v.kind === 'updating' && v.reconnecting)).toBe(true); // the server vanished and that was expected
	});

	test('a failed update rolls back and says so', async () => {
		const h = harness('fail');
		await h.c.start();
		await h.c.check();
		await h.advance(500);
		await h.c.update();
		await h.advance(1000);
		expect(h.c.view).toMatchObject({ kind: 'failed', rollbackFailed: false });
		expect(h.reloads).toEqual([]);
	});

	test('rollback failure is a distinct state', async () => {
		const h = harness('rollbackfail');
		await h.c.start();
		await h.c.check();
		await h.advance(500);
		await h.c.update();
		await h.advance(1000);
		expect(h.c.view).toMatchObject({ kind: 'failed', rollbackFailed: true });
	});

	test('no watcher: "not set up", and Check does nothing harmful', async () => {
		const h = harness('none');
		await h.c.start();
		expect(h.c.view).toMatchObject({ kind: 'no_updater', stale: false });
		const stale = harness('stale');
		await stale.c.start();
		expect(stale.c.view).toMatchObject({ kind: 'no_updater', stale: true });
	});

	test('a watcher that never answers is reported as a failure after 90 s, not as silence', async () => {
		const h = harness('silent');
		await h.c.start();
		await h.c.check();
		await h.advance(500);
		await h.c.update();
		await h.advance(150_000);
		expect(h.c.view.kind).toBe('failed');
	});

	test('Update is refused while an export or a save runs, and says why', async () => {
		let exporting = true;
		const h = harness('available', () => ({ exporting }));
		await h.c.start();
		expect(h.c.view).toMatchObject({ kind: 'available', blocked: 'Finish your export first.' });
		await expect(h.c.update()).rejects.toThrow('Finish your export first.');
		exporting = false;
		await h.c.refresh();
		await h.c.update();
		expect(h.c.view.kind).toBe('updating');
	});

	test('the dot follows definite answers only', async () => {
		const h = harness('available');
		await h.c.start();
		expect(h.c.updateWaiting).toBe(true);
		const none = harness('uptodate');
		await none.c.start();
		expect(none.c.updateWaiting).toBe(false);
		const quiet = harness('none');
		await quiet.c.start();
		expect(quiet.c.updateWaiting).toBeNull();
	});
});
