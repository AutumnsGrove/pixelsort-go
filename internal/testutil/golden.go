package testutil

import (
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Updating reports whether this test binary was run with -update.
//
// The flag is registered by the package that owns a golden file rather than here: internal test files cannot
// import testutil (it imports engine), so one flag per binary, looked up by name, is simpler than two.
func Updating() bool {
	f := flag.Lookup("update")
	if f == nil {
		return false
	}
	b, err := strconv.ParseBool(f.Value.String())
	return err == nil && b
}

// Golden compares the SHA-256 of got with testdata/golden/<name>.sha256, relative to the calling package's
// directory. With -update it writes the file instead. A golden changes only when behaviour changes on purpose, and
// that commit also bumps EngineVersion.
func Golden(t testing.TB, name string, got []byte) {
	t.Helper()
	sum := sha256.Sum256(got)
	gotHex := hex.EncodeToString(sum[:])
	path := filepath.Join("testdata", "golden", name+".sha256")
	if Updating() {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("golden %q: %v", name, err)
		}
		if err := os.WriteFile(path, []byte(gotHex+"\n"), 0o600); err != nil {
			t.Fatalf("golden %q: %v", name, err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("golden %q: %v (create it with: go test ./engine -run Golden -update)", name, err)
	}
	if gotWant := strings.TrimSpace(string(want)); gotWant != gotHex {
		t.Fatalf("golden %q changed:\n got %s\nwant %s\nIf the change is intended, bump EngineVersion and run -update.",
			name, gotHex, gotWant)
	}
}
