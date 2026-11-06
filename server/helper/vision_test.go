package helper_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/helper"
)

const models = `{"data":[
 {"id":"acme/sees","architecture":{"input_modalities":["text","image"]}},
 {"id":"acme/text-only","architecture":{"input_modalities":["text"]}},
 {"id":"acme/also-sees","architecture":{"input_modalities":["image","text","file"]}}
]}`

func listServer(t *testing.T, hits *atomic.Int32, status int, body string) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(s.Close)
	return s
}

func TestOnlyAModelThatTakesImagesPasses(t *testing.T) {
	var hits atomic.Int32
	v := &helper.OpenRouterVision{URL: listServer(t, &hits, 200, models).URL}
	ctx := context.Background()
	for _, ok := range []string{"acme/sees", "acme/also-sees"} {
		if err := v.Check(ctx, ok); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	if err := v.Check(ctx, "acme/text-only"); !errors.Is(err, helper.ErrNoVision) {
		t.Errorf("a text-only model: %v", err)
	}
	if err := v.Check(ctx, "acme/missing"); err == nil || errors.Is(err, helper.ErrNoVision) {
		t.Errorf("an unlisted model should be unknown, not 'cannot see': %v", err)
	}
	if hits.Load() != 1 {
		t.Fatalf("the list was fetched %d times; once is enough for a while", hits.Load())
	}
}

func TestTheListIsFetchedAgainWhenItGetsOld_AndAnOutageKeepsTheOldAnswer(t *testing.T) {
	var hits atomic.Int32
	var down atomic.Bool
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		if down.Load() {
			http.Error(w, "boom", http.StatusBadGateway)
			return
		}
		_, _ = w.Write([]byte(models))
	}))
	t.Cleanup(s.Close)
	v := &helper.OpenRouterVision{URL: s.URL, TTL: 20 * time.Millisecond}
	if err := v.Check(context.Background(), "acme/sees"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(40 * time.Millisecond)
	down.Store(true)
	if err := v.Check(context.Background(), "acme/sees"); err != nil {
		t.Fatalf("an outage after a good answer must not turn the helper off: %v", err)
	}
	if hits.Load() != 2 {
		t.Fatalf("hits %d: it should have tried again", hits.Load())
	}
}

func TestWithNoAnswerAtAllItSaysItCouldNotCheck_NotThatTheModelCannotSee(t *testing.T) {
	var hits atomic.Int32
	for name, srv := range map[string]*httptest.Server{
		"an error":    listServer(t, &hits, 503, "down"),
		"not json":    listServer(t, &hits, 200, "<html>"),
		"empty reply": listServer(t, &hits, 200, ""),
	} {
		err := (&helper.OpenRouterVision{URL: srv.URL}).Check(context.Background(), "acme/sees")
		if err == nil || errors.Is(err, helper.ErrNoVision) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := (&helper.OpenRouterVision{URL: "http://127.0.0.1:1"}).Check(context.Background(), "acme/sees"); err == nil {
		t.Error("an unreachable provider is an error")
	}
}
