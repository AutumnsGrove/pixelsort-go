package spa_test

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/AutumnsGrove/pixelsort-go/server/spa"
)

func TestInlineScriptHashes(t *testing.T) {
	body := "\n\t{ boot(); }\n"
	fsys := fstest.MapFS{"index.html": {Data: []byte("<html><script type=\"module\" src=\"/a.js\"></script><script>" + body + "</script></html>")}}
	got := spa.InlineScriptHashes(fsys)
	sum := sha256.Sum256([]byte(body))
	want := "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	if len(got) != 1 || got[0] != want {
		t.Fatalf("got %v, want [%s]", got, want)
	}
	if spa.InlineScriptHashes(fstest.MapFS{}) != nil {
		t.Fatal("a missing index.html should give no hashes")
	}
	if strings.Contains(strings.Join(got, ""), "unsafe-inline") {
		t.Fatal("never fall back to unsafe-inline")
	}
}
