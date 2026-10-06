package main

import (
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"strings"
)

// This owner exists only during one current capture. The old base and journal
// identity are immutable; neither retains an old FS, project, AST or checker.
type governanceTypeReplayKey struct {
	base   *governanceTypeReceiptBase
	origin *compilerInputJournal
	cache  *governanceTypeDemandCache
}
type governanceTypeReplayComparison struct {
	base                              *governanceTypeReceiptBase
	actualReads                       map[string]compilerRawRead
	actualObservations                map[compilerInputKey]string
	authored                          map[string]bool
	currentReads, currentObservations int
	sourceReads                       map[string]compilerRawRead
	changed, badSources               map[string]bool
	prefix                            compilerInputPrefix
	readIndexes                       map[string][]int
	observationIndexes                map[compilerInputKey][]int
	readValues                        []compilerRawRead
	observationValues                 []string
	badReads, badObservations         map[int]bool
	// Each prefix records the largest raw frontier its observed reads require.
	// Missing raw rows remain separate, preserving raw-before-observed snapshots.
	requiredReads                       []int
	missingReads                        []int
	metadata                            []int
	dirtyReads                          map[string]bool
	dirtyObservations                   map[compilerInputKey]bool
	hasAssertions                       bool
	acceptedReads, acceptedObservations int
}

func newGovernanceTypeReplayComparison(base *governanceTypeReceiptBase, project *governedProject) *governanceTypeReplayComparison {
	if base == nil || base.root != project.Root || project.capture == nil || project.capture.compiler == nil {
		return nil
	}
	state := &governanceTypeReplayComparison{
		base: base, actualReads: map[string]compilerRawRead{}, actualObservations: map[compilerInputKey]string{}, authored: map[string]bool{},
		sourceReads: map[string]compilerRawRead{}, changed: map[string]bool{}, badSources: map[string]bool{},
		readIndexes: map[string][]int{}, observationIndexes: map[compilerInputKey][]int{}, badReads: map[int]bool{}, badObservations: map[int]bool{},
		dirtyReads: map[string]bool{}, dirtyObservations: map[compilerInputKey]bool{},
	}
	fs := project.capture.compiler
	fs.mu.Lock()
	for key, cell := range fs.operations {
		if key.kind == inputRead && cell.value != nil {
			state.actualReads[key.path] = cell.value.(compilerCapturedValue[compilerRawRead]).value
		}
		if cell.observed {
			state.actualObservations[key] = cell.observation
		}
	}
	state.currentReads, state.currentObservations = len(fs.prefix.reads), len(fs.prefix.observations)
	fs.mu.Unlock()
	for _, file := range project.Files {
		state.actualReads[file.AbsolutePath] = compilerRawRead{file.Text, true}
		state.authored[file.AbsolutePath] = true
	}
	for path := range base.sources {
		state.classifySource(path)
	}
	return state
}

func (state *governanceTypeReplayComparison) classifySource(path string) {
	old, source := state.base.sources[path]
	if !source {
		return
	}
	current, actual := state.actualReads[path]
	if !actual {
		current = compilerRawRead{old.text, true}
	}
	state.sourceReads[path] = current
	delete(state.changed, path)
	delete(state.badSources, path)
	if !current.present {
		state.badSources[path] = true
		return
	}
	if current.text == old.text {
		return
	}
	if !old.ordinary {
		state.badSources[path] = true
		return
	}
	kind := core.ScriptKindTS
	if strings.HasSuffix(strings.ToLower(path), ".tsx") {
		kind = core.ScriptKindTSX
	}
	parsed := parser.ParseSourceFile(old.options, current.text, kind)
	if !governanceOrdinaryTypeSource(parsed) || governanceTypeReferenceSyntax(parsed) != old.references || !governanceTypeLiteralFidelity(parsed) {
		state.badSources[path] = true
		return
	}
	state.changed[path] = true
}

// Consume only new actual first-value rows. Expected fallbacks never enter FS.
func (state *governanceTypeReplayComparison) advance(project *governedProject) {
	fs := project.capture.compiler
	fs.mu.Lock()
	reads := append([]compilerRawInput(nil), fs.prefix.reads[state.currentReads:]...)
	observations := append([]compilerInputObservation(nil), fs.prefix.observations[state.currentObservations:]...)
	state.currentReads, state.currentObservations = len(fs.prefix.reads), len(fs.prefix.observations)
	fs.mu.Unlock()
	for _, row := range reads {
		if state.authored[row.path] {
			continue
		} // Original authored overlay wins.
		state.actualReads[row.path] = row.value
		state.classifySource(row.path)
		state.dirtyReads[row.path] = true
		for _, index := range state.readIndexes[row.path] {
			state.compareRead(index)
		}
		for _, index := range state.observationIndexes[compilerInputKey{row.path, inputMetadata}] {
			state.compareObservation(index)
		}
	}
	for _, row := range observations {
		state.actualObservations[row.key] = row.before
		state.dirtyObservations[row.key] = true
		for _, index := range state.observationIndexes[row.key] {
			state.compareObservation(index)
		}
	}
}

func (state *governanceTypeReplayComparison) compareRead(index int) {
	row := state.prefix.reads[index]
	current, actual := state.actualReads[row.path]
	if !actual {
		if source, exists := state.sourceReads[row.path]; exists {
			current = source
		} else {
			current = row.value
			for _, before := range state.readIndexes[row.path] {
				if before >= index {
					break
				}
				current = state.readValues[before]
			}
		}
	}
	state.readValues[index] = current
	if current != row.value && !state.changed[row.path] {
		state.badReads[index] = true
	} else {
		delete(state.badReads, index)
	}
}
func (state *governanceTypeReplayComparison) compareObservation(index int) {
	row := state.prefix.observations[index]
	current, actual := state.actualObservations[row.key]
	if !actual {
		current = row.before
	}
	state.observationValues[index] = current
	if row.key.kind != inputRead && !(row.key.kind == inputMetadata && state.changed[row.key.path]) && current != row.before {
		state.badObservations[index] = true
	} else {
		delete(state.badObservations, index)
	}
}

// Capped prefixes borrow one original first-value journal. Only newly exposed
// rows are indexed/compared; equal lengths from distinct journals never share.
func (state *governanceTypeReplayComparison) extend(prefix compilerInputPrefix) {
	readStart, observationStart := len(state.prefix.reads), len(state.prefix.observations)
	if len(prefix.reads) > readStart {
		state.prefix.reads = prefix.reads
	}
	if len(prefix.observations) > observationStart {
		state.prefix.observations = prefix.observations
	}
	for index := readStart; index < len(state.prefix.reads); index++ {
		row := state.prefix.reads[index]
		state.readIndexes[row.path] = append(state.readIndexes[row.path], index)
		state.readValues = append(state.readValues, compilerRawRead{})
		state.compareRead(index)
	}
	for index := observationStart; index < len(state.prefix.observations); index++ {
		row := state.prefix.observations[index]
		state.observationIndexes[row.key] = append(state.observationIndexes[row.key], index)
		state.observationValues = append(state.observationValues, "")
		state.compareObservation(index)
		required := 0
		if index > 0 {
			required = state.requiredReads[index-1]
		}
		if row.key.kind == inputRead {
			if indexes := state.readIndexes[row.key.path]; len(indexes) > 0 {
				if indexes[0]+1 > required {
					required = indexes[0] + 1
				}
			} else {
				state.missingReads = append(state.missingReads, index)
			}
		}
		state.requiredReads = append(state.requiredReads, required)
		if row.key.kind == inputMetadata {
			state.metadata = append(state.metadata, index)
		}
	}
}

func (state *governanceTypeReplayComparison) prepare(receipt *governanceTypeReceipt, project *governedProject) (*governanceCompilerReadAssertions, bool) {
	// Common classification is not demand authority: retain the original full
	// referenced/global closure and all current source validity guards per ask.
	if len(state.badSources) != 0 {
		return nil, false
	}
	needed := receipt.neededSources()
	for path := range state.changed {
		if needed[path] {
			return nil, false
		}
	}
	for index := range state.badReads {
		if index < len(receipt.prefix.reads) {
			return nil, false
		}
	}
	firstFailure := len(receipt.prefix.observations)
	for index := range state.badObservations {
		if index < firstFailure {
			firstFailure = index
		}
	}
	// Preserve the original position of a missing raw guard relative to fresh
	// metadata. A shorter raw prefix must not borrow a future raw publication.
	if firstFailure > 0 && state.requiredReads[firstFailure-1] > len(receipt.prefix.reads) {
		for index := 0; index < firstFailure; index++ {
			if state.requiredReads[index] > len(receipt.prefix.reads) {
				firstFailure = index
				break
			}
		}
	}
	for _, index := range state.missingReads {
		if index >= firstFailure {
			continue
		}
		indexes := state.readIndexes[state.prefix.observations[index].key.path]
		if len(indexes) == 0 || indexes[0] >= len(receipt.prefix.reads) {
			firstFailure = index
		}
	}
	fresh := map[compilerInputKey]string{}
	fs := project.capture.compiler
	for _, index := range state.metadata {
		if index >= firstFailure {
			break
		}
		key := state.prefix.observations[index].key
		if state.changed[key.path] {
			// Do not memoize this original physical Stat across questions.
			value := observeCompilerInput(fs.disk, key)
			fs.remember(key.path, key.kind, value)
			fresh[key] = value
		}
	}
	if firstFailure != len(receipt.prefix.observations) {
		return nil, false
	}
	// Only a successful receipt returns owned additions. Longer failed prefixes
	// can enrich comparison indexes but cannot promote their unused assertions.
	out := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
	if !state.hasAssertions {
		for path, value := range state.sourceReads {
			out.barrierReads[path] = value
		}
	}
	for path := range state.dirtyReads {
		if value, exists := state.sourceReads[path]; exists {
			out.barrierReads[path] = value
		}
		for _, index := range state.readIndexes[path] {
			if index < len(receipt.prefix.reads) {
				out.barrierReads[path] = state.readValues[index]
			}
		}
	}
	for index := state.acceptedReads; index < len(receipt.prefix.reads); index++ {
		out.barrierReads[state.prefix.reads[index].path] = state.readValues[index]
	}
	for key := range state.dirtyObservations {
		for _, index := range state.observationIndexes[key] {
			if index < len(receipt.prefix.observations) && key.kind != inputRead {
				out.barrierObservations[key] = state.observationValues[index]
			}
		}
	}
	for index := state.acceptedObservations; index < len(receipt.prefix.observations); index++ {
		key := state.prefix.observations[index].key
		if key.kind != inputRead {
			out.barrierObservations[key] = state.observationValues[index]
		}
	}
	for key, value := range fresh {
		out.barrierObservations[key] = value
	}
	return out, true
}

func (state *governanceTypeReplayComparison) accept(prefix compilerInputPrefix) {
	state.hasAssertions = true
	if len(prefix.reads) > state.acceptedReads {
		state.acceptedReads = len(prefix.reads)
	}
	if len(prefix.observations) > state.acceptedObservations {
		state.acceptedObservations = len(prefix.observations)
	}
	for path := range state.dirtyReads {
		_, source := state.sourceReads[path]
		indexes := state.readIndexes[path]
		if source || len(indexes) > 0 && indexes[0] < len(prefix.reads) {
			delete(state.dirtyReads, path)
		}
	}
	for key := range state.dirtyObservations {
		indexes := state.observationIndexes[key]
		if len(indexes) > 0 && indexes[0] < len(prefix.observations) {
			delete(state.dirtyObservations, key)
		}
	}
}

func (receipt *governanceTypeReceipt) replayForCache(project *governedProject, cache *governanceTypeDemandCache) (*governanceCompilerReadAssertions, *governanceTypeReplayComparison, bool) {
	capture := project.capture
	if capture == nil || capture.compiler == nil {
		return nil, nil, false
	}
	key := governanceTypeReplayKey{receipt.base, receipt.prefix.origin, cache}
	var state *governanceTypeReplayComparison
	// Legacy/non-provenance inputs get a fresh comparison, not guessed sharing.
	if receipt.prefix.origin != nil && capture.compiler.singleCapture {
		if capture.typeReplayComparisons == nil {
			capture.typeReplayComparisons = map[governanceTypeReplayKey]*governanceTypeReplayComparison{}
		}
		state = capture.typeReplayComparisons[key]
	}
	if state == nil {
		state = newGovernanceTypeReplayComparison(receipt.base, project)
		if state == nil {
			return nil, nil, false
		}
		if receipt.prefix.origin != nil && capture.compiler.singleCapture {
			capture.typeReplayComparisons[key] = state
		}
	} else {
		state.advance(project)
	}
	state.extend(receipt.prefix)
	out, valid := state.prepare(receipt, project)
	return out, state, valid
}
