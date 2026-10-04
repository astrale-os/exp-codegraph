package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"unicode/utf8"
)

// An offered private owner extends the original products protocol. Unknown offers
// are unsupported, not malformed user options; older callers retain fallback.
func governanceClosedSourceOffered(raw json.RawMessage) bool {
	var options struct {
		Revision json.RawMessage `json:"sourcePolicyOwnerRevision"`
	}
	var revision int
	return json.Unmarshal(raw, &options) == nil &&
		json.Unmarshal(options.Revision, &revision) == nil && revision == 2
}

const governanceClosedSourceLimit = 32 * 1024 * 1024

// Compact only this source wire. Canonical evidence and digest strings stay unchanged.
func governanceSourceWireText(text string) (json.RawMessage, uint64, error) {
	if !utf8.ValidString(text) {
		bytes, err := json.Marshal(jsstring.JSONText(text))
		return bytes, 0, err
	}
	var units uint64
	for _, scalar := range text {
		units++
		if scalar > 0xffff {
			units++
		}
	}
	bytes, err := json.Marshal(text)
	// Saturate only excess admission cost, avoiding overflow while preserving the bound.
	extra := uint64(governanceClosedSourceLimit + 1)
	if units <= (uint64(len(bytes))+governanceClosedSourceLimit-2)/6 {
		extra = 2 + 6*units - uint64(len(bytes))
	}
	return bytes, extra, err
}

// The capture finishes its private authored body before the first handoff. No
// producer writes that body afterward; current filesystem validity remains the seal.
// This descriptor retains only its existing owner identity and original size charge.
type governanceSourceBodyOwner struct {
	project                         *governedProject
	token, generation, digest, root string
	legacyLength                    uint64
	opened, projected               bool
}

func (owner *governanceSourceBodyOwner) matches(state *governanceProductsSession) bool {
	return owner != nil && state.Project != nil && owner.project == state.Project &&
		owner.token == state.Token && owner.generation == state.Generation &&
		owner.digest == state.Project.GovernanceDigest && owner.root == state.Project.Root
}

func (session *governanceSession) openClosedSource(token, generation, digest string) error {
	state := session.productsSession
	if state == nil || session.policyLane != nil || state.Project == nil || state.Token != token ||
		state.Generation != generation || state.Project.GovernanceDigest != digest ||
		state.ProductsDigest != "" || state.SourceProducts != nil ||
		!state.sourceBody.matches(state) || state.sourceBody.opened {
		return fmt.Errorf("opened source does not own its admitting phase")
	}
	state.sourceBody.opened = true
	return nil
}

// This is an experimental private suspension, never a partially admitted report.
// It precedes ProductsDigest. The existing lane transfers the same owner back.
func (session *governanceSession) closedSourceHandoff(withResolutionInputs bool) (any, error) {
	state := session.productsSession
	if state == nil || !governanceClosedSourceOffered(state.Prepare.Options) || state.Project == nil || state.ProductsDigest != "" {
		return nil, fmt.Errorf("closed source handoff lacks an admitting owner")
	}
	project := state.Project
	if project.capture.probeInconsistent {
		session.discardProducts()
		return map[string]any{"status": "partial", "residual": []string{"Captured generic I/O observations changed or exceeded authority bounds."}}, nil
	}
	if withResolutionInputs && state.sourceBody != nil {
		state.sourceBody.projected = false // Failed fresh export cannot retain an earlier phase permit.
	}
	metadata := map[string]*string{}
	for _, name := range []string{"package.json", "tsconfig.json", "pnpm-workspace.yaml"} {
		path := filepath.Join(project.Root, name)
		cell, captured := project.capture.byteCells[path]
		if !captured {
			if project.capture.observations["read\000"+path].Value != "absent" {
				return nil, fmt.Errorf("closed source root metadata was not captured: %s", name)
			}
			metadata[name] = nil
			continue
		}
		if cell.err != nil {
			return nil, cell.err
		}
		if cell.bytes == nil {
			metadata[name] = nil
		} else if !withResolutionInputs {
			text := base64.StdEncoding.EncodeToString(cell.bytes)
			metadata[name] = &text
		}
	}
	if withResolutionInputs {
		if session.policyLane != nil || state.SourceProducts != nil {
			return nil, fmt.Errorf("closed input frame lacks exclusive admitting owner")
		}
		if !state.sourceBody.matches(state) || !state.sourceBody.opened {
			return nil, fmt.Errorf("closed source projection lacks an opened body")
		}
		inputs := session.closedSourceResolutionInputs()
		encoded, err := json.Marshal(inputs)
		if err != nil {
			return nil, err
		}
		// Exact original second-frame charge without constructing its source body.
		added := uint64(len(",\"resolutionInputs\":")) + uint64(len(encoded))
		if added > governanceClosedSourceLimit-state.sourceBody.legacyLength {
			return governanceSourceFrameOverflow(), nil
		}
		frame := map[string]any{"status": "source-projection", "token": state.Token,
			"generation": state.Generation, "sourceSnapshotDigest": project.GovernanceDigest,
			"root": project.Root, "resolutionInputs": inputs}
		// Removed mandatory body fields exceed the 11-byte status-name increase.
		// Thus the thin physical frame is smaller than the already bounded old frame.
		state.sourceBody.projected = true
		return frame, nil
	}
	if state.sourceBody != nil {
		return nil, fmt.Errorf("closed source body was already admitted")
	}
	rows := []map[string]any{}
	for _, file := range project.Files {
		rows = append(rows, map[string]any{"path": file.Path, "absolutePath": file.AbsolutePath, "text": jsstring.JSONText(file.Text)})
	}
	frame := map[string]any{
		"status": "source", "token": state.Token, "generation": state.Generation,
		"sourceSnapshotDigest": project.GovernanceDigest, "root": project.Root,
		"rootEntries": append([]string{}, project.RootEntries...), "files": rows,
		"compilerValid": project.compilerValid, "verbatimModuleSyntax": project.verbatim,
		"rootMetadata": metadata,
	}
	// Convert after every original metadata/projection guard, at the marshal frontier.
	var legacyExtra uint64
	for index, file := range project.Files {
		text, extra, err := governanceSourceWireText(file.Text)
		if err != nil {
			return nil, err
		}
		rows[index]["text"] = text
		if legacyExtra > governanceClosedSourceLimit || extra > governanceClosedSourceLimit-legacyExtra {
			legacyExtra = governanceClosedSourceLimit + 1
		} else {
			legacyExtra += extra
		}
	}
	bytes, err := json.Marshal(frame)
	if err != nil {
		return nil, err
	}
	if len(bytes) > governanceClosedSourceLimit || legacyExtra > uint64(governanceClosedSourceLimit-len(bytes)) {
		return governanceSourceFrameOverflow(), nil
	}
	state.sourceBody = &governanceSourceBodyOwner{project: project, token: state.Token,
		generation: state.Generation, digest: project.GovernanceDigest, root: project.Root,
		legacyLength: uint64(len(bytes)) + legacyExtra}
	return frame, nil
}

func governanceSourceFrameOverflow() map[string]any {
	return map[string]any{"status": "partial", "residual": []string{"Captured source frame exceeds original private payload admission bound."}}
}
