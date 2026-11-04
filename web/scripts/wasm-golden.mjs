// Runs every golden recipe through the real WASM API in Node and compares the SHA-256 with the native goldens.
// Usage: node web/scripts/wasm-golden.mjs [dir with engine.wasm and wasm_exec.js]   (default: build)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.argv[2] ?? 'build');
await import(pathToFileURL(path.join(dir, 'wasm_exec.js')).href);
const go = new Go();
const { instance } = await WebAssembly.instantiate(readFileSync(path.join(dir, 'engine.wasm')), go.importObject);
go.run(instance);
for (let i = 0; !globalThis.pixelsortReady; i++) {
	if (i > 500) throw new Error('engine.wasm did not become ready');
	await new Promise((r) => setTimeout(r, 10));
}
const ps = globalThis.pixelsort;

// testutil.Gradient, integer-only: identical bytes to the Go helper.
export function gradient(w, h, seed) {
	const out = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const o = (y * w + x) * 4;
			out[o] = (Math.floor((x * 255) / Math.max(1, w - 1)) + seed * 7) & 255;
			out[o + 1] = (Math.floor((y * 255) / Math.max(1, h - 1)) + seed * 13) & 255;
			out[o + 2] = ((x ^ y) * 5 + seed) & 255;
			out[o + 3] = 255;
		}
	}
	return out;
}

function ok(r, what) {
	if (!r || r.ok !== true) throw new Error(`${what}: ${r?.error ?? 'no result'}`);
	return r;
}

const recipes = JSON.parse(readFileSync('engine/testdata/golden/recipes.json', 'utf8'));
let failed = 0;
for (const rc of recipes) {
	ok(ps.init(rc.w, rc.h), 'init');
	ok(ps.setImage(gradient(rc.w, rc.h, rc.gradientSeed)), 'setImage');
	if (rc.regions) {
		// testutil.GridCells and ClassPattern("checker"): cell ids from 1, class = id%2+1.
		const size = rc.regions.cellSize;
		const cw = Math.ceil(rc.w / size);
		const labels = new Uint16Array(rc.w * rc.h);
		for (let y = 0; y < rc.h; y++)
			for (let x = 0; x < rc.w; x++) labels[y * rc.w + x] = Math.floor(y / size) * cw + Math.floor(x / size) + 1;
		const cells = Math.max(...labels);
		const classOf = new Uint8Array(cells + 1);
		for (let id = 1; id <= cells; id++) classOf[id] = (id % 2) + 1;
		ok(ps.setRegions(labels, classOf, JSON.stringify(rc.regions.defs)), 'setRegions');
	} else {
		ok(ps.setRegions(null, null, null), 'clear regions');
	}
	ok(ps.configure(JSON.stringify(rc.params)), 'configure');
	ok(ps.prepare(), 'prepare');
	for (const how of ['instant', 'stepped']) {
		if (how === 'instant') ok(ps.instant(), 'instant');
		else {
			ok(ps.reset(), 'reset');
			for (let n = 0; !ok(ps.step(50), 'step').done; n++) if (n > 100000) throw new Error('stepper did not finish');
		}
		const dst = new Uint8Array(rc.w * rc.h * 4);
		ok(ps.copyPixels(dst), 'copyPixels');
		const got = createHash('sha256').update(dst).digest('hex');
		if (got === rc.sha256) console.log(`ok   ${rc.name} (${how})`);
		else {
			failed++;
			console.log(`FAIL ${rc.name} (${how}): ${got} != ${rc.sha256}`);
		}
	}
}
process.exit(failed ? 1 : 0);
