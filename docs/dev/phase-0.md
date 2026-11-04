# Phase 0: repo, tooling, and a hello-world WASM

**Goal.** A repo that builds, lints and tests itself with one command, CI that does the same, and proof that
the Go engine can run as WebAssembly inside a web worker, served with the headers a future worker pool needs.

**Exit criteria (all must hold).**

1. `make check` passes from a clean checkout.
2. `make hello` prints `ok: ping() -> 1` (the engine runs as WASM, under Node).
3. `make wasm-test` passes (the engine's tests run inside WASM).
4. `make fuzz FUZZTIME=2s` runs at least one fuzz target.
5. CI workflow exists (cannot run locally; review it by eye).
6. **[HUMAN]** The spike page, opened over `tailscale serve`, shows `crossOriginIsolated true` and an engine
   version. Recorded in `docs/dev/NOTES.md`.

All code blocks below were run and passed (Go 1.27.3, arm64 and amd64, Node 26) when this plan was written.
Copy them, then make the tests pass; where a test is shown, write it first.

Work on branch `build/phase-0`.

---

### P0-T01 · Module, repo hygiene, engine stub

**Goal.** An empty but valid Go module with the `engine` package and its first test.

**Files.** `go.mod`, `.gitignore`, `.editorconfig`, `engine/engine.go`, `engine/engine_test.go`.

**Spec.**
- `go.mod`: module `github.com/AutumnsGrove/pixelsort-go`, `go 1.27`. (Run `go mod init` then edit.)
- `.gitignore` contains: `build/`, `web/build/`, `web/.svelte-kit/`, `node_modules/`, `*.wasm`,
  `spike/wasm_exec.js`, `coverage.out`, `dist/`, `.env`, `data/`.
- `.editorconfig`: UTF-8, LF, final newline, tabs for `*.go` and `Makefile`, two spaces otherwise.
- `engine` package with `EngineVersion`.

**Test first** (`engine/engine_test.go`):

```
package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func TestEngineVersionIsSet(t *testing.T) {
	if engine.EngineVersion == "" {
		t.Fatal("EngineVersion must not be empty")
	}
}
```

**Implement** (`engine/engine.go`):

```
// Package engine is the pixel-sorting engine. It is pure: no I/O, no globals, no syscall/js. PLAN.md section 3.
package engine

// EngineVersion identifies engine behaviour. It is stored with every run and bumped whenever a golden hash
// changes on purpose (see docs/dev/testing.md).
const EngineVersion = "1"
```

**Verify.** `go test ./engine` passes; `gofmt -l .` prints nothing.

**Commit.** `Add module and engine stub`

---

### P0-T02 · Version package and CLI root

**Goal.** A `pixelsort-go version` command that prints a build-stamped version.

**Files.** `internal/version/version.go`, `cmd/pixelsort-go/main.go`, `cmd/pixelsort-go/main_test.go`.
Add the dependency: `go get github.com/spf13/cobra@latest && go mod tidy`.

**Test first** (`cmd/pixelsort-go/main_test.go`):

```
package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestVersionCommandPrintsVersion(t *testing.T) {
	root := newRoot()
	var out bytes.Buffer
	root.SetOut(&out)
	root.SetArgs([]string{"version"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(out.String()) == "" {
		t.Fatal("version printed nothing")
	}
}
```

**Implement.** `main.go` references `newServe()`, which you add in P0-T03; to keep this task compiling on its
own, create `serve.go` with a stub `func newServe() *cobra.Command { return &cobra.Command{Use: "serve"} }` and
replace it in P0-T03. (The final `main.go`:)

```
// Command pixelsort-go is the server and command line for pixelsort-go.
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/AutumnsGrove/pixelsort-go/internal/version"
)

func newRoot() *cobra.Command {
	root := &cobra.Command{Use: "pixelsort-go", Short: "A pixel sorter you can watch", SilenceUsage: true}
	root.AddCommand(newServe(), newVersion())
	return root
}

func newVersion() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version",
		RunE: func(cmd *cobra.Command, _ []string) error {
			_, err := fmt.Fprintln(cmd.OutOrStdout(), version.Version)
			return err
		},
	}
}

func main() {
	if err := newRoot().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err) //nolint:errcheck // nothing useful to do if stderr is closed
		os.Exit(1)
	}
}
```

`internal/version/version.go`:

```
// Package version holds the build's version string, stamped in at build time.
package version

// Version is "r<commit count>.<short sha>" in a release build and "dev" otherwise.
// Set with: go build -ldflags "-X github.com/AutumnsGrove/pixelsort-go/internal/version.Version=r12.abc1234".
var Version = "dev"
```

**Note (a trap found while verifying).** `fmt.Fprintln` returns an error and `errcheck` rejects ignoring it.
That is why `version` uses `RunE` and returns the error, and why `main` has one commented `//nolint:errcheck`.

**Verify.** `go test ./cmd/...` passes; `go run ./cmd/pixelsort-go version` prints `dev`.

**Commit.** `Add CLI root and version command`

---

### P0-T03 · Cross-origin isolation middleware and static handler

**Goal.** A tiny file server that sets COOP, COEP and CORP, and serves `.wasm` as `application/wasm`.
This is the seed of the real app server (phase 6).

**Files.** `server/headers.go`, `server/headers_test.go`, `server/static.go`, `server/static_test.go`,
`cmd/pixelsort-go/serve.go`.

**Why the headers.** Browsers only expose `SharedArrayBuffer` (needed for a future worker pool) on pages that
are *cross-origin isolated*, which needs `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. `Cross-Origin-Resource-Policy: same-origin` lets our own assets
load under that policy. Browsers also refuse streaming WebAssembly compilation unless the type is
`application/wasm`.

**Tests first.**

`server/headers_test.go`:

```
package server_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/server"
)

func TestCrossOriginIsolationSetsHeaders(t *testing.T) {
	h := server.CrossOriginIsolation(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	for k, want := range map[string]string{"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin"} {
		if got := rec.Header().Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("wrapped handler status lost: %d", rec.Code)
	}
}
```

`server/static_test.go`:

```
package server_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/server"
)

func TestStaticHandlerServesWasmWithRightType(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "engine.wasm"), []byte("\x00asm\x01\x00\x00\x00"), 0o600); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	server.NewStaticHandler(dir).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/engine.wasm", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/wasm" {
		t.Errorf("Content-Type = %q, want application/wasm", got)
	}
	if rec.Header().Get("Cross-Origin-Opener-Policy") != "same-origin" {
		t.Error("static files must be cross-origin isolated")
	}
}
```

**Implement.**

`server/headers.go`:

```
// Package server serves the web app and the gallery API.
package server

import "net/http"

// CrossOriginIsolation sets the headers that make a page cross-origin isolated, which a future worker pool needs
// for SharedArrayBuffer. PLAN.md section 5.
func CrossOriginIsolation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Embedder-Policy", "require-corp")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}
```

`server/static.go`:

```
package server

import (
	"mime"
	"net/http"
)

// NewStaticHandler serves dir with the right type for .wasm (browsers refuse streaming compile otherwise) and
// with cross-origin isolation.
func NewStaticHandler(dir string) http.Handler {
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	return CrossOriginIsolation(http.FileServer(http.Dir(dir)))
}
```

`cmd/pixelsort-go/serve.go` (replaces the stub):

```
package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/spf13/cobra"

	"github.com/AutumnsGrove/pixelsort-go/server"
)

func newServe() *cobra.Command {
	var dir, addr string
	c := &cobra.Command{
		Use:   "serve",
		Short: "Serve static files with cross-origin isolation (phase 0 spike; grows into the app server)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if _, err := fmt.Fprintf(cmd.OutOrStdout(), "serving %s on http://%s\n", dir, addr); err != nil {
				return err
			}
			srv := &http.Server{Addr: addr, Handler: server.NewStaticHandler(dir), ReadHeaderTimeout: 10 * time.Second}
			return srv.ListenAndServe()
		},
	}
	c.Flags().StringVar(&dir, "dir", "spike", "directory to serve")
	c.Flags().StringVar(&addr, "addr", "127.0.0.1:8895", "listen address")
	return c
}
```

**Verify.** `go test ./server ./cmd/...` passes.

**Commit.** `Add cross-origin isolated static server`

---

### P0-T04 · Lint config and Makefile

**Goal.** One command, `make check`, that a person or CI runs before every commit.

**Files.** `.golangci.yml`, `Makefile`.

`.golangci.yml` (golangci-lint **v2** format; v2.15 is installed here):

```
version: "2"

run:
  timeout: 5m

linters:
  default: none
  enable:
    - errcheck
    - govet
    - staticcheck
    - unused
    - ineffassign
    - gosec
    - revive
    - misspell
    - errorlint
    - copyloopvar
    - unparam
    - nilerr
    - gocritic
  settings:
    revive:
      rules:
        - name: exported
        - name: package-comments
        - name: error-return
        - name: error-strings
        - name: error-naming
        - name: if-return
        - name: increment-decrement
        - name: var-declaration
        - name: indent-error-flow
        - name: errorf
        - name: empty-block
        - name: unreachable-code
        - name: redefines-builtin-id
  exclusions:
    rules:
      - path: _test\.go
        linters: [gosec, unparam]

formatters:
  enable:
    - gofmt
    - goimports
```

`Makefile` (recipe lines start with a **tab**, not spaces):

```
SHELL := /bin/bash
.DEFAULT_GOAL := check

GOROOT_DIR := $(shell go env GOROOT)
WASM_EXEC := $(GOROOT_DIR)/lib/wasm/go_js_wasm_exec
FUZZTIME ?= 20s
VERSION ?= r$(shell git rev-list --count HEAD 2>/dev/null || echo 0).$(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
LDFLAGS := -X github.com/AutumnsGrove/pixelsort-go/internal/version.Version=$(VERSION)

.PHONY: check fmt fmt-check vet lint short test fuzz bench wasm wasm-test hello spike web web-test e2e clean

## check: format check, vet, lint and the fast tests. Run before every commit.
check: fmt-check vet lint short

fmt:
	gofmt -w .

fmt-check:
	@test -z "$$(gofmt -l .)" || { echo "gofmt needed on:"; gofmt -l .; exit 1; }

vet:
	go vet ./...

lint:
	golangci-lint run ./...

## short: fast tests only (properties run at their default 100 checks).
short:
	go test -short -shuffle=on ./...

## test: everything native, with the race detector.
test:
	go test -race -shuffle=on ./...

## fuzz: explore every Fuzz target for FUZZTIME (default 20s) each. -fuzz takes one target per run, so loop.
fuzz:
	@set -e; for pkg in $$(go list ./...); do \
	  for f in $$(go test -list '^Fuzz' $$pkg | grep '^Fuzz' || true); do \
	    echo "== fuzz $$pkg $$f"; go test $$pkg -run '^$$' -fuzz "^$$f$$" -fuzztime=$(FUZZTIME); \
	  done; \
	done

bench:
	go test -run '^$$' -bench . -benchmem ./engine/...

## wasm: build the engine to build/engine.wasm and copy Go's loader next to it.
wasm:
	@mkdir -p build
	GOOS=js GOARCH=wasm go build -ldflags "$(LDFLAGS) -s -w" -o build/engine.wasm ./cmd/wasm
	cp "$(GOROOT_DIR)/lib/wasm/wasm_exec.js" build/wasm_exec.js

## wasm-test: run the engine's own tests inside Node (WebAssembly).
wasm-test:
	GOOS=js GOARCH=wasm go test -exec="$(WASM_EXEC)" ./engine/...

## hello: load build/engine.wasm in Node and call it (the automated half of the phase 0 spike).
hello: wasm
	node scripts/wasm-hello.mjs build

## spike: serve spike/ plus the built wasm, with cross-origin isolation, on 127.0.0.1:8895.
spike: wasm
	cp build/engine.wasm build/wasm_exec.js spike/
	go run ./cmd/pixelsort-go serve --dir spike --addr 127.0.0.1:8895

web:
	pnpm --dir web install --frozen-lockfile && pnpm --dir web build

web-test:
	pnpm --dir web test

e2e:
	pnpm --dir web exec playwright test

clean:
	rm -rf build coverage.out
```

**Test.** There is no unit test for a Makefile. The test is the command: write the files, then run
`make check`. It must exit 0 (check the exit code directly: `make check > /tmp/check.txt 2>&1; echo $?`; do
not pipe it into `tail`, which hides the exit code).

**Verify.** `make check` exits 0. `make test` exits 0.

**Commit.** `Add lint config and Makefile`

---

### P0-T05 · A fuzz target, so `make fuzz` has something to run

**Goal.** Prove the fuzz loop in the Makefile finds and runs targets (it runs one per invocation, because
`-fuzz` accepts a single target).

**Files.** `engine/engine_fuzz_test.go`.

**Test first / implement** (this file *is* the test):

```
package engine_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func FuzzEngineVersionStable(f *testing.F) {
	f.Add(1)
	f.Fuzz(func(t *testing.T, _ int) {
		if engine.EngineVersion == "" {
			t.Fatal("empty")
		}
	})
}
```

**Verify.** `make fuzz FUZZTIME=2s` prints `== fuzz github.com/AutumnsGrove/pixelsort-go/engine
FuzzEngineVersionStable` and `PASS`. `make check` still passes (the fuzz target also runs once as a normal test
over its seed).

**Commit.** `Add first fuzz target`

---

### P0-T06 · The engine as WebAssembly, under Node

**Goal.** Build `cmd/wasm` to `build/engine.wasm`, load it from Node the way a worker would, and call it.

**Files.** `cmd/wasm/main.go`, `scripts/wasm-hello.mjs`.

**Test first.** `scripts/wasm-hello.mjs` is the test (it exits non-zero on any failure). Write it, then run
`make hello`: it must fail (`engine.wasm` does not exist yet).

```
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
const got = globalThis.pixelsort.ping();
if (typeof got !== 'string' || got === '') { console.error('FAIL: ping() returned', got); process.exit(1); }
console.log('ok: ping() ->', got);
process.exit(0);
```

**Implement** `cmd/wasm/main.go`:

```
//go:build js && wasm

// Command wasm is the browser entry point: it exposes the engine to JavaScript as globalThis.pixelsort.
package main

import (
	"syscall/js"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

func main() {
	api := js.Global().Get("Object").New()
	api.Set("ping", js.FuncOf(func(this js.Value, args []js.Value) any { return engine.EngineVersion }))
	js.Global().Set("pixelsort", api)
	js.Global().Set("pixelsortReady", true)
	select {} // keep the Go runtime alive so JavaScript can call back in
}
```

**Notes.**
- `//go:build js && wasm` keeps this file out of normal builds, so `go vet ./...` on a Mac skips it. `make
  wasm` and `make wasm-test` are the only things that compile it.
- `select {}` parks the Go program so JavaScript can call back into it. In `GOOS=js` Go yields to the host
  instead of reporting a deadlock.
- The Go version's loader is `$(go env GOROOT)/lib/wasm/wasm_exec.js`. Always copy it from the same Go that
  built the `.wasm`; a mismatched loader fails in confusing ways. `make wasm` does this.

**Verify.** `make hello` prints `ok: ping() -> 1`. `make wasm-test` passes.

**Commit.** `Add WASM entry point and Node hello check`

---

### P0-T07 · The browser spike: worker, page, isolation report

**Goal.** A page that loads the WASM in a **web worker**, calls the engine, and shows whether the page is
cross-origin isolated.

**Files.** `spike/index.html`, `spike/worker.js`.

`spike/index.html`:

```
<!doctype html>
<meta charset="utf-8">
<title>pixelsort-go spike</title>
<style>body{font:15px/1.6 ui-monospace,monospace;background:#0a0908;color:#ece4d3;padding:32px}b{color:#ff5a36}</style>
<h1>Phase 0 spike</h1>
<pre id="out">starting...</pre>
<script>
const out = document.getElementById('out');
const lines = [];
const say = (k, v) => { lines.push(k.padEnd(26) + v); out.textContent = lines.join('\n'); };
say('crossOriginIsolated', String(self.crossOriginIsolated));
say('SharedArrayBuffer', typeof SharedArrayBuffer === 'function' ? 'available' : 'missing');
say('secure context', String(self.isSecureContext));
const w = new Worker('worker.js');
w.onmessage = (e) => { say('engine.wasm ping()', e.data.ok ? 'engine version ' + e.data.version : 'FAILED: ' + e.data.error); document.title = 'spike: done'; };
w.onerror = (e) => say('worker error', e.message);
</script>
```

`spike/worker.js`:

```
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
```

**Test.** Run `make spike`, then in another terminal:

```
curl -sI http://127.0.0.1:8895/engine.wasm | grep -i 'content-type\|cross-origin'
```

It must show `Content-Type: application/wasm` and the three `Cross-Origin-*` headers. Then open
`http://127.0.0.1:8895/` in a browser: the page must show `crossOriginIsolated true`, `SharedArrayBuffer
available` and `engine.wasm ping() engine version 1`. (When this plan was written, a headless Chromium run showed
exactly that.)

**Verify.** The curl output above; the page output above.

**Commit.** `Add browser spike page and worker`

---

### P0-T08 · CI

**Goal.** GitHub Actions runs the same checks on every push and pull request.

**Files.** `.github/workflows/ci.yml`.

```yaml
name: ci
on:
  push:
    branches: [main, 'build/**']
  pull_request:
permissions:
  contents: read
jobs:
  go:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install golangci-lint
        run: go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0
      - name: Format, vet, lint, fast tests
        run: make check
      - name: Tests with the race detector
        run: make test
      - name: Fuzz every target briefly
        run: make fuzz FUZZTIME=10s
      - name: Engine tests under WebAssembly
        run: make wasm-test
      - name: WASM hello under Node
        run: make hello
```

**Notes.** `go install` of the linter is slower than a prebuilt binary but is reproducible and needs no
third-party action. Later phases append jobs (web, worker, image build); do not add them now.
Fuzz crashers found in CI are uploaded as part of the failing log; reproduce locally with the printed
`go test` command.

**Verify.** Review by eye: indentation is two spaces, every step has `name` or `uses`. (It cannot run until
pushed; the reviewer will watch the first run.)

**Commit.** `Add CI workflow`

---

### P0-T09 · [HUMAN] Check the headers survive `tailscale serve`

**Goal.** Confirm COOP/COEP reach the browser through the homelab's HTTPS front door. Autumn does this; the
agent skips it and writes one line under "Needs Autumn" in `NOTES.md`.

**Steps.**
1. `make spike` (listens on `127.0.0.1:8895`; port 8895 is the planned one, see PLAN.md section 7).
2. `tailscale serve --bg --https=8895 http://127.0.0.1:8895` (or the machine's usual form).
3. `curl -sI https://<machine>.<tailnet>.ts.net:8895/engine.wasm | grep -i 'content-type\|cross-origin'`
4. Open `https://<machine>.<tailnet>.ts.net:8895/` and read the page.
5. `tailscale serve reset` (or turn that mapping off) when done.

**Pass.** All three `Cross-Origin-*` headers present; page shows `crossOriginIsolated true`.
**If it fails.** Note which header is missing in `NOTES.md`. The app still works (version 1 uses one worker
and does not need `SharedArrayBuffer`; decision B3).

**Commit.** none (a `NOTES.md` entry).

---

### P0-T10 · Repo docs and bookkeeping

**Goal.** The repo explains itself; the checklist is current.

**Files.** `README.md` (edit), `docs/dev/NOTES.md` (create), `docs/dev/PROGRESS.md` (tick boxes).

**Spec.**
- `README.md`: change the status line to say development has started; add a "Develop" section with the
  `make` targets from `AGENT.md` and a link to `docs/dev/README.md`.
- `docs/dev/NOTES.md`: create with the heading `# Build notes` and two sections, `## Needs Autumn` and
  `## Decisions and questions`, each empty.
- Tick every Phase 0 box in `PROGRESS.md`.

**Verify.** `make check` passes. `git status` is clean after the commit.

**Commit.** `Update README and add build notes`
