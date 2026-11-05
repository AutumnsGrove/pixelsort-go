package engine

// RecommendedRules is the Python app's curated pool of Wolfram rules that make good sort masks.
var RecommendedRules = [...]uint8{26, 19, 23, 25, 35, 106, 11, 110, 45, 41, 105, 54, 3, 15, 9, 154, 142}

// RuleNote is the one-line character of a recommended rule; ok is false for any other rule.
func RuleNote(rule uint8) (note string, ok bool) {
	switch rule {
	case 26, 19, 23, 25:
		return "Simple patterns with structure", true
	case 35, 106, 11:
		return "More complex organised patterns", true
	case 110:
		return "Turing complete, creates complex structures", true
	case 45, 41, 105:
		return "Irregular but structured patterns", true
	case 54, 3, 15, 9:
		return "Various geometric patterns", true
	case 154, 142:
		return "Dense, fractal-like patterns", true
	}
	return "", false
}

// PickRecommended chooses a recommended rule from a seed, for a "surprise me" button. The engine never picks a rule
// on its own: a recipe always names its rule.
func PickRecommended(seed uint32) uint8 {
	return RecommendedRules[NewStream(seed, 0xCA5E).Uint32n(uint32(len(RecommendedRules)))]
}
