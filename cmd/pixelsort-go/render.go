package main

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"

	"github.com/spf13/cobra"

	"github.com/AutumnsGrove/pixelsort-go/engine"

	// The decoders a photo is likely to be in.
	_ "image/jpeg"
)

// newRender is the phase 1 deliverable: sort a picture from a recipe file, with no UI in the way.
func newRender() *cobra.Command {
	var in, recipe, out, mask string
	c := &cobra.Command{
		Use:   "render",
		Short: "Sort an image from a recipe file and write a PNG",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return render(cmd, in, recipe, out, mask)
		},
	}
	c.Flags().StringVar(&in, "in", "", "input image (PNG or JPEG)")
	c.Flags().StringVar(&recipe, "recipe", "", "recipe JSON file")
	c.Flags().StringVar(&out, "out", "", "output PNG")
	c.Flags().StringVar(&mask, "mask", "", "optional mask image: painted pixels are frozen")
	return c
}

func render(cmd *cobra.Command, in, recipePath, outPath, maskPath string) error {
	if in == "" || recipePath == "" || outPath == "" {
		return errors.New("render: --in, --recipe and --out are all required")
	}
	im, err := loadImage(in)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(recipePath) //nolint:gosec // the user names the recipe file on the command line
	if err != nil {
		return fmt.Errorf("render: read recipe %s: %w", recipePath, err)
	}
	params, err := engine.ParseParams(data)
	if err != nil {
		return fmt.Errorf("render: recipe %s: %w", recipePath, err)
	}
	opts := &engine.Options{}
	if maskPath != "" {
		opts.Mask, err = loadMask(maskPath, im.W, im.H)
		if err != nil {
			return err
		}
	}
	plan, err := engine.NewPlan(im, params, opts)
	if err != nil {
		return fmt.Errorf("render: %w", err)
	}
	sorted := plan.Sort()
	if err := writePNG(outPath, sorted); err != nil {
		return err
	}
	_, err = fmt.Fprintf(cmd.OutOrStdout(), "lines %d, intervals %d, sortable %d, frozen %d\n",
		plan.Stats.Lines, plan.Stats.Intervals, plan.Stats.SortablePixels, plan.Stats.FrozenPixels)
	return err
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
