//go:build !embedweb

package spa

import "io/fs"

type emptyFS struct{}

func (emptyFS) Open(string) (fs.File, error) { return nil, fs.ErrNotExist }

// FS is empty in a build without the web app, so Handler answers with a clear message instead of a bare 404.
func FS() fs.FS { return emptyFS{} }
