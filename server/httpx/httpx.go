// Package httpx holds the small HTTP pieces every handler shares: the error envelope, JSON helpers and middleware.
package httpx

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

// The error-code catalog (decision S3). The web app maps these to its own error catalog.
const (
	CodeBadRequest         = "bad_request"
	CodeNotFound           = "not_found"
	CodeConflict           = "conflict"
	CodeTooLarge           = "too_large"
	CodeBadType            = "bad_type"
	CodeHashMismatch       = "hash_mismatch"
	CodeStarredNeedsOK     = "starred_needs_confirm"
	CodeRateLimited        = "rate_limited"
	CodeInternal           = "internal"
	CodeForbidden          = "forbidden"
	CodeMethodNotAllowed   = "method_not_allowed"
	requestIDHeader        = "X-Request-Id"
	defaultMaxJSONBodySize = 1 << 20
)

// Envelope is the JSON shape of every error response.
type Envelope struct {
	Error Detail `json:"error"`
}

// Detail is the code and a human message.
type Detail struct {
	Code    string  `json:"code"`
	Message string  `json:"message"`
	IDs     []int64 `json:"ids,omitempty"` // for starred_needs_confirm: the starred runs that blocked the request
}

// Write sends v as JSON with the given status.
func Write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("write response", "err", err)
	}
}

// Error sends the error envelope.
func Error(w http.ResponseWriter, status int, code, msg string) {
	Write(w, status, Envelope{Error: Detail{Code: code, Message: msg}})
}

// Decode reads exactly one JSON value into v, rejecting unknown fields, trailing data and bodies over maxBytes.
func Decode(r *http.Request, v any, maxBytes int64) error {
	if maxBytes <= 0 {
		maxBytes = defaultMaxJSONBodySize
	}
	return DecodeReader(io.LimitReader(r.Body, maxBytes+1), v, maxBytes)
}

// DecodeReader is Decode for any reader.
func DecodeReader(r io.Reader, v any, maxBytes int64) error {
	raw, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if int64(len(raw)) > maxBytes {
		return ErrBodyTooLarge
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("bad JSON: %w", err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("bad JSON: unexpected data after the value")
	}
	return nil
}

// ErrBodyTooLarge is returned by Decode when the body exceeds its limit.
var ErrBodyTooLarge = errors.New("request body too large")

// BadJSON answers a Decode failure with 413 or 400.
func BadJSON(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrBodyTooLarge) {
		Error(w, http.StatusRequestEntityTooLarge, CodeTooLarge, "that request is too large")
		return
	}
	Error(w, http.StatusBadRequest, CodeBadRequest, err.Error())
}

// RequestID gives every request an id, echoes it in X-Request-Id and passes an incoming one through if it is sane.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestIDHeader)
		if len(id) == 0 || len(id) > 64 || !printable(id) {
			var b [8]byte
			_, _ = rand.Read(b[:])
			id = hex.EncodeToString(b[:])
		}
		w.Header().Set(requestIDHeader, id)
		next.ServeHTTP(w, r)
	})
}

func printable(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 0x21 || s[i] > 0x7e {
			return false
		}
	}
	return true
}

// Recover turns a panic into a 500 with the generic envelope; the panic and its stack go to the log only.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler { //nolint:errorlint // ErrAbortHandler is compared by identity by net/http
					panic(v)
				}
				slog.Error("panic in handler", "path", r.URL.Path, "panic", fmt.Sprint(v), "stack", string(debug.Stack()))
				Error(w, http.StatusInternalServerError, CodeInternal, "something went wrong")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (s *statusWriter) WriteHeader(code int) { s.status = code; s.ResponseWriter.WriteHeader(code) }
func (s *statusWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += int64(n)
	return n, err //nolint:wrapcheck // a pass-through writer must return the underlying error unchanged
}

// Unwrap lets http.ResponseController reach the real writer (flushing, deadlines).
func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// AccessLog logs method, path, status, duration and bytes. The query string is never logged: it can hold tokens.
func AccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "status", sw.status, "ms", time.Since(start).Milliseconds(),
			"bytes", sw.bytes, "id", w.Header().Get(requestIDHeader))
	})
}

// MaxBody caps request bodies; a handler that reads past the limit gets an error it reports as 413.
func MaxBody(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > limit {
				Error(w, http.StatusRequestEntityTooLarge, CodeTooLarge, "that request is too large")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

// Timeout gives non-streaming routes a deadline through the request context.
func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.TimeoutHandler(next, d, `{"error":{"code":"internal","message":"timed out"}}`)
	}
}

// Chain applies middleware so the first listed is the outermost.
func Chain(h http.Handler, mw ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}
