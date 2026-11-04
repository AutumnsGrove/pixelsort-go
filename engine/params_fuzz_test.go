package engine_test

import (
	"encoding/json"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// FuzzParamsJSON checks that no byte string can make the parser panic, and that whatever it accepts is both
// valid and stable under a marshal/parse round trip.
func FuzzParamsJSON(f *testing.F) {
	f.Add([]byte(`{"mode":"random","angle":45}`))
	f.Add([]byte(`{"angle":-1}`))
	f.Add([]byte(`{"angle":360}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`{"mode":"wave","length":1000,"randomness":100,"waveAmp":100,"wavePeriod":1000}`))
	f.Add([]byte(`{"angle":999999999999999999999999}`))
	f.Add([]byte(`{"mode":"ca","rule":255,"cell":1,"caSpace":"line","caBoundary":"wrap"}`))
	f.Add([]byte(`{"angle":`))
	f.Add([]byte(`{"angle":{"nested":[1,2,3]},"key":"luma"}`))
	f.Add([]byte(`{"lo":200,"hi":100}`))
	f.Add([]byte{0xff, 0xfe, 0x00})
	f.Fuzz(func(t *testing.T, data []byte) {
		p, err := engine.ParseParams(data)
		if err != nil {
			return
		}
		if err := p.Validate(); err != nil {
			t.Fatalf("parsed but invalid: %v", err)
		}
		again, err := json.Marshal(p)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		round, err := engine.ParseParams(again)
		if err != nil {
			t.Fatalf("re-parse %s: %v", again, err)
		}
		if round != p {
			t.Fatalf("round trip changed the params:\n got %+v\nwant %+v", round, p)
		}
	})
}
