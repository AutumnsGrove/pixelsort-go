// Package version holds the build's version string, stamped in at build time.
package version

// Version is "r<commit count>.<short sha>" in a release build and "dev" otherwise.
// Set with: go build -ldflags "-X github.com/AutumnsGrove/pixelsort-go/internal/version.Version=r12.abc1234".
var Version = "dev"
