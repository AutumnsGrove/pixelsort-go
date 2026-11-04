package engine

import (
	"errors"
	"fmt"
)

// MaxPixels is the largest image the engine will accept: 16384 x 16384. Above it a plan's working set (pixels,
// keys, lines) stops fitting in a browser tab's memory.
const MaxPixels = 1 << 28

// ErrBadSize means the requested width or height cannot form an image.
var ErrBadSize = errors.New("engine: image size out of range")

// ErrBadData means a buffer's length does not match the image it is meant to fill.
var ErrBadData = errors.New("engine: pixel data does not match image size")

// Image is an RGBA raster. Pix holds one packed pixel per position, row-major, with position i = y*W + x.
// The bytes of a packed pixel are R, G, B, A in memory order (decision E1), so Pix can be reinterpreted as
// the buffer an ImageData wants without conversion.
type Image struct {
	W, H int
	Pix  []uint32 // len W*H
}

// NewImage returns a transparent black image of the given size. It fails with ErrBadSize for a non-positive
// dimension or more than MaxPixels pixels.
func NewImage(w, h int) (*Image, error) {
	if err := checkSize(w, h); err != nil {
		return nil, err
	}
	return &Image{W: w, H: h, Pix: make([]uint32, w*h)}, nil
}

// checkSize validates a size without ever multiplying w by h, which could overflow on a hostile input.
func checkSize(w, h int) error {
	if w < 1 || h < 1 || w > MaxPixels || h > MaxPixels || w > MaxPixels/h {
		return fmt.Errorf("engine: %dx%d image: %w", w, h, ErrBadSize)
	}
	return nil
}

// FromRGBA builds an image from a byte buffer of 4*w*h bytes in R, G, B, A order.
func FromRGBA(w, h int, rgba []byte) (*Image, error) {
	im, err := NewImage(w, h)
	if err != nil {
		return nil, err
	}
	if len(rgba) != 4*w*h {
		return nil, fmt.Errorf("engine: %d bytes for a %dx%d image: %w", len(rgba), w, h, ErrBadData)
	}
	for i := range im.Pix {
		j := 4 * i
		im.Pix[i] = Pack(rgba[j], rgba[j+1], rgba[j+2], rgba[j+3])
	}
	return im, nil
}

// RGBA returns a fresh byte buffer of 4*W*H bytes in R, G, B, A order.
func (im *Image) RGBA() []byte {
	out := make([]byte, 4*len(im.Pix))
	for i, p := range im.Pix {
		r, g, b, a := Unpack(p)
		j := 4 * i
		out[j], out[j+1], out[j+2], out[j+3] = r, g, b, a
	}
	return out
}

// Clone returns a copy that shares nothing with im.
func (im *Image) Clone() *Image {
	pix := make([]uint32, len(im.Pix))
	copy(pix, im.Pix)
	return &Image{W: im.W, H: im.H, Pix: pix}
}

// Pack packs four channels into one pixel: R in the lowest byte (decision E1).
func Pack(r, g, b, a uint8) uint32 {
	return uint32(r) | uint32(g)<<8 | uint32(b)<<16 | uint32(a)<<24
}

// Unpack splits a packed pixel into its four channels.
func Unpack(p uint32) (r, g, b, a uint8) {
	return uint8(p & 0xff), uint8((p >> 8) & 0xff), uint8((p >> 16) & 0xff), uint8((p >> 24) & 0xff)
}
