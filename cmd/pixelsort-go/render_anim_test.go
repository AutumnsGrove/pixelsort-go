package main

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/gif"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// shuffledRow is one row of distinct reds, which the engine sorts by red in mode none.
var shuffledRow = [][]uint8{{70, 10, 90, 30, 50, 20, 80, 40, 60, 100, 0, 110}}

func writeAnimInputs(t *testing.T, dir string) (in, recipe, instant string) {
	t.Helper()
	in = filepath.Join(dir, "in.png")
	recipe = filepath.Join(dir, "recipe.json")
	instant = filepath.Join(dir, "instant.png")
	writeTestPNG(t, in, shuffledRow)
	if err := os.WriteFile(recipe, []byte(`{"mode":"none","key":"red","algo":"oddeven","randomness":0,"length":1000}`), 0o600); err != nil {
		t.Fatal(err)
	}
	root := newRoot()
	root.SetOut(&bytes.Buffer{})
	root.SetArgs([]string{"render", "--in", in, "--recipe", recipe, "--out", instant})
	if err := root.Execute(); err != nil {
		t.Fatalf("instant render: %v", err)
	}
	return in, recipe, instant
}

func runRender(t *testing.T, args ...string) error {
	t.Helper()
	root := newRoot()
	root.SetOut(&bytes.Buffer{})
	root.SetErr(&bytes.Buffer{})
	root.SetArgs(append([]string{"render"}, args...))
	return root.Execute()
}

func redsOf(img image.Image) []int {
	var out []int
	for x := 0; x < img.Bounds().Dx(); x++ {
		r, _, _, _ := img.At(x, 0).RGBA()
		out = append(out, int(r>>8))
	}
	return out
}

func TestRenderAnimationGIFFramesAndFinalSort(t *testing.T) {
	dir := t.TempDir()
	in, recipe, instant := writeAnimInputs(t, dir)
	out := filepath.Join(dir, "out.gif")
	if err := runRender(t, "--in", in, "--recipe", recipe, "--anim", out,
		"--fps", "10", "--duration", "1", "--ease", "linear", "--hold", "0"); err != nil {
		t.Fatalf("render: %v", err)
	}
	f, err := os.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	g, err := gif.DecodeAll(f)
	if err != nil {
		t.Fatalf("decode GIF: %v", err)
	}
	if len(g.Image) != 10 {
		t.Fatalf("got %d frames, want 10 (1 s at 10 fps)", len(g.Image))
	}
	if g.LoopCount != 0 {
		t.Fatalf("LoopCount = %d, want 0", g.LoopCount)
	}
	wantLast := redsOf(readPNG(t, instant))
	gotLast := redsOf(g.Image[len(g.Image)-1])
	for i := range wantLast {
		if gotLast[i] != wantLast[i] {
			t.Fatalf("last GIF frame %v, want the instant result %v", gotLast, wantLast)
		}
	}
}

func TestRenderAnimationAPNGFinalFrameEqualsInstant(t *testing.T) {
	dir := t.TempDir()
	in, recipe, instant := writeAnimInputs(t, dir)
	out := filepath.Join(dir, "out.apng")
	if err := runRender(t, "--in", in, "--recipe", recipe, "--anim", out,
		"--fps", "10", "--duration", "1", "--ease", "linear", "--hold", "0"); err != nil {
		t.Fatalf("render: %v", err)
	}
	last := lastAPNGFrame(t, out)
	want := redsOf(readPNG(t, instant))
	got := redsOf(last)
	if len(got) != len(want) {
		t.Fatalf("last frame width %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("last APNG frame %v, want the instant result %v", got, want)
		}
	}
}

// lastAPNGFrame rebuilds a standalone PNG from the last frame's data so the standard decoder can read it.
func lastAPNGFrame(t *testing.T, path string) image.Image {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(b[:8]) != "\x89PNG\r\n\x1a\n" {
		t.Fatal("not a PNG")
	}
	var ihdr, last []byte
	inFrame := false
	for p := 8; p+12 <= len(b); {
		n := int(binary.BigEndian.Uint32(b[p:]))
		typ := string(b[p+4 : p+8])
		data := b[p+8 : p+8+n]
		if got, want := crc32.ChecksumIEEE(b[p+4:p+8+n]), binary.BigEndian.Uint32(b[p+8+n:]); got != want {
			t.Fatalf("%s CRC", typ)
		}
		switch typ {
		case "IHDR":
			ihdr = data
		case "fcTL":
			inFrame = true
			last = nil
		case "IDAT":
			if inFrame {
				last = append(last, data...)
			}
		case "fdAT":
			if inFrame {
				last = append(last, data[4:]...)
			}
		case "IEND":
			p = len(b)
			continue
		}
		p += 12 + n
	}
	if ihdr == nil || len(last) == 0 {
		t.Fatal("no APNG frames found")
	}
	var buf bytes.Buffer
	buf.WriteString("\x89PNG\r\n\x1a\n")
	buf.Write(appendChunkForTest(nil, "IHDR", ihdr))
	buf.Write(appendChunkForTest(nil, "IDAT", last))
	buf.Write(appendChunkForTest(nil, "IEND", nil))
	img, err := png.Decode(&buf)
	if err != nil {
		t.Fatalf("decode last APNG frame: %v", err)
	}
	return img
}

func appendChunkForTest(b []byte, typ string, data []byte) []byte {
	b = binary.BigEndian.AppendUint32(b, uint32(len(data)))
	b = append(b, typ...)
	b = append(b, data...)
	crc := crc32.NewIEEE()
	_, _ = crc.Write([]byte(typ))
	_, _ = crc.Write(data)
	return binary.BigEndian.AppendUint32(b, crc.Sum32())
}

func TestRenderFramesWritesTheSequence(t *testing.T) {
	dir := t.TempDir()
	in, recipe, instant := writeAnimInputs(t, dir)
	frames := filepath.Join(dir, "frames")
	if err := runRender(t, "--in", in, "--recipe", recipe, "--frames", frames,
		"--fps", "5", "--duration", "1", "--ease", "ease-out", "--hold", "0"); err != nil {
		t.Fatalf("render: %v", err)
	}
	entries, err := os.ReadDir(frames)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 5 {
		t.Fatalf("got %d frames, want 5 (1 s at 5 fps)", len(entries))
	}
	if entries[0].Name() != "frame-00000.png" {
		t.Fatalf("first frame is %q", entries[0].Name())
	}
	if entries[4].Name() != "frame-00004.png" {
		t.Fatalf("last frame is %q", entries[4].Name())
	}
	want := redsOf(readPNG(t, instant))
	got := redsOf(readPNG(t, filepath.Join(frames, "frame-00004.png")))
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("last frame %v, want the instant result %v", got, want)
		}
	}
}

func TestRenderAnimationScale(t *testing.T) {
	dir := t.TempDir()
	in, recipe, _ := writeAnimInputs(t, dir)
	out := filepath.Join(dir, "out.png")
	if err := runRender(t, "--in", in, "--recipe", recipe, "--anim", out,
		"--fps", "2", "--duration", "1", "--scale", "0.5"); err != nil {
		t.Fatalf("render: %v", err)
	}
	img := lastAPNGFrame(t, out)
	if img.Bounds().Dx() != len(shuffledRow[0])/2 || img.Bounds().Dy() != 1 {
		t.Fatalf("scaled frame is %v, want %dx1", img.Bounds(), len(shuffledRow[0])/2)
	}
}

func TestRenderAnimationErrors(t *testing.T) {
	dir := t.TempDir()
	in, recipe, _ := writeAnimInputs(t, dir)
	tests := []struct {
		name string
		args []string
		want string
	}{
		{"no output at all", []string{"--in", in, "--recipe", recipe}, "--out"},
		{"unknown animation extension", []string{"--in", in, "--recipe", recipe, "--anim", filepath.Join(dir, "out.mp4")}, "extension"},
		{"unknown easing", []string{"--in", in, "--recipe", recipe, "--anim", filepath.Join(dir, "a.gif"), "--ease", "bouncy"}, "ease"},
		{"scale out of range", []string{"--in", in, "--recipe", recipe, "--anim", filepath.Join(dir, "a.gif"), "--scale", "3"}, "scale"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := runRender(t, tc.args...)
			if err == nil {
				t.Fatal("no error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error %q does not mention %q", err, tc.want)
			}
		})
	}
}
