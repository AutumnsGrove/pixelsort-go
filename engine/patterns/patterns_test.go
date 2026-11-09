package patterns_test

import (
	"bytes"
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine/patterns"
	"github.com/AutumnsGrove/pixelsort-go/internal/testutil"
)

// everySpec walks the catalog, so a new family or variant is tested without touching this file.
func everySpec(t *testing.T) []patterns.Spec {
	t.Helper()
	var out []patterns.Spec
	for _, f := range patterns.Catalog() {
		for _, v := range f.Variants {
			out = append(out, patterns.Spec{
				Family: f.Name, Variant: v.Name, Seed: 11, Cell: 60, Thickness: 8, Detail: 5,
			})
		}
	}
	if len(out) == 0 {
		t.Fatal("the catalog is empty")
	}
	return out
}

func TestCatalogNamesEveryFamilyAndVariant(t *testing.T) {
	fams := patterns.Catalog()
	if len(fams) != 4 {
		t.Fatalf("%d families, want 4", len(fams))
	}
	want := map[string]int{"truchet": 3, "interference": 2, "radial": 3, "grid": 3}
	for _, f := range fams {
		if f.Note == "" {
			t.Errorf("family %q has no note", f.Name)
		}
		if len(f.Variants) != want[f.Name] {
			t.Errorf("family %q has %d variants, want %d", f.Name, len(f.Variants), want[f.Name])
		}
		for _, v := range f.Variants {
			if v.Note == "" {
				t.Errorf("%s/%s has no note", f.Name, v.Name)
			}
		}
	}
	for _, name := range []string{"truchet", "interference", "radial", "grid"} {
		if patterns.DefaultVariant(name) == "" {
			t.Errorf("DefaultVariant(%q) is empty", name)
		}
	}
	if patterns.DefaultVariant("nope") != "" {
		t.Error("an unknown family must have no default variant")
	}
}

func TestMaskIsBinaryAndTheRightSize(t *testing.T) {
	sizes := [][2]int{{1, 1}, {1, 17}, {17, 1}, {31, 19}, {64, 64}, {97, 61}}
	for _, s := range everySpec(t) {
		for _, size := range sizes {
			w, h := size[0], size[1]
			m, err := patterns.Mask(w, h, s)
			if err != nil {
				t.Fatalf("%s/%s %dx%d: %v", s.Family, s.Variant, w, h, err)
			}
			if len(m) != w*h {
				t.Fatalf("%s/%s %dx%d: %d bytes", s.Family, s.Variant, w, h, len(m))
			}
			for i, v := range m {
				if v > 1 {
					t.Fatalf("%s/%s %dx%d: byte %d is %d, want 0 or 1", s.Family, s.Variant, w, h, i, v)
				}
			}
		}
	}
}

func TestMaskIsDeterministic(t *testing.T) {
	for _, s := range everySpec(t) {
		a, _ := patterns.Mask(97, 61, s)
		b, _ := patterns.Mask(97, 61, s)
		if !bytes.Equal(a, b) {
			t.Fatalf("%s/%s is not deterministic", s.Family, s.Variant)
		}
	}
}

func TestASeedChangesTheSeededFamilies(t *testing.T) {
	// interference rings and truchet/hex and grid/woven read the seed; the others do not have to.
	for _, s := range everySpec(t) {
		if s.Family == "interference" && s.Variant == "mesh" {
			continue
		}
		if s.Family == "radial" {
			continue
		}
		// a bigger canvas, so a seeded variant has enough tiles to show the change
		a, _ := patterns.Mask(320, 200, s)
		s.Seed++
		b, _ := patterns.Mask(320, 200, s)
		if s.Family == "grid" && s.Variant != "woven" {
			continue
		}
		if bytes.Equal(a, b) {
			t.Errorf("%s/%s ignores the seed", s.Family, s.Variant)
		}
	}
}

func TestVariantsOfOneFamilyDiffer(t *testing.T) {
	for _, f := range patterns.Catalog() {
		seen := map[string][]byte{}
		for _, v := range f.Variants {
			m, err := patterns.Mask(97, 61, patterns.Spec{Family: f.Name, Variant: v.Name, Seed: 3, Cell: 40, Thickness: 8, Detail: 5})
			if err != nil {
				t.Fatal(err)
			}
			for name, other := range seen {
				if bytes.Equal(m, other) {
					t.Errorf("%s/%s and %s/%s are the same mask", f.Name, v.Name, f.Name, name)
				}
			}
			seen[v.Name] = m
		}
	}
}

func TestInvertFlipsEveryPixel(t *testing.T) {
	for _, s := range everySpec(t) {
		a, _ := patterns.Mask(53, 31, s)
		s.Invert = true
		b, _ := patterns.Mask(53, 31, s)
		for i := range a {
			if b[i] != 1-a[i] {
				t.Fatalf("%s/%s: invert left pixel %d as %d, want %d", s.Family, s.Variant, i, b[i], 1-a[i])
			}
		}
	}
}

func TestTheKnobsChangeTheMask(t *testing.T) {
	base := patterns.Spec{Family: "grid", Variant: "iso", Seed: 1, Cell: 40, Thickness: 8, Detail: 5}
	a, _ := patterns.Mask(97, 61, base)

	bigger := base
	bigger.Cell = 80
	if b, _ := patterns.Mask(97, 61, bigger); bytes.Equal(a, b) {
		t.Error("cell size did not change the mask")
	}
	thicker := base
	thicker.Thickness = 20
	if b, _ := patterns.Mask(97, 61, thicker); bytes.Equal(a, b) {
		t.Error("thickness did not change the mask")
	}
	turned := base
	turned.Rotate = 30
	if b, _ := patterns.Mask(97, 61, turned); bytes.Equal(a, b) {
		t.Error("rotate did not change the mask")
	}

	spiral := patterns.Spec{Family: "radial", Variant: "spiral", Seed: 1, Cell: 40, Thickness: 8, Detail: 3}
	s3, _ := patterns.Mask(97, 61, spiral)
	spiral.Detail = 7
	if s7, _ := patterns.Mask(97, 61, spiral); bytes.Equal(s3, s7) {
		t.Error("detail did not change the spiral")
	}
}

func TestAnEmptyVariantMeansTheFamilysFirst(t *testing.T) {
	for _, f := range patterns.Catalog() {
		a, err := patterns.Mask(41, 23, patterns.Spec{Family: f.Name, Seed: 2, Cell: 40, Thickness: 8, Detail: 5})
		if err != nil {
			t.Fatalf("%s: %v", f.Name, err)
		}
		b, _ := patterns.Mask(41, 23, patterns.Spec{Family: f.Name, Variant: f.Variants[0].Name, Seed: 2, Cell: 40, Thickness: 8, Detail: 5})
		if !bytes.Equal(a, b) {
			t.Errorf("%s: an empty variant is not the first variant", f.Name)
		}
	}
}

func TestMaskRefusesBadSpecs(t *testing.T) {
	good := patterns.Spec{Family: "truchet", Variant: "arc", Cell: 40, Thickness: 8, Detail: 5}
	bad := []struct {
		name string
		spec patterns.Spec
	}{
		{"unknown family", patterns.Spec{Family: "nope", Variant: "arc", Cell: 40, Thickness: 8, Detail: 5}},
		{"unknown variant", patterns.Spec{Family: "truchet", Variant: "nope", Cell: 40, Thickness: 8, Detail: 5}},
		{"cell zero", func() patterns.Spec { s := good; s.Cell = 0; return s }()},
		{"cell too big", func() patterns.Spec { s := good; s.Cell = 1001; return s }()},
		{"thickness zero", func() patterns.Spec { s := good; s.Thickness = 0; return s }()},
		{"thickness too big", func() patterns.Spec { s := good; s.Thickness = 501; return s }()},
		{"rotate 360", func() patterns.Spec { s := good; s.Rotate = 360; return s }()},
		{"rotate negative", func() patterns.Spec { s := good; s.Rotate = -1; return s }()},
		{"detail zero", func() patterns.Spec { s := good; s.Detail = 0; return s }()},
		{"detail too big", func() patterns.Spec { s := good; s.Detail = 17; return s }()},
		{"width negative", func() patterns.Spec { s := good; s.Width = -1; return s }()},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := patterns.Mask(40, 40, tc.spec); err == nil {
				t.Fatal("should be refused")
			}
		})
	}
	for _, size := range [][2]int{{0, 10}, {10, 0}, {-1, 10}, {10, -1}} {
		if _, err := patterns.Mask(size[0], size[1], good); err == nil {
			t.Errorf("%dx%d should be refused", size[0], size[1])
		}
	}
}

func TestTheReferenceWidthKeepsTheCellsTheSameSize(t *testing.T) {
	// A line-space mask is generated on a narrower canvas but must use the picture's width for per-mille sizes.
	s := patterns.Spec{Family: "truchet", Variant: "arc", Seed: 1, Cell: 100, Thickness: 10, Detail: 5, Width: 200}
	narrow, _ := patterns.Mask(200, 50, s)
	wide, _ := patterns.Mask(200, 50, patterns.Spec{Family: "truchet", Variant: "arc", Seed: 1, Cell: 100, Thickness: 10, Detail: 5, Width: 400})
	if bytes.Equal(narrow, wide) {
		t.Fatal("the reference width did not reach the cell size")
	}
}

// TestGolden pins each variant's exact bytes. A changed hash is a behaviour change: say why in the same commit.
func TestGolden(t *testing.T) {
	for _, s := range everySpec(t) {
		m, err := patterns.Mask(97, 61, s)
		if err != nil {
			t.Fatal(err)
		}
		testutil.Golden(t, "pattern-"+s.Family+"-"+s.Variant, m)
	}
}
