// Loads the built engine.wasm in Node exactly as a browser worker would, calls it, and checks the answer.
// Usage: node scripts/wasm-hello.mjs <dir with engine.wasm and wasm_exec.js>
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.argv[2] ?? 'build');
await import(pathToFileURL(path.join(dir, 'wasm_exec.js')).href); // defines globalThis.Go
const go = new Go();
const { instance } = await WebAssembly.instantiate(readFileSync(path.join(dir, 'engine.wasm')), go.importObject);
go.run(instance); // runs until the program exits; main() parks forever, so do not await it

const deadline = Date.now() + 5000;
while (!globalThis.pixelsortReady) {
  if (Date.now() > deadline) { console.error('FAIL: engine.wasm did not become ready within 5 s'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 10));
}
const got = globalThis.pixelsort.version();
if (!got.ok || typeof got.version !== 'string' || got.version === '') { console.error('FAIL: version() returned', got); process.exit(1); }
console.log('ok: version() ->', got.version);
process.exit(0);
