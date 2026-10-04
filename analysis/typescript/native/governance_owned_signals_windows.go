//go:build windows

package main

import "os"

// The linked/captured original1.81 worker is Darwin-qualified. Preserve Windows
// controller termination without installing an unqualified signal interception.
func governanceOwnedTerminationSignals() []os.Signal { return nil }
func governanceRelayTerminationSignal(original os.Signal) error {
	self, err := os.FindProcess(os.Getpid())
	if err != nil {
		return err
	}
	return self.Signal(original)
}
