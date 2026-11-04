package httpx_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/server/httpx"
)

func TestRecoverHidesThePanic(t *testing.T) {
	h := httpx.Recover(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("secret detail") }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/x", nil))
	if rec.Code != 500 || strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var e httpx.Envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil || e.Error.Code != httpx.CodeInternal {
		t.Fatalf("envelope %v %v", e, err)
	}
}

func TestRequestIDIsSetAndEchoed(t *testing.T) {
	h := httpx.RequestID(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if len(rec.Header().Get("X-Request-Id")) < 8 {
		t.Fatal("no generated id")
	}
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Request-Id", "abc-123")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("X-Request-Id") != "abc-123" {
		t.Fatal("incoming id not echoed")
	}
	req.Header.Set("X-Request-Id", "bad id\nwith newline")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if strings.ContainsAny(rec.Header().Get("X-Request-Id"), " \n") {
		t.Fatal("a hostile id was echoed")
	}
}

func TestMaxBody(t *testing.T) {
	h := httpx.MaxBody(10)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var v any
		if err := httpx.Decode(r, &v, 10); err != nil {
			httpx.BadJSON(w, err)
		}
	}))
	req := httptest.NewRequest("POST", "/", strings.NewReader(strings.Repeat("x", 100)))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestDecode(t *testing.T) {
	type body struct {
		A int `json:"a"`
	}
	for name, tc := range map[string]struct {
		in string
		ok bool
	}{
		"fine":          {`{"a":1}`, true},
		"two values":    {`{"a":1} {"a":2}`, false},
		"unknown field": {`{"b":1}`, false},
		"trailing junk": {`{"a":1} x`, false},
		"not json":      {`nope`, false},
	} {
		t.Run(name, func(t *testing.T) {
			var b body
			err := httpx.Decode(httptest.NewRequest("POST", "/", bytes.NewReader([]byte(tc.in))), &b, 1024)
			if (err == nil) != tc.ok {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestErrorEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.Error(rec, 404, httpx.CodeNotFound, "no such run")
	if rec.Code != 404 || rec.Header().Get("Content-Type") != "application/json" || !strings.Contains(rec.Body.String(), `"code":"not_found"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestChainOrder(t *testing.T) {
	var order []string
	mk := func(name string) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { order = append(order, name); next.ServeHTTP(w, r) })
		}
	}
	httpx.Chain(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { order = append(order, "end") }), mk("a"), mk("b")).
		ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	if strings.Join(order, ",") != "a,b,end" {
		t.Fatal(order)
	}
}
