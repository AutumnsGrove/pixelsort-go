// "Your shapes": saved custom shapes. They live on the server (/api/shapes) so every device sees them; when there is no
// server (the share-only build, or it is down) they fall back to this browser's localStorage and are tried again later.
// Pure logic around two small interfaces, so it is tested without a browser.
import type { ApiShape } from './api';
import type { KeyValueStore } from './storage';
import type { Ring } from './shape-tidy';

export type SavedShape = { id: string; name: string; poly: Ring; more: Ring[]; local: boolean };

export interface ShapeBackend {
	listShapes(): Promise<ApiShape[]>;
	addShape(s: { name: string; poly: Ring; more: Ring[] }): Promise<ApiShape>;
	deleteShape(id: number): Promise<void>;
}

const KEY = 'pixelsort.shapes';
const MAX_LOCAL = 50;

const fromApi = (s: ApiShape): SavedShape => ({
	id: `s${s.id}`,
	name: s.name,
	poly: s.poly,
	more: s.more ?? [],
	local: false
});

/** Is this thing a shape we can use (guards what comes out of storage, which may be damaged or from an older version)? */
export function validShape(s: unknown): s is SavedShape {
	if (typeof s !== 'object' || s === null) return false;
	const o = s as Partial<SavedShape>;
	const ringOk = (r: unknown) =>
		Array.isArray(r) &&
		r.length >= 3 &&
		r.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)));
	return (
		typeof o.id === 'string' &&
		typeof o.name === 'string' &&
		ringOk(o.poly) &&
		Array.isArray(o.more) &&
		o.more.every(ringOk)
	);
}

export class ShapeLibrary {
	constructor(
		private readonly server: ShapeBackend,
		private readonly local: KeyValueStore
	) {}

	private readLocal(): SavedShape[] {
		const raw = this.local.get(KEY);
		return Array.isArray(raw) ? raw.filter(validShape).map((s) => ({ ...s, local: true })) : [];
	}
	private writeLocal(list: SavedShape[]): void {
		this.local.set(KEY, list.slice(0, MAX_LOCAL));
	}

	/** The server's shapes, then any this browser saved while the server was away; the offline ones are sent up now. */
	async list(): Promise<SavedShape[]> {
		const pending = this.readLocal();
		try {
			const remote = (await this.server.listShapes()).map(fromApi);
			const stillPending: SavedShape[] = [];
			for (const p of pending) {
				try {
					remote.unshift(fromApi(await this.server.addShape({ name: p.name, poly: p.poly, more: p.more })));
				} catch {
					stillPending.push(p);
				}
			}
			this.writeLocal(stillPending);
			return [...stillPending, ...remote];
		} catch {
			return pending;
		}
	}

	/** Save a shape: on the server if it is there, otherwise in this browser. Returns the saved shape. */
	async add(name: string, poly: Ring, more: Ring[]): Promise<SavedShape> {
		try {
			return fromApi(await this.server.addShape({ name, poly, more }));
		} catch {
			const mine: SavedShape = {
				id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
				name,
				poly,
				more,
				local: true
			};
			this.writeLocal([mine, ...this.readLocal()]);
			return mine;
		}
	}

	async remove(shape: SavedShape): Promise<void> {
		if (shape.local) {
			this.writeLocal(this.readLocal().filter((s) => s.id !== shape.id));
			return;
		}
		await this.server.deleteShape(Number(shape.id.slice(1)));
	}
}

/** A name for a shape that has none: "Shape 3". */
export const nextShapeName = (existing: readonly SavedShape[]): string => `Shape ${existing.length + 1}`;
