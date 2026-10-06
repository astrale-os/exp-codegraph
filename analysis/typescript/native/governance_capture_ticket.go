package main

import (
	"fmt"
	"sync/atomic"
)

// A private publication ticket names one retained observation-set revision.
// It is not a canonical cross-owner observation digest or a hash-equality claim.
// Public continuations present an opaque certificate back to this same owner.
// Capture cells retain first observations; adding a cell or detecting a conflict
// advances this owner revision. Compiler maps with replacing semantics cannot
// use this ticket. Final publication still compares original uncached operations.
type governanceCaptureTicket struct {
	ownedProducer                              *governanceOwnedOwner
	owner, revision                            uint64
	observations, compilerObservations, probes int
	compiler                                   *compilerInputFS
	inconsistent, compilerInconsistent         bool
	initialized                                bool
}

var governanceCaptureTicketOwners atomic.Uint64

func (capture *governanceCapture) semanticTicket() string {
	compilerCount := 0
	compilerConflict := false
	if capture.compiler != nil {
		capture.compiler.mu.Lock()
		compilerCount = len(capture.compiler.prefix.observations)
		compilerConflict = capture.compiler.inconsistent
		immutable := capture.compiler.singleCapture
		capture.compiler.mu.Unlock()
		if !immutable {
			return capture.canonicalCertificate()
		}
	}
	ticket := &capture.ticket
	if ticket.owner == 0 {
		ticket.owner = governanceCaptureTicketOwners.Add(1)
		if ticket.owner == 0 {
			panic("private capture ticket identities exhausted")
		}
	}
	if !ticket.initialized || ticket.ownedProducer != capture.ownedGenericOwner || ticket.observations != len(capture.observations) || ticket.compilerObservations != compilerCount || ticket.probes != len(capture.probeObservations) || ticket.compiler != capture.compiler || ticket.inconsistent != capture.probeInconsistent || ticket.compilerInconsistent != compilerConflict {
		ticket.revision++
		if ticket.revision == 0 {
			panic("private capture ticket revisions exhausted")
		}
		ticket.ownedProducer = capture.ownedGenericOwner
		ticket.observations = len(capture.observations)
		ticket.compilerObservations = compilerCount
		ticket.probes = len(capture.probeObservations)
		ticket.compiler = capture.compiler
		ticket.inconsistent = capture.probeInconsistent
		ticket.compilerInconsistent = compilerConflict
		ticket.initialized = true
	}
	return fmt.Sprintf("private-capture:%d:%d", ticket.owner, ticket.revision)
}

// The consumer presents this opaque ticket back to its owning capture, rather
// than proving a globally canonical hash identity. Its actual observation maps
// retain first values; pending type proposals retain separate expected inputs.
// Neither can publish until the original uncached whole barrier passes.
func (capture *governanceCapture) certificate() string {
	return governanceHash([]byte(fmt.Sprintf("publication:%s:pending-types:%d", capture.semanticTicket(), len(capture.compilerAssertions)+len(capture.typeCacheLeases))))
}
