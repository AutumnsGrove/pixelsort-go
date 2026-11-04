// Time one stepper pass in WASM under Node for odd-even at 1 and 2 MP. Usage: node web/scripts/bench-step.mjs [dir]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.argv[2] ?? 'build');
await import(pathToFileURL(path.join(dir, 'wasm_exec.js')).href);
const go = new Go();
const { instance } = await WebAssembly.instantiate(readFileSync(path.join(dir, 'engine.wasm')), go.importObject);
go.run(instance);
while (!globalThis.pixelsortReady) await new Promise((r) => setTimeout(r, 10));
const ps = globalThis.pixelsort;
for (const [name, w, h] of [
	['1MP', 1000, 1000],
	['2MP', 1600, 1250]
]) {
	const rgba = new Uint8Array(w * h * 4);
	for (let i = 0; i < w * h; i++) rgba.set([(i * 7) & 255, ((i / w) | 0) & 255, (i * 13) & 255, 255], i * 4);
	ps.init(w, h);
	ps.setImage(rgba);
	ps.configure(JSON.stringify({ angle: 30, length: 50, randomness: 0, algo: 'oddeven' }));
	ps.prepare();
	ps.reset();
	const times = [];
	for (let i = 0; i < 20; i++) {
		const t = performance.now();
		const r = ps.step(1);
		times.push(performance.now() - t);
		if (r.done) break;
	}
	times.sort((a, b) => a - b);
	console.log(
		`${name} odd-even pass in WASM: median ${times[times.length >> 1].toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times.at(-1).toFixed(1)})`
	);
}
process.exit(0);
