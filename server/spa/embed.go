//go:build embedweb

package spa

import (
	"embed"
	"io/fs"
)

//go:embed all:build
var built embed.FS

// FS is the built web app (copy web/build to server/spa/build first: make web-embed).
func FS() fs.FS {
	sub, err := fs.Sub(built, "build")
	if err != nil {
		panic(err) // "build" is embedded above, so Sub cannot fail
	}
	return sub
}
