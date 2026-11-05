package share

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrWorker means the Worker could not be reached or refused a request; the caller reports a 502.
var ErrWorker = errors.New("share: the share Worker did not accept the request")

// Opener returns a fresh reader for a request body, so an idempotent PUT can be retried.
type Opener func() (io.ReadCloser, error)

// Client makes signed requests to the Worker. The secret never leaves it: it is not in any error or log line.
type Client struct {
	base   string
	secret string
	HTTP   *http.Client
	Now    func() time.Time
	// Backoff is the wait before retry n (1-based); tests set it to zero.
	Backoff func(n int) time.Duration
}

// NewClient builds a Client for base (no trailing slash) and secret.
func NewClient(base, secret string) *Client {
	return &Client{
		base: strings.TrimRight(base, "/"), secret: secret,
		HTTP: &http.Client{Timeout: 5 * time.Minute}, Now: time.Now,
		Backoff: func(n int) time.Duration { return time.Duration(n) * 500 * time.Millisecond },
	}
}

func (c *Client) newRequest(ctx context.Context, method, path string, body io.Reader, size int64, bodySHA, contentType string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return nil, fmt.Errorf("share: build request: %w", err)
	}
	if size >= 0 && body != nil {
		req.ContentLength = size
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	SignRequest(req, c.secret, c.Now(), bodySHA)
	return req, nil
}

// Put uploads one object, retrying up to 3 times on network errors and 5xx (the Worker's PUTs are idempotent).
func (c *Client) Put(ctx context.Context, path, contentType, bodySHA string, size int64, open Opener) error {
	var last error
	for attempt := 1; attempt <= 3; attempt++ {
		if attempt > 1 {
			select {
			case <-ctx.Done():
				return fmt.Errorf("%w: %w", ErrWorker, ctx.Err())
			case <-time.After(c.Backoff(attempt - 1)):
			}
		}
		body, err := open()
		if err != nil {
			return fmt.Errorf("share: open body: %w", err)
		}
		req, err := c.newRequest(ctx, http.MethodPut, path, body, size, bodySHA, contentType)
		if err != nil {
			_ = body.Close()
			return err
		}
		resp, err := c.HTTP.Do(req)
		if err != nil {
			last = fmt.Errorf("%w: %s", ErrWorker, redact(err))
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		_ = resp.Body.Close()
		switch {
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			return nil
		case resp.StatusCode >= 500:
			last = fmt.Errorf("%w: HTTP %d", ErrWorker, resp.StatusCode)
		default:
			return fmt.Errorf("%w: HTTP %d", ErrWorker, resp.StatusCode)
		}
	}
	return last
}

// PutBytes uploads an in-memory object.
func (c *Client) PutBytes(ctx context.Context, path, contentType string, data []byte) error {
	return c.Put(ctx, path, contentType, BodySHA(data), int64(len(data)), func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(data)), nil
	})
}

// DeleteAlbum revokes an album: every object under it is removed. Idempotent.
func (c *Client) DeleteAlbum(ctx context.Context, id string) error {
	req, err := c.newRequest(ctx, http.MethodDelete, "/api/albums/"+id, nil, -1, EmptySHA, "")
	if err != nil {
		return err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrWorker, redact(err))
	}
	defer resp.Body.Close() //nolint:errcheck // nothing to do about a failed close
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: HTTP %d", ErrWorker, resp.StatusCode)
	}
	return nil
}

// Fetch asks the Worker to load a picture from the internet. The caller owns resp.Body and passes the Worker's
// status, headers and body on; error statuses are the Worker's own (see worker/src/fetch.ts).
func (c *Client) Fetch(ctx context.Context, rawURL string) (*http.Response, error) {
	req, err := c.newRequest(ctx, http.MethodGet, "/fetch?url="+url.QueryEscape(rawURL), nil, -1, EmptySHA, "")
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrWorker, redact(err))
	}
	return resp, nil
}

// redact keeps a transport error useful without ever quoting the request (which could carry the signature).
func redact(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err.Error()
	}
	return err.Error()
}
