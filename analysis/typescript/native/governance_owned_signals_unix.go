//go:build darwin || linux

package main

import (
	"os"
	"syscall"
)

func governanceOwnedTerminationSignals() []os.Signal {
	return []os.Signal{os.Interrupt, syscall.SIGTERM}
}
func governanceRelayTerminationSignal(original os.Signal) error {
	return syscall.Kill(os.Getpid(), original.(syscall.Signal))
}
