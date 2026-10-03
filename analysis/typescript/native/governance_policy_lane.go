package main

import (
	"encoding/json"
	"fmt"
)

// One actor owns generic I/O while exactly one private lane owns every compiler,
// checker, source cache, generation broker and lease. The channel transfers that
// ownership back only after the lane finishes. No RPC accesses its mutable state.
type governancePolicyLane struct {
	done chan governancePolicyLaneResult
}
type governancePolicyLaneResult struct {
	owner  *governanceSession
	result any
	err    error
}

func governanceGenericEnabled(raw json.RawMessage) bool {
	var options struct {
		Generic *bool `json:"generic"`
	}
	if len(raw) != 0 && json.Unmarshal(raw, &options) != nil {
		return false
	}
	return options.Generic == nil || *options.Generic
}

// Fork only the currently captured policy/root bytes. These are fresh original
// reads owned by this attempt, not governanceExpectedCapture replay proposals.
// Compiler/assertion/lease cells must never be admitted into this seed.
func governancePolicySeed(source *governanceCapture) (*governanceCapture, error) {
	if source == nil || source.compiler != nil || len(source.compilerAssertions)+len(source.typeCacheLeases) != 0 {
		return nil, fmt.Errorf("generic policy seed contains semantic authority")
	}
	seed := &governanceCapture{root: source.root, observations: map[string]governanceObservation{}, byteCells: map[string]governanceCapturedBytes{}, probeObservations: map[governanceProbeKey]string{}, probeInconsistent: source.probeInconsistent}
	for key, value := range source.observations {
		seed.observations[key] = value
	}
	for path, cell := range source.byteCells {
		seed.byteCells[path] = governanceCapturedBytes{append([]byte(nil), cell.bytes...), cell.err}
	}
	for key, value := range source.probeObservations {
		seed.probeObservations[key] = value
	}
	return seed, nil
}

func (session *governanceSession) startPolicyLane(raw json.RawMessage) (any, error) {
	suspension := session.policySuspension
	seed, err := governancePolicySeed(suspension.Capture)
	if err != nil {
		return nil, err
	}
	prepare := session.productsSession.Prepare
	// Move all reusable mutable authority. The actor retains no aliases to it.
	private := &governanceSession{
		root: session.root, generation: session.generation, policySuspension: suspension,
		productsSession: &governanceProductsSession{Prepare: prepare},
		parseCache:      session.parseCache, typeDemandCache: session.typeDemandCache,
		programGeneration: session.programGeneration, sealedDecisions: session.sealedDecisions,
	}
	session.parseCache = nil
	session.typeDemandCache = nil
	session.programGeneration = nil
	session.sealedDecisions = nil
	session.policySuspension = nil
	state := &governanceProductsSession{Prepare: prepare, Token: suspension.Token, Generation: fmt.Sprint(session.generation), GenericSuspended: true, GenericSpeculative: true,
		Project: &governedProject{Root: suspension.Root, capture: seed}}
	session.productsSession = state
	lane := &governancePolicyLane{done: make(chan governancePolicyLaneResult, 1)}
	session.policyLane = lane
	owned := append(json.RawMessage(nil), raw...)
	go func() {
		result, err := private.continueProductsOwned(owned, false)
		lane.done <- governancePolicyLaneResult{private, result, err}
	}()
	return state.genericSuspension(), nil
}

func (session *governanceSession) takePolicyLane() governancePolicyLaneResult {
	lane := session.policyLane
	joined := <-lane.done
	session.policyLane = nil
	private := joined.owner
	session.parseCache = private.parseCache
	session.typeDemandCache = private.typeDemandCache
	session.programGeneration = private.programGeneration
	session.sealedDecisions = private.sealedDecisions
	session.productsSession = private.productsSession
	session.policySuspension = private.policySuspension
	private.parseCache = nil
	private.typeDemandCache = nil
	private.programGeneration = nil
	private.sealedDecisions = nil
	private.productsSession = nil
	private.policySuspension = nil
	return joined
}

// New prepare, EOF and disposal drain the one outstanding computation before
// retiring its Program proposal and releasing leases. Cancellation of the native
// process retires the entire OS process, including this private goroutine.
func (session *governanceSession) drainPolicyLane() {
	if session.policyLane != nil {
		session.takePolicyLane()
	}
}

// Compare full original operation fingerprints. Different operation kinds keep
// independent guards. ReadFile/probe read-bytes share the exact original operation
// and its complete bytes or complete failure (kind/code/message), never errno only.
func governanceLaneCapturesAgree(a, b *governanceCapture) bool {
	if a.probeInconsistent || b.probeInconsistent {
		return false
	}
	for key, row := range a.observations {
		if other, ok := b.observations[key]; ok && row != other {
			return false
		}
	}
	for key, value := range a.probeObservations {
		if other, ok := b.probeObservations[key]; ok && value != other {
			return false
		}
	}
	for _, pair := range [][2]*governanceCapture{{a, b}, {b, a}} {
		for path, cell := range pair[0].byteCells {
			key := governanceProbeKey{Path: path, Kind: "read-bytes"}
			if expected, ok := pair[1].probeObservations[key]; ok {
				actual := governanceObserveProbeWithRead(key, func(string) ([]byte, error) { return cell.bytes, cell.err })
				if governanceProbeFingerprint(actual) != expected {
					return false
				}
			}
		}
	}
	return true
}

func (session *governanceSession) joinPolicyLane(generic *governanceProductsSession) (any, error) {
	joined := session.takePolicyLane()
	if joined.err != nil {
		session.discardProducts()
		return nil, joined.err
	}
	state := session.productsSession
	if state == nil || state.Project == nil {
		return joined.result, nil
	}
	if state.Token != generic.Token || state.Generation != generic.Generation || !governanceLaneCapturesAgree(state.Project.capture, generic.Project.capture) {
		session.programGeneration = nil
		session.sealedDecisions = nil
		session.discardProducts()
		return map[string]any{"status": "retry"}, nil
	}
	state.GenericEngine = generic.GenericEngine
	state.GenericProduct = generic.GenericProduct
	state.JoinedCaptures = append(state.JoinedCaptures, generic.Project.capture)
	if result, ok := joined.result.(map[string]any); ok && result["status"] == "source" {
		return joined.result, nil
	}
	// Native outcomes/intrinsics are still private. Products are assembled only
	// after both producers finish, with all independent closures in final seal.
	if len(state.Requirements) != 0 {
		return joined.result, nil
	}
	return session.evaluateProducts()
}
