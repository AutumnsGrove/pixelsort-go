// Types for the globals Go's wasm_exec.js and cmd/wasm define inside the worker.

type GoResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

declare class Go {
	importObject: WebAssembly.Imports;
	run(instance: WebAssembly.Instance): Promise<void>;
	_inst?: { exports: { mem: WebAssembly.Memory } };
}

interface PixelsortApi {
	version(): GoResult<{ version: string }>;
	init(w: number, h: number): GoResult;
	setImage(rgba: Uint8Array | Uint8ClampedArray): GoResult;
	setRegions(labels: Uint16Array | null, classOf: Uint8Array | null, defsJson: string | null): GoResult;
	setMask(mask: Uint8Array | null): GoResult;
	setSoft(radius: number): GoResult;
	configure(json: string): GoResult;
	prepare(): GoResult<{ stats: { lines: number; intervals: number; sortable: number; frozen: number } }>;
	instant(): GoResult;
	reset(): GoResult;
	step(n: number): GoResult<{ done: boolean; progress: number; pass: number }>;
	pixelsPtr(): GoResult<{ ptr: number; len: number }>;
	copyPixels(dst: Uint8Array): GoResult;
}

// eslint-disable-next-line no-var
declare var pixelsort: PixelsortApi;
// eslint-disable-next-line no-var
declare var pixelsortReady: boolean | undefined;
