/// <reference lib="webworker" />
import './vendor/wasm_exec.js';
import { adaptAuto, fixedSteps, type Speed } from './animator';
import { EngineDownloadFailed, fetchEngine } from './loader';
import type { FrameEvent, LoadingEvent, Request, Response } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

// The worker loads Go's runtime and engine.wasm once, then answers one request at a time in arrival order. The download goes
// through fetchEngine (stall timeout, one retry, progress) so a flaky link ends in a clear message and a retry, not a hang.
async function load(): Promise<void> {
	const go = new Go();
	const url = new URL('/engine.wasm', self.location.origin);
	let last = 0;
	self.postMessage({ event: 'loading', loaded: 0, total: null, attempt: 1 } satisfies LoadingEvent); // so "loading" shows before the first byte
	const bytes = await fetchEngine(url.toString(), {
		onProgress: (p) => {
			// at most ten updates a second, but never skip the last one
			const now = performance.now();
			if (now - last < 100 && p.loaded !== p.total) return;
			last = now;
			self.postMessage({ event: 'loading', ...p } satisfies LoadingEvent);
		}
	});
	const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
	void go.run(instance); // main() parks forever; do not await it
	for (let i = 0; !globalThis.pixelsortReady; i++) {
		if (i > 500) throw new Error('engine.wasm did not become ready');
		await new Promise((r) => setTimeout(r, 10));
	}
	goInstance = go;
	self.postMessage({ event: 'loaded' } satisfies LoadingEvent);
}
let goInstance: Go | null = null;
const ready = load();
ready.catch(() => {}); // each request below reports it; this keeps an unhandled rejection from also being logged

function fail(id: number, error: string): Response {
	return { id, ok: false, error };
}

/** Reads the sorted pixels out of Go memory into a fresh ArrayBuffer, by copying or by a view into linear memory. */
function takePixels(strategy: 'copy' | 'view'): { rgba: ArrayBuffer } | { error: string } {
	if (strategy === 'view') {
		const p = globalThis.pixelsort.pixelsPtr();
		const mem = goInstance?._inst?.exports.mem;
		if (!p.ok || !mem) return { error: p.ok ? 'no wasm memory' : p.error };
		const view = new Uint8Array(mem.buffer, p.ptr, p.len);
		if (view.byteLength !== p.len) return { error: 'view length mismatch' };
		return { rgba: view.slice().buffer };
	}
	const p = globalThis.pixelsort.pixelsPtr();
	if (!p.ok) return { error: p.error };
	const dst = new Uint8Array(p.len);
	const r = globalThis.pixelsort.copyPixels(dst);
	return r.ok ? { rgba: dst.buffer } : { error: r.error };
}

// ---- animation: the worker drives the stepper and streams frames; the page acknowledges each one ----
const anim = {
	running: false,
	paused: false,
	speed: 24 as Speed,
	carry: 0,
	autoSteps: 1,
	awaitingAck: false,
	last: 0,
	timer: 0
};

function stopAnimation(): void {
	anim.running = false;
	clearTimeout(anim.timer);
}

function scheduleTick(): void {
	clearTimeout(anim.timer);
	anim.timer = self.setTimeout(tick, 0);
}

function tick(): void {
	if (!anim.running || anim.paused || anim.awaitingAck) return;
	const now = performance.now();
	let steps: number;
	if (anim.speed === 'auto') {
		steps = anim.autoSteps;
	} else {
		const r = fixedSteps((now - anim.last) / 1000, anim.speed, anim.carry);
		steps = r.steps;
		anim.carry = r.carry;
	}
	anim.last = now;
	if (steps < 1) {
		scheduleTick();
		return;
	}
	const t0 = performance.now();
	const r = globalThis.pixelsort.step(steps);
	const stepMs = performance.now() - t0;
	if (!r.ok) {
		stopAnimation();
		return;
	}
	if (anim.speed === 'auto') anim.autoSteps = adaptAuto(anim.autoSteps, stepMs);
	const px = takePixels('copy');
	if ('error' in px) {
		stopAnimation();
		return;
	}
	const frame: FrameEvent = { event: 'frame', rgba: px.rgba, progress: r.progress, pass: r.pass, done: r.done, stepMs };
	anim.awaitingAck = true;
	self.postMessage(frame, [px.rgba]);
	if (r.done) stopAnimation();
}

function startAnimation(): { ok: true } | { ok: false; error: string } {
	const reset = globalThis.pixelsort.reset();
	if (!reset.ok) return reset;
	Object.assign(anim, {
		running: true,
		paused: false,
		carry: 0,
		autoSteps: 1,
		awaitingAck: false,
		last: performance.now()
	});
	scheduleTick();
	return { ok: true };
}

function handle(req: Request): { res: Response; transfer: Transferable[] } {
	const api = globalThis.pixelsort;
	const done = (r: GoResult): Response => (r.ok ? { id: req.id, ok: true } : fail(req.id, r.error));
	switch (req.type) {
		case 'init':
			return { res: done(api.init(req.w, req.h)), transfer: [] };
		case 'setImage':
			return { res: done(api.setImage(new Uint8Array(req.rgba))), transfer: [] };
		case 'setRegions':
			return {
				res: done(
					api.setRegions(
						req.labels ? new Uint16Array(req.labels) : null,
						req.classOf ? new Uint8Array(req.classOf) : null,
						req.defsJson
					)
				),
				transfer: []
			};
		case 'setMask':
			return { res: done(api.setMask(req.mask ? new Uint8Array(req.mask) : null)), transfer: [] };
		case 'setSoft':
			return { res: done(api.setSoft(req.radius)), transfer: [] };
		case 'setTiling': {
			const r = api.setTiling(req.specJson, req.defsJson);
			if (!r.ok) return { res: fail(req.id, r.error), transfer: [] };
			if (req.specJson === null) return { res: { id: req.id, ok: true }, transfer: [] };
			// Copy the label map and the class table out of Go memory so the page can draw outlines and class tints.
			const p = api.labelsPtr();
			const mem = goInstance?._inst?.exports.mem;
			const c = api.classOf();
			if (!p.ok || !mem || !c.ok) return { res: fail(req.id, 'no region data'), transfer: [] };
			const labels = new Uint8Array(mem.buffer, p.ptr, p.len).slice().buffer;
			const classOf = c.classes.slice().buffer;
			return { res: { id: req.id, ok: true, labels, classOf }, transfer: [labels, classOf] };
		}
		case 'setMaskSpec':
			return { res: done(api.setMaskSpec(req.specJson)), transfer: [] };
		case 'brightestSpot': {
			const r = api.brightestSpot();
			return {
				res: r.ok ? { id: req.id, ok: true, spot: { cx: r.cx, cy: r.cy, w: r.w, h: r.h } } : fail(req.id, r.error),
				transfer: []
			};
		}
		case 'histogram': {
			const r = api.histogram(req.key);
			return { res: r.ok ? { id: req.id, ok: true, counts: r.counts } : fail(req.id, r.error), transfer: [] };
		}
		case 'caRules': {
			const r = api.caRules();
			return { res: r.ok ? { id: req.id, ok: true, rules: r.rules } : fail(req.id, r.error), transfer: [] };
		}
		case 'caPreview': {
			const r = api.caPreview(req.json, req.rule);
			if (!r.ok) return { res: fail(req.id, r.error), transfer: [] };
			const mask = r.mask.slice().buffer; // a copy that can be transferred
			return { res: { id: req.id, ok: true, mask, preview: { w: r.w, h: r.h } }, transfer: [mask] };
		}
		case 'sortable': {
			const prep = api.prepare();
			if (!prep.ok) return { res: fail(req.id, prep.error), transfer: [] };
			const r = api.sortable();
			if (!r.ok) return { res: fail(req.id, r.error), transfer: [] };
			const mask = r.mask.slice().buffer; // a copy that can be transferred
			return { res: { id: req.id, ok: true, mask }, transfer: [mask] };
		}
		case 'configure':
			return { res: done(api.configure(req.json)), transfer: [] };
		case 'animate': {
			const prep = api.prepare();
			if (!prep.ok) return { res: fail(req.id, prep.error), transfer: [] };
			anim.speed = req.speed;
			const started = startAnimation();
			if (!started.ok) return { res: fail(req.id, started.error), transfer: [] };
			return { res: { id: req.id, ok: true, stats: prep.stats }, transfer: [] };
		}
		case 'pause':
			anim.paused = true;
			return { res: { id: req.id, ok: true }, transfer: [] };
		case 'resume':
			anim.paused = false;
			if (anim.running) {
				anim.last = performance.now();
				scheduleTick();
			}
			return { res: { id: req.id, ok: true }, transfer: [] };
		case 'setSpeed':
			anim.speed = req.speed;
			return { res: { id: req.id, ok: true }, transfer: [] };
		case 'restart': {
			const started = startAnimation();
			return { res: started.ok ? { id: req.id, ok: true } : fail(req.id, started.error), transfer: [] };
		}
		case 'seek': {
			// Scrubbing holds the animation where the person put it; Resume carries on from there (even if the sort had
			// finished before they dragged back).
			anim.paused = true;
			const r = api.seek(req.pass);
			if (!r.ok) return { res: fail(req.id, r.error), transfer: [] };
			const px = takePixels('copy');
			if ('error' in px) return { res: fail(req.id, px.error), transfer: [] };
			anim.running = !r.done;
			clearTimeout(anim.timer);
			return {
				res: { id: req.id, ok: true, rgba: px.rgba, seek: { pass: r.pass, progress: r.progress, done: r.done } },
				transfer: [px.rgba]
			};
		}
		case 'ack':
			anim.awaitingAck = false;
			if (anim.running && !anim.paused) scheduleTick();
			return { res: { id: req.id, ok: true }, transfer: [] }; // the client does not wait for it
		case 'run': {
			stopAnimation();
			const t0 = performance.now();
			const prep = api.prepare();
			if (!prep.ok) return { res: fail(req.id, prep.error), transfer: [] };
			const t1 = performance.now();
			const sorted = api.instant();
			if (!sorted.ok) return { res: fail(req.id, sorted.error), transfer: [] };
			const t2 = performance.now();
			const px = takePixels(req.transfer ?? 'copy');
			if ('error' in px) return { res: fail(req.id, px.error), transfer: [] };
			const t3 = performance.now();
			return {
				res: {
					id: req.id,
					ok: true,
					stats: prep.stats,
					rgba: px.rgba,
					timings: { prepareMs: t1 - t0, sortMs: t2 - t1, transferMs: t3 - t2 }
				},
				transfer: [px.rgba]
			};
		}
	}
}

self.onmessage = async (e: MessageEvent<Request>) => {
	try {
		await ready;
	} catch (err) {
		if (err instanceof EngineDownloadFailed) {
			self.postMessage({
				...fail(e.data.id, err.message),
				download: { attempts: err.attempts, reason: err.reason, url: '/engine.wasm' }
			});
		} else self.postMessage(fail(e.data.id, `engine failed to load: ${(err as Error).message}`));
		return;
	}
	const { res, transfer } = handle(e.data);
	if (e.data.type !== 'ack') self.postMessage(res, transfer);
};
