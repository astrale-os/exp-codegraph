package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func liveInputSession(t *testing.T, setup func(string)) (*governanceSession, string) {
	t.Helper()
	root := t.TempDir()
	governanceWrite(t, root, "index.ts", "export {}")
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022"},"include":["index.ts"]}`)
	if setup != nil {
		setup(root)
	}
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	project.capture.compilerInputs()
	state := &governanceProductsSession{Project: project, Token: "live-input", Generation: "current", Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":1}`)}}
	session := &governanceSession{productsSession: state}
	t.Cleanup(session.discardProducts)
	return session, root
}
func liveInputRequest(t *testing.T, session *governanceSession, operation, path string) governanceClosedSourceRequest {
	t.Helper()
	operand, err := jsstring.FromCompilerText(path)
	if err != nil {
		t.Fatal(err)
	}
	state := session.productsSession
	return governanceClosedSourceRequest{Token: state.Token, Generation: state.Generation, SourceSnapshotDigest: state.Project.GovernanceDigest,
		Path: "index.ts", Operation: "input", Input: &governanceClosedSourceInputRequest{Operation: operation, PathUnits: operand.Units()}}
}
func liveInputObserve(t *testing.T, session *governanceSession, operation, path string) governanceClosedSourceAnswer {
	t.Helper()
	request := liveInputRequest(t, session, operation, path)
	raw, err := json.Marshal(map[string]any{"token": request.Token, "kind": "source-observe", "request": request})
	if err != nil {
		t.Fatal(err)
	}
	result, err := session.continueProducts(raw)
	if err != nil {
		t.Fatal(err)
	}
	answer := result.(governanceClosedSourceAnswer)
	if answer.Token != request.Token || answer.Generation != request.Generation || answer.SourceSnapshotDigest != request.SourceSnapshotDigest {
		t.Fatal("input answer escaped current owner identity")
	}
	return answer
}

func TestClosedSourceLiveInputPreservesFirstBytesAndFreshGuards(t *testing.T) {
	session, root := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "node_modules/pkg/package.json", "\ufeff{\"name\":\"pkg\"}")
	})
	capture := session.productsSession.Project.capture
	path := filepath.Join(root, "node_modules/pkg/package.json")
	first := liveInputObserve(t, session, "read", path)
	expected := base64.StdEncoding.EncodeToString([]byte("\ufeff{\"name\":\"pkg\"}"))
	if first.Status != "known" || first.Row == nil || first.Row.Base64 == nil || *first.Row.Base64 != expected {
		t.Fatalf("original bytes not owned: %#v", first)
	}
	if ok, err := capture.Verify(); !ok || err != nil {
		t.Fatalf("initial raw union failed: %v", err)
	}
	governanceWrite(t, root, "node_modules/pkg/package.json", `{"name":"changed"}`)
	next := liveInputObserve(t, session, "read", path)
	if !reflect.DeepEqual(first, next) {
		t.Fatal("current cell physically reread or changed after first consumption")
	}
	if ok, _ := capture.Verify(); ok {
		t.Fatal("final uncached guard missed hidden metadata edit")
	}
	if owner := session.productsSession.Project.typeOwner; owner != nil && owner.program != nil {
		t.Fatal("input gap created a Program")
	}
}

func TestClosedSourceLiveInputRejectsForeignAndTerminalPhasesBeforeIO(t *testing.T) {
	session, root := liveInputSession(t, nil)
	state := session.productsSession
	capture := state.Project.capture
	path := filepath.Join(root, "unconsumed.json")
	for _, kind := range []string{"generation", "digest", "caller", "complete", "products", "pending", "lone-path", "unknown-operation"} {
		t.Run(kind, func(t *testing.T) {
			request := liveInputRequest(t, session, "read", path)
			beforeCells, beforeBytes := len(capture.compiler.operations), len(capture.byteCells)
			switch kind {
			case "generation":
				request.Generation = "retired"
			case "digest":
				request.SourceSnapshotDigest = "foreign"
			case "caller":
				request.Path = "foreign.ts"
			case "complete":
				state.SourceProducts = []governanceRuleProduct{}
			case "products":
				state.ProductsDigest = "closed"
			case "pending":
				session.policyLane = &governancePolicyLane{}
			case "lone-path":
				request.Input.PathUnits = []uint16{'/', 0xd800}
			case "unknown-operation":
				request.Input.Operation = "made-up"
			}
			answer, err := session.observeClosedSource(request)
			state.SourceProducts, state.ProductsDigest, session.policyLane = nil, "", nil
			if kind == "pending" {
				if err != nil || answer.Status != "pending" || answer.Generation != request.Generation {
					t.Fatal("pending reached mutable IO owner")
				}
			} else if kind == "lone-path" {
				if err != nil || answer.Status != "unavailable" {
					t.Fatal("lossy path became physical operand")
				}
			} else if err == nil {
				t.Fatal("foreign/terminal input was admitted")
			}
			if len(capture.compiler.operations) != beforeCells || len(capture.byteCells) != beforeBytes {
				t.Fatal("rejected request consumed an input")
			}
		})
	}
}

func TestClosedSourceLiveInputActualStatNegativeAndSymlinkUnion(t *testing.T) {
	target, replacement := t.TempDir(), t.TempDir()
	governanceWrite(t, target, "package.json", "{}")
	if err := os.Mkdir(filepath.Join(target, "\U00010000"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(target, "\ue000"), 0755); err != nil {
		t.Fatal(err)
	}
	session, root := liveInputSession(t, func(root string) {
		if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, filepath.Join(root, "node_modules", "linked")); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(root, "missing"), filepath.Join(root, "node_modules", "broken")); err != nil {
			t.Fatal(err)
		}
	})
	capture := session.productsSession.Project.capture
	alias := filepath.Join(root, "node_modules", "linked")
	path := filepath.Join(alias, "package.json")
	file := liveInputObserve(t, session, "file", path)
	if file.Status != "known" || file.Row.Boolean == nil || !*file.Row.Boolean || capture.compiler.observed[compilerInputKey{path, inputMetadata}] == "" {
		t.Fatal("regular membership lacked actual Stat")
	}
	casePath := filepath.Join(alias, "PACKAGE.JSON")
	spelling := liveInputObserve(t, session, "file", casePath)
	if spelling.Status != "known" || spelling.Row.Path != casePath || capture.compiler.operations[compilerInputKey{casePath, inputFile}] == capture.compiler.operations[compilerInputKey{path, inputFile}] {
		t.Fatal("case spelling collapsed original operation identity")
	}
	for _, operation := range []string{"file", "directory", "read"} {
		answer := liveInputObserve(t, session, operation, filepath.Join(root, "node_modules", "missing.json"))
		if answer.Status != "known" || answer.Row.Boolean == nil || *answer.Row.Boolean {
			t.Fatalf("original negative lost: %#v", answer)
		}
	}
	entries := liveInputObserve(t, session, "entries", filepath.Join(root, "node_modules"))
	if entries.Status != "known" || !reflect.DeepEqual(entries.Row.Directories, []string{"linked"}) {
		t.Fatal("directory symlink/broken membership changed")
	}
	nested := liveInputObserve(t, session, "entries", alias)
	if nested.Status != "known" || !reflect.DeepEqual(nested.Row.Directories, []string{"\ue000", "\U00010000"}) {
		t.Fatal("actual native enumeration order changed")
	}
	real := liveInputObserve(t, session, "realpath", alias)
	if real.Status != "known" || real.Row.Realpath != target || real.Row.Path != alias {
		t.Fatal("logical spelling or realpath identity collapsed")
	}
	if ok, err := capture.Verify(); !ok || err != nil {
		t.Fatalf("initial symlink union failed: %v", err)
	}
	if err := os.Remove(alias); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(replacement, alias); err != nil {
		t.Fatal(err)
	}
	if ok, _ := capture.Verify(); ok {
		t.Fatal("final uncached realpath/membership guard missed retarget")
	}
}

func TestClosedSourceLiveInputRolesFidelityAndCorrespondence(t *testing.T) {
	for _, kind := range []string{"custom-config", "non-json", "unsafe-json", "old-read-changed", "utf16"} {
		t.Run(kind, func(t *testing.T) {
			session, root := liveInputSession(t, func(root string) {
				governanceWrite(t, root, "node_modules/pkg/package.json", "{}")
				governanceWrite(t, root, "node_modules/pkg/base.conf", "{}")
				governanceWrite(t, root, "node_modules/pkg/source.ts", "export {}")
			})
			capture := session.productsSession.Project.capture
			path := filepath.Join(root, "node_modules/pkg/package.json")
			expected := "unavailable"
			switch kind {
			case "custom-config":
				path = filepath.Join(root, "node_modules/pkg/base.conf")
				(governanceJSONInputs{capture.compiler}).ReadFile(path)
				expected = "known"
			case "non-json":
				path = filepath.Join(root, "node_modules/pkg/source.ts")
			case "unsafe-json":
				governanceWrite(t, root, "node_modules/pkg/package.json", `{"imports":{"#\ud800":"./x"}}`)
			case "old-read-changed":
				capture.compiler.ReadFile(path)
				governanceWrite(t, root, "node_modules/pkg/package.json", `{"changed":true}`)
			case "utf16":
				if err := os.WriteFile(path, []byte{0xff, 0xfe, '{', 0, '}', 0}, 0600); err != nil {
					t.Fatal(err)
				}
			}
			answer := liveInputObserve(t, session, "read", path)
			if answer.Status != expected || answer.Status == "unavailable" && answer.Row != nil {
				t.Fatalf("unsupported input became an answer: %#v", answer)
			}
			if kind == "old-read-changed" && !capture.probeInconsistent {
				t.Fatal("conflicting raw/decoded read did not retire authority")
			}
			if kind == "unsafe-json" {
				count := len(capture.compiler.operations)
				later := liveInputObserve(t, session, "file", filepath.Join(root, "new.ts"))
				if later.Status != "unavailable" || len(capture.compiler.operations) != count {
					t.Fatal("metadata certificate allowed a later producer")
				}
			}
			if kind == "non-json" {
				if _, seen := capture.byteCells[path]; seen {
					t.Fatal("unknown source read consumed bytes")
				}
			}
		})
	}
}

func TestClosedSourceLiveInputFrameIdentityAndUnavailableRoot(t *testing.T) {
	session, root := liveInputSession(t, nil)
	capture := session.productsSession.Project.capture
	beforeCells, beforeBytes := len(capture.compiler.operations), len(capture.byteCells)
	first, err := session.closedSourceHandoff(false)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := first.(map[string]any)["resolutionInputs"]; exists {
		t.Fatal("initial parser frame gained a compiler input owner")
	}
	second, err := session.closedSourceHandoff(true)
	if err != nil {
		t.Fatal(err)
	}
	envelope := second.(map[string]any)["resolutionInputs"].(governanceClosedSourceInputs)
	if envelope.Status != "known" || envelope.Root != root || envelope.Token != session.productsSession.Token || envelope.Generation != session.productsSession.Generation || envelope.SourceSnapshotDigest != session.productsSession.Project.GovernanceDigest {
		t.Fatal("second input envelope lost current owner identity")
	}
	capture.compiler.mu.Lock()
	capture.compiler.metadataLossy = true
	capture.compiler.mu.Unlock()
	unavailable, err := session.closedSourceHandoff(true)
	if err != nil {
		t.Fatal(err)
	}
	declined := unavailable.(map[string]any)["resolutionInputs"].(governanceClosedSourceInputs)
	if declined.Status != "unavailable" || declined.Root != root || declined.Token != envelope.Token || declined.Generation != envelope.Generation || declined.SourceSnapshotDigest != envelope.SourceSnapshotDigest || declined.Reason == "" || len(declined.Rows) != 0 {
		t.Fatal("truthful unavailable became malformed or offered covered inputs")
	}
	if len(capture.compiler.operations) != beforeCells || len(capture.byteCells) != beforeBytes {
		t.Fatal("snapshot performed fresh input operations")
	}
}
