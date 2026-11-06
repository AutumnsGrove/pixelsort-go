import { defaultParams, type Params } from './params';
import type { Speed } from './animator';
import { EngineDownloadFailed, type LoadProgress } from './loader';
import type { FrameEvent, LoadingEvent, Request, Response, Stats, Timings } from './protocol';

/** Thrown into every pending promise when the worker dies. The next call starts a fresh worker (without state). */
export class EngineCrashed extends Error {
	constructor(detail: string) {
		super(`engine worker crashed: ${detail}`);
		this.name = 'EngineCrashed';
	}
}

export type Frame = { rgba: Uint8ClampedArray; progress: number; pass: number; done: boolean; stepMs: number };
export type RunResult = { rgba: Uint8ClampedArray; stats: Stats; timings: Timings };

export type SeekResult = { rgba: Uint8ClampedArray; pass: number; progress: number; done: boolean };
type SeekWaiting = { resolve: (r: SeekResult | 'superseded') => void; reject: (e: Error) => void; pass: number };

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
	private seekInFlight = false;
	private seekWaiting: SeekWaiting | null = null;
	private frameListeners = new Set<(f: Frame) => void>();
	private loadingListeners = new Set<(p: LoadProgress | null) => void>();
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

	/** How many pixels have each 0..255 value of a sort key (counts add up to w*h). */
	async histogram(key: string): Promise<number[]> {
		const res = await this.send({ type: 'histogram', key }, []);
		if (!res.ok || !res.counts) throw new Error(res.ok ? 'no counts' : res.error);
		return res.counts;
	}
	/** The recommended cellular-automaton rules and what each looks like, from the engine. */
	async caRules(): Promise<{ rule: number; note: string }[]> {
		const res = await this.send({ type: 'caRules' }, []);
		if (!res.ok || !res.rules) throw new Error(res.ok ? 'no rules' : res.error);
		return res.rules;
	}

	/**
	 * What one cellular rule looks like with this recipe (space, sort angle, cell size, boundary, seed): a small fixed canvas of
	 * 0/1 cells, drawn by the engine's own mask code. The recipe travels with the question, so it needs no picture and no
	 * configure, and it never disturbs a sort that is running.
	 */
	async caPreview(params: Params, rule: number): Promise<{ mask: Uint8Array; w: number; h: number }> {
		const res = await this.send({ type: 'caPreview', json: JSON.stringify(params), rule }, []);
		if (!res.ok) throw new Error(res.error);
		if (!res.mask || !res.preview) throw new Error('caPreview answered without a mask');
		return { mask: new Uint8Array(res.mask), ...res.preview };
	}

	/** Which pixels the current recipe lets move: 1 where a pixel is in some interval, 0 where it is held. Asked of the engine, never worked out here. */
	async sortable(): Promise<Uint8Array> {
		const res = await this.send({ type: 'sortable' }, []);
		if (!res.ok || !res.mask) throw new Error(res.ok ? 'no mask' : res.error);
		return new Uint8Array(res.mask);
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

	/** Subscribes to the engine download: progress while it downloads, then `null` once the engine is running. */
	onLoading(cb: (p: LoadProgress | null) => void): () => void {
		this.loadingListeners.add(cb);
		return () => this.loadingListeners.delete(cb);
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

	/**
	 * Pauses and jumps to the state after `pass` passes, answering with those pixels. Latest wins: while one seek is in flight
	 * only the newest further seek is kept, and any older waiting one resolves 'superseded', so dragging a slider never queues
	 * up work for positions already passed.
	 */
	seek(pass: number): Promise<SeekResult | 'superseded'> {
		if (this.seekInFlight) {
			this.seekWaiting?.resolve('superseded');
			return new Promise((resolve, reject) => {
				this.seekWaiting = { resolve, reject, pass };
			});
		}
		return this.startSeek(pass);
	}
	private startSeek(pass: number): Promise<SeekResult | 'superseded'> {
		this.seekInFlight = true;
		const result = this.send({ type: 'seek', pass }, []).then((res): SeekResult => {
			if (!res.ok) throw new Error(res.error);
			if (!res.rgba || !res.seek) throw new Error('seek answered without pixels');
			return { rgba: new Uint8ClampedArray(res.rgba), ...res.seek };
		});
		const next = (): void => {
			this.seekInFlight = false;
			const w = this.seekWaiting;
			this.seekWaiting = null;
			if (w) this.startSeek(w.pass).then(w.resolve, w.reject);
		};
		result.then(next, next);
		return result;
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
		w.onmessage = (e: MessageEvent<Response | FrameEvent | LoadingEvent>) => {
			if ('event' in e.data) {
				if (e.data.event === 'frame') this.deliverFrame(e.data);
				else this.deliverLoading(e.data);
				return;
			}
			const p = this.pending.get(e.data.id);
			if (!p) return;
			this.pending.delete(e.data.id);
			const d = !e.data.ok && e.data.download;
			if (d) p.reject(new EngineDownloadFailed(d.url, d.attempts, d.reason));
			else p.resolve(e.data);
		};
		w.onerror = (e: ErrorEvent) => this.crash(e.message || 'unknown error');
		this.worker = w;
		return w;
	}

	private deliverLoading(e: LoadingEvent): void {
		const p = e.event === 'loading' ? { loaded: e.loaded, total: e.total, attempt: e.attempt } : null;
		for (const cb of this.loadingListeners) cb(p);
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
