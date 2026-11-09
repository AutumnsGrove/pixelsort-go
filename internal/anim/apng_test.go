package anim_test

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image/png"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/anim"
)

type chunk struct {
	typ  string
	data []byte
}

func parsePNG(t *testing.T, b []byte) []chunk {
	t.Helper()
	if string(b[:8]) != "\x89PNG\r\n\x1a\n" {
		t.Fatalf("bad signature % x", b[:8])
	}
	var out []chunk
	for p := 8; p < len(b); {
		if p+12 > len(b) {
			t.Fatalf("truncated chunk at %d", p)
		}
		n := int(binary.BigEndian.Uint32(b[p:]))
		typ := string(b[p+4 : p+8])
		if p+12+n > len(b) {
			t.Fatalf("chunk %s length %d runs past the file", typ, n)
		}
		data := b[p+8 : p+8+n]
		want := binary.BigEndian.Uint32(b[p+8+n:])
		if got := crc32.ChecksumIEEE(b[p+4 : p+8+n]); got != want {
			t.Fatalf("chunk %s CRC %08x, want %08x", typ, got, want)
		}
		out = append(out, chunk{typ: typ, data: data})
		p += 12 + n
	}
	return out
}

func apngFrame(c rgb) *engine.Image {
	return &engine.Image{W: 2, H: 2, Pix: []uint32{
		engine.Pack(c.r, c.g, c.b, 255), engine.Pack(c.r, c.g, c.b, 255),
		engine.Pack(c.r, c.g, c.b, 255), engine.Pack(c.r, c.g, c.b, 255),
	}}
}

type rgb struct{ r, g, b uint8 }

func TestAPNGWriterChunkOrderAndSequence(t *testing.T) {
	var buf bytes.Buffer
	a := anim.NewAPNGWriter(&buf, 2, 2, 2, true)
	if err := a.AddFrame(apngFrame(rgb{255, 0, 0}), 100); err != nil {
		t.Fatal(err)
	}
	if err := a.AddFrame(apngFrame(rgb{0, 0, 255}), 350); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	chunks := parsePNG(t, buf.Bytes())
	var order []string
	for _, c := range chunks {
		order = append(order, c.typ)
	}
	want := []string{"IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "IEND"}
	if len(order) != len(want) {
		t.Fatalf("chunks %v, want %v", order, want)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("chunks %v, want %v", order, want)
		}
	}
	// acTL: frames, plays.
	if n := binary.BigEndian.Uint32(chunks[1].data[0:]); n != 2 {
		t.Fatalf("acTL frames = %d, want 2", n)
	}
	if n := binary.BigEndian.Uint32(chunks[1].data[4:]); n != 0 {
		t.Fatalf("acTL plays = %d, want 0 (forever)", n)
	}
	// fcTL sequence numbers interleave with fdAT: 0, 1, 2.
	if seq := binary.BigEndian.Uint32(chunks[2].data[0:]); seq != 0 {
		t.Fatalf("first fcTL sequence = %d, want 0", seq)
	}
	if seq := binary.BigEndian.Uint32(chunks[4].data[0:]); seq != 1 {
		t.Fatalf("second fcTL sequence = %d, want 1", seq)
	}
	if seq := binary.BigEndian.Uint32(chunks[5].data[0:]); seq != 2 {
		t.Fatalf("fdAT sequence = %d, want 2", seq)
	}
	// Delays as milliseconds over 1000.
	if n, d := binary.BigEndian.Uint16(chunks[2].data[20:]), binary.BigEndian.Uint16(chunks[2].data[22:]); n != 100 || d != 1000 {
		t.Fatalf("first delay %d/%d, want 100/1000", n, d)
	}
	if n := binary.BigEndian.Uint16(chunks[4].data[20:]); n != 350 {
		t.Fatalf("second delay %d, want 350", n)
	}
}

func TestAPNGWriterFirstFrameDecodesAsAPNG(t *testing.T) {
	var buf bytes.Buffer
	a := anim.NewAPNGWriter(&buf, 2, 2, 1, false)
	if err := a.AddFrame(apngFrame(rgb{10, 20, 30}), 100); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("the first frame is not a valid PNG: %v", err)
	}
	r, g, b, _ := img.At(0, 0).RGBA()
	if r>>8 != 10 || g>>8 != 20 || b>>8 != 30 {
		t.Fatalf("pixel = %d,%d,%d want 10,20,30", r>>8, g>>8, b>>8)
	}
}

func TestAPNGWriterCountsFrames(t *testing.T) {
	var buf bytes.Buffer
	a := anim.NewAPNGWriter(&buf, 2, 2, 1, false)
	if err := a.AddFrame(&engine.Image{W: 1, H: 1, Pix: []uint32{0}}, 100); err == nil {
		t.Fatal("a frame of the wrong size was accepted")
	}
	if err := a.AddFrame(apngFrame(rgb{1, 2, 3}), 100); err != nil {
		t.Fatal(err)
	}
	if err := a.AddFrame(apngFrame(rgb{1, 2, 3}), 100); err == nil {
		t.Fatal("more frames than declared were accepted")
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestAPNGWriterNonLoopPlaysOnce(t *testing.T) {
	var buf bytes.Buffer
	a := anim.NewAPNGWriter(&buf, 1, 1, 1, false)
	if err := a.AddFrame(&engine.Image{W: 1, H: 1, Pix: []uint32{engine.Pack(0, 0, 0, 255)}}, 20); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	chunks := parsePNG(t, buf.Bytes())
	if n := binary.BigEndian.Uint32(chunks[1].data[4:]); n != 1 {
		t.Fatalf("acTL plays = %d, want 1", n)
	}
}
