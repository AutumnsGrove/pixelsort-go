// Auto-save rule: a run is saved when an animation finishes, or 2 seconds pass with no change after a completed
// preview, or on export; never on every slider tick. Saves are de-duplicated by key (the server de-duplicates too) and
// a failure never blocks: it retries on a backoff (30 s, 2 min, 10 min) and reports through a callback.

export const DEBOUNCE_MS = 2000;
export const BACKOFF_MS = [30_000, 120_000, 600_000];

export type Timers = { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realTimers: Timers = {
	set: (f, ms) => setTimeout(f, ms),
	clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
};

export class Autosaver {
	private timer: unknown = null;
	private saved = new Set<string>();
	failed = false;

	constructor(
		private readonly save: (key: string) => Promise<void>,
		private readonly onFailure: (e: unknown, attempt: number) => void = () => {},
		private readonly timers: Timers = realTimers
	) {}

	/** Save `key` after the quiet period; a newer call replaces a pending one. */
	schedule(key: string, immediate = false): void {
		this.timers.clear(this.timer);
		if (this.saved.has(key)) return;
		this.timer = this.timers.set(() => void this.attempt(key, 0), immediate ? 0 : DEBOUNCE_MS);
	}

	private async attempt(key: string, n: number): Promise<void> {
		try {
			await this.save(key);
			this.saved.add(key);
			this.failed = false;
		} catch (e) {
			this.failed = true;
			this.onFailure(e, n);
			const wait = BACKOFF_MS[n];
			if (wait !== undefined) this.timer = this.timers.set(() => void this.attempt(key, n + 1), wait);
		}
	}

	cancel(): void {
		this.timers.clear(this.timer);
	}
}
