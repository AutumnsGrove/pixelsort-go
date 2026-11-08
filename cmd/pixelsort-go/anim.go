package main

import (
	"fmt"
	"image/color"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/anim"
)

// maxPaletteSamples is how many pixels the GIF palette is built from: enough to see the whole picture without holding a
// frame's worth of colours per sampled frame.
const maxPaletteSamples = 25_000

// scaledSize is the animation size after --scale, never smaller than one pixel.
func scaledSize(w, h int, scale float64) (int, int) {
	return max(1, int(math.Round(float64(w)*scale))), max(1, int(math.Round(float64(h)*scale)))
}

// writeAnimation picks the encoder from the file extension.
func writeAnimation(path string, pl *engine.Plan, seq anim.Sequence, w, h int, loop bool) error {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".gif":
		return writeGIF(path, pl, seq, w, h, loop)
	case ".apng", ".png":
		return writeAPNG(path, pl, seq, w, h, loop)
	}
	return fmt.Errorf("render: --anim needs a .gif or .apng extension, not %q", filepath.Ext(path))
}

// writeGIF builds one global palette from a handful of frames, then streams every frame through it with dithering.
func writeGIF(path string, pl *engine.Plan, seq anim.Sequence, w, h int, loop bool) error {
	pal, err := paletteFor(pl, seq, w, h)
	if err != nil {
		return err
	}
	mapper := anim.NewMapper(pal)
	f, err := os.Create(path) //nolint:gosec // the user names the output file on the command line
	if err != nil {
		return fmt.Errorf("render: create %s: %w", path, err)
	}
	g, err := anim.NewGIFWriter(f, w, h, pal, loop)
	if err != nil {
		_ = f.Close()
		return fmt.Errorf("render: %w", err)
	}
	walkErr := anim.Walk(pl, seq.Passes, func(frame, _ int, im *engine.Image) error {
		indices := mapper.MapImage(anim.ScaleNearest(im, w, h), true)
		return g.AddFrame(indices, seq.DelaysMS[frame])
	})
	if walkErr != nil {
		_ = f.Close()
		return walkErr
	}
	if err := g.Close(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("render: close %s: %w", path, err)
	}
	return nil
}

// paletteFor walks up to eight frames spread across the sequence and runs median cut over their sampled colours.
func paletteFor(pl *engine.Plan, seq anim.Sequence, w, h int) ([]color.RGBA, error) {
	picks := spread(len(seq.Passes), 8)
	passes := make([]int, len(picks))
	for i, p := range picks {
		passes[i] = seq.Passes[p]
	}
	var samples []color.RGBA
	err := anim.Walk(pl, passes, func(_, _ int, im *engine.Image) error {
		samples = append(samples, anim.SampleColours(anim.ScaleNearest(im, w, h), maxPaletteSamples)...)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return anim.MedianCut(samples, 256), nil
}

// spread picks up to n indexes from 0..count-1, always including both ends and never repeating.
func spread(count, n int) []int {
	if count <= 0 {
		return nil
	}
	n = min(n, count)
	if n == 1 {
		return []int{0}
	}
	out := make([]int, 0, n)
	last := -1
	for k := range n {
		idx := int(math.Round(float64(k) * float64(count-1) / float64(n-1)))
		if idx != last {
			out = append(out, idx)
			last = idx
		}
	}
	return out
}

// writeAPNG streams lossless frames. Unlike GIF, the last frame is the exact instant result.
func writeAPNG(path string, pl *engine.Plan, seq anim.Sequence, w, h int, loop bool) error {
	f, err := os.Create(path) //nolint:gosec // the user names the output file on the command line
	if err != nil {
		return fmt.Errorf("render: create %s: %w", path, err)
	}
	a := anim.NewAPNGWriter(f, w, h, len(seq.Passes), loop)
	walkErr := anim.Walk(pl, seq.Passes, func(frame, _ int, im *engine.Image) error {
		return a.AddFrame(anim.ScaleNearest(im, w, h), seq.DelaysMS[frame])
	})
	if walkErr != nil {
		_ = f.Close()
		return walkErr
	}
	if err := a.Close(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("render: close %s: %w", path, err)
	}
	return nil
}

// writeFrameSequence writes the sampled frames as PNGs named frame-00000.png, for piping into ffmpeg.
func writeFrameSequence(dir string, pl *engine.Plan, seq anim.Sequence, w, h int) error {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("render: create %s: %w", dir, err)
	}
	return anim.Walk(pl, seq.Passes, func(frame, _ int, im *engine.Image) error {
		path := filepath.Join(dir, fmt.Sprintf("frame-%05d.png", frame))
		return writePNG(path, anim.ScaleNearest(im, w, h))
	})
}
