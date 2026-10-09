package main

import (
	"encoding/json"
	"fmt"
	"io"
)

const capturedSemanticFrameBytes = 64 * 1024 * 1024

// A lease owns only projection membership and publication state. The captured
// type authority remains the sole compiler owner and is never reopened here.
type governanceSemanticProjection struct {
	cache        *bodyDemandCache
	plan         projectionPlan
	acknowledged generationState
	pending      *pendingGeneration
}

type governanceSemanticRequest struct {
	Token                string    `json:"token"`
	Generation           string    `json:"generation"`
	SourceSnapshotDigest string    `json:"sourceSnapshotDigest"`
	Lease                string    `json:"lease,omitempty"`
	Request              request   `json:"request"`
	Capabilities         *[]string `json:"capabilities,omitempty"`
}

func (session *governanceSession) semanticOwner(input governanceSemanticRequest) (*governanceProductsSession, error) {
	state := session.productsSession
	if state == nil || governanceClosedSourceRevision(state.Prepare.Options) != 3 || session.policyLane != nil || state.Project == nil ||
		state.Token != input.Token || state.Generation != input.Generation || state.Project.GovernanceDigest != input.SourceSnapshotDigest ||
		state.ProductsDigest != "" || state.SourceProducts != nil || !state.sourceBody.matches(state) ||
		!state.sourceBody.opened || !state.sourceBody.projected {
		return nil, fmt.Errorf("semantic reader does not own the admitting source capture")
	}
	return state, nil
}

func (session *governanceSession) openSemanticProjection(raw json.RawMessage) (any, error) {
	var input governanceSemanticRequest
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	state, err := session.semanticOwner(input)
	if err != nil {
		return nil, err
	}
	if input.Lease != "" {
		return nil, fmt.Errorf("semantic acquisition must not supply a lease")
	}
	capabilities := []string{sourceNamespace, bodyDemandNamespace}
	if input.Capabilities != nil {
		capabilities = sortedUnique(*input.Capabilities)
	}
	plan := planProjections(capabilities)
	for _, capability := range capabilities {
		if !plan.enables(capability) {
			return nil, fmt.Errorf("unsupported captured projection capability %q", capability)
		}
	}
	if state.semanticReaders == nil {
		state.semanticReaders = map[string]*governanceSemanticProjection{}
	}
	state.semanticLease++
	lease := fmt.Sprintf("%s:%d", state.Token, state.semanticLease)
	state.semanticReaders[lease] = &governanceSemanticProjection{cache: &bodyDemandCache{fullBodies: map[string]factShard{}}, plan: plan}
	return map[string]any{"token": input.Token, "generation": input.Generation,
		"sourceSnapshotDigest": input.SourceSnapshotDigest, "lease": lease,
		"project": map[string]any{"root": state.Project.Root, "config": "tsconfig.json",
			"capabilities": plan.capabilities()}}, nil
}

func (session *governanceSession) requestSemanticProjection(raw json.RawMessage) (any, error) {
	var input governanceSemanticRequest
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	// A retired lease can always be closed. Its tuple never selects CURRENT and
	// therefore cannot release another capture's projection or compiler.
	if input.Request.Kind == "dispose" {
		state := session.productsSession
		if state != nil && state.Token == input.Token && state.Generation == input.Generation && state.Project != nil &&
			state.Project.GovernanceDigest == input.SourceSnapshotDigest {
			delete(state.semanticReaders, input.Lease)
		}
		return map[string]any{"token": input.Token, "generation": input.Generation,
			"sourceSnapshotDigest": input.SourceSnapshotDigest, "lease": input.Lease}, nil
	}
	state, err := session.semanticOwner(input)
	if err != nil {
		return nil, err
	}
	if input.Capabilities != nil {
		return nil, fmt.Errorf("captured projection capabilities are immutable within a lease")
	}
	projection := state.semanticReaders[input.Lease]
	if input.Lease == "" || projection == nil {
		return nil, fmt.Errorf("semantic reader lease is unavailable")
	}
	request := input.Request
	if request.ID < 1 {
		return nil, fmt.Errorf("semantic request identity is invalid")
	}
	var response any
	switch request.Kind {
	case "acknowledge":
		if projection.pending == nil || request.Generation != projection.pending.state.generation.ID || request.Sequence < 1 ||
			(projection.pending.transaction.Base != "" && request.Sequence != projection.pending.state.generation.Sequence) {
			return nil, fmt.Errorf("semantic acknowledgement does not own the published candidate")
		}
		projection.acknowledged = projection.pending.state
		projection.acknowledged.generation.Sequence = request.Sequence
		session.semanticPublished = projection.acknowledged
		projection.pending = nil
		response = map[string]any{"id": request.ID, "protocolVersion": protocolVersion, "kind": "acknowledged", "generation": request.Generation}
	case "refresh":
		if request.Discover || request.Invalidate || len(request.Changed) != 0 || len(request.Changes) != 0 {
			return nil, fmt.Errorf("semantic projection cannot change its captured compiler inputs")
		}
		if projection.pending != nil {
			return nil, fmt.Errorf("semantic projection awaits acknowledgement")
		}
		base := projection.acknowledged
		adopting := base.generation.ID == "" && request.Base != ""
		if (!adopting && request.Base != base.generation.ID) ||
			(request.Base != "" && (request.BaseSequence < 1 || (!adopting && request.BaseSequence != base.generation.Sequence))) {
			return nil, fmt.Errorf("semantic projection base differs from its acknowledged generation")
		}
		demand, err := admitBodyDemand(request.BodyDemand)
		if err != nil {
			return nil, err
		}
		if demand == nil || demand.Owners == nil {
			return nil, fmt.Errorf("semantic projection requires an exact observed body recipe")
		}
		if projection.cache.ready {
			for _, owner := range *demand.Owners {
				if projection.cache.byOwner[owner] == nil {
					return nil, fmt.Errorf("semantic demand owner is absent from its captured inventory")
				}
			}
		}
		// Selection is monotone inside one immutable capture. A missing owner
		// must not silently erase evidence observed by an earlier computation.
		if base.bodyDemand != nil {
			if !governanceSelectionContains(demand.Paths, base.bodyDemand.Paths) || !governanceSelectionContains(*demand.Owners, *base.bodyDemand.Owners) {
				return nil, fmt.Errorf("semantic projection cannot retract observed demand")
			}
		}
		owner := governanceCapturedTypeAuthority(state.Project)
		universe, configuration, err := governanceCapturedUniverseConfiguration(owner)
		if err != nil {
			return nil, err
		}
		// Cross-capture reuse starts only from exact acknowledged metadata and
		// the freshly recomputed compiler universe. An unknown base requires a
		// complete baseless transaction and the existing store adoption gate.
		publicationBase := base
		baseID := request.Base
		if base.generation.ID == "" {
			previous := session.semanticPublished
			if adopting && previous.generation.ID == request.Base && previous.generation.Sequence == request.BaseSequence && previous.generation.Universe == universe {
				publicationBase = previous
			} else {
				baseID = ""
			}
		}
		if !state.Project.capture.metadataFidelity() {
			return nil, fmt.Errorf("semantic compiler metadata is not faithful to its capture")
		}
		plan := projection.plan
		plan.demand, plan.demandCache = demand, projection.cache
		const maximumSemanticBytes = 384 * 1024 * 1024
		var shards []factShard
		var sources []sourceRecord
		initial := !projection.cache.ready
		if !initial {
			shards, sources, _, err = projection.cache.project(plan, maximumSemanticBytes, maximumSemanticBytes, nil, request.ID)
		} else {
			shards, sources, _, err = extractProgram(state.Project.Root, universe, owner.program, nil, plan,
				map[string]bool{typescriptBodyPayloadCodec: true}, maximumSemanticBytes, maximumSemanticBytes, nil, request.ID)
		}
		if err != nil {
			return nil, err
		}
		if initial {
			// A prior epoch's recipe is selection intent, not current owner
			// authority. Retain only bodies the current captured inventory owns.
			retainedOwners, retainedPaths := []string{}, []string{}
			paths := map[string]bool{}
			for _, body := range projection.cache.bodies {
				paths[body.path] = true
			}
			for _, path := range demand.Paths {
				if paths[path] {
					retainedPaths = append(retainedPaths, path)
				}
			}
			for _, owner := range *demand.Owners {
				if projection.cache.byOwner[owner] != nil {
					retainedOwners = append(retainedOwners, owner)
				}
			}
			demand = &bodyDemandRecipe{Paths: retainedPaths, Owners: &retainedOwners}
		}
		transaction, publication, err := assembleProjectionTransaction(projectionPublication{
			base: publicationBase, baseID: baseID, universe: universe, configuration: configuration,
			capabilities: plan.capabilities(), shards: shards, sources: sources, full: true, requestID: request.ID,
		})
		if err != nil {
			return nil, err
		}
		publication.bodyDemand = demand
		if transaction == nil || (adopting && publication.generation.ID == request.Base) {
			if adopting {
				publication.generation.Sequence = request.BaseSequence
			}
			projection.acknowledged = publication
			session.semanticPublished = publication
			response = map[string]any{"id": request.ID, "protocolVersion": protocolVersion, "kind": "unchanged", "generation": publication.generation.ID}
		} else {
			response = map[string]any{"id": request.ID, "protocolVersion": protocolVersion, "kind": "transaction", "transaction": transaction}
			if err := validateCapturedSemanticFrame(input, response, capturedSemanticFrameBytes); err != nil {
				return nil, err
			}
			projection.pending = &pendingGeneration{state: publication, transaction: transaction}
		}
	default:
		return nil, fmt.Errorf("unsupported captured semantic operation %s", request.Kind)
	}
	return map[string]any{"token": input.Token, "generation": input.Generation,
		"sourceSnapshotDigest": input.SourceSnapshotDigest, "lease": input.Lease, "response": response}, nil
}

// The decision actor owns a single bounded response frame. Explicit larger
// capability sets must fail before publishing a candidate or writing its bytes;
// their caller can use the resident project's existing streamed transport.
func validateCapturedSemanticFrame(input governanceSemanticRequest, response any, limit int) error {
	frame := map[string]any{"id": int64(1<<63 - 1), "result": map[string]any{
		"token": input.Token, "generation": input.Generation, "sourceSnapshotDigest": input.SourceSnapshotDigest,
		"lease": input.Lease, "response": response}}
	if err := writeFrame(io.Discard, frame, limit-1); err != nil {
		return fmt.Errorf("captured semantic projection requires a smaller capability/selection set or the resident streamed reader: %w", err)
	}
	return nil
}

func governanceSelectionContains(current, previous []string) bool {
	selected := map[string]bool{}
	for _, value := range current {
		selected[value] = true
	}
	for _, value := range previous {
		if !selected[value] {
			return false
		}
	}
	return true
}
