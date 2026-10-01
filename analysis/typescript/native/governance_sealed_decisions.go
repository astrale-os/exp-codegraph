package main

import (
	"encoding/json"
	"sort"
)

// A sealed decision owns values and expected observations, never a checker,
// AST, or borrowed callbacks. Expected cells are proposals, not current reads.
type governanceSealedDecisions struct {
	prepare   string
	policy    string
	contracts string
	neutral   string
	sources   string
	rules     []byte
	runtime   []byte
	leaves    []byte
	answers   []byte
	expected  *governanceCapture
}

func governanceDecisionPrepareKey(value governancePrepare) string {
	// Changed is a caller hint; it does not certify bytes or affect semantics.
	value.Changed = nil
	return string(stableJSON(value))
}

func governanceDecisionSources(project *governedProject) string {
	rows := make([][]string, 0, len(project.Files))
	for _, file := range project.Files {
		rows = append(rows, []string{file.Path, file.AbsolutePath, file.Role, file.Layer, file.Submodule, governanceHash([]byte(file.Text))})
	}
	return string(stableJSON(rows))
}

func governanceExpectedCapture(source *governanceCapture) *governanceCapture {
	expected := &governanceCapture{root: source.root, observations: map[string]governanceObservation{}, probeObservations: map[governanceProbeKey]string{}, probeInconsistent: source.probeInconsistent}
	for key, value := range source.observations {
		expected.observations[key] = value
	}
	for key, value := range source.probeObservations {
		expected.probeObservations[key] = value
	}
	for _, pending := range source.typeReceipts {
		copy := &governanceTypeReceipt{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
		for path, value := range pending.barrierReads {
			copy.barrierReads[path] = value
		}
		for key, value := range pending.barrierObservations {
			copy.barrierObservations[key] = value
		}
		expected.typeReceipts = append(expected.typeReceipts, copy)
	}
	if source.compiler != nil {
		source.compiler.mu.Lock()
		expected.compiler = &compilerInputFS{disk: source.compiler.disk, observed: map[compilerInputKey]string{}, inconsistent: source.compiler.inconsistent}
		for key, value := range source.compiler.observed {
			expected.compiler.observed[key] = value
		}
		actualRaw := &governanceTypeReceipt{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
		for path, value := range source.compiler.rawReads {
			actualRaw.barrierReads[path] = value
		}
		expected.typeReceipts = append(expected.typeReceipts, actualRaw)
		source.compiler.mu.Unlock()
	}
	return expected
}

func (session *governanceSession) retainSealedDecisions(state *governanceProductsSession) {
	// Only completed cells are eligible. Missing canonical leaves and public
	// ambiguity are different: an authoritative ambiguity is a complete value.
	if len(state.Requirements) != 0 || len(state.RuleReady) == 0 || len(state.RuntimeReady) != 3 {
		return
	}
	rules, err := json.Marshal(state.RuleReady)
	if err != nil {
		return
	}
	runtime, err := json.Marshal(state.RuntimeReady)
	if err != nil {
		return
	}
	session.sealedDecisions = &governanceSealedDecisions{
		prepare:   governanceDecisionPrepareKey(state.Prepare),
		policy:    string(stableJSON(state.Project.Policy)) + string(stableJSON(state.Project.Disabled)) + state.Project.policyDigest,
		contracts: string(stableJSON(state.Contracts)), neutral: state.NeutralLeaf,
		sources: governanceDecisionSources(state.Project), rules: rules, runtime: runtime,
		expected: governanceExpectedCapture(state.Project.capture),
	}
	session.sealedDecisions.leaves, _ = json.Marshal(state.LeafInputs)
	session.sealedDecisions.answers, _ = json.Marshal(state.Answers)
}

func (session *governanceSession) proposeSealedDecisions(state *governanceProductsSession) bool {
	sealed := session.sealedDecisions
	if sealed == nil || sealed.prepare != governanceDecisionPrepareKey(state.Prepare) || sealed.policy != string(stableJSON(state.Project.Policy))+string(stableJSON(state.Project.Disabled))+state.Project.policyDigest || sealed.contracts != string(stableJSON(state.Contracts)) || sealed.neutral != state.NeutralLeaf || sealed.sources != governanceDecisionSources(state.Project) {
		return false
	}
	// Compare overlaps with actual current observations before proposing cells.
	// Unread old observations remain expected until the final uncached barrier.
	for key, now := range state.Project.capture.observations {
		if before, ok := sealed.expected.observations[key]; ok && before != now {
			return false
		}
	}
	for key, now := range state.Project.capture.probeObservations {
		if before, ok := sealed.expected.probeObservations[key]; ok && before != now {
			return false
		}
	}
	var rules, runtime map[string]governanceOutcome
	if json.Unmarshal(sealed.rules, &rules) != nil || json.Unmarshal(sealed.runtime, &runtime) != nil {
		return false
	}
	state.RuleReady, state.RuntimeReady, state.ReplayExpected = rules, runtime, sealed.expected
	var leaves map[string]governanceIntrinsic
	if json.Unmarshal(sealed.leaves, &leaves) != nil || json.Unmarshal(sealed.answers, &state.ReplayAnswers) != nil {
		state.RuleReady, state.RuntimeReady, state.ReplayExpected = nil, nil, nil
		return false
	}
	// Re-observe leaf inputs with the current canonical JS owner. Contract
	// identity alone does not certify a callback's current returned meaning.
	ids := make([]string, 0, len(leaves))
	for id := range leaves {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		state.require(leaves[id])
	}
	return true
}

func (session *governanceSession) observeSealedLeaf(state *governanceProductsSession, answer governanceIntrinsicAnswer) {
	if state.ReplayAnswers == nil {
		return
	}
	if before, ok := state.ReplayAnswers[answer.ID]; ok && stableJSON(before) == stableJSON(answer) {
		return
	}
	state.RuleReady, state.RuntimeReady = nil, nil
	state.ReplayExpected = nil
	session.sealedDecisions = nil
}
