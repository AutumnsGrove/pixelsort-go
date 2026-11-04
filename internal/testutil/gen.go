// Package testutil is the test-support half of the engine: one definition of "a random valid input", one
// deterministic image, and the golden-hash helper. It is not part of the engine and nothing in production imports it.
package testutil

import (
	"github.com/AutumnsGrove/pixelsort-go/engine"
	"pgregory.net/rapid"
)

// Gradient returns a synthetic image built from integers only, so it is byte-identical on arm64, amd64 and WASM.
// Goldens and benchmarks use it: a photograph would make every hash depend on a decoder.
func Gradient(w, h int, seed uint32) *engine.Image {
	s := int(seed)
	im := &engine.Image{W: w, H: h, Pix: make([]uint32, w*h)}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r := (x*255/max(1, w-1) + s*7) & 255
			g := (y*255/max(1, h-1) + s*13) & 255
			b := ((x^y)*5 + s) & 255
			im.Pix[y*w+x] = engine.Pack(uint8(r&0xff), uint8(g&0xff), uint8(b&0xff), 255)
		}
	}
	return im
}

// UniqueIDImage returns an image where every pixel still knows where it came from: r = i%7 (plenty of ties),
// g = i&255 and b = i>>8. For any image below 65536 pixels the position can be recovered exactly, which is how
// tests check stability, permutation and "this pixel did not move".
func UniqueIDImage(w, h int) *engine.Image {
	im := &engine.Image{W: w, H: h, Pix: make([]uint32, w*h)}
	for i := range im.Pix {
		im.Pix[i] = engine.Pack(uint8(i%7), uint8(i&255), uint8((i>>8)&255), 255)
	}
	return im
}

// ImageGen draws small images from a small palette, so key ties (the interesting case for a stable sort) are common.
func ImageGen(maxW, maxH int) *rapid.Generator[*engine.Image] {
	return rapid.Custom(func(t *rapid.T) *engine.Image {
		w := rapid.IntRange(1, maxW).Draw(t, "w")
		h := rapid.IntRange(1, maxH).Draw(t, "h")
		n := rapid.IntRange(1, 8).Draw(t, "paletteSize")
		palette := make([]uint32, n)
		for i := range palette {
			palette[i] = rapid.Uint32().Draw(t, "colour")
		}
		im := &engine.Image{W: w, H: h, Pix: make([]uint32, w*h)}
		for i := range im.Pix {
			im.Pix[i] = palette[rapid.IntRange(0, n-1).Draw(t, "pixel")]
		}
		return im
	})
}

// ParamsGen draws any valid recipe, including the cellular-automaton modes.
func ParamsGen() *rapid.Generator[engine.Params] {
	return paramsGen([]engine.IntervalMode{engine.ModeRandom, engine.ModeWave, engine.ModeThreshold, engine.ModeEdges,
		engine.ModeCA, engine.ModeCAEdges, engine.ModeNone})
}

// ParamsGenNoCA draws a valid recipe without the cellular-automaton modes, which NewPlan rejects until phase 4.
func ParamsGenNoCA() *rapid.Generator[engine.Params] {
	return paramsGen([]engine.IntervalMode{engine.ModeRandom, engine.ModeWave, engine.ModeThreshold, engine.ModeEdges,
		engine.ModeNone})
}

func paramsGen(modes []engine.IntervalMode) *rapid.Generator[engine.Params] {
	keys := []engine.SortKey{engine.KeyLuma, engine.KeyValue, engine.KeyIntensity, engine.KeyMinimum, engine.KeyHue,
		engine.KeySaturation, engine.KeyRed, engine.KeyGreen, engine.KeyBlue, engine.KeyAlpha}
	algos := []engine.Algo{engine.AlgoOddEven, engine.AlgoInsertion, engine.AlgoMerge, engine.AlgoReveal}
	spaces := []string{engine.CASpaceImage, engine.CASpaceLine}
	boundaries := []string{engine.CABoundaryRandom, engine.CABoundaryWrap, engine.CABoundaryFixed}
	return rapid.Custom(func(t *rapid.T) engine.Params {
		lo := rapid.IntRange(0, 255).Draw(t, "lo")
		return engine.Params{
			Mode:         rapid.SampledFrom(modes).Draw(t, "mode"),
			Key:          rapid.SampledFrom(keys).Draw(t, "key"),
			Reverse:      rapid.Bool().Draw(t, "reverse"),
			Angle:        rapid.IntRange(0, 359).Draw(t, "angle"),
			Length:       rapid.IntRange(1, 1000).Draw(t, "length"),
			Randomness:   rapid.IntRange(0, 100).Draw(t, "randomness"),
			WaveAmp:      rapid.IntRange(0, 100).Draw(t, "waveAmp"),
			WavePeriod:   rapid.IntRange(0, 1000).Draw(t, "wavePeriod"),
			Lo:           lo,
			Hi:           rapid.IntRange(lo, 255).Draw(t, "hi"),
			ThresholdKey: rapid.SampledFrom(keys).Draw(t, "thresholdKey"),
			Edge:         rapid.IntRange(0, 255).Draw(t, "edge"),
			Rule:         rapid.IntRange(0, 255).Draw(t, "rule"),
			Cell:         rapid.IntRange(1, 1000).Draw(t, "cell"),
			CASpace:      rapid.SampledFrom(spaces).Draw(t, "caSpace"),
			CABoundary:   rapid.SampledFrom(boundaries).Draw(t, "caBoundary"),
			Algo:         rapid.SampledFrom(algos).Draw(t, "algo"),
			Seed:         rapid.Uint32().Draw(t, "seed"),
		}
	})
}

// RegionsGen draws a valid region map for a w x h image: a grid of square cells, a class pattern, and per-class
// defs that give each class its own angle and may freeze it.
func RegionsGen(w, h int) *rapid.Generator[*engine.Regions] {
	patterns := []string{"checker", "thirds", "all", "random"}
	return rapid.Custom(func(t *rapid.T) *engine.Regions {
		cells := GridCells(w, h, rapid.IntRange(1, 12).Draw(t, "cellSize"))
		classOf := ClassPattern(maxCellID(cells), rapid.SampledFrom(patterns).Draw(t, "pattern"),
			rapid.Uint32().Draw(t, "classSeed"))
		defs := make([]engine.ClassDef, maxClass(classOf)+1)
		for c := 1; c < len(defs); c++ {
			angle := rapid.IntRange(0, 359).Draw(t, "classAngle")
			defs[c] = engine.ClassDef{Angle: &angle, Frozen: rapid.Bool().Draw(t, "classFrozen")}
		}
		return &engine.Regions{Labels: cells, ClassOf: classOf, Defs: defs}
	})
}

// GridCells numbers the squares of a size x size grid from 1, row by row. Cell 0 is left unused, which is what the
// real tessellations reserve for the gaps between shapes.
func GridCells(w, h, size int) []uint16 {
	if size < 1 {
		size = 1
	}
	cw := (w + size - 1) / size
	out := make([]uint16, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			out[y*w+x] = uint16(((y/size)*cw + x/size + 1) & 0xffff)
		}
	}
	return out
}

// ClassPattern assigns a class 1..4 to every cell id. Index 0 (the gaps) is class 0, which the shape builder
// freezes by default. The patterns are the ones the mockup offers: all alike, checker, thirds, random.
func ClassPattern(cells int, pattern string, seed uint32) []uint8 {
	out := make([]uint8, cells+1)
	for id := 1; id <= cells; id++ {
		switch pattern {
		case "all":
			out[id] = 1
		case "checker":
			out[id] = uint8(id%2 + 1)
		case "thirds":
			out[id] = uint8(min(3, (id-1)*3/max(1, cells)+1) & 0xff)
		default: // "random": a tiny integer hash, so the same (cells, seed) always gives the same classes
			h := uint32(id)*2654435761 + seed*40503
			out[id] = uint8((h>>13)&0xff)%4 + 1
		}
	}
	return out
}

// maxClass is the highest class id in a class table, so a small cell count with a "checker" pattern still gets a
// definition for the classes it names.
func maxClass(classOf []uint8) int {
	m := 0
	for _, c := range classOf {
		m = max(m, int(c))
	}
	return m
}

func maxCellID(cells []uint16) int {
	m := 0
	for _, c := range cells {
		m = max(m, int(c))
	}
	return m
}
