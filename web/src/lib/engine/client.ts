import { defaultParams, type Params } from './params';
import type { Speed } from './animator';
import type { FrameEvent, Request, Response, Stats, Timings } from './protocol';

/** Thrown into every pending promise when the worker dies. The next call starts a fresh worker (without state). */
export class EngineCrashed extends Error {
	constructor(detail: string) {
		super(`engine worker crashed: ${detail}`);
		this.name = 'EngineCrashed';
	}
}

export type Frame = { rgba: Uint8ClampedArray; progress: number; pass: number; done: boolean; stepMs: number };
export type RunResult = { rgba: Uint8ClampedArray; stats: Stats; timings: Timings };

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void };
type Waiting = { resolve: (r: RunResult | 'superseded') => void; reject: (e: Error) => void };

// Distributive Omit, so the union survives losing `id`.
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

function defaultFactory(): Worker {
	return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

/**
 * A promise-based wrapper over the engine worker. Go cannot be interrupted mid-sort, so "latest wins" means
 * coalescing: while a run is in flight only the newest further run() is kept; older waiting ones resolve
 * 'superseded'.
 */
export class EngineClient {
	private worker: Worker | null = null;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private params: Params = { ...defaultParams };
	private runInFlight = false;
	private waiting: Waiting | null = null;
	private frameListeners = new Set<(f: Frame) => void>();
	transfer: 'copy' | 'view' = 'copy';

	constructor(private readonly factory: () => Worker = defaultFactory) {}

	/** Starts the worker and resolves once the engine answered a request, i.e. after wasm loaded. */
	async ready(): Promise<void> {
		await this.send({ type: 'configure', json: JSON.stringify(this.params) }, []).catch((e: Error) => {
			// A fresh engine has no image yet; configure works without one only after init, so tolerate that.
			if (e instanceof EngineCrashed) throw e;
		});
	}

	async init(w: number, h: number): Promise<void> {
		await this.expectOk(this.send({ type: 'init', w, h }, []));
		await this.expectOk(this.send({ type: 'configure', json: JSON.stringify(this.params) }, []));
	}

	/** Copies, then transfers the copy, so the caller's array stays usable. */
	async setImage(rgba: Uint8ClampedArray): Promise<void> {
		const copy = new Uint8Array(rgba.byteLength);
		copy.set(rgba);
		await this.expectOk(this.send({ type: 'setImage', rgba: copy.buffer }, [copy.buffer]));
	}

	async setRegions(labels: Uint16Array | null, classOf: Uint8Array | null, defs: unknown): Promise<void> {
		const l = labels ? labels.slice().buffer : null;
		const c = classOf ? classOf.slice().buffer : null;
		await this.expectOk(
			this.send(
				{ type: 'setRegions', labels: l, classOf: c, defsJson: labels ? JSON.stringify(defs) : null },
				[l, c].filter((b): b is ArrayBuffer => b !== null)
			)
		);
	}

	async setMask(mask: Uint8Array | null): Promise<void> {
		const m = mask ? mask.slice().buffer : null;
		await this.expectOk(this.send({ type: 'setMask', mask: m }, m ? [m] : []));
	}

	/** Cuts the picture into cells from a tiling spec (null clears). Resolves with the label map and the class of each cell. */
	async setTiling(
		spec: object | null,
		defs: object[] | null = null
	): Promise<{ labels: Uint16Array; classOf: Uint8Array } | null> {
		const res = await this.send(
			{ type: 'setTiling', specJson: spec ? JSON.stringify(spec) : null, defsJson: defs ? JSON.stringify(defs) : null },
			[]
		);
		if (!res.ok) throw new Error(res.error);
		return res.labels && res.classOf
			? { labels: new Uint16Array(res.labels), classOf: new Uint8Array(res.classOf) }
			: null;
	}

	/** Rasterises a mask spec (objects, strokes, invert, feather) in the engine; null clears. */
	async setMaskSpec(spec: object | null): Promise<void> {
		await this.expectOk(this.send({ type: 'setMaskSpec', specJson: spec ? JSON.stringify(spec) : null }, []));
	}

	/** The brightest blob of the picture as an ellipse in fractions of the picture. */
	async brightestSpot(): Promise<{ cx: number; cy: number; w: number; h: number }> {
		const res = await this.send({ type: 'brightestSpot' }, []);
		if (!res.ok || !res.spot) throw new Error(res.ok ? 'no spot' : res.error);
		return res.spot;
	}

	async setSoft(radius: number): Promise<void> {
		await this.expectOk(this.send({ type: 'setSoft', radius }, []));
	}

	/** Merges into the last params and sends the full recipe every time. */
	async configure(params: Partial<Params>): Promise<void> {
		this.params = { ...this.params, ...params };
		await this.expectOk(this.send({ type: 'configure', json: JSON.stringify(this.params) }, []));
	}

	run(): Promise<RunResult | 'superseded'> {
		if (this.runInFlight) {
			this.waiting?.resolve('superseded');
			return new Promise((resolve, reject) => {
				this.waiting = { resolve, reject };
			});
		}
		return this.startRun();
	}

	/** Subscribes to animation frames. Each frame is acknowledged after the listeners ran, which lets the next one come. */
	onFrame(cb: (f: Frame) => void): () => void {
		this.frameListeners.add(cb);
		return () => this.frameListeners.delete(cb);
	}

	/** Prepares the current recipe and starts streaming frames. A later run() or animate() replaces it. */
	async animate(speed: Speed): Promise<Stats> {
		const res = await this.send({ type: 'animate', speed }, []);
		if (!res.ok) throw new Error(res.error);
		if (!res.stats) throw new Error('animate answered without stats');
		return res.stats;
	}
	async pause(): Promise<void> {
		await this.expectOk(this.send({ type: 'pause' }, []));
	}
	async resume(): Promise<void> {
		await this.expectOk(this.send({ type: 'resume' }, []));
	}
	async setSpeed(speed: Speed): Promise<void> {
		await this.expectOk(this.send({ type: 'setSpeed', speed }, []));
	}
	async restart(): Promise<void> {
		await this.expectOk(this.send({ type: 'restart' }, []));
	}

	dispose(): void {
		this.crash('disposed');
	}

	private startRun(): Promise<RunResult | 'superseded'> {
		this.runInFlight = true;
		const result = this.send({ type: 'run', transfer: this.transfer }, []).then((res) => {
			if (!res.ok) throw new Error(res.error);
			if (!res.rgba || !res.stats || !res.timings) throw new Error('run answered without pixels');
			return { rgba: new Uint8ClampedArray(res.rgba), stats: res.stats, timings: res.timings };
		});
		const next = (): void => {
			this.runInFlight = false;
			const w = this.waiting;
			this.waiting = null;
			if (w) this.startRun().then(w.resolve, w.reject);
		};
		result.then(next, next);
		return result;
	}

	private async expectOk(p: Promise<Response>): Promise<void> {
		const res = await p;
		if (!res.ok) throw new Error(res.error);
	}

	private send(body: WithoutId<Request>, transfer: Transferable[]): Promise<Response> {
		const worker = this.ensureWorker();
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			worker.postMessage({ ...body, id }, transfer);
		});
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		const w = this.factory();
		w.onmessage = (e: MessageEvent<Response | FrameEvent>) => {
			if ('event' in e.data) {
				this.deliverFrame(e.data);
				return;
			}
			const p = this.pending.get(e.data.id);
			if (!p) return;
			this.pending.delete(e.data.id);
			p.resolve(e.data);
		};
		w.onerror = (e: ErrorEvent) => this.crash(e.message || 'unknown error');
		this.worker = w;
		return w;
	}

	private deliverFrame(f: FrameEvent): void {
		const frame: Frame = {
			rgba: new Uint8ClampedArray(f.rgba),
			progress: f.progress,
			pass: f.pass,
			done: f.done,
			stepMs: f.stepMs
		};
		for (const cb of this.frameListeners) cb(frame);
		this.worker?.postMessage({ id: this.nextId++, type: 'ack' } satisfies Request);
	}

	private crash(detail: string): void {
		this.worker?.terminate();
		this.worker = null;
		const err = new EngineCrashed(detail);
		for (const p of this.pending.values()) p.reject(err);
		this.pending.clear();
		const w = this.waiting;
		this.waiting = null;
		w?.reject(err);
	}
}
