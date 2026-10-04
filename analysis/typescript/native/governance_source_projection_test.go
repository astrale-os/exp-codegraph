package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Direct scalar fixtures enter the same admission/open/projection guards as the
// dispatcher, without inventing SDK decisions or executing unrelated rules.
func governanceSourceObservationFixture(t *testing.T, session *governanceSession) {
	t.Helper()
	state := session.productsSession
	if state.sourceBody == nil {
		first, err := session.closedSourceHandoff(false)
		if err != nil || first.(map[string]any)["status"] != "source" {
			t.Fatalf("source fixture first admission: %#v %v", first, err)
		}
	}
	if !state.sourceBody.opened {
		if err := session.openClosedSource(state.Token, state.Generation, state.Project.GovernanceDigest); err != nil {
			t.Fatal(err)
		}
	}
	if !state.sourceBody.projected {
		projection, err := session.closedSourceHandoff(true)
		if err != nil || projection.(map[string]any)["status"] != "source-projection" {
			t.Fatalf("source fixture projection: %#v %v", projection, err)
		}
	}
}

func TestSourceProjectionRejectsForeignAndOutOfOrderOwners(t *testing.T) {
	for _, kind := range []string{"no-first", "token", "generation", "digest", "project", "duplicate-open", "projection-before-open", "observation-before-projection", "completion-before-projection", "retired"} {
		t.Run(kind, func(t *testing.T) {
			session, _ := liveInputSession(t, nil)
			state := session.productsSession
			token, generation, digest := state.Token, state.Generation, state.Project.GovernanceDigest
			if kind != "no-first" {
				if _, err := session.closedSourceHandoff(false); err != nil {
					t.Fatal(err)
				}
			}
			compiler := state.Project.capture.compiler
			before := len(compiler.operations)
			var err error
			switch kind {
			case "token":
				token = "foreign"
			case "generation":
				generation = "retired"
			case "digest":
				digest = "foreign"
			case "project":
				foreign := *state.Project // Equal body/digest is not this admitted owner.
				state.Project = &foreign
			case "duplicate-open", "observation-before-projection", "completion-before-projection":
				if err := session.openClosedSource(token, generation, digest); err != nil {
					t.Fatal(err)
				}
			case "retired":
				session.discardProducts()
			}
			switch kind {
			case "projection-before-open":
				_, err = session.closedSourceHandoff(true)
			case "observation-before-projection":
				_, err = session.observeClosedSource(governanceClosedSourceRequest{Token: token, Generation: generation, SourceSnapshotDigest: digest, Path: "index.ts", Operation: "resolve"})
			case "completion-before-projection":
				raw, _ := json.Marshal(map[string]any{"token": token, "generation": generation, "sourceSnapshotDigest": digest, "decisions": []any{}})
				_, err = session.completeClosedSource(raw)
			default:
				err = session.openClosedSource(token, generation, digest)
			}
			if err == nil || state.SourceProducts != nil || state.ProductsDigest != "" || len(compiler.operations) != before {
				t.Fatalf("foreign/out-of-order request reached computation: %s %v", kind, err)
			}
		})
	}
}

func TestSourceProjectionRetainsExactOriginalSecondThreshold(t *testing.T) {
	for _, offset := range []int{-1, 0, 1} {
		t.Run([]string{"below", "equal", "above"}[offset+1], func(t *testing.T) {
			session, _ := liveInputSession(t, nil)
			state, project := session.productsSession, session.productsSession.Project
			project.Files[0].Text = ""
			first, err := session.closedSourceHandoff(false)
			if err != nil {
				t.Fatal(err)
			}
			frame := first.(map[string]any)
			frame["resolutionInputs"] = session.closedSourceResolutionInputs()
			padding := governanceClosedSourceLimit + offset - len(sourceWireLegacyFrame(t, frame, session))
			// Only this pre-admission size fixture is rebuilt; no admitted body mutates.
			state.sourceBody = nil
			project.Files[0].Text = strings.Repeat("x", padding/6)
			project.RootEntries[0] += strings.Repeat("p", padding%6)
			frame["rootEntries"] = append([]string{}, project.RootEntries...)
			oldLength := len(sourceWireLegacyFrame(t, frame, session))
			if oldLength != governanceClosedSourceLimit+offset {
				t.Fatalf("old boundary=%d", oldLength)
			}
			if _, err := session.closedSourceHandoff(false); err != nil {
				t.Fatal(err)
			}
			if err := session.openClosedSource(state.Token, state.Generation, project.GovernanceDigest); err != nil {
				t.Fatal(err)
			}
			result, err := session.closedSourceHandoff(true)
			if err != nil {
				t.Fatal(err)
			}
			out := result.(map[string]any)
			if offset > 0 {
				if !reflect.DeepEqual(out, governanceSourceFrameOverflow()) || state.sourceBody.projected {
					t.Fatal("old oversized second frame admitted")
				}
				return
			}
			if out["status"] != "source-projection" || len(out) != 6 {
				t.Fatal("projection shape changed", out)
			}
			encoded, err := json.Marshal(out)
			if err != nil || len(encoded) > oldLength {
				t.Fatalf("thin frame exceeds old physical charge: %d/%d %v", len(encoded), oldLength, err)
			}
			inputs, _ := json.Marshal(out["resolutionInputs"])
			if state.sourceBody.legacyLength+uint64(len(",\"resolutionInputs\":"))+uint64(len(inputs)) != uint64(oldLength) {
				t.Fatal("retained charge differs from original full serializer")
			}
		})
	}
}

func TestSourceProjectionMinimumBodyAndWTF8KeepOriginalCharge(t *testing.T) {
	for _, text := range []string{"", "é😀", "a\xed\xa0\x80z", "\xed\xb0\x80"} {
		t.Run(text, func(t *testing.T) {
			session, _ := liveInputSession(t, nil)
			session.productsSession.Project.Files[0].Text = text
			first, err := session.closedSourceHandoff(false)
			if err != nil {
				t.Fatal(err)
			}
			original := sourceWireLegacyFrame(t, first.(map[string]any), session)
			if session.productsSession.sourceBody.legacyLength != uint64(len(original)) {
				t.Fatal("first canonical charge changed")
			}
			governanceSourceObservationFixture(t, session)
			projection, err := session.closedSourceHandoff(true)
			if err != nil {
				t.Fatal(err)
			}
			old := first.(map[string]any)
			old["resolutionInputs"] = projection.(map[string]any)["resolutionInputs"]
			full := sourceWireLegacyFrame(t, old, session)
			thin, _ := json.Marshal(projection)
			if len(thin) >= len(full) {
				t.Fatal("projection no longer fits under old frame charge")
			}
		})
	}
	// Empty captured body still removes more syntax than the new status adds.
	session, _ := liveInputSession(t, nil)
	session.productsSession.Project.Files = nil
	first, err := session.closedSourceHandoff(false)
	if err != nil {
		t.Fatal(err)
	}
	governanceSourceObservationFixture(t, session)
	projection, err := session.closedSourceHandoff(true)
	if err != nil {
		t.Fatal(err)
	}
	first.(map[string]any)["resolutionInputs"] = projection.(map[string]any)["resolutionInputs"]
	full, _ := json.Marshal(first)
	thin, _ := json.Marshal(projection)
	if len(thin) >= len(full) {
		t.Fatal("empty-body physical dominance failed")
	}
}

func TestSourceProjectionNeverRetainsReplyAliasesOrLateFidelity(t *testing.T) {
	session, _ := liveInputSession(t, nil)
	governanceSourceObservationFixture(t, session)
	first, err := session.closedSourceHandoff(true)
	if err != nil {
		t.Fatal(err)
	}
	frame := first.(map[string]any)
	inputs := frame["resolutionInputs"].(governanceClosedSourceInputs)
	if len(inputs.Rows) == 0 {
		t.Fatal("actual compiler rows required")
	}
	originalPath := inputs.Rows[0].Path
	inputs.Rows[0].Path = "foreign"
	frame["token"], frame["files"] = "foreign", []any{}
	next, err := session.closedSourceHandoff(true)
	if err != nil {
		t.Fatal(err)
	}
	current := next.(map[string]any)
	rows := current["resolutionInputs"].(governanceClosedSourceInputs)
	if len(current) != 6 || current["token"] != session.productsSession.Token || rows.Rows[0].Path != originalPath {
		t.Fatal("projection reply mutation escaped into owner")
	}
	compiler := session.productsSession.Project.capture.compiler
	compiler.mu.Lock()
	compiler.metadataLossy = true
	compiler.mu.Unlock()
	late, err := session.closedSourceHandoff(true)
	if err != nil || late.(map[string]any)["resolutionInputs"].(governanceClosedSourceInputs).Status != "unavailable" {
		t.Fatalf("late fidelity hidden: %#v %v", late, err)
	}
	if session.productsSession.SourceProducts != nil {
		t.Fatal("failed fresh projection promoted decisions")
	}
}

func TestSourceAdmissionDoesNotReplaceFreshFilesystemSeal(t *testing.T) {
	for _, mutation := range []string{"text-before-projection", "text-after-projection", "added-file", "removed-file", "root-metadata"} {
		t.Run(mutation, func(t *testing.T) {
			session, root := liveInputSession(t, nil)
			state := session.productsSession
			first, err := session.closedSourceHandoff(false)
			if err != nil {
				t.Fatal(err)
			}
			if err := session.openClosedSource(state.Token, state.Generation, state.Project.GovernanceDigest); err != nil {
				t.Fatal(err)
			}
			if mutation != "text-before-projection" {
				if _, err := session.closedSourceHandoff(true); err != nil {
					t.Fatal(err)
				}
			}
			switch mutation {
			case "text-before-projection", "text-after-projection":
				governanceWrite(t, root, "index.ts", "export const changed=1")
			case "added-file":
				governanceWrite(t, root, "new.ts", "export {}")
			case "removed-file":
				if err := os.Remove(filepath.Join(root, "index.ts")); err != nil {
					t.Fatal(err)
				}
			case "root-metadata":
				governanceWrite(t, root, "tsconfig.json", "{\"include\":[]}")
			}
			projection, err := session.closedSourceHandoff(true)
			if err != nil || projection.(map[string]any)["status"] != "source-projection" {
				t.Fatalf("projection reread authored body: %#v %v", projection, err)
			}
			text := first.(map[string]any)["files"].([]map[string]any)[0]["text"].(json.RawMessage)
			want, _ := json.Marshal("export {}")
			if string(text) != string(want) {
				t.Fatal("first body changed with current disk")
			}
			state.ProductsDigest = strings.Repeat("a", 64) // Exercise original publication barrier, not SDK verdicts.
			sealed, err := session.sealProducts(state.Token, state.ProductsDigest, strings.Repeat("b", 64))
			if err != nil || sealed.(map[string]any)["status"] != "retry" || session.productsSession != nil {
				t.Fatalf("admitted body substituted for fresh seal: %#v %v", sealed, err)
			}
		})
	}
}

func TestSourceProjectionMetadataErrorStillPrecedesPhaseAndEncoding(t *testing.T) {
	session, root := liveInputSession(t, nil)
	governanceSourceObservationFixture(t, session)
	path := filepath.Join(root, "tsconfig.json")
	delete(session.productsSession.Project.capture.byteCells, path)
	delete(session.productsSession.Project.capture.observations, "read\x00"+path)
	_, err := session.closedSourceHandoff(true)
	if err == nil || err.Error() != "closed source root metadata was not captured: tsconfig.json" || session.productsSession.sourceBody.projected {
		t.Fatalf("metadata priority or failed-export phase changed: %v", err)
	}
	_, original := json.Marshal(jsstring.JSONText("\xff"))
	fresh, _ := liveInputSession(t, nil)
	fresh.productsSession.Project.Files[0].Text = "\xff"
	_, actual := fresh.closedSourceHandoff(false)
	if actual == nil || actual.Error() != original.Error() || fresh.productsSession.sourceBody != nil {
		t.Fatalf("malformed first body gained owner: %v", actual)
	}
}

func TestSourceProjectionTupleGuardsRemainAfterSuccessfulProjection(t *testing.T) {
	for _, field := range []string{"token", "generation", "digest"} {
		t.Run(field, func(t *testing.T) {
			session, _ := liveInputSession(t, nil)
			governanceSourceObservationFixture(t, session)
			state := session.productsSession
			request := governanceClosedSourceRequest{Token: state.Token, Generation: state.Generation,
				SourceSnapshotDigest: state.Project.GovernanceDigest, Path: "index.ts", Operation: "package-mapping"}
			switch field {
			case "token":
				request.Token = "other-owner"
			case "generation":
				request.Generation = "other-generation"
			case "digest":
				request.SourceSnapshotDigest = "other-body"
			}
			before := len(state.Project.capture.compiler.operations)
			if _, err := session.observeClosedSource(request); err == nil {
				t.Fatal("foreign scalar reached admitted owner")
			}
			raw, _ := json.Marshal(map[string]any{"token": request.Token, "generation": request.Generation,
				"sourceSnapshotDigest": request.SourceSnapshotDigest, "decisions": []any{}})
			if _, err := session.completeClosedSource(raw); err == nil {
				t.Fatal("foreign completion reached admitted owner")
			}
			if state.SourceProducts != nil || state.ProductsDigest != "" || len(state.Project.capture.compiler.operations) != before {
				t.Fatal("failed tuple promoted observations or products")
			}
		})
	}
}
