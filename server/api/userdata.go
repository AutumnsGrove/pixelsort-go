package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"

	"github.com/AutumnsGrove/pixelsort-go/server/httpx"
)

func (a *API) listPresets(w http.ResponseWriter, r *http.Request) {
	list, err := a.d.Runs.Presets(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, map[string]any{"presets": list})
}

func (a *API) addPreset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Settings    json.RawMessage `json:"settings"`
	}
	if err := httpx.Decode(r, &in, 64<<10); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	if err := validateRecipe(in.Settings); err != nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	p, err := a.d.Runs.AddPreset(r.Context(), in.Name, in.Description, in.Settings)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusCreated, p)
}

func validateRecipe(raw json.RawMessage) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		return errors.New("settings must be a JSON object")
	}
	for k := range obj {
		if !recipeKeys[k] {
			return fmt.Errorf("unknown recipe field %q", k)
		}
	}
	return nil
}

func (a *API) deletePreset(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "not found")
		return
	}
	if err := a.d.Runs.DeletePreset(r.Context(), id); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) {
	s, err := a.d.Runs.Settings(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(s)
}

var workRes = map[float64]bool{960: true, 1280: true, 1920: true, 2560: true}

// validateSettings mirrors the web settings module: known keys only, bounded values (PLAN.md section 10).
func validateSettings(raw []byte) (json.RawMessage, error) {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		return nil, errors.New("settings must be a JSON object")
	}
	oneOf := func(k string, v any, allowed ...string) error {
		s, ok := v.(string)
		for _, a := range allowed {
			if ok && s == a {
				return nil
			}
		}
		return fmt.Errorf("%s must be one of %v", k, allowed)
	}
	num := func(k string, v any, lo, hi float64) error {
		f, ok := v.(float64)
		if !ok || math.IsNaN(f) || f < lo || f > hi || f != math.Trunc(f) {
			return fmt.Errorf("%s must be a whole number from %v to %v", k, lo, hi)
		}
		return nil
	}
	for k, v := range obj {
		var err error
		switch k {
		case "workRes":
			if f, ok := v.(float64); v != nil && !(ok && workRes[f]) {
				err = errors.New("workRes must be null, 960, 1280, 1920 or 2560")
			}
		case "exportFormat":
			err = oneOf(k, v, "png", "jpeg", "webp")
		case "exportQuality":
			err = num(k, v, 40, 100)
		case "speed":
			err = num(k, v, 1, 400)
		case "stripMeta", "embedRecipe", "grain":
			if _, ok := v.(bool); !ok {
				err = fmt.Errorf("%s must be true or false", k)
			}
		case "shareExpiry":
			err = oneOf(k, v, "never", "30")
		case "motion":
			err = oneOf(k, v, "system", "reduce")
		default:
			err = fmt.Errorf("unknown setting %q", k)
		}
		if err != nil {
			return nil, err
		}
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return nil, fmt.Errorf("settings: %w", err)
	}
	return out, nil
}

func (a *API) putSettings(w http.ResponseWriter, r *http.Request) {
	var raw json.RawMessage
	if err := httpx.Decode(r, &raw, 16<<10); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	clean, err := validateSettings(raw)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, err.Error())
		return
	}
	if err := a.d.Runs.PutSettings(r.Context(), clean); err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(clean)
}

func (a *API) listShapes(w http.ResponseWriter, r *http.Request) {
	list, err := a.d.Runs.Shapes(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusOK, map[string]any{"shapes": list})
}

const maxShapePoints = 2000

func (a *API) addShape(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string         `json:"name"`
		Poly [][2]float64   `json:"poly"`
		More [][][2]float64 `json:"more"`
	}
	if err := httpx.Decode(r, &in, 512<<10); err != nil {
		httpx.BadJSON(w, err)
		return
	}
	total := len(in.Poly)
	for _, ring := range in.More {
		total += len(ring)
	}
	if len(in.Poly) < 3 || total > maxShapePoints {
		httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "a shape needs at least 3 points and at most "+strconv.Itoa(maxShapePoints))
		return
	}
	for _, ring := range append([][][2]float64{in.Poly}, in.More...) {
		for _, p := range ring {
			for _, v := range p {
				if math.IsNaN(v) || math.IsInf(v, 0) || v < -10 || v > 10 {
					httpx.Error(w, http.StatusBadRequest, httpx.CodeBadRequest, "shape coordinates must be finite and in unit-square range")
					return
				}
			}
		}
	}
	poly, _ := json.Marshal(in.Poly) // plain numbers always marshal
	var more json.RawMessage
	if in.More != nil {
		more, _ = json.Marshal(in.More)
	}
	sh, err := a.d.Runs.AddShape(r.Context(), in.Name, poly, more)
	if err != nil {
		fail(w, err)
		return
	}
	httpx.Write(w, http.StatusCreated, sh)
}

func (a *API) deleteShape(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		httpx.Error(w, http.StatusNotFound, httpx.CodeNotFound, "not found")
		return
	}
	if err := a.d.Runs.DeleteShape(r.Context(), id); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
