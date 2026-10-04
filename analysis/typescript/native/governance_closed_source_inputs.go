package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

// Only the private original TS resolver supplies operations. Its exact UTF16
// operand is lowered to an OS path before any current-owner cell is consumed.
type governanceClosedSourceInputRequest struct {
	Operation string
	PathUnits []uint16
}
type governanceClosedSourceInputs struct {
	Revision             int    `json:"revision"`
	Status               string `json:"status"`
	Token                string `json:"token"`
	Generation           string `json:"generation"`
	SourceSnapshotDigest string `json:"sourceSnapshotDigest"`
	Reason               string `json:"reason,omitempty"`
	compilerResolutionInputs
}

func (session *governanceSession) closedSourceResolutionInputs() governanceClosedSourceInputs {
	state := session.productsSession
	project := state.Project
	result := governanceClosedSourceInputs{Revision: 1, Status: "unavailable", Token: state.Token, Generation: state.Generation, SourceSnapshotDigest: project.GovernanceDigest, compilerResolutionInputs: compilerResolutionInputs{Root: project.Root}}
	capture := project.capture
	if !capture.liveResolutionInputOwner() {
		result.Reason = "Captured compiler input authority unavailable."
		return result
	}
	result.UseCaseSensitiveFileNames = capture.compiler.UseCaseSensitiveFileNames()
	if !capture.metadataFidelity() {
		result.Reason = "Captured compiler input authority unavailable."
		return result
	}
	// Metadata roles were recorded by the original JSON config/package reader.
	// Copy only its path inventory; no configuration/checker/FS operation runs here.
	capture.compiler.mu.Lock()
	configs := make([]string, 0, len(capture.compiler.metadataPaths))
	for path := range capture.compiler.metadataPaths {
		configs = append(configs, path)
	}
	capture.compiler.mu.Unlock()
	inputs, ok := capture.resolutionInputs(configs)
	if !ok {
		result.Reason = "Captured compiler input projection unavailable."
		return result
	}
	// Uncovered rows are invitations to first consumption, never false facts.
	for index := range inputs.Rows {
		row := &inputs.Rows[index]
		if row.Operation == "read" && row.Unavailable == "" && !capture.resolutionReadCorresponds(row.Path) {
			row.Base64, row.Boolean = nil, nil
			row.Unavailable = "Captured raw/decoded read correspondence unavailable."
		}
	}
	if capture.probeInconsistent {
		result.Reason = "Captured input observations contradict their owner."
		return result
	}
	result.Status, result.compilerResolutionInputs = "known", inputs
	return result
}

func (capture *governanceCapture) liveResolutionInputOwner() bool {
	fs := capture.compiler
	return fs != nil && fs.singleCapture && governanceOriginalCompilerBarrierOwner(fs.disk) && fs.FS == fs.disk && !capture.probeInconsistent && !fs.inconsistent
}

// UTF8 original authored reads expose the exact raw string (including BOM and
// invalid byte sequences). UTF16's separate decoder cannot prove a first-byte
// origin; this live boundary declines rather than reconstructing its bytes.
func (capture *governanceCapture) resolutionReadCorresponds(path string) bool {
	fs := capture.compiler
	fs.mu.Lock()
	value, completed := fs.rawReads[path]
	fs.mu.Unlock()
	raw, captured := capture.byteCells[path]
	if !completed || !captured {
		return false
	}
	if raw.err != nil {
		if value.present {
			capture.probeInconsistent = true
		}
		return !value.present
	}
	if len(raw.bytes) >= 2 && (raw.bytes[0] == 0xff && raw.bytes[1] == 0xfe || raw.bytes[0] == 0xfe && raw.bytes[1] == 0xff) {
		return false
	}
	if !value.present || value.text != string(raw.bytes) {
		capture.probeInconsistent = true
		return false
	}
	return true
}

func (session *governanceSession) observeClosedSourceInput(request governanceClosedSourceRequest) (governanceClosedSourceAnswer, error) {
	state := session.productsSession
	if state == nil || !governanceClosedSourceOffered(state.Prepare.Options) || state.Token != request.Token || state.Generation != request.Generation {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed input attempt is retired")
	}
	answer := governanceClosedSourceAnswer{Status: "pending", Token: state.Token, Generation: state.Generation, SourceSnapshotDigest: request.SourceSnapshotDigest}
	if session.policyLane != nil {
		return answer, nil
	}
	if state.Project == nil || state.ProductsDigest != "" || state.SourceProducts != nil {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed input owner is not admitting observations")
	}
	project := state.Project
	if project.GovernanceDigest != request.SourceSnapshotDigest || project.FilesByPath[request.Path] == nil {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed input caller does not own captured source")
	}
	if !state.sourceBody.matches(state) || !state.sourceBody.opened || !state.sourceBody.projected {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed input observation lacks an admitted projection")
	}
	unavailable := func(reason string) (governanceClosedSourceAnswer, error) {
		answer.Status, answer.Reason = "unavailable", reason
		return answer, nil
	}
	if request.Input == nil {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed input operation is missing")
	}
	operand := jsstring.FromUnits(request.Input.PathUnits)
	path := operand.WTF8()
	if !operand.ValidUnicode() || !filepath.IsAbs(path) || strings.IndexByte(path, 0) >= 0 {
		return unavailable("Captured input OS-path authority unavailable.")
	}
	kinds := map[string]compilerInputKind{"read": inputRead, "file": inputFile, "directory": inputDirectory, "entries": inputEnumeration, "realpath": inputRealpath}
	kind, valid := kinds[request.Input.Operation]
	if !valid {
		return governanceClosedSourceAnswer{}, fmt.Errorf("unknown closed input operation")
	}
	capture := project.capture
	if !capture.liveResolutionInputOwner() || !capture.metadataFidelity() {
		return unavailable("Captured compiler input authority unavailable.")
	}
	fs := capture.compiler
	key := compilerInputKey{path, kind}
	if kind == inputRead {
		fs.mu.Lock()
		metadata := fs.metadataPaths[path]
		fs.mu.Unlock()
		if !metadata && !strings.EqualFold(filepath.Base(path), "package.json") && !strings.EqualFold(filepath.Ext(path), ".json") {
			return unavailable("Resolution read lacks JSON metadata authority.")
		}
	}
	switch kind {
	case inputRead:
		// Existing completed reads keep their original value. Missing reads lend the
		// SAME raw capture cell to the unchanged original authored decoder boundary.
		captureCompilerOperation(fs, key, func() compilerRawRead {
			text, present := fs.readFileFrom(path, func(path string) (string, bool) {
				text, err := readAuthoredSourceFileFrom(path, fs.disk.(*authoredCompilerDisk).decoder, capture.read)
				return text, err == nil
			})
			return compilerRawRead{text, present}
		})
		// The original reader reports failure as undefined. This retains its
		// actual raw negative/error guard and distinct original failure details.
		_, _ = capture.read(path)
		if !capture.resolutionReadCorresponds(path) {
			return unavailable("Captured raw/decoded read correspondence unavailable.")
		}
		text, present := fs.ReadFile(path)
		if present {
			fs.certifyJSON(path, text)
		}
	case inputFile:
		if fs.FileExists(path) {
			fs.regularity(path)
		}
	case inputDirectory:
		fs.DirectoryExists(path)
	case inputEnumeration:
		fs.GetAccessibleEntries(path)
	case inputRealpath:
		fs.Realpath(path)
	}
	if !capture.liveResolutionInputOwner() || !capture.metadataFidelity() {
		return unavailable("Captured compiler input observations changed or lost authority.")
	}
	fs.mu.Lock()
	cell := fs.operations[key]
	var row compilerResolutionInput
	var covered bool
	if cell != nil && cell.value != nil {
		row, covered = capture.resolutionInputLocked(key, cell, map[string]bool{path: true})
	}
	fs.mu.Unlock()
	if !covered || row.Unavailable != "" {
		return unavailable("Captured compiler input projection unavailable.")
	}
	answer.Status, answer.Row = "known", &row
	encoded, err := json.Marshal(answer)
	if err != nil {
		return governanceClosedSourceAnswer{}, err
	}
	if len(encoded) > 32*1024*1024 {
		answer.Row = nil
		return unavailable("Captured input exceeds original private payload admission bound.")
	}
	return answer, nil
}
