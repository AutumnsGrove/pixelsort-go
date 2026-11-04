// Command pixelsort-go is the server and command line for pixelsort-go.
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/AutumnsGrove/pixelsort-go/internal/version"
)

func newRoot() *cobra.Command {
	root := &cobra.Command{Use: "pixelsort-go", Short: "A pixel sorter you can watch", SilenceUsage: true}
	root.AddCommand(newServe(), newVersion())
	return root
}

func newVersion() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version",
		RunE: func(cmd *cobra.Command, _ []string) error {
			_, err := fmt.Fprintln(cmd.OutOrStdout(), version.Version)
			return err
		},
	}
}

func main() {
	if err := newRoot().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err) //nolint:errcheck // nothing useful to do if stderr is closed
		os.Exit(1)
	}
}
