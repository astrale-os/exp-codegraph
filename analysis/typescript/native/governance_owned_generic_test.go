package main

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOwnedGenericClientCannotConstructActualJournal(t *testing.T) {
	session := &governanceSession{}
	for _, proposal := range []map[string]any{
		{"token": "forged", "journal": []any{}},
		{"token": "forged", "observations": []any{}},
		{"token": "forged", "artifactPath": "/client/worker"},
		{"token": "forged", "owner": map[string]any{"instance": "client", "epoch": 1}},
		{"token": "forged", "journalRetained": true},
		{"token": "forged", "journalCount": 1},
		{"token": "forged", "goOwner": map[string]any{"instance": "client"}},
	} {
		raw, _ := json.Marshal(proposal)
		if _, err := session.captureOwnedGeneric(raw); err == nil {
			t.Fatalf("client authority field accepted: %#v", proposal)
		}
		if session.genericProducer != nil {
			t.Fatal("forged proposal launched a producer")
		}
	}
}

func TestOwnedGenericBytesPreserveFreshSealAndOriginalLifetime(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	original := []byte("const a=1")
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	key := governanceProbeKey{Path: path, Kind: "read-bytes"}
	row := governanceObserveProbe(key)
	capture := &governanceCapture{observations: map[string]governanceObservation{}, ownedGenericRows: map[governanceProbeKey]governanceProbeObservation{key: row}, ownedGenericBytes: map[string][]byte{path: append([]byte(nil), original...)}}
	captured := capture.probe(governanceProbeRequest{ID: "borrow", Kind: "read-bytes", Path: path})
	if captured.Status != "known" || captured.ID != "borrow" || capture.ownedGenericRows[key].ID != "" {
		t.Fatal("borrow changed original producer cell")
	}
	if valid, err := capture.Verify(); !valid || err != nil {
		t.Fatalf("unchanged owned bytes failed %v %v", valid, err)
	}
	if err := os.WriteFile(path, []byte("const a=2"), 0600); err != nil {
		t.Fatal(err)
	}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("same-size hidden source edit sealed")
	}
	// Borrowing the captured byte row must not replace independent fresh guards.
	capture.probe(governanceProbeRequest{ID: "later", Kind: "read-bytes", Path: path})
	if valid, _ := capture.Verify(); valid {
		t.Fatal("later borrow erased old producer bytes")
	}
	if _, err := capture.read(path); err != nil {
		t.Fatal(err)
	}
	if !capture.probeInconsistent {
		t.Fatal("a later original Go read erased producer overlap conflict")
	}
	next := &governanceCapture{observations: map[string]governanceObservation{}}
	if next.ownedGenericRows != nil || next.ownedGenericBytes != nil {
		t.Fatal("new capture borrowed old producer cells")
	}
}

var ownedArtifactFixture = flag.String("owned-artifact", "", "qualified original worker fixture for private producer lifetime tests")

func TestOwnedGenericArtifactAndProcessHaveDistinctLifetimes(t *testing.T) {
	if *ownedArtifactFixture == "" {
		t.Skip("requires exact qualified original1.81 artifact fixture")
	}
	artifact, err := os.ReadFile(*ownedArtifactFixture)
	if err != nil {
		t.Fatal(err)
	}
	if len(artifact) != governanceOwnedArtifactLength || governanceHash(artifact) != governanceOwnedArtifactSHA {
		t.Fatal("fixture is not the exact qualified original worker")
	}
	producer, err := governanceNewOwnedProcessWithin(artifact, ownedArtifactTestStore(t))
	if err != nil {
		t.Fatal(err)
	}
	defer producer.close()
	snapshot := filepath.Join(producer.directory, governanceOwnedArtifactName)
	actual, err := os.ReadFile(snapshot)
	if err != nil {
		t.Fatalf("worker snapshot lost before process lifetime ended: %v", err)
	}
	if governanceHash(actual) != governanceOwnedArtifactSHA {
		t.Fatal("private executable snapshot differs")
	}
	producer.close()
	select {
	case <-producer.done:
	case <-time.After(5 * time.Second):
		t.Fatal("disposed original worker did not end")
	}
	if _, err = os.Stat(producer.directory); err != nil {
		t.Fatal("disposed worker removed the artifact owner capsule")
	}
	if producer.artifact.verify() {
		t.Fatal("disposed process lease can revive")
	}
	if !producer.closed.Load() {
		t.Fatal("disposed producer can revive")
	}
}

func TestOwnedBatchPreservesPhysicalErrorsAndRejectsDivergence(t *testing.T) {
	native := governanceProbeObservation{ID: "n", Status: "error", Error: &governanceProbeError{Kind: "not-found", Code: "2", Message: "No such file or directory (os error 2)"}}
	actual := governanceProbeObservation{ID: "g", Status: "error", Error: &governanceProbeError{Kind: "not-found", Code: "ENOENT", Message: "open /private/path: no such file or directory"}}
	if !governanceOwnedBridgeEqual("read-bytes", native, actual) {
		t.Fatal("equal errno/kind was not bridgeable")
	}
	if native.Error.Message == actual.Error.Message {
		t.Fatal("test lacks distinct physical messages")
	}
	if native.Error.Code != "2" || actual.Error.Code != "ENOENT" {
		t.Fatal("bridge normalized physical results")
	}
	for _, change := range []func(*governanceProbeObservation){
		func(o *governanceProbeObservation) {
			o.Status = "known"
			o.Error = nil
			o.Value = map[string]any{"bytesBase64": ""}
		},
		func(o *governanceProbeObservation) { o.Error.Kind = "permission-denied" },
		func(o *governanceProbeObservation) { o.Error.Code = "EACCES" },
		func(o *governanceProbeObservation) { o.Error.Message = "" },
		func(o *governanceProbeObservation) { o.Status = "unsupported" },
	} {
		row := actual
		err := *actual.Error
		row.Error = &err
		change(&row)
		if governanceOwnedBridgeEqual("read-bytes", native, row) {
			t.Fatal("divergent result admitted")
		}
	}
	first := governanceProbeObservation{Status: "known", Value: map[string]any{"entries": []any{map[string]any{"name": "visible.ts", "kind": "file"}}}}
	second := governanceProbeObservation{Status: "known", Value: map[string]any{"entries": []any{map[string]any{"name": "hidden.ts", "kind": "file"}}}}
	if governanceOwnedBridgeEqual("directory", first, second) {
		t.Fatal("directory membership divergence admitted")
	}
	second = governanceProbeObservation{Status: "unsupported", Value: map[string]any{"entries": []any{map[string]any{"name": "visible.ts", "kind": "file"}}, "reason": "partial directory"}}
	if governanceOwnedBridgeEqual("directory", first, second) {
		t.Fatal("partial directory collapsed into success")
	}
}

func TestOwnedBatchActualWorkerRejectsForgedJoinAndRecoversDrift(t *testing.T) {
	if *ownedArtifactFixture == "" {
		t.Skip("requires exact original1.81 fixture")
	}
	artifact, err := os.ReadFile(*ownedArtifactFixture)
	if err != nil {
		t.Fatal(err)
	}
	if len(artifact) != governanceOwnedArtifactLength || governanceHash(artifact) != governanceOwnedArtifactSHA {
		t.Fatal("wrong qualified fixture")
	}
	for _, mode := range []string{"wrong-owner", "duplicate", "invented-positive", "new-ignore-fallback"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "newly.ts")
			if err := os.WriteFile(path, []byte("const value = 1;\n"), 0600); err != nil {
				t.Fatal(err)
			}
			p, err := governanceNewOwnedProcessWithin(artifact, ownedArtifactTestStore(t))
			if err != nil {
				t.Fatal(err)
			}
			defer p.close()
			timer := time.AfterFunc(10*time.Second, p.close)
			defer timer.Stop()
			owner := governanceOwnedOwner{p.instance, 1, "test-current-token", governanceOwnedArtifactSHA}
			send := func(v any) {
				data, e := json.Marshal(v)
				if e != nil {
					t.Fatal(e)
				}
				if _, e = p.input.Write(append(data, '\n')); e != nil {
					t.Fatal(e)
				}
			}
			read := func() map[string]json.RawMessage {
				if !p.output.Scan() {
					t.Fatalf("missing private frame: %v", p.output.Err())
				}
				var out map[string]json.RawMessage
				if e := json.Unmarshal(p.output.Bytes(), &out); e != nil {
					t.Fatal(e)
				}
				return out
			}
			send(map[string]any{"operation": "discover-owned-batch", "token": owner.Token, "root": root, "configPath": filepath.Join(root, ".oxlintrc.json"), "config": map[string]any{"categories": map[string]string{"correctness": "off"}}, "commandIgnorePatterns": []string{}, "observations": []any{}, "goOwner": owner})
			draft := read()
			var status string
			json.Unmarshal(draft["status"], &status)
			if status != "owned-draft" {
				t.Fatalf("not a private draft: %s", draft)
			}
			var rows []governanceOwnedRow
			if err = json.Unmarshal(draft["journal"], &rows); err != nil {
				t.Fatal(err)
			}
			if mode == "wrong-owner" {
				wrong := owner
				wrong.Token = "stale-token"
				send(map[string]any{"operation": "reconcile", "owner": wrong, "rows": []any{}, "fallback": false})
			} else if mode == "duplicate" {
				row := rows[0]
				send(map[string]any{"operation": "reconcile", "owner": owner, "rows": []governanceOwnedRow{row, row}, "fallback": false})
			} else if mode == "invented-positive" {
				r := governanceProbeRequest{ID: "client-new", Kind: "read-bytes", Path: filepath.Join(root, "never-observed.ts")}
				o := governanceProbeObservation{ID: r.ID, Status: "known", Value: map[string]string{"bytesBase64": ""}}
				send(map[string]any{"operation": "reconcile", "owner": owner, "rows": []governanceOwnedRow{{r, o}}, "fallback": false})
			} else {
				if err = os.WriteFile(filepath.Join(root, ".gitignore"), []byte("newly.ts\n"), 0600); err != nil {
					t.Fatal(err)
				}
				drift := false
				for _, cell := range rows {
					if cell.Requirement.Kind == "directory" || cell.Observation.Status == "error" {
						actual := governanceObserveProbe(governanceOwnedKey(cell.Requirement))
						if !governanceOwnedBridgeEqual(cell.Requirement.Kind, cell.Observation, actual) {
							drift = true
						}
					}
				}
				if !drift {
					t.Fatal("new ignore/root-directory outcome did not conflict")
				}
				send(map[string]any{"operation": "reconcile", "owner": owner, "rows": []any{}, "fallback": true})
			}
			final := read()
			if mode != "new-ignore-fallback" {
				if _, ok := final["error"]; !ok {
					t.Fatalf("forged join published: %s", final)
				}
				return
			}
			for n := 0; n < 1000; n++ {
				json.Unmarshal(final["status"], &status)
				if status == "go-probe" {
					var r governanceProbeRequest
					json.Unmarshal(final["requirement"], &r)
					o := governanceObserveProbe(governanceOwnedKey(r))
					o.ID = r.ID
					send(map[string]any{"operation": "probe-result", "owner": owner, "row": governanceOwnedRow{r, o}})
					final = read()
					continue
				}
				if status != "owned-generic" {
					t.Fatalf("original recovery failed: %s", final)
				}
				var membership struct {
					Paths []string `json:"paths"`
				}
				json.Unmarshal(final["membership"], &membership)
				if len(membership.Paths) != 0 {
					t.Fatalf("new ignored source remained in recovered membership: %v", membership.Paths)
				}
				var closed []governanceOwnedRow
				json.Unmarshal(final["journal"], &closed)
				for _, cell := range closed {
					if cell.Requirement.Kind == "read-bytes" && cell.Requirement.Path == path {
						t.Fatal("abandoned source bytes published into actual journal")
					}
				}
				return
			}
			t.Fatal("original recovery exhausted IO bound")
		})
	}
}

var ownedColdProfilePath = flag.String("owned-cold-profile", "", "local exact constructor cold component receipt")

func TestOwnedColdInitializationProfile(t *testing.T) {
	if *ownedArtifactFixture == "" || *ownedColdProfilePath == "" {
		t.Skip("requires qualified fixture and local output")
	}
	type sample struct {
		Mode               string                 `json:"mode"`
		ArtifactIdentityMs float64                `json:"artifactIdentityMs"`
		Startup            governanceOwnedStartup `json:"startup"`
		FirstOwnerFrameMs  float64                `json:"firstOwnerFrameMs"`
		StartToEOFMs       float64                `json:"startToEOFMs"`
		ChildUserMs        float64                `json:"childUserMs"`
		ChildSystemMs      float64                `json:"childSystemMs"`
	}
	rows := []sample{}
	for _, mode := range []string{"eof", "first-owner-frame", "eof", "first-owner-frame", "eof", "first-owner-frame"} {
		began := time.Now()
		artifact, err := os.ReadFile(*ownedArtifactFixture)
		if err != nil {
			t.Fatal(err)
		}
		if len(artifact) != governanceOwnedArtifactLength || governanceHash(artifact) != governanceOwnedArtifactSHA {
			t.Fatal("fixture differs")
		}
		identityMs := time.Since(began).Seconds() * 1000
		p, err := governanceNewOwnedProcessWithin(artifact, ownedArtifactTestStore(t))
		if err != nil {
			t.Fatal(err)
		}
		timer := time.AfterFunc(10*time.Second, p.close)
		row := sample{Mode: mode, ArtifactIdentityMs: identityMs, Startup: p.startup}
		if mode == "eof" {
			p.input.Close()
			<-p.done
			row.StartToEOFMs = time.Since(p.startup.AfterStart).Seconds() * 1000
		} else {
			root := t.TempDir()
			os.WriteFile(filepath.Join(root, "source.ts"), []byte("const a=1\n"), 0600)
			owner := governanceOwnedOwner{p.instance, 1, "cold-owner-token", governanceOwnedArtifactSHA}
			request := map[string]any{"operation": "discover-owned-batch", "token": owner.Token, "root": root, "configPath": filepath.Join(root, ".oxlintrc.json"), "config": map[string]any{"categories": map[string]string{"correctness": "off"}}, "commandIgnorePatterns": []string{}, "observations": []any{}, "goOwner": owner}
			encoded, _ := json.Marshal(request)
			if _, err = p.input.Write(append(encoded, '\n')); err != nil {
				t.Fatal(err)
			}
			if !p.output.Scan() {
				t.Fatal("worker did not produce actual first owner frame")
			}
			row.FirstOwnerFrameMs = time.Since(p.startup.AfterStart).Seconds() * 1000
			var frame struct {
				Status string               `json:"status"`
				Owner  governanceOwnedOwner `json:"owner"`
			}
			json.Unmarshal(p.output.Bytes(), &frame)
			if frame.Status != "owned-draft" || frame.Owner != owner {
				t.Fatal("first frame lacks its exact owner")
			}
			p.close()
			<-p.done
		}
		timer.Stop()
		if p.cmd.ProcessState != nil {
			row.ChildUserMs = p.cmd.ProcessState.UserTime().Seconds() * 1000
			row.ChildSystemMs = p.cmd.ProcessState.SystemTime().Seconds() * 1000
		}
		rows = append(rows, row)
	}
	out := map[string]any{"artifactSha256": governanceOwnedArtifactSHA, "artifactBytes": governanceOwnedArtifactLength, "samples": rows, "scope": "Exact unchanged fd6 original1.81 artifact, real Go-owned private snapshot constructor. EOF measures loader + original Worker default/main before any request. First frame includes original draft discovery/source/audit projection on a private generated single-source root. Component timing only, no whole-driver qualification, prewarmed service or redefined public cold."}
	encoded, _ := json.MarshalIndent(out, "", "  ")
	if err := os.WriteFile(*ownedColdProfilePath, append(encoded, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}
