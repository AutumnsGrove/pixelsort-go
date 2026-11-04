// Loads Go's WebAssembly runtime and the engine inside a worker, calls it once, and reports back.
importScripts('wasm_exec.js');
(async () => {
  try {
    const go = new Go();
    const { instance } = await WebAssembly.instantiateStreaming(fetch('engine.wasm'), go.importObject);
    go.run(instance); // main() parks forever; do not await
    while (!self.pixelsortReady) await new Promise((r) => setTimeout(r, 5));
    postMessage({ ok: true, version: self.pixelsort.ping() });
  } catch (err) {
    postMessage({ ok: false, error: String(err) });
  }
})();
