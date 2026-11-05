// The "Updates" block's state machine (docs/update.md). The app never touches Docker and never names an image: it asks
// the server to write a signal file ("check" or "requested") and a small watcher on the host does the pull, the health
// check and the rollback, then writes a result. Port of the pure parts of mockups/shared/updater.js; the real HTTP
// client arrives in phase 8 behind the same UpdateClient interface.

export const STALE_HEARTBEAT_MS = 30 * 60 * 1000; // the watcher ticks every 10 min; three missed = gone quiet
export const NO_ANSWER_MS = 90 * 1000; // request file gone, still no result
export const SLOW_MS = 5 * 60 * 1000;
export const VERSION_RE = /^r\d+\.[0-9a-f]{7,}$/; // r<commit count>.<short sha>, stamped in at build time
export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
export const REQUEST_BODY = 'latest'; // the only thing the app may ever write into "requested"

export const short = (d: unknown): string =>
	String(d ?? '')
		.replace(/^sha256:/, '')
		.slice(0, 12);

export type Busy = { exporting?: boolean; saving?: boolean };
export type VersionInfo = { version: string; deployment: string; updater: string; heartbeatAgeMs: number | null };
export type Available = {
	update_available?: boolean;
	latest?: string;
	latest_digest?: string;
	checked_at?: string | null;
	current?: string;
};
export type UpdateResult = {
	status: 'ok' | 'failed' | 'skipped';
	detail?: string;
	rollback?: string;
	target?: string;
	finished_at: string;
};

/** Everything the UI needs to ask of the watcher; the real implementation is HTTP, tests use a fake. */
export interface UpdateClient {
	getVersion(): Promise<VersionInfo>;
	getAvailable(): Promise<{ available: Available | null; check_pending: boolean }>;
	getStatus(): Promise<{ pending: boolean; result: UpdateResult | null }>;
	check(): Promise<{ ok: true }>;
	start(body: string): Promise<{ ok: true }>;
}

/** Why the Update button must wait, or null. Exports run in the browser, so only the page can know. */
export function blockReason(busy: Busy = {}): string | null {
	if (busy.exporting) return 'Finish your export first.';
	if (busy.saving) return 'A run is still saving. It only takes a moment.';
	return null;
}

/** The app refuses to write anything but the word "latest": never an image name, tag or digest. */
export const validRequest = (body: unknown): boolean => body === REQUEST_BODY;

/** A tab opened before an update still runs the old page and engine. True when the server has moved on. */
export const staleTab = (loaded: string | null | undefined, serving: string | null | undefined): boolean =>
	VERSION_RE.test(loaded ?? '') && VERSION_RE.test(serving ?? '') && loaded !== serving;

export type ViewInput = {
	info?: Partial<VersionInfo> | null;
	available?: Available | null;
	checkPending?: boolean;
	updatePending?: boolean;
	result?: UpdateResult | null;
	startedAt?: number | null;
	startedFromVersion?: string;
	runningVersion?: string;
	serverUnreachable?: boolean;
	pendingClearedAt?: number | null;
	busy?: Busy;
	now?: number;
};
export type View =
	| { kind: 'loading' }
	| { kind: 'no_updater'; stale: boolean }
	| { kind: 'checking' }
	| { kind: 'up_to_date'; checkedAt?: string | null; note?: string }
	| { kind: 'available'; latest?: string; blocked: string | null }
	| { kind: 'updating'; slow: boolean; reconnecting: boolean }
	| { kind: 'done'; version: string }
	| { kind: 'failed'; detail: string; rollbackFailed: boolean; blocked: string | null };

/** What the Updates block should say. It is the state machine; it never throws, whatever it is given. */
export function deriveView(i: ViewInput | null | undefined): View {
	const v = i ?? {};
	const now = v.now ?? Date.now();
	const blocked = blockReason(v.busy);
	if (v.startedAt != null) {
		const r = v.result;
		const answered = !!r && !v.updatePending && Date.parse(r.finished_at) >= v.startedAt - 1000;
		if (answered && r) {
			if (r.status === 'ok' && v.runningVersion && v.runningVersion !== v.startedFromVersion)
				return { kind: 'done', version: v.runningVersion };
			if (r.status === 'skipped') return { kind: 'up_to_date', checkedAt: r.finished_at, note: r.detail ?? '' };
			if (r.status === 'failed' || r.status === 'ok')
				return { kind: 'failed', detail: r.detail ?? '', rollbackFailed: r.rollback === 'failed', blocked };
		}
		if (!v.updatePending && !answered && v.pendingClearedAt != null && now - v.pendingClearedAt > NO_ANSWER_MS) {
			return {
				kind: 'failed',
				rollbackFailed: false,
				blocked,
				detail: 'The updater did not report back within 90 seconds. Nothing is known to be wrong, but check the server.'
			};
		}
		return { kind: 'updating', slow: now - v.startedAt > SLOW_MS, reconnecting: !!v.serverUnreachable };
	}
	if (!v.info) return { kind: 'loading' };
	if (v.info.updater !== 'ready' || (v.info.heartbeatAgeMs != null && v.info.heartbeatAgeMs > STALE_HEARTBEAT_MS)) {
		return { kind: 'no_updater', stale: v.info.updater === 'ready' };
	}
	if (v.checkPending) return { kind: 'checking' };
	if (v.available?.update_available) return { kind: 'available', latest: v.available.latest, blocked };
	return { kind: 'up_to_date', checkedAt: v.available?.checked_at ?? null };
}

export type Scenario = 'ready' | 'available' | 'uptodate' | 'fail' | 'rollbackfail' | 'silent' | 'none' | 'stale';

/**
 * A stand-in for the watcher and the /api/update endpoints, driven by a clock. Timeline of one update, from the moment
 * "requested" appears: pull (the app still answers), then the container is replaced (every request fails), then healthy
 * (version changes, result ok), or failed (old version back), rollbackfail (nothing healthy) or silent (no result).
 */
export function createSim(
	o: {
		scenario?: Scenario;
		now?: () => number;
		timing?: Partial<{ check: number; pull: number; down: number }>;
		version?: string;
		latest?: string;
	} = {}
): UpdateClient & { S: { version: string; latest: string } } {
	const scenario = o.scenario ?? 'ready';
	const now = o.now ?? Date.now;
	const T = { check: 1400, pull: 2600, down: 1100, ...o.timing };
	const S = { version: o.version ?? 'r13.327bb45', latest: o.latest ?? 'r14.9a1c4e2' };
	const iso = (t: number) => new Date(t).toISOString();
	const digest = 'sha256:' + '9a1c4e2b7f'.repeat(7).slice(0, 64);
	const current = short('sha256:' + '327bb45a1d'.repeat(7));
	let checkAt: number | null = null;
	let reqAt: number | null = null;
	let result: UpdateResult | null = null;
	let applied = false;
	let pending = false;
	let available: Available | null =
		scenario === 'available'
			? { current, latest: short(digest), latest_digest: digest, checked_at: iso(now()), update_available: true }
			: null;

	const advance = () => {
		const t = now();
		if (checkAt != null && t - checkAt >= T.check) {
			checkAt = null;
			const has = scenario !== 'uptodate' && !applied;
			available = {
				current,
				latest: has ? short(digest) : current,
				latest_digest: has ? digest : '',
				checked_at: iso(t),
				update_available: has
			};
		}
		if (reqAt != null && t - reqAt >= T.pull + T.down) {
			const fin = reqAt + T.pull + T.down;
			reqAt = null;
			pending = false;
			if (scenario === 'fail')
				result = {
					status: 'failed',
					detail:
						'The new version did not become healthy in 120 seconds. Restored the backup and started the previous version.',
					rollback: 'ok',
					target: S.latest,
					finished_at: iso(fin)
				};
			else if (scenario === 'rollbackfail')
				result = {
					status: 'failed',
					detail: 'The new version did not start, and the previous version did not start either.',
					rollback: 'failed',
					target: S.latest,
					finished_at: iso(fin)
				};
			else if (scenario === 'silent') result = null;
			else {
				applied = true;
				S.version = S.latest;
				available = null;
				result = { status: 'ok', detail: '', target: S.latest, finished_at: iso(fin) };
			}
		}
	};
	const down = () => reqAt != null && now() - reqAt >= T.pull && now() - reqAt < T.pull + T.down;
	const gone = () => new Error('Failed to fetch');

	return {
		S,
		async getVersion() {
			advance();
			if (down()) throw gone();
			return {
				version: S.version,
				deployment: 'docker',
				updater: scenario === 'none' ? 'not installed' : 'ready',
				heartbeatAgeMs: scenario === 'stale' ? 3 * 60 * 60 * 1000 : 4 * 60 * 1000
			};
		},
		async getAvailable() {
			advance();
			if (down()) throw gone();
			return { available, check_pending: checkAt != null };
		},
		async getStatus() {
			advance();
			if (down()) throw gone();
			return { pending: reqAt != null || pending, result };
		},
		async check() {
			advance();
			if (down()) throw gone();
			checkAt = now();
			return { ok: true };
		},
		async start(body) {
			if (!validRequest(body)) throw new Error('The app only ever asks for the latest version.');
			advance();
			if (down()) throw gone();
			result = null;
			reqAt = now();
			pending = true;
			return { ok: true };
		}
	};
}
