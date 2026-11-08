package main

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"

	"github.com/spf13/cobra"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/internal/anim"

	// The decoders a photo is likely to be in.
	_ "image/jpeg"
)

// renderOptions is everything the render command takes: one instant PNG and/or an animation and/or a PNG sequence.
type renderOptions struct {
	in, recipe, out, mask string
	animPath, framesDir   string
	fps                   int
	durationSec           float64
	ease                  string
	holdMS                int
	scale                 float64
	loop                  bool
}

// newRender sorts a picture from a recipe file, as a still, an animation, or a PNG sequence.
func newRender() *cobra.Command {
	var o renderOptions
	c := &cobra.Command{
		Use:   "render",
		Short: "Sort an image from a recipe file: a PNG, a GIF/APNG, or a PNG sequence",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return render(cmd, o)
		},
	}
	f := c.Flags()
	f.StringVar(&o.in, "in", "", "input image (PNG or JPEG)")
	f.StringVar(&o.recipe, "recipe", "", "recipe JSON file")
	f.StringVar(&o.out, "out", "", "output PNG (the instant result)")
	f.StringVar(&o.mask, "mask", "", "optional mask image: painted pixels are frozen")
	f.StringVar(&o.animPath, "anim", "", "animation to write: .gif or .apng (also .png for APNG)")
	f.StringVar(&o.framesDir, "frames", "", "directory for a PNG frame sequence")
	f.IntVar(&o.fps, "fps", 30, "animation frame rate (1-60)")
	f.Float64Var(&o.durationSec, "duration", 5, "animation length in seconds")
	f.StringVar(&o.ease, "ease", "ease-out", "pacing: linear or ease-out")
	f.IntVar(&o.holdMS, "hold", 500, "extra milliseconds the last frame stays")
	f.Float64Var(&o.scale, "scale", 1, "animation scale, (0, 1]")
	f.BoolVar(&o.loop, "loop", true, "loop GIF and APNG forever")
	return c
}

func render(cmd *cobra.Command, o renderOptions) error {
	if o.in == "" || o.recipe == "" || o.out == "" && o.animPath == "" && o.framesDir == "" {
		return errors.New("render: --in, --recipe and one of --out, --anim or --frames are required")
	}
	ease, err := parseEase(o.ease)
	if err != nil {
		return err
	}
	if o.fps < 1 || o.fps > anim.MaxFPS {
		return fmt.Errorf("render: --fps must be 1 to %d", anim.MaxFPS)
	}
	if o.durationSec <= 0 {
		return errors.New("render: --duration must be more than zero")
	}
	if o.holdMS < 0 {
		return errors.New("render: --hold must not be negative")
	}
	if o.scale <= 0 || o.scale > 1 {
		return errors.New("render: --scale must be more than 0 and at most 1")
	}
	im, err := loadImage(o.in)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(o.recipe) //nolint:gosec // the user names the recipe file on the command line
	if err != nil {
		return fmt.Errorf("render: read recipe %s: %w", o.recipe, err)
	}
	params, err := engine.ParseParams(data)
	if err != nil {
		return fmt.Errorf("render: recipe %s: %w", o.recipe, err)
	}
	opts := &engine.Options{}
	if o.mask != "" {
		opts.Mask, err = loadMask(o.mask, im.W, im.H)
		if err != nil {
			return err
		}
	}
	pl, err := engine.NewPlan(im, params, opts)
	if err != nil {
		return fmt.Errorf("render: %w", err)
	}
	if o.out != "" {
		if err := writePNG(o.out, pl.Sort()); err != nil {
			return err
		}
	}
	if o.animPath != "" || o.framesDir != "" {
		w, h := scaledSize(pl.W, pl.H, o.scale)
		seq := anim.NewSequence(pl.MaxPasses(), int(math.Round(o.durationSec*1000)), o.fps, o.holdMS, ease)
		if o.animPath != "" {
			if err := writeAnimation(o.animPath, pl, seq, w, h, o.loop); err != nil {
				return err
			}
		}
		if o.framesDir != "" {
			if err := writeFrameSequence(o.framesDir, pl, seq, w, h); err != nil {
				return err
			}
		}
	}
	_, err = fmt.Fprintf(cmd.OutOrStdout(), "lines %d, intervals %d, sortable %d, frozen %d\n",
		pl.Stats.Lines, pl.Stats.Intervals, pl.Stats.SortablePixels, pl.Stats.FrozenPixels)
	return err
}

// parseEase accepts the two names a recipe may use; an unknown one is an error rather than a silent linear.
func parseEase(s string) (anim.Ease, error) {
	switch anim.Ease(s) {
	case anim.Linear:
		return anim.Linear, nil
	case anim.EaseOut:
		return anim.EaseOut, nil
	}
	return "", fmt.Errorf("render: --ease must be %q or %q", anim.Linear, anim.EaseOut)
}

// loadImage decodes a photo into the engine's packed RGBA form, without premultiplying anything.
func loadImage(path string) (*engine.Image, error) {
	f, err := os.Open(path) //nolint:gosec // the user names the input file on the command line
	if err != nil {
		return nil, fmt.Errorf("render: open %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("render: decode %s: %w", path, err)
	}
	return toEngineImage(img), nil
}

// toEngineImage converts any decoded image to packed pixels. PNG and JPEG decoded by Go give NRGBA or YCbCr, and
// going through the NRGBA model is the only non-premultiplied path the standard library offers.
func toEngineImage(img image.Image) *engine.Image {
	b := img.Bounds()
	out := &engine.Image{W: b.Dx(), H: b.Dy(), Pix: make([]uint32, b.Dx()*b.Dy())}
	if n, ok := img.(*image.NRGBA); ok {
		for y := 0; y < out.H; y++ {
			for x := 0; x < out.W; x++ {
				i := n.PixOffset(b.Min.X+x, b.Min.Y+y)
				out.Pix[y*out.W+x] = engine.Pack(n.Pix[i], n.Pix[i+1], n.Pix[i+2], n.Pix[i+3])
			}
		}
		return out
	}
	for y := 0; y < out.H; y++ {
		for x := 0; x < out.W; x++ {
			c := color.NRGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
			out.Pix[y*out.W+x] = engine.Pack(c.R, c.G, c.B, c.A)
		}
	}
	return out
}

// loadMask reads a mask image: painted pixels are frozen. A greyscale mask paints with brightness, an alpha mask
// paints with opacity, and which one a file is has to be decided from the file as a whole: a PNG where every pixel
// is opaque is a greyscale mask, one with transparent areas is an alpha mask.
func loadMask(path string, w, h int) ([]uint8, error) {
	f, err := os.Open(path) //nolint:gosec // the user names the mask file on the command line
	if err != nil {
		return nil, fmt.Errorf("render: open mask %s: %w", path, err)
	}
	defer func() { _ = f.Close() }()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("render: decode mask %s: %w", path, err)
	}
	b := img.Bounds()
	if b.Dx() != w || b.Dy() != h {
		return nil, fmt.Errorf("render: mask %s is %dx%d, the image is %dx%d: %w", path, b.Dx(), b.Dy(), w, h, engine.ErrBadData)
	}
	useAlpha := false
	for y := 0; y < h && !useAlpha; y++ {
		for x := 0; x < w; x++ {
			if _, _, _, a := pixelNRGBA(img, b.Min.X+x, b.Min.Y+y); a != 255 {
				useAlpha = true
				break
			}
		}
	}
	mask := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, bl, a := pixelNRGBA(img, b.Min.X+x, b.Min.Y+y)
			painted := useAlpha && a >= 128 || !useAlpha && max(r, g, bl) > 0
			if painted {
				mask[y*w+x] = 255
			}
		}
	}
	return mask, nil
}

func pixelNRGBA(img image.Image, x, y int) (r, g, b, a uint8) {
	c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
	return c.R, c.G, c.B, c.A
}

// writePNG saves the result as an 8-bit RGBA PNG.
func writePNG(path string, im *engine.Image) error {
	img := &image.NRGBA{Pix: im.RGBA(), Stride: 4 * im.W, Rect: image.Rect(0, 0, im.W, im.H)}
	f, err := os.Create(path) //nolint:gosec // the user names the output file on the command line
	if err != nil {
		return fmt.Errorf("render: create %s: %w", path, err)
	}
	if err := png.Encode(f, img); err != nil {
		return fmt.Errorf("render: encode %s: %w", path, err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("render: close %s: %w", path, err)
	}
	return nil
}
