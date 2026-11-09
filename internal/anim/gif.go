package anim

import (
	"compress/lzw"
	"errors"
	"fmt"
	"image/color"
	"io"
)

// ErrBadPalette means a GIF palette has no colours or more than the format's 256.
var ErrBadPalette = errors.New("anim: GIF palette must have 1 to 256 colours")

// GIFWriter streams an animated GIF with one global palette: frames arrive one at a time, so a long export never holds
// every frame in memory. It uses the standard library's LZW writer, the same one image/gif uses.
type GIFWriter struct {
	w           io.Writer
	width       int
	height      int
	palette     []color.RGBA // padded to a power of two
	bits        int          // bits per palette index, 1..8
	loop        bool
	headerWrote bool
	closed      bool
}

// NewGIFWriter writes the header for a width x height animation using palette, looping forever when loop is set. Call
// AddFrame for each frame in order, then Close.
func NewGIFWriter(w io.Writer, width, height int, palette []color.RGBA, loop bool) (*GIFWriter, error) {
	if len(palette) < 1 || len(palette) > 256 {
		return nil, ErrBadPalette
	}
	if width < 1 || height < 1 {
		return nil, fmt.Errorf("anim: GIF size %dx%d", width, height)
	}
	bits := 1
	for 1<<bits < len(palette) {
		bits++
	}
	padded := make([]color.RGBA, 1<<bits)
	copy(padded, palette)
	g := &GIFWriter{w: w, width: width, height: height, palette: padded, bits: bits, loop: loop}
	if err := g.writeHeader(); err != nil {
		return nil, err
	}
	return g, nil
}

func (g *GIFWriter) writeHeader() error {
	var b []byte
	b = append(b, "GIF89a"...)
	b = appendU16(b, g.width)
	b = appendU16(b, g.height)
	// Global colour table, 8-bit colour resolution, no sort, table size 2^bits.
	b = append(b, 0x80|0x70|byte(g.bits-1), 0, 0) //nolint:gosec // bits is 1..8
	for _, c := range g.palette {
		b = append(b, c.R, c.G, c.B)
	}
	if g.loop {
		b = append(b, 0x21, 0xFF, 0x0B)
		b = append(b, "NETSCAPE2.0"...)
		b = append(b, 0x03, 0x01, 0x00, 0x00, 0x00)
	}
	_, err := g.w.Write(b)
	if err != nil {
		return fmt.Errorf("anim: write GIF header: %w", err)
	}
	g.headerWrote = true
	return nil
}

// AddFrame writes one frame's palette indices and how long it stays, in milliseconds.
func (g *GIFWriter) AddFrame(indices []uint8, delayMS int) error {
	if g.closed {
		return errors.New("anim: GIF already closed")
	}
	if len(indices) != g.width*g.height {
		return fmt.Errorf("anim: GIF frame has %d pixels, want %d", len(indices), g.width*g.height)
	}
	delay := max(2, (delayMS+5)/10) // hundredths, with browsers' 2 floor
	var b []byte
	// Graphic control extension: disposal 1 (leave in place), no transparency.
	b = append(b, 0x21, 0xF9, 0x04, 0x04)
	b = appendU16(b, delay)
	b = append(b, 0, 0)
	// Image descriptor: full frame, no local colour table.
	b = append(b, 0x2C)
	b = appendU16(b, 0)
	b = appendU16(b, 0)
	b = appendU16(b, g.width)
	b = appendU16(b, g.height)
	b = append(b, 0)
	if _, err := g.w.Write(b); err != nil {
		return fmt.Errorf("anim: write GIF frame header: %w", err)
	}
	minCode := max(2, g.bits)
	if _, err := g.w.Write([]byte{byte(minCode)}); err != nil { //nolint:gosec // minCode is 2..8
		return fmt.Errorf("anim: write GIF code size: %w", err)
	}
	sub := &blockWriter{w: g.w}
	lw := lzw.NewWriter(sub, lzw.LSB, minCode)
	if _, err := lw.Write(indices); err != nil {
		return fmt.Errorf("anim: write GIF LZW: %w", err)
	}
	if err := lw.Close(); err != nil {
		return fmt.Errorf("anim: close GIF LZW: %w", err)
	}
	return sub.Close()
}

// Close writes the trailer. It is safe to call once.
func (g *GIFWriter) Close() error {
	if g.closed {
		return nil
	}
	g.closed = true
	if _, err := g.w.Write([]byte{0x3B}); err != nil {
		return fmt.Errorf("anim: write GIF trailer: %w", err)
	}
	return nil
}

// appendU16 appends v little-endian; callers pass values that fit 16 bits.
func appendU16(b []byte, v int) []byte { return append(b, byte(v), byte(v>>8)) } //nolint:gosec // v is a GIF field, at most 16 bits

// blockWriter frames writes as GIF data sub-blocks: a length byte then up to 255 bytes, ending with a zero byte.
type blockWriter struct {
	w   io.Writer
	buf [255]byte
	n   int
}

func (b *blockWriter) Write(p []byte) (int, error) {
	total := len(p)
	for len(p) > 0 {
		n := copy(b.buf[b.n:], p)
		b.n += n
		p = p[n:]
		if b.n == len(b.buf) {
			if err := b.flush(); err != nil {
				return total - len(p), err
			}
		}
	}
	return total, nil
}

func (b *blockWriter) flush() error {
	if b.n == 0 {
		return nil
	}
	if _, err := b.w.Write(append([]byte{byte(b.n)}, b.buf[:b.n]...)); err != nil { //nolint:gosec // n is at most 255
		return fmt.Errorf("anim: write GIF block: %w", err)
	}
	b.n = 0
	return nil
}

func (b *blockWriter) Close() error {
	if err := b.flush(); err != nil {
		return err
	}
	if _, err := b.w.Write([]byte{0}); err != nil {
		return fmt.Errorf("anim: write GIF block terminator: %w", err)
	}
	return nil
}
