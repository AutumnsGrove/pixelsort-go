package shapes_test

import (
	"testing"

	"github.com/AutumnsGrove/pixelsort-go/engine"
	"github.com/AutumnsGrove/pixelsort-go/engine/shapes"
)

func TestBuildRegionsFreezesTheGapsByDefault(t *testing.T) {
	c, _ := shapes.Tessellate(40, 40, tile(shapes.Square, 250, 30, 0))
	classOf := shapes.Classify(c, shapes.PatternChecker, 0, 1)
	r := shapes.BuildRegions(c, classOf, nil)
	if err := r.Validate(40, 40); err != nil {
		t.Fatal(err)
	}
	if !r.Defs[0].Frozen {
		t.Fatal("class 0 (the gaps) must be frozen by default")
	}
	if len(r.Defs) != 3 {
		t.Fatalf("%d definitions for classes 0..2", len(r.Defs))
	}
}

func TestBuildRegionsRespectsACallersClassZero(t *testing.T) {
	c, _ := shapes.Tessellate(40, 40, tile(shapes.Square, 250, 30, 0))
	classOf := shapes.Classify(c, shapes.PatternAll, 0, 1)
	angle := 45
	r := shapes.BuildRegions(c, classOf, []engine.ClassDef{{Angle: &angle}, {Frozen: true}})
	if r.Defs[0].Frozen || r.Defs[0].Angle == nil || !r.Defs[1].Frozen {
		t.Fatalf("the caller's definitions must be kept as given: %+v", r.Defs)
	}
}
