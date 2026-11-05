# syntax=docker/dockerfile:1
#
# Reproducible three-stage build: the engine as WebAssembly, then the web app, then the single Go binary that embeds
# both. The final image is distroless (CA certificates for the Worker calls, no shell) and runs as a non-root user.

ARG VERSION=dev

# ---- 1. the engine, compiled to WebAssembly ----
FROM golang:1.27 AS go-wasm
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY engine ./engine
COPY cmd/wasm ./cmd/wasm
COPY internal ./internal
ARG VERSION
ENV CGO_ENABLED=0
RUN GOOS=js GOARCH=wasm go build -trimpath \
      -ldflags "-s -w -X github.com/AutumnsGrove/pixelsort-go/internal/version.Version=${VERSION}" \
      -o /out/engine.wasm ./cmd/wasm \
 && cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" /out/wasm_exec.js

# ---- 2. the web app (needs the WASM and Go's loader) ----
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
COPY --from=go-wasm /out/engine.wasm ./static/engine.wasm
COPY --from=go-wasm /out/wasm_exec.js ./src/lib/engine/vendor/wasm_exec.js
RUN pnpm build

# ---- 3. the server binary, with the web app embedded ----
FROM golang:1.27 AS go-server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/build ./server/spa/build
ARG VERSION
ENV CGO_ENABLED=0
RUN go build -tags embedweb -trimpath \
      -ldflags "-s -w -X github.com/AutumnsGrove/pixelsort-go/internal/version.Version=${VERSION}" \
      -o /out/pixelsort-go ./cmd/pixelsort-go

# ---- final: distroless, non-root ----
FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION
LABEL org.opencontainers.image.source="https://github.com/AutumnsGrove/pixelsort-go" \
      org.opencontainers.image.version="${VERSION}"
COPY --from=go-server /out/pixelsort-go /app/pixelsort-go
USER 65532:65532
ENV PIXELSORT_DATA=/data \
    PIXELSORT_ADDR=0.0.0.0:8895 \
    PIXELSORT_DEPLOYMENT=docker
EXPOSE 8895
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/app/pixelsort-go", "healthcheck", "--addr", "127.0.0.1:8895"]
ENTRYPOINT ["/app/pixelsort-go", "serve"]
