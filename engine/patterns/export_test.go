package patterns

import "flag"

// The -update flag is read by internal/testutil.Golden by name; the package that owns golden files registers it.
var _ = flag.Bool("update", false, "rewrite golden files")
