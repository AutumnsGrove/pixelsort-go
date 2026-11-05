// Drives deriveView with live data: polls the client, remembers when an update was started, treats a vanished server as
// expected while the container is replaced, and asks for a reload once the version has changed. No DOM: timers, clock and
// the reload callback are injected, so the whole flow runs in tests with the fake simulator.
import {
	deriveView,
	type Available,
	type Busy,
	type UpdateClient,
	type UpdateResult,
	type VersionInfo,
	type View
} from '../updater';

export type Timers = { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realTimers: Timers = {
	set: (f, ms) => setTimeout(f, ms),
	clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
};

export type ControllerOptions = {
	client: UpdateClient;
	now?: () => number;
	timers?: Timers;
	busy?: () => Busy; // the page knows about exports and saves; the server only knows about uploads
	onView?: (v: View) => void;
	onReload?: (newVersion: string) => void;
	pollMs?: number;
};

export class UpdateController {
	view: View = { kind: 'loading' };
	private info: VersionInfo | null = null;
	private available: Available | null = null;
	private checkPending = false;
	private updatePending = false;
	private result: UpdateResult | null = null;
	private startedAt: number | null = null;
	private startedFromVersion = '';
	private serverUnreachable = false;
	private pendingClearedAt: number | null = null;
	private timer: unknown = null;
	private stopped = false;
	private readonly now: () => number;
	private readonly timers: Timers;
	private readonly pollMs: number;

	constructor(private readonly o: ControllerOptions) {
		this.now = o.now ?? Date.now;
		this.timers = o.timers ?? realTimers;
		this.pollMs = o.pollMs ?? 2000;
	}

	/** Reads the server once, then keeps polling only while something is happening (never while idle). */
	async start(): Promise<void> {
		await this.refresh();
	}

	stop(): void {
		this.stopped = true;
		this.timers.clear(this.timer);
	}

	/** One round of reads. Network errors during an update are expected and are not reported as failures. */
	async refresh(): Promise<void> {
		if (this.stopped) return;
		try {
			this.info = await this.o.client.getVersion();
			this.serverUnreachable = false;
			const [avail, status] = await Promise.all([this.o.client.getAvailable(), this.o.client.getStatus()]);
			this.available = avail.available;
			this.checkPending = avail.check_pending;
			if (this.updatePending && !status.pending && this.pendingClearedAt == null) this.pendingClearedAt = this.now();
			this.updatePending = status.pending;
			this.result = status.result;
		} catch {
			// While an update runs the server vanishes for a while; before one starts it just means we know nothing new.
			this.serverUnreachable = this.startedAt != null;
		}
		this.publish();
		this.schedule();
	}

	private publish(): void {
		const v = deriveView({
			info: this.info,
			available: this.available,
			checkPending: this.checkPending,
			updatePending: this.updatePending,
			result: this.result,
			startedAt: this.startedAt,
			startedFromVersion: this.startedFromVersion,
			runningVersion: this.info?.version,
			serverUnreachable: this.serverUnreachable,
			pendingClearedAt: this.pendingClearedAt,
			busy: this.o.busy?.(),
			now: this.now()
		});
		this.view = v;
		this.o.onView?.(v);
		if (v.kind === 'done') this.o.onReload?.(v.version);
	}

	private schedule(): void {
		this.timers.clear(this.timer);
		const k = this.view.kind;
		const active = k === 'checking' || k === 'updating' || this.checkPending;
		if (!this.stopped && active) this.timer = this.timers.set(() => void this.refresh(), this.pollMs);
	}

	async check(): Promise<void> {
		await this.o.client.check();
		this.checkPending = true;
		this.publish();
		this.schedule();
	}

	/** Asks for the newest version. Refused while the page itself is busy (an export or a save). */
	async update(): Promise<void> {
		const v = deriveView({ info: this.info, available: this.available, busy: this.o.busy?.(), now: this.now() });
		if (v.kind === 'available' && v.blocked) throw new Error(v.blocked);
		await this.o.client.start('latest');
		this.startedAt = this.now();
		this.startedFromVersion = this.info?.version ?? '';
		this.result = null;
		this.updatePending = true;
		this.pendingClearedAt = null;
		this.publish();
		this.schedule();
	}

	/** Whether to remember "an update is waiting" for the dot: only definite answers change it. */
	get updateWaiting(): boolean | null {
		if (this.view.kind === 'available') return true;
		if (this.view.kind === 'up_to_date' || this.view.kind === 'done') return false;
		return null;
	}
}
