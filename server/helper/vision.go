package helper

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/color"
	"net/http"
	"slices"
	"sync"
	"time"
)

var opaqueWhite = color.RGBA{255, 255, 255, 255}

// ErrNoVision means the model does not accept pictures: the Shape helper needs one that does.
var ErrNoVision = errors.New("helper: the model does not accept pictures")

// errUnknownModel means the provider does not list the model.
var errUnknownModel = errors.New("helper: the provider does not list that model")

// VisionChecker confirms a model accepts pictures before one is sent.
type VisionChecker interface {
	Check(ctx context.Context, model string) error
}

// VisionFunc adapts a function to a VisionChecker.
type VisionFunc func(ctx context.Context, model string) error

// Check calls f.
func (f VisionFunc) Check(ctx context.Context, model string) error { return f(ctx, model) }

// AlwaysVision accepts every model. For tests, where the model is a script.
type AlwaysVision struct{}

// Check accepts.
func (AlwaysVision) Check(context.Context, string) error { return nil }

func visionRefusal(err error, model string) error {
	switch {
	case errors.Is(err, ErrNoVision):
		return &RequestError{"no_vision", fmt.Sprintf("%s doesn’t accept pictures. The Shape helper needs a model that can see; Cut out this object still works.", model)}
	case errors.Is(err, errUnknownModel):
		return &RequestError{"model_unavailable", fmt.Sprintf("%s isn’t a model the provider offers.", model)}
	case errors.Is(err, context.Canceled):
		return fmt.Errorf("helper: %w", err)
	default:
		return &RequestError{"model_unavailable", "Couldn’t check the model with the provider. Try again in a moment."}
	}
}

// OpenRouterVision asks OpenRouter's model list whether a model takes images, and remembers the list for an hour.
type OpenRouterVision struct {
	// URL is the model list, "https://openrouter.ai/api/v1/models" when empty.
	URL    string
	Client *http.Client
	TTL    time.Duration

	mu      sync.Mutex
	fetched time.Time
	vision  map[string]bool // model id -> takes images
}

const defaultModelsURL = "https://openrouter.ai/api/v1/models"

// Check refuses a model that is not listed, or whose input kinds do not include an image.
func (o *OpenRouterVision) Check(ctx context.Context, model string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	ttl := o.TTL
	if ttl == 0 {
		ttl = time.Hour
	}
	if o.vision == nil || time.Since(o.fetched) > ttl {
		list, err := o.fetch(ctx)
		if err != nil {
			if o.vision == nil { // nothing to fall back on
				return err
			}
		} else {
			o.vision, o.fetched = list, time.Now()
		}
	}
	takes, listed := o.vision[model]
	switch {
	case !listed:
		return errUnknownModel
	case !takes:
		return ErrNoVision
	}
	return nil
}

func (o *OpenRouterVision) fetch(ctx context.Context) (map[string]bool, error) {
	url := o.URL
	if url == "" {
		url = defaultModelsURL
	}
	c := o.Client
	if c == nil {
		c = &http.Client{Timeout: 15 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil) //nolint:gosec // the URL is server configuration or a test server, never from a request
	if err != nil {
		return nil, fmt.Errorf("helper: model list: %w", err)
	}
	res, err := c.Do(req) //nolint:gosec // same URL as above
	if err != nil {
		return nil, fmt.Errorf("helper: model list: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck // read-only body
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("helper: model list: HTTP %d", res.StatusCode)
	}
	var body struct {
		Data []struct {
			ID           string `json:"id"`
			Architecture struct {
				Input []string `json:"input_modalities"`
			} `json:"architecture"`
		} `json:"data"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 16<<20)).Decode(&body); err != nil {
		return nil, fmt.Errorf("helper: model list: %w", err)
	}
	out := make(map[string]bool, len(body.Data))
	for _, m := range body.Data {
		out[m.ID] = slices.Contains(m.Architecture.Input, "image")
	}
	return out, nil
}
