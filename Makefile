SHELL := /bin/bash
.DEFAULT_GOAL := check

GOROOT_DIR := $(shell go env GOROOT)
WASM_EXEC := $(GOROOT_DIR)/lib/wasm/go_js_wasm_exec
FUZZTIME ?= 20s
VERSION ?= r$(shell git rev-list --count HEAD 2>/dev/null || echo 0).$(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
LDFLAGS := -X github.com/AutumnsGrove/pixelsort-go/internal/version.Version=$(VERSION)

.PHONY: deploy-test image image-test compose-test web-embed embed-build check fmt fmt-check vet lint short test fuzz bench wasm wasm-test hello spike web web-test e2e e2e-worker clean

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
	@if [ -d web ]; then mkdir -p web/static web/src/lib/engine/vendor; \
	  cp build/engine.wasm web/static/engine.wasm; \
	  cp build/wasm_exec.js web/src/lib/engine/vendor/wasm_exec.js; fi

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

## web-embed: copy the built web app into server/spa/build so a binary built with -tags embedweb serves it.
web-embed: web
	rm -rf server/spa/build && cp -r web/build server/spa/build

## embed-build: the single binary: web app embedded, version stamped.
embed-build: wasm web-embed
	go build -tags embedweb -ldflags "$(LDFLAGS)" -o build/pixelsort-go ./cmd/pixelsort-go

web:
	pnpm --dir web install --frozen-lockfile && pnpm --dir web build

web-test:
	pnpm --dir web test

e2e-worker: ## the real Worker (wrangler dev) driven by the real Go server
	pnpm --dir web e2e:worker

e2e:
	pnpm --dir web exec playwright test

## image: build the container image (needs a Docker daemon).
image:
	docker build --build-arg VERSION=$(VERSION) -t pixelsort:dev .

## image-test: build it and check headers, read-only run, restart, size and arm64 (needs a Docker daemon).
image-test:
	VERSION=$(VERSION) deploy/image-test.sh pixelsort:test

## deploy-test: every shell test under deploy/ (fakes only; no Docker daemon, no network).
deploy-test:
	bash deploy/watcher/test.sh
	bash deploy/test-install.sh
	bash deploy/backup/test.sh
	bash deploy/meridian/test.sh
	bash deploy/compose-test.sh
	bash deploy/workflow-lint.sh

## compose-test: render docker-compose.yml and check its hardening (no daemon needed).
compose-test:
	deploy/compose-test.sh

clean:
	rm -rf build coverage.out
