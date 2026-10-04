package main

import (
	"fmt"
	"os"
	"os/signal"
	"sync"
	"time"
)

// One signal owner belongs to the controller session, never to individual Rust
// producers. It closes the child and then restores and relays the original
// termination signal. It cannot turn SIGTERM into a silent successful exit.
type governanceOwnedSessionSignals struct {
	mu       sync.Mutex
	children map[*governanceOwnedProcess]struct{}
	closing  bool
	signals  chan os.Signal
	done     chan struct{}
	once     sync.Once
}

func governanceNewOwnedSessionSignals() *governanceOwnedSessionSignals {
	owner := &governanceOwnedSessionSignals{children: make(map[*governanceOwnedProcess]struct{}), signals: make(chan os.Signal, 2), done: make(chan struct{})}
	kinds := governanceOwnedTerminationSignals()
	if len(kinds) == 0 {
		return owner
	}
	signal.Notify(owner.signals, kinds...)
	go func() {
		select {
		case original := <-owner.signals:
			owner.stop()
			signal.Reset(original)
			if err := governanceRelayTerminationSignal(original); err != nil {
				panic(fmt.Sprintf("cannot restore original termination signal: %v", err))
			}
		case <-owner.done:
		}
	}()
	return owner
}
func (owner *governanceOwnedSessionSignals) start(artifact []byte) (*governanceOwnedProcess, error) {
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if owner.closing {
		return nil, fmt.Errorf("native controller is terminating")
	}
	child, err := governanceNewOwnedProcess(artifact)
	if err != nil {
		return nil, err
	}
	// Start and owner registration are serialized with shutdown. There is no
	// newly running child that can be missed by the session's signal handler.
	owner.children[child] = struct{}{}
	go func() {
		<-child.done
		owner.mu.Lock()
		delete(owner.children, child)
		owner.mu.Unlock()
	}()
	return child, nil
}
func (owner *governanceOwnedSessionSignals) stop() {
	owner.once.Do(func() {
		owner.mu.Lock()
		owner.closing = true
		children := make([]*governanceOwnedProcess, 0, len(owner.children))
		for child := range owner.children {
			children = append(children, child)
		}
		owner.mu.Unlock()
		for _, child := range children {
			child.close()
		}
		timer := time.NewTimer(500 * time.Millisecond)
		defer timer.Stop()
	wait:
		for _, child := range children {
			select {
			case <-child.done:
			case <-timer.C:
				break wait
			}
		}
		signal.Stop(owner.signals)
		close(owner.done)
	})
}
func (session *governanceSession) startOwnedGenericProcess(artifact []byte) (*governanceOwnedProcess, error) {
	if session.ownedSignals == nil {
		return governanceNewOwnedProcess(artifact)
	}
	return session.ownedSignals.start(artifact)
}
