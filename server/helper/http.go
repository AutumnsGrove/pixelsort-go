package helper

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

// Guard keeps the helper from being used up: only so many runs at once, and only so many starts a minute, for the whole server.
// Every run costs money at the provider, so this is the cap on what a misbehaving page could spend.
type Guard struct {
	mu         sync.Mutex
	concurrent int
	perMinute  int
	inFlight   int
	starts     []time.Time
	now        func() time.Time
}

// NewGuard allows at most concurrent runs at once and perMinute starts in any minute.
func NewGuard(concurrent, perMinute int) *Guard {
	return &Guard{concurrent: concurrent, perMinute: perMinute, now: time.Now}
}

// Acquire reserves a run. When it is allowed, call the returned release exactly once when the run is over.
func (g *Guard) Acquire() (release func(), ok bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	cut := now.Add(-time.Minute)
	kept := g.starts[:0]
	for _, t := range g.starts {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	g.starts = kept
	if g.inFlight >= g.concurrent || len(g.starts) >= g.perMinute {
		return nil, false
	}
	g.inFlight++
	g.starts = append(g.starts, now)
	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			g.inFlight--
			g.mu.Unlock()
		})
	}, true
}

// InFlight is how many runs are going right now.
func (g *Guard) InFlight() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.inFlight
}

// maxForm is the most of a request body the handler will read: the picture copy plus a prompt and some form framing.
const maxForm = MaxImageBytes + 64<<10

// Handler serves POST /api/helper: a multipart form with "prompt" and "image", answered as a stream of newline-delimited JSON
// events. A request that is refused before the model is asked gets a plain error status instead. Neither the prompt nor the
// picture is logged anywhere. If the caller goes away the run stops.
func Handler(svc *Service, g *Guard) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			fail(w, http.StatusMethodNotAllowed, "bad_method", "Use POST.")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxForm)
		err := r.ParseMultipartForm(maxForm) //nolint:gosec // the body is capped by MaxBytesReader above
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				fail(w, http.StatusRequestEntityTooLarge, "image_too_large", "The picture copy is too big to send.")
				return
			}
			fail(w, http.StatusBadRequest, "bad_request", "Send the request as a form with a prompt and an image.")
			return
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()
		req := Request{Prompt: r.FormValue("prompt")}
		if f, _, err := r.FormFile("image"); err == nil {
			req.Image, _ = io.ReadAll(io.LimitReader(f, MaxImageBytes+1))
			_ = f.Close()
		}
		// Refuse bad requests before they take a slot, so a broken page cannot use up the limit.
		if _, err := prepare(req); err != nil {
			refuse(w, err)
			return
		}
		release, ok := g.Acquire()
		if !ok {
			w.Header().Set("Retry-After", "10")
			fail(w, http.StatusTooManyRequests, "busy", "The helper is busy. Try again in a few seconds.")
			return
		}
		defer release()

		flusher, _ := w.(http.Flusher)
		started := false
		begin := func() {
			if started {
				return
			}
			started = true
			w.Header().Set("Content-Type", "application/x-ndjson")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.WriteHeader(http.StatusOK)
		}
		enc := json.NewEncoder(w)
		err = svc.Run(r.Context(), req, func(e Event) {
			begin()
			if enc.Encode(e) == nil && flusher != nil {
				flusher.Flush()
			}
		})
		if err != nil && !started {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return // the caller left
			}
			refuse(w, err)
		}
	})
}

// refuse answers a request the helper will not run with a status that says why.
func refuse(w http.ResponseWriter, err error) {
	var re *RequestError
	if !errors.As(err, &re) {
		fail(w, http.StatusInternalServerError, "internal", "The helper hit a problem. Try again.")
		return
	}
	status := http.StatusBadRequest
	switch re.Code {
	case "image_too_large":
		status = http.StatusRequestEntityTooLarge
	case "no_vision":
		status = http.StatusUnprocessableEntity
	case "model_unavailable":
		status = http.StatusServiceUnavailable
	}
	fail(w, status, re.Code, re.Message)
}

func fail(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
}
