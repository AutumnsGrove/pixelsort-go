package api

// recipeKeys is the allow-list of top-level keys in a saved recipe (a preset's settings). The server never imports
// the engine, so the list is written out here; recipe_test.go reflects over engine.Params and fails if the two drift.
var recipeKeys = map[string]bool{
	"mode": true, "key": true, "reverse": true, "angle": true, "length": true, "randomness": true, "waveAmp": true,
	"wavePeriod": true, "lo": true, "hi": true, "thresholdKey": true, "edge": true, "rule": true, "cell": true,
	"caSpace": true, "caBoundary": true, "algo": true, "seed": true,
	"pattern": true, "patternVariant": true, "patternCell": true, "patternThickness": true, "patternRotate": true,
	"patternDetail": true, "patternInvert": true, "patternOverlay": true,
}
