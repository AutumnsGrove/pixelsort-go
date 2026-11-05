package share

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"testing"
	"time"
)

type vector struct {
	Name, Method, Path, Timestamp, Body, BodySha, Signature string
}

func loadVectors(t *testing.T) []vector {
	t.Helper()
	raw, err := os.ReadFile("../../worker/test/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vs []vector
	if err := json.Unmarshal(raw, &vs); err != nil {
		t.Fatal(err)
	}
	if len(vs) < 3 {
		t.Fatalf("expected the shared vectors, got %d", len(vs))
	}
	return vs
}

// The Worker's tests load the same file, so the two implementations cannot drift.
func TestSignatureMatchesSharedVectors(t *testing.T) {
	for _, v := range loadVectors(t) {
		t.Run(v.Name, func(t *testing.T) {
			if got := BodySHA([]byte(v.Body)); got != v.BodySha {
				t.Fatalf("body sha %s, want %s", got, v.BodySha)
			}
			if got := Signature("test-secret", v.Method, v.Path, v.Timestamp, v.BodySha); got != v.Signature {
				t.Fatalf("signature %s, want %s", got, v.Signature)
			}
			secs, _ := strconv.ParseInt(v.Timestamp, 10, 64)
			h := Sign("test-secret", v.Method, v.Path, time.Unix(secs, 0), v.BodySha)
			if h.Get(HeaderSignature) != v.Signature || h.Get(HeaderTimestamp) != v.Timestamp || h.Get(HeaderBodySHA) != v.BodySha {
				t.Fatalf("headers %v", h)
			}
		})
	}
}

func TestEmptyShaConstant(t *testing.T) {
	if BodySHA(nil) != EmptySHA {
		t.Fatal("EmptySHA is wrong")
	}
}

func TestSignRequestUsesPathAndRawQuery(t *testing.T) {
	v := loadVectors(t)[2] // fetch with query
	req, _ := http.NewRequest(v.Method, "https://worker.example"+v.Path, nil)
	SignRequest(req, "test-secret", time.Unix(1700000000, 0), v.BodySha)
	if got := req.Header.Get(HeaderSignature); got != v.Signature {
		t.Fatalf("signature %s, want %s", got, v.Signature)
	}
}
