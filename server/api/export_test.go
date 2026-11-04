package api

// RecipeKeys returns a copy of the recipe allow-list, for the test that compares it with engine.Params.
func RecipeKeys() map[string]bool {
	out := make(map[string]bool, len(recipeKeys))
	for k, v := range recipeKeys {
		out[k] = v
	}
	return out
}
