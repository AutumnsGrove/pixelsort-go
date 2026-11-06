package helper_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/AutumnsGrove/nova/testkit"

	"github.com/AutumnsGrove/pixelsort-go/server/helper"
)

func form(t *testing.T, prompt string, img []byte) (*bytes.Buffer, string) {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	if prompt != "" {
		_ = w.WriteField("prompt", prompt)
	}
	if img != nil {
		fw, _ := w.CreateFormFile("image", "copy.png")
		_, _ = fw.Write(img)
	}
	_ = w.Close()
	return &b, w.FormDataContentType()
}

func handler(t *testing.T, g *helper.Guard, turns ...testkit.Turn) (http.Handler, *testkit.Provider) {
	t.Helper()
	p := testkit.NewProvider(testkit.NewFakeClock(time.Unix(0, 0)), turns...)
	svc := helper.New(helper.Options{Provider: p, Model: "test/vision-model", Vision: helper.AlwaysVision{}})
	if g == nil {
		g = helper.NewGuard(2, 100)
	}
	return helper.Handler(svc, g), p
}

func post(t *testing.T, h http.Handler, prompt string, img []byte) *httptest.ResponseRecorder {
	t.Helper()
	body, ct := form(t, prompt, img)
	req := httptest.NewRequest(http.MethodPost, "/api/helper", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func lines(t *testing.T, rec *httptest.ResponseRecorder) []helper.Event {
	t.Helper()
	var out []helper.Event
	sc := bufio.NewScanner(rec.Body)
	for sc.Scan() {
		var e helper.Event
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			t.Fatalf("line %q is not an event: %v", sc.Text(), err)
		}
		out = append(out, e)
	}
	return out
}

func TestTheStreamIsOneJSONEventPerLineFromStartToDone(t *testing.T) {
	h, _ := handler(t, nil,
		testkit.Turn{ToolCalls: []testkit.Call{call("a", "list_objects", `{}`)}},
		testkit.Turn{ToolCalls: []testkit.Call{call("b", "propose_shape", `{"region":"r1","name":"Disc"}`)}},
		testkit.Turn{Text: "ok"},
	)
	rec := post(t, h, "make a shape of the red disc", scene(t, "png"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/x-ndjson" {
		t.Fatalf("Content-Type %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control %q: a transcript must not be cached", cc)
	}
	ev := lines(t, rec)
	if len(ev) < 4 || ev[0].Type != "start" || ev[len(ev)-1].Type != "done" || ev[len(ev)-1].Reason != "proposed" {
		t.Fatalf("events %+v", ev)
	}
	var proposed bool
	for _, e := range ev {
		proposed = proposed || (e.Type == "proposal" && e.Proposal != nil && e.Proposal.Name == "Disc")
	}
	if !proposed {
		t.Fatal("no proposal on the stream")
	}
	if !rec.Flushed {
		t.Fatal("events must be flushed as they happen, not at the end")
	}
}

func TestBadRequestsGetAnHonestStatusAndAReasonNotAStream(t *testing.T) {
	h, p := handler(t, nil, testkit.Turn{Text: "never asked"})
	for name, c := range map[string]struct {
		prompt string
		img    []byte
		status int
		code   string
	}{
		"no prompt":     {"", scene(t, "png"), http.StatusBadRequest, "bad_prompt"},
		"no picture":    {"x", nil, http.StatusBadRequest, "bad_image"},
		"not a picture": {"x", []byte("plain text"), http.StatusBadRequest, "bad_image"},
		"too big":       {"x", make([]byte, helper.MaxImageBytes+100), http.StatusRequestEntityTooLarge, "image_too_large"},
	} {
		rec := post(t, h, c.prompt, c.img)
		if rec.Code != c.status {
			t.Errorf("%s: status %d, want %d (%s)", name, rec.Code, c.status, rec.Body)
		}
		var env struct {
			Error struct{ Code, Message string } `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || env.Error.Code != c.code || env.Error.Message == "" {
			t.Errorf("%s: body %s", name, rec.Body)
		}
	}
	if p.Remaining() != 1 {
		t.Fatal("the model was asked for a request that should have been refused")
	}
}

func TestAnythingButPostWithAFormIsRefused(t *testing.T) {
	h, _ := handler(t, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/helper", strings.NewReader(`{"prompt":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("a JSON body is not a form: status %d", rec.Code)
	}
}

func TestOnlyOneRunAtATimeFitsTheGuard_TheNextIsToldToWait(t *testing.T) {
	g := helper.NewGuard(1, 100)
	h, _ := handler(t, g, testkit.Turn{Hang: true})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		body, ct := form(t, "slow", scene(t, "png"))
		req := httptest.NewRequest(http.MethodPost, "/api/helper", body).WithContext(ctx)
		req.Header.Set("Content-Type", ct)
		h.ServeHTTP(httptest.NewRecorder(), req)
		close(done)
	}()
	time.Sleep(150 * time.Millisecond) // the first run is in flight
	second := post(t, h, "another", scene(t, "png"))
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("status %d, want 429 while a run is in flight", second.Code)
	}
	if !strings.Contains(second.Body.String(), `"busy"`) {
		t.Fatalf("body %s", second.Body)
	}
	cancel() // the first caller goes away: its run stops, and the guard is free again
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("the run did not stop when the caller went away")
	}
	if g.InFlight() != 0 {
		t.Fatalf("%d runs still counted", g.InFlight())
	}
}

func TestTheGuardLimitsHowOftenRunsStart(t *testing.T) {
	g := helper.NewGuard(5, 2)
	for i := 0; i < 2; i++ {
		rel, ok := g.Acquire()
		if !ok {
			t.Fatalf("run %d should start", i+1)
		}
		rel()
	}
	if _, ok := g.Acquire(); ok {
		t.Fatal("a third run within the minute should wait")
	}
}

func TestNeitherThePromptNorThePictureIsEverLogged(t *testing.T) {
	var logs bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(old) })
	const secret = "PROMPT-CANARY-8841"
	img := scene(t, "png")
	h, _ := handler(t, nil, testkit.Turn{Text: "no shape for " + secret})
	rec := post(t, h, "make a "+secret, img)
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	if strings.Contains(logs.String(), secret) {
		t.Fatalf("the prompt was logged:\n%s", logs.String())
	}
	if strings.Contains(logs.String(), "iVBOR") || strings.Contains(logs.String(), "/9j/") {
		t.Fatal("picture bytes were logged")
	}
}
