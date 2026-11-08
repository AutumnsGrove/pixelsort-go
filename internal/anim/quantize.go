package anim

import (
	"image/color"
	"sort"

	"github.com/AutumnsGrove/pixelsort-go/engine"
)

// MedianCut turns colour samples into at most n palette entries. It splits the box with the widest channel range at that
// channel's median until there are enough boxes, then averages each box. When there are no more than n distinct colours
// every one is kept exactly.
func MedianCut(samples []color.RGBA, n int) []color.RGBA {
	if n < 1 {
		return nil
	}
	if len(samples) == 0 {
		return []color.RGBA{{A: 255}, {R: 255, G: 255, B: 255, A: 255}}
	}
	boxes := []box{{pix: samples}}
	for len(boxes) < n {
		idx, score := -1, 0
		for i := range boxes {
			if s := boxes[i].score(); s > score {
				idx, score = i, s
			}
		}
		if idx < 0 {
			break
		}
		a, b := boxes[idx].split()
		boxes[idx] = a
		boxes = append(boxes, b)
	}
	out := make([]color.RGBA, len(boxes))
	for i, b := range boxes {
		out[i] = b.average()
	}
	return out
}

type box struct{ pix []color.RGBA }

// score is how much this box would gain from a split: its widest channel range, but only if it holds two colours.
func (b box) score() int {
	if len(b.pix) < 2 {
		return 0
	}
	r0, r1, g0, g1, bl0, bl1 := 255, 0, 255, 0, 255, 0
	for _, c := range b.pix {
		r0, r1 = min(r0, int(c.R)), max(r1, int(c.R))
		g0, g1 = min(g0, int(c.G)), max(g1, int(c.G))
		bl0, bl1 = min(bl0, int(c.B)), max(bl1, int(c.B))
	}
	return max(r1-r0, g1-g0, bl1-bl0)
}

// split sorts the box by its widest channel and cuts it at the median.
func (b box) split() (box, box) {
	r0, r1, g0, g1, bl0, bl1 := 255, 0, 255, 0, 255, 0
	for _, c := range b.pix {
		r0, r1 = min(r0, int(c.R)), max(r1, int(c.R))
		g0, g1 = min(g0, int(c.G)), max(g1, int(c.G))
		bl0, bl1 = min(bl0, int(c.B)), max(bl1, int(c.B))
	}
	channel := func(c color.RGBA) int { return int(c.R) }
	switch {
	case g1-g0 > r1-r0 && g1-g0 >= bl1-bl0:
		channel = func(c color.RGBA) int { return int(c.G) }
	case bl1-bl0 > r1-r0 && bl1-bl0 > g1-g0:
		channel = func(c color.RGBA) int { return int(c.B) }
	}
	pix := b.pix
	sort.Slice(pix, func(i, j int) bool { return channel(pix[i]) < channel(pix[j]) })
	mid := len(pix) / 2
	return box{pix: pix[:mid]}, box{pix: pix[mid:]}
}

func (b box) average() color.RGBA {
	var r, g, bl int
	for _, c := range b.pix {
		r += int(c.R)
		g += int(c.G)
		bl += int(c.B)
	}
	n := max(1, len(b.pix))
	return color.RGBA{R: uint8((r + n/2) / n), G: uint8((g + n/2) / n), B: uint8((bl + n/2) / n), A: 255} //nolint:gosec // each channel is an average of bytes
}

// SampleColours copies up to max pixels' colours from an image, taking them evenly so the whole picture is represented.
func SampleColours(im *engine.Image, maxSamples int) []color.RGBA {
	if im == nil || len(im.Pix) == 0 || maxSamples < 1 {
		return nil
	}
	stride := max(1, len(im.Pix)/maxSamples)
	out := make([]color.RGBA, 0, min(len(im.Pix), maxSamples))
	for i := 0; i < len(im.Pix); i += stride {
		r, g, b, a := engine.Unpack(im.Pix[i])
		out = append(out, color.RGBA{R: r, G: g, B: b, A: a})
	}
	return out
}

// Mapper maps pixels to palette indices, caching the nearest entry per 5-bit colour so a frame costs one lookup a pixel.
type Mapper struct {
	pal   []color.RGBA
	cache [1 << 15]int16
}

// NewMapper returns a mapper for pal. A palette needs at least one colour.
func NewMapper(pal []color.RGBA) *Mapper {
	m := &Mapper{pal: pal}
	for i := range m.cache {
		m.cache[i] = -1
	}
	return m
}

func key(r, g, b int) int {
	return (r>>3)<<10 | (g>>3)<<5 | (b >> 3)
}

func clamp8(v int) int { return min(255, max(0, v)) }

// Index is the nearest palette entry (squared RGB distance) for a colour.
func (m *Mapper) Index(c color.RGBA) uint8 {
	r, g, b := clamp8(int(c.R)), clamp8(int(c.G)), clamp8(int(c.B))
	k := key(r, g, b)
	if i := m.cache[k]; i >= 0 {
		return uint8(i) //nolint:gosec // cache entries are palette indexes, at most 255
	}
	best, bestD := 0, 1<<62
	for i, p := range m.pal {
		dr, dg, db := r-int(p.R), g-int(p.G), b-int(p.B)
		if d := dr*dr + dg*dg + db*db; d < bestD {
			best, bestD = i, d
		}
	}
	m.cache[k] = int16(best)
	return uint8(best) //nolint:gosec // a palette has at most 256 entries, so best fits a byte
}

// MapImage returns one palette index per pixel. With dithering, Floyd-Steinberg error carries into neighbours so a
// gradient keeps its shape instead of banding.
func (m *Mapper) MapImage(im *engine.Image, dither bool) []uint8 {
	out := make([]uint8, len(im.Pix))
	if !dither {
		for i, p := range im.Pix {
			r, g, b, _ := engine.Unpack(p)
			out[i] = m.Index(color.RGBA{R: r, G: g, B: b, A: 255})
		}
		return out
	}
	w, h := im.W, im.H
	curR, nextR := make([]int, w+2), make([]int, w+2)
	curG, nextG := make([]int, w+2), make([]int, w+2)
	curB, nextB := make([]int, w+2), make([]int, w+2)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, _ := engine.Unpack(im.Pix[y*w+x])
			i := x + 1
			rr, gg, bb := clamp8(int(r)+curR[i]), clamp8(int(g)+curG[i]), clamp8(int(b)+curB[i])
			idx := m.Index(color.RGBA{R: uint8(rr), G: uint8(gg), B: uint8(bb), A: 255}) //nolint:gosec // clamp8 returns 0..255
			out[y*w+x] = idx
			p := m.pal[idx]
			er, eg, eb := rr-int(p.R), gg-int(p.G), bb-int(p.B)
			// Floyd-Steinberg: 7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right.
			curR[i+1] += er * 7 / 16
			curG[i+1] += eg * 7 / 16
			curB[i+1] += eb * 7 / 16
			nextR[i-1] += er * 3 / 16
			nextG[i-1] += eg * 3 / 16
			nextB[i-1] += eb * 3 / 16
			nextR[i] += er * 5 / 16
			nextG[i] += eg * 5 / 16
			nextB[i] += eb * 5 / 16
			nextR[i+1] += er / 16
			nextG[i+1] += eg / 16
			nextB[i+1] += eb / 16
		}
		curR, nextR = nextR, curR
		curG, nextG = nextG, curG
		curB, nextB = nextB, curB
		clear(nextR)
		clear(nextG)
		clear(nextB)
	}
	return out
}

// ScaleNearest resizes to w x h by sampling the nearest source pixel. It is deterministic and cheap; the CLI uses it
// for --scale.
func ScaleNearest(im *engine.Image, w, h int) *engine.Image {
	w, h = max(1, w), max(1, h)
	if im.W == w && im.H == h {
		return im
	}
	out := &engine.Image{W: w, H: h, Pix: make([]uint32, w*h)}
	for y := range h {
		sy := min(im.H-1, y*im.H/h)
		for x := range w {
			sx := min(im.W-1, x*im.W/w)
			out.Pix[y*w+x] = im.Pix[sy*im.W+sx]
		}
	}
	return out
}
