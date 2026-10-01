package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestGovernanceCapturedGenericProbesNegativeAndLinkTopology(t *testing.T) {
	root := t.TempDir()
	session := governanceSession{}
	configuration, err := session.captureConfiguration(root)
	if err != nil {
		t.Fatal(err)
	}
	token := configuration["token"].(string)
	missing := filepath.Join(root, "missing.gitignore")
	payload, _ := json.Marshal(map[string]any{"token": token, "requirements": []governanceProbeRequest{{ID: "missing", Kind: "read-bytes", Path: missing}, {ID: "directory", Kind: "directory", Path: root}}})
	response, err := session.captureProbes(payload)
	if err != nil {
		t.Fatal(err)
	}
	rows := response.(map[string]any)["observations"].([]governanceProbeObservation)
	if rows[0].Status != "error" || rows[0].Error.Kind != "not-found" || rows[0].Error.Code != "ENOENT" {
		t.Fatalf("negative=%#v", rows[0])
	}
	capture := session.policySuspension.Capture
	if valid, err := capture.Verify(); !valid || err != nil {
		t.Fatalf("unchanged negative failed %v %v", valid, err)
	}
	governanceWrite(t, root, "missing.gitignore", "*.ts")
	if valid, _ := capture.Verify(); valid {
		t.Fatal("appeared ignored source authority was sealed")
	}
	capture = &governanceCapture{observations: map[string]governanceObservation{}}
	target := filepath.Join(root, "target")
	governanceWrite(t, root, "target/source.ts", "const a=1")
	link := filepath.Join(root, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	row := capture.probe(governanceProbeRequest{ID: "canonical", Kind: "canonicalize", Path: link})
	if row.Status != "known" {
		t.Fatal(row)
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("link retarget was sealed")
	}
}
func TestGovernanceCaptureRetainsFirstObservationAcrossWithinGenerationEdit(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	governanceWrite(t, root, "source.ts", "const a=1")
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	if _, err := capture.read(path); err != nil {
		t.Fatal(err)
	}
	governanceWrite(t, root, "source.ts", "const a=2")
	if _, err := capture.read(path); err != nil {
		t.Fatal(err)
	}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("last read must not overwrite earlier consumed input")
	}
	disk := newAuthoredCompilerDisk()
	compiler := governanceNewCompilerInputFS(disk)
	compiler.ReadFile(path)
	governanceWrite(t, root, "source.ts", "const a=3")
	compiler.ReadFile(path)
	capture = &governanceCapture{observations: map[string]governanceObservation{}, compiler: compiler}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("native compiler observation replacement erased mixed capture")
	}
}

func TestGovernanceCapturedDirectoryPartialFailureIsNotEmptyMembership(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "one.ts", "export {}")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	complete := governanceDirectoryObservation(entries, nil)
	if complete.Status != "known" || len(complete.Value.(map[string]any)["entries"].([]map[string]string)) != 1 {
		t.Fatal("complete directory rows lost")
	}
	partial := governanceDirectoryObservation(entries, errors.New("iteration failure after first entry"))
	if partial.Status != "unsupported" || partial.Error != nil {
		t.Fatalf("partial rows collapsed to failed empty membership: %#v", partial)
	}
	absent := governanceDirectoryObservation(nil, os.ErrNotExist)
	if absent.Status != "error" || absent.Error.Kind != "not-found" {
		t.Fatalf("genuine absence lost: %#v", absent)
	}
}

func TestGovernanceContentDigestRetainedAndSealed(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "engine.node")
	if err := os.WriteFile(path, []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	session := governanceSession{}
	_, err := session.captureConfiguration(root)
	if err != nil {
		t.Fatal(err)
	}
	capture := session.policySuspension.Capture
	row := capture.probe(governanceProbeRequest{ID: "asset", Kind: "content-digest", Path: path})
	if row.Status != "known" {
		t.Fatalf("digest=%#v", row)
	}
	value := row.Value.(map[string]any)
	if value["sha256"] != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" || value["byteLength"] != int64(3) {
		t.Fatalf("digest=%#v", value)
	}
	if valid, err := capture.Verify(); !valid || err != nil {
		t.Fatalf("stable seal=%v %v", valid, err)
	}
	if err := os.WriteFile(path, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("changed bytes passed digest seal")
	}
	changed := capture.probe(governanceProbeRequest{ID: "asset2", Kind: "content-digest", Path: path})
	if changed.Status != "unsupported" || !capture.probeInconsistent {
		t.Fatal("changed reread replaced first owner")
	}
	missing := governanceObserveProbe(governanceProbeKey{Kind: "content-digest", Path: filepath.Join(root, "missing")})
	if missing.Status != "error" || missing.Value != nil || missing.Error.Kind != "not-found" {
		t.Fatalf("absence=%#v", missing)
	}
	directory := governanceObserveProbe(governanceProbeKey{Kind: "content-digest", Path: root})
	if directory.Status != "error" || directory.Value != nil {
		t.Fatalf("directory digest=%#v", directory)
	}
}
