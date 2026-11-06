package helper_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
	"time"

	"github.com/AutumnsGrove/nova/provider"
	"github.com/AutumnsGrove/nova/testkit"

	"github.com/AutumnsGrove/pixelsort-go/server/helper"
)

// scene is a 400x240 picture: flat green, a big red disc on the left and a small blue one on the right.
func scene(t testing.TB, format string) []byte {
	t.Helper()
	im := image.NewRGBA(image.Rect(0, 0, 400, 240))
	for y := 0; y < 240; y++ {
		for x := 0; x < 400; x++ {
			c := color.RGBA{40, 80, 50, 255}
			if (x-120)*(x-120)+(y-120)*(y-120) <= 70*70 {
				c = color.RGBA{200, 60, 30, 255}
			}
			if (x-320)*(x-320)+(y-60)*(y-60) <= 25*25 {
				c = color.RGBA{30, 60, 200, 255}
			}
			im.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	var err error
	if format == "jpeg" {
		err = jpeg.Encode(&b, im, &jpeg.Options{Quality: 95})
	} else {
		err = png.Encode(&b, im)
	}
	if err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

type run struct {
	events []helper.Event
	err    error
	prov   *testkit.Provider
}

func (r *run) types() []string {
	var out []string
	for _, e := range r.events {
		out = append(out, e.Type)
	}
	return out
}

func (r *run) last(typ string) *helper.Event {
	for i := len(r.events) - 1; i >= 0; i-- {
		if r.events[i].Type == typ {
			return &r.events[i]
		}
	}
	return nil
}

func (r *run) tools() []helper.Event {
	var out []helper.Event
	for _, e := range r.events {
		if e.Type == "tool_end" {
			out = append(out, e)
		}
	}
	return out
}

func do(t *testing.T, req helper.Request, turns ...testkit.Turn) *run {
	t.Helper()
	return doCtx(t, context.Background(), req, turns...)
}

func doCtx(t *testing.T, ctx context.Context, req helper.Request, turns ...testkit.Turn) *run {
	t.Helper()
	p := testkit.NewProvider(testkit.NewFakeClock(time.Unix(0, 0)), turns...)
	svc := helper.New(helper.Options{Provider: p, Model: "test/vision-model", Vision: helper.AlwaysVision{}})
	r := &run{prov: p}
	r.err = svc.Run(ctx, req, func(e helper.Event) { r.events = append(r.events, e) })
	return r
}

func call(id, name, args string) testkit.Call { return testkit.Call{ID: id, Name: name, Args: args} }

func TestTheModelFindsAnObjectAndProposesAShape(t *testing.T) {
	testkit.NoLeaks(t)
	r := do(t, helper.Request{Prompt: "make a shape of the red disc", Image: scene(t, "png")},
		testkit.Turn{ToolCalls: []testkit.Call{call("a", "describe_image", `{}`)}},
		testkit.Turn{ToolCalls: []testkit.Call{call("b", "list_objects", `{"min_area_pct":1,"max":8}`)}},
		testkit.Turn{ToolCalls: []testkit.Call{call("c", "segment_from_point", `{"region":"r1","tolerance":30}`)}},
		testkit.Turn{ToolCalls: []testkit.Call{call("d", "propose_shape", `{"region":"r1","name":"Red disc"}`)}},
		testkit.Turn{Text: "Here is the red disc."},
	)
	if r.err != nil {
		t.Fatal(r.err)
	}
	got := r.types()
	if got[0] != "start" || got[len(got)-1] != "done" {
		t.Fatalf("events %v: a run starts and ends", got)
	}
	var names []string
	for _, e := range r.tools() {
		names = append(names, e.Name)
		if e.IsError {
			t.Errorf("%s failed: %s", e.Name, e.Result)
		}
		if len(e.Result) > 8<<10 {
			t.Errorf("%s returned %d bytes: results are small", e.Name, len(e.Result))
		}
	}
	if strings.Join(names, ",") != "describe_image,list_objects,segment_from_point,propose_shape" {
		t.Fatalf("tool order %v", names)
	}
	p := r.last("proposal")
	if p == nil || p.Proposal == nil {
		t.Fatalf("no proposal in %v", got)
	}
	if p.Proposal.Name != "Red disc" || p.Proposal.Region != "r1" {
		t.Fatalf("proposal %+v", p.Proposal)
	}
	// the seed lies inside the big red disc (centre 0.30, 0.50 of the picture), so cutting out from it finds the disc
	if p.Proposal.SeedX < 0.1 || p.Proposal.SeedX > 0.5 || p.Proposal.SeedY < 0.2 || p.Proposal.SeedY > 0.8 {
		t.Fatalf("seed %.2f,%.2f is not on the red disc", p.Proposal.SeedX, p.Proposal.SeedY)
	}
	if p.Proposal.Tolerance != 30 {
		t.Fatalf("tolerance %d, want the 30 the model segmented with", p.Proposal.Tolerance)
	}
	if p.Proposal.AreaPct < 10 || p.Proposal.AreaPct > 20 {
		t.Fatalf("the red disc is about 16%% of the picture, got %.1f", p.Proposal.AreaPct)
	}
	if d := r.last("done"); d == nil || d.Reason != "proposed" {
		t.Fatalf("done %+v", d)
	}
}

func TestTheModelIsOfferedExactlyTheFixedTools_AndSeesThePictureAndTheRequest(t *testing.T) {
	r := do(t, helper.Request{Prompt: "the sun please", Image: scene(t, "jpeg")}, testkit.Turn{Text: "Nothing like that here."})
	if r.err != nil {
		t.Fatal(r.err)
	}
	reqs := r.prov.Requests()
	if len(reqs) != 1 {
		t.Fatalf("%d requests", len(reqs))
	}
	var offered []string
	for _, d := range reqs[0].Tools {
		offered = append(offered, d.Function.Name)
	}
	want := []string{"describe_image", "list_objects", "propose_shape", "segment_from_point"}
	if strings.Join(sorted(offered), ",") != strings.Join(want, ",") {
		t.Fatalf("tools offered %v, want exactly %v", offered, want)
	}
	var sawImage, sawPrompt, sawSystem bool
	for _, m := range reqs[0].Messages {
		if m.Role == "system" && m.Content != "" {
			sawSystem = true
		}
		if m.Role == "user" {
			sawPrompt = sawPrompt || strings.Contains(m.Content, "the sun please")
			for _, p := range m.Parts {
				if p.Type == "image" && p.MimeType != "" && p.Data != "" {
					sawImage = true
				}
			}
		}
	}
	if !sawImage || !sawPrompt || !sawSystem {
		t.Fatalf("image %v, prompt %v, system %v", sawImage, sawPrompt, sawSystem)
	}
	if d := r.last("done"); d == nil || d.Reason != "no_proposal" {
		t.Fatalf("a reply with no proposal ends as no_proposal, got %+v", d)
	}
	if say := r.last("say"); say == nil || !strings.Contains(say.Text, "Nothing like that") {
		t.Fatalf("the reply is passed on: %+v", say)
	}
}

func sorted(in []string) []string {
	out := append([]string(nil), in...)
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func TestToolMistakesAreAnswersTheModelCanFix_NotCrashes(t *testing.T) {
	r := do(t, helper.Request{Prompt: "a shape", Image: scene(t, "png")},
		testkit.Turn{ToolCalls: []testkit.Call{call("a", "propose_shape", `{"region":"r1","name":"Too early"}`)}},                           // before listing
		testkit.Turn{ToolCalls: []testkit.Call{call("b", "list_objects", `{}`)}},                                                            // defaults are fine
		testkit.Turn{ToolCalls: []testkit.Call{call("c", "segment_from_point", `{"region":"r99"}`)}},                                        // an id nobody made
		testkit.Turn{ToolCalls: []testkit.Call{call("d", "segment_from_point", `{"x":2,"y":0.5}`)}},                                         // outside the picture
		testkit.Turn{ToolCalls: []testkit.Call{call("e", "run_shell", `{"cmd":"ls"}`)}},                                                     // not a tool
		testkit.Turn{ToolCalls: []testkit.Call{call("f", "segment_from_point", `not json`)}},                                                // not even JSON
		testkit.Turn{ToolCalls: []testkit.Call{call("g", "propose_shape", "{\"region\":\"r1\",\"name\":\"\\u0007  Bell\\n\\n  ring  \"}")}}, // a name with junk in it
		testkit.Turn{Text: "done"},
	)
	if r.err != nil {
		t.Fatal(r.err)
	}
	ends := r.tools()
	wantErr := []bool{true, false, true, true, true, true, false}
	if len(ends) != len(wantErr) {
		t.Fatalf("%d tool results: %+v", len(ends), ends)
	}
	for i, e := range ends {
		if e.IsError != wantErr[i] {
			t.Errorf("call %d (%s): is_error=%v, want %v: %s", i, e.Name, e.IsError, wantErr[i], e.Result)
		}
	}
	if p := r.last("proposal"); p == nil || p.Proposal.Name != "Bell ring" {
		t.Fatalf("a name is tidied to plain words: %+v", p)
	}
}

func TestItStopsAfterTooManySteps(t *testing.T) {
	turns := make([]testkit.Turn, 0, 20)
	for i := 0; i < 20; i++ {
		turns = append(turns, testkit.Turn{ToolCalls: []testkit.Call{call("x", "describe_image", `{}`)}})
	}
	r := do(t, helper.Request{Prompt: "loop", Image: scene(t, "png")}, turns...)
	if r.err != nil {
		t.Fatal(r.err)
	}
	if d := r.last("done"); d == nil || d.Reason != "too_many_steps" {
		t.Fatalf("done %+v", d)
	}
	if r.prov.Remaining() < 20-helper.MaxSteps-1 {
		t.Fatalf("the model was asked %d times; the cap is %d", 20-r.prov.Remaining(), helper.MaxSteps)
	}
}

func TestCancellingStopsTheRunAndLeavesNothingRunning(t *testing.T) {
	testkit.NoLeaks(t)
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(50 * time.Millisecond); cancel() }()
	r := doCtx(t, ctx, helper.Request{Prompt: "slow", Image: scene(t, "png")}, testkit.Turn{Hang: true})
	if !errors.Is(r.err, context.Canceled) {
		t.Fatalf("err %v, want context.Canceled", r.err)
	}
	if p := r.last("proposal"); p != nil {
		t.Fatal("a cancelled run proposes nothing")
	}
}

func TestBadRequestsAreRefusedBeforeTheModelIsAsked(t *testing.T) {
	big := make([]byte, helper.MaxImageBytes+1)
	huge := image.NewRGBA(image.Rect(0, 0, helper.MaxImageSide+1, 10))
	var hb bytes.Buffer
	_ = png.Encode(&hb, huge)
	for name, c := range map[string]struct {
		req  helper.Request
		code string
	}{
		"no prompt":       {helper.Request{Prompt: "  ", Image: scene(t, "png")}, "bad_prompt"},
		"a long prompt":   {helper.Request{Prompt: strings.Repeat("x", helper.MaxPromptChars+1), Image: scene(t, "png")}, "bad_prompt"},
		"no picture":      {helper.Request{Prompt: "x"}, "bad_image"},
		"not a picture":   {helper.Request{Prompt: "x", Image: []byte("hello, I am not an image")}, "bad_image"},
		"too many bytes":  {helper.Request{Prompt: "x", Image: big}, "image_too_large"},
		"too many pixels": {helper.Request{Prompt: "x", Image: hb.Bytes()}, "image_too_large"},
	} {
		t.Run(name, func(t *testing.T) {
			r := do(t, c.req, testkit.Turn{Text: "must not be asked"})
			var re *helper.RequestError
			if !errors.As(r.err, &re) || re.Code != c.code {
				t.Fatalf("err %v, want code %s", r.err, c.code)
			}
			if r.prov.Remaining() != 1 || len(r.events) != 0 {
				t.Fatal("the model was asked, or events were sent, for a request that should be refused")
			}
		})
	}
}

func TestAModelThatCannotSeeIsRefusedWithAPlainReason(t *testing.T) {
	p := testkit.NewProvider(testkit.NewFakeClock(time.Unix(0, 0)), testkit.Turn{Text: "x"})
	svc := helper.New(helper.Options{Provider: p, Model: "text/only", Vision: helper.VisionFunc(func(context.Context, string) error { return helper.ErrNoVision })})
	err := svc.Run(context.Background(), helper.Request{Prompt: "x", Image: scene(t, "png")}, func(helper.Event) {})
	var re *helper.RequestError
	if !errors.As(err, &re) || re.Code != "no_vision" || !strings.Contains(re.Message, "pictures") {
		t.Fatalf("err %v", err)
	}
	if p.Remaining() != 1 {
		t.Fatal("no request may reach a model that cannot see")
	}
}

func TestTheResultsNeverCarryPixelsOrTheOriginalPicture(t *testing.T) {
	r := do(t, helper.Request{Prompt: "list", Image: scene(t, "png")},
		testkit.Turn{ToolCalls: []testkit.Call{call("a", "describe_image", `{}`), call("b", "list_objects", `{}`)}},
		testkit.Turn{Text: "ok"},
	)
	for _, e := range r.events {
		raw, _ := json.Marshal(e)
		if len(raw) > 16<<10 {
			t.Errorf("event %s is %d bytes", e.Type, len(raw))
		}
	}
	// after the first turn the model's messages hold tool results as text, with no image part added by a tool
	reqs := r.prov.Requests()
	images := 0
	for _, m := range reqs[len(reqs)-1].Messages {
		for _, p := range m.Parts {
			if p.Type == "image" {
				images++
			}
		}
	}
	if images != 1 {
		t.Fatalf("the model saw %d images: only the one the person sent", images)
	}
}

var _ provider.Provider = (*testkit.Provider)(nil)
