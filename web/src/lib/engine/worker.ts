/// <reference lib="webworker" />
import './vendor/wasm_exec.js';
import type { Request, Response } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

// The worker loads Go's runtime and engine.wasm once, then answers one request at a time in arrival order.
async function load(): Promise<void> {
	const go = new Go();
	const url = new URL('/engine.wasm', self.location.origin);
	const { instance } = await WebAssembly.instantiateStreaming(fetch(url), go.importObject);
	void go.run(instance); // main() parks forever; do not await it
	for (let i = 0; !globalThis.pixelsortReady; i++) {
		if (i > 500) throw new Error('engine.wasm did not become ready');
		await new Promise((r) => setTimeout(r, 10));
	}
	goInstance = go;
}
let goInstance: Go | null = null;
const ready = load();

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
		case 'configure':
			return { res: done(api.configure(req.json)), transfer: [] };
		case 'run': {
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
		self.postMessage(fail(e.data.id, `engine failed to load: ${(err as Error).message}`));
		return;
	}
	const { res, transfer } = handle(e.data);
	self.postMessage(res, transfer);
};
