// Package share talks to the Cloudflare share Worker: request signing, and later the shares API.
package share

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Header names the Worker expects on every request.
const (
	HeaderTimestamp = "X-PS-Timestamp"
	HeaderBodySHA   = "X-PS-Content-SHA256"
	HeaderSignature = "X-PS-Signature"
)

// EmptySHA is the SHA-256 of no bytes, used for requests without a body.
const EmptySHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// BodySHA returns the lowercase hex SHA-256 of body.
func BodySHA(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

// Signature computes HMAC-SHA256(secret, "PS1\nMETHOD\nPATH\nTIMESTAMP\nBODYSHA") as lowercase hex.
// path is the request path plus the raw query string, exactly as sent.
func Signature(secret, method, path, timestamp, bodySHA string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("PS1\n" + strings.ToUpper(method) + "\n" + path + "\n" + timestamp + "\n" + bodySHA))
	return hex.EncodeToString(mac.Sum(nil))
}

// Sign returns the three headers for a request made at ts.
func Sign(secret, method, path string, ts time.Time, bodySHA string) http.Header {
	stamp := strconv.FormatInt(ts.Unix(), 10)
	h := http.Header{}
	h.Set(HeaderTimestamp, stamp)
	h.Set(HeaderBodySHA, bodySHA)
	h.Set(HeaderSignature, Signature(secret, method, path, stamp, bodySHA))
	return h
}

// SignRequest adds the signing headers to req, using its method and its path plus raw query.
func SignRequest(req *http.Request, secret string, ts time.Time, bodySHA string) {
	path := req.URL.EscapedPath()
	if req.URL.RawQuery != "" {
		path += "?" + req.URL.RawQuery
	}
	for k, v := range Sign(secret, req.Method, path, ts, bodySHA) {
		req.Header[k] = v
	}
}
