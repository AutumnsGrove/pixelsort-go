// The storage interface the app talks to. Pure modules never touch localStorage; this is the one seam. The default is
// LocalStorageBackend; phase 6's ServerBackend implements the same interface over the gallery API.

export interface KeyValueStore {
	/** The stored JSON value, or null if missing or damaged (a damaged value reads as the default, never throws). */
	get(key: string): unknown;
	/** Returns false instead of throwing when storage is unavailable or full. */
	set(key: string, value: unknown): boolean;
	remove(key: string): void;
}

type Storageish = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class LocalStorageBackend implements KeyValueStore {
	constructor(
		private readonly store: () => Storageish | null = () => (typeof localStorage === 'undefined' ? null : localStorage)
	) {}

	get(key: string): unknown {
		try {
			const raw = this.store()?.getItem(key);
			return raw == null ? null : JSON.parse(raw);
		} catch {
			return null;
		}
	}
	set(key: string, value: unknown): boolean {
		try {
			const s = this.store();
			if (!s) return false;
			s.setItem(key, JSON.stringify(value));
			return true;
		} catch {
			return false;
		}
	}
	remove(key: string): void {
		try {
			this.store()?.removeItem(key);
		} catch {
			/* private mode: nothing to remove */
		}
	}
}

/** An in-memory store: the fallback when storage is unavailable, and the one tests use. */
export class MemoryBackend implements KeyValueStore {
	private data = new Map<string, string>();
	get(key: string): unknown {
		const raw = this.data.get(key);
		if (raw === undefined) return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}
	set(key: string, value: unknown): boolean {
		this.data.set(key, JSON.stringify(value));
		return true;
	}
	remove(key: string): void {
		this.data.delete(key);
	}
}
