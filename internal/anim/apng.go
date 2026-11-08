package anim

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/png"
	"io"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// APNGWriter streams an animated PNG. Each frame is encoded by image/png and its compressed data is re-framed as an
// APNG frame; nothing but one frame is held in memory.
type APNGWriter struct {
	w       io.Writer
	width   int
	height  int
	frames  int
	written int
	loop    bool
	started bool
	closed  bool
	seq     uint32
}

// NewAPNGWriter writes an animated PNG header for width x height and exactly frames frames. loop repeats forever.
func NewAPNGWriter(w io.Writer, width, height, frames int, loop bool) *APNGWriter {
	return &APNGWriter{w: w, width: width, height: height, frames: frames, loop: loop}
}

// AddFrame appends one frame and how long it stays, in milliseconds.
func (a *APNGWriter) AddFrame(im *engine.Image, delayMS int) error {
	if a.closed {
		return errors.New("anim: APNG already closed")
	}
	if im == nil || im.W != a.width || im.H != a.height || len(im.Pix) != im.W*im.H {
		return fmt.Errorf("anim: APNG frame is not %dx%d", a.width, a.height)
	}
	if a.written >= a.frames {
		return fmt.Errorf("anim: APNG has more than the declared %d frames", a.frames)
	}
	ihdr, idat, err := encodePNG(im)
	if err != nil {
		return err
	}
	if !a.started {
		if err := a.start(ihdr); err != nil {
			return err
		}
	}
	if err := a.writeFrame(idat, delayMS, a.written == 0); err != nil {
		return err
	}
	a.written++
	return nil
}

func (a *APNGWriter) start(ihdr []byte) error {
	var b []byte
	b = append(b, "\x89PNG\r\n\x1a\n"...)
	b = appendChunk(b, "IHDR", ihdr)
	// acTL: how many frames and how many times to play (0 is forever).
	actl := make([]byte, 8)
	binary.BigEndian.PutUint32(actl[0:], uint32(a.frames)) //nolint:gosec // a frame list is far below 2^32
	plays := uint32(0)
	if !a.loop {
		plays = 1
	}
	binary.BigEndian.PutUint32(actl[4:], plays)
	b = appendChunk(b, "acTL", actl)
	if _, err := a.w.Write(b); err != nil {
		return fmt.Errorf("anim: write APNG header: %w", err)
	}
	a.started = true
	return nil
}

func (a *APNGWriter) writeFrame(idat []byte, delayMS int, first bool) error {
	delay := max(1, delayMS)
	if delay > 0xFFFF {
		delay = 0xFFFF
	}
	var fctl []byte
	fctl = appendChunk(fctl, "fcTL", a.fctlData(delay))
	a.seq++
	var b []byte
	b = append(b, fctl...)
	if first {
		b = appendChunk(b, "IDAT", idat)
	} else {
		fdat := make([]byte, 4, 4+len(idat))
		binary.BigEndian.PutUint32(fdat, a.seq)
		a.seq++
		fdat = append(fdat, idat...)
		b = appendChunk(b, "fdAT", fdat)
	}
	if _, err := a.w.Write(b); err != nil {
		return fmt.Errorf("anim: write APNG frame: %w", err)
	}
	return nil
}

func (a *APNGWriter) fctlData(delayMS int) []byte {
	d := make([]byte, 26)
	binary.BigEndian.PutUint32(d[0:], a.seq)
	binary.BigEndian.PutUint32(d[4:], uint32(a.width))  //nolint:gosec // checked positive in the CLI
	binary.BigEndian.PutUint32(d[8:], uint32(a.height)) //nolint:gosec // checked positive in the CLI
	// x_offset and y_offset are zero.
	binary.BigEndian.PutUint16(d[20:], uint16(delayMS)) //nolint:gosec // clamped to 0xFFFF above
	binary.BigEndian.PutUint16(d[22:], 1000)
	// dispose_op 0 (none), blend_op 0 (source).
	return d
}

// Close writes the IEND chunk. It is safe to call once.
func (a *APNGWriter) Close() error {
	if a.closed {
		return nil
	}
	a.closed = true
	if _, err := a.w.Write(appendChunk(nil, "IEND", nil)); err != nil {
		return fmt.Errorf("anim: write APNG trailer: %w", err)
	}
	return nil
}

// encodePNG returns the IHDR payload and every IDAT payload of one frame, concatenated.
func encodePNG(im *engine.Image) (ihdr, idat []byte, err error) {
	img := &image.NRGBA{Pix: im.RGBA(), Stride: 4 * im.W, Rect: image.Rect(0, 0, im.W, im.H)}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, nil, fmt.Errorf("anim: encode PNG frame: %w", err)
	}
	b := buf.Bytes()
	for p := 8; p+8 <= len(b); {
		n := int(binary.BigEndian.Uint32(b[p:]))
		typ := string(b[p+4 : p+8])
		data := b[p+8 : p+8+n]
		switch typ {
		case "IHDR":
			ihdr = data
		case "IDAT":
			idat = append(idat, data...)
		case "IEND":
			return ihdr, idat, nil
		}
		p += 12 + n
	}
	return ihdr, idat, nil
}

// appendChunk appends a PNG chunk with its CRC.
func appendChunk(b []byte, typ string, data []byte) []byte {
	b = binary.BigEndian.AppendUint32(b, uint32(len(data))) //nolint:gosec // frame data is far below 2^32
	b = append(b, typ...)
	b = append(b, data...)
	crc := crc32.NewIEEE()
	_, _ = crc.Write([]byte(typ))
	_, _ = crc.Write(data)
	return binary.BigEndian.AppendUint32(b, crc.Sum32())
}
