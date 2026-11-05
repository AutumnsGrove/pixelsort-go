// App-wide reactive bits of the updater: what the page is busy with (an update must wait for it), and whether an update
// is waiting (the dot on the gear). The dot never starts a check and never goes online: it reads a file the watcher wrote.
import { HttpUpdateClient } from './http-client';

/** Set by Studio while an export or a save is running; the Update button is disabled with a reason while it is true. */
export const appBusy = $state({ exporting: false, saving: false });

const KEY = 'pixelsort.update-ready';
export const updateDot = $state({ ready: false });

function stored(): boolean {
	try {
		return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

/** Remember a definite answer from Settings; "checking", "updating" and "failed" never change it. */
export function rememberUpdateWaiting(waiting: boolean | null): void {
	if (waiting === null) return;
	updateDot.ready = waiting;
	try {
		if (waiting) localStorage.setItem(KEY, '1');
		else localStorage.removeItem(KEY);
	} catch {
		/* private mode: keep it for this page */
	}
}

let started = false;
/** Reads GET /api/update/available when a page opens and about once an hour after. */
export function startUpdateDot(client = new HttpUpdateClient(), everyMs = 60 * 60 * 1000): () => void {
	updateDot.ready = stored();
	if (started) return () => {};
	started = true;
	const read = async () => {
		try {
			const r = await client.getAvailable();
			if (r.available) rememberUpdateWaiting(!!r.available.update_available);
		} catch {
			/* offline or restarting: leave the dot as it was */
		}
	};
	void read();
	const timer = setInterval(() => void read(), everyMs);
	const onStorage = (e: StorageEvent) => {
		if (e.key === KEY) updateDot.ready = e.newValue === '1';
	};
	window.addEventListener('storage', onStorage);
	return () => {
		clearInterval(timer);
		window.removeEventListener('storage', onStorage);
		started = false;
	};
}
