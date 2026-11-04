<script lang="ts">
	import { onMount } from 'svelte';
	import '../../../lib/engine/vendor/wasm_exec.js';

	// Driven by web/scripts/bench.mjs. Loads the engine on the main thread (the transfer strategies cost the same
	// there as in a worker) and exposes window.bench.
	type Row = { mp: number; prepare: number; sort: number; copy: number; view: number; viewOk: boolean; send: number; same: boolean };
	let status = $state('loading');

	onMount(async () => {
		const go = new Go();
		const { instance } = await WebAssembly.instantiateStreaming(fetch('/engine.wasm'), go.importObject);
		void go.run(instance);
		while (!globalThis.pixelsortReady) await new Promise((r) => setTimeout(r, 10));
		const ps = globalThis.pixelsort;
		const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
		const worst = (a: number[]) => Math.max(...a);
		const time = <T,>(f: () => T): [T, number] => {
			const t = performance.now();
			const r = f();
			return [r, performance.now() - t];
		};
		(window as unknown as { bench: (mp: number, runs: number) => Promise<unknown> }).bench = async (mp, runs) => {
			const w = Math.round(Math.sqrt(mp * 1e6 * (4 / 3)));
			const h = Math.round((mp * 1e6) / w);
			const rgba = new Uint8Array(w * h * 4);
			for (let i = 0; i < w * h; i++) rgba.set([(i * 7) & 255, ((i / w) | 0) & 255, (i * 13) & 255, 255], i * 4);
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d')!;
			const rec = { prepare: [] as number[], sort: [] as number[], copy: [] as number[], view: [] as number[], send: [] as number[] };
			let viewOk = true;
			let same = true;
			ps.init(w, h);
			ps.configure(JSON.stringify({ angle: 30, length: 80 }));
			for (let i = 0; i < runs; i++) {
				const [, send] = time(() => ps.setImage(rgba)); // one-way cost into Go memory (the copy a transfer ends in)
				rec.send.push(send);
				const [, p] = time(() => ps.prepare());
				const [, s] = time(() => ps.instant());
				rec.prepare.push(p);
				rec.sort.push(s);
				const [dst, c] = time(() => {
					const d = new Uint8Array(w * h * 4);
					ps.copyPixels(d);
					ctx.putImageData(new ImageData(new Uint8ClampedArray(d.buffer), w, h), 0, 0);
					return d;
				});
				rec.copy.push(c);
				const [v, vt] = time(() => {
					const pp = ps.pixelsPtr();
					if (!pp.ok) return null;
					const mem = go._inst!.exports.mem;
					const view = new Uint8ClampedArray(mem.buffer, pp.ptr, pp.len);
					if (view.byteLength !== pp.len) viewOk = false;
					ctx.putImageData(new ImageData(view, w, h), 0, 0);
					return view.slice();
				});
				rec.view.push(vt);
				if (!v || v.length !== dst.length || !v.every((x, j) => x === dst[j])) same = false;
			}
			const row: Row & { worst: Record<string, number> } = {
				mp: (w * h) / 1e6,
				prepare: median(rec.prepare),
				sort: median(rec.sort),
				copy: median(rec.copy),
				view: median(rec.view),
				viewOk,
				send: median(rec.send),
				same,
				worst: { prepare: worst(rec.prepare), sort: worst(rec.sort), copy: worst(rec.copy), view: worst(rec.view) }
			};
			return row;
		};
		status = 'ready';
	});
</script>

<p data-testid="bench-status">{status}</p>
