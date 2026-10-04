package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestOwnedOperationIdentityPreservesOriginalRawOperand(t *testing.T) {
	root := t.TempDir()
	for _, operand := range []string{root + "/a/../x", root + "/./x", root + "//x", root + "/x/", root + "/x\x00"} {
		for _, kind := range []string{"metadata", "directory", "read-bytes", "canonicalize"} {
			request := governanceProbeRequest{ID: "actual-journal", Path: operand, Kind: kind}
			key, valid := governanceOwnedOperationIdentity(request)
			if !valid || key != governanceOwnedKey(request) || key.Path != operand {
				t.Fatalf("raw original operand was rejected or replaced: %#v %#v", request, key)
			}
		}
	}
	for _, request := range []governanceProbeRequest{
		{ID: "", Path: root, Kind: "metadata"},
		{ID: "x", Path: "a/../x", Kind: "metadata"},
		{ID: "x", Path: root, Kind: "read-bytes", FollowLinks: true},
		{ID: "x", Path: root, Kind: "directory", FollowLinks: true},
		{ID: "x", Path: root, Kind: "canonicalize", FollowLinks: true},
	} {
		if _, valid := governanceOwnedOperationIdentity(request); valid {
			t.Fatalf("existing identity restriction escaped: %#v", request)
		}
	}
}

func TestOwnedRawSymlinkParentOperationsKeepSeparateFreshObligations(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"remote/sub", "other/sub"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for name, value := range map[string]string{"payload": "local", "remote/payload": "first", "other/payload": "other"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(filepath.Join(root, "remote/sub"), link); err != nil {
		t.Fatal(err)
	}
	raw := link + "/../payload"
	clean := filepath.Clean(raw)
	if raw == clean {
		t.Fatal("fixture lacks a lexical alias")
	}
	rawBytes, err := os.ReadFile(raw)
	if err != nil {
		t.Fatal(err)
	}
	cleanBytes, err := os.ReadFile(clean)
	if err != nil || string(rawBytes) != "first" || string(cleanBytes) != "local" {
		t.Fatalf("fixture does not distinguish kernel operands: %q %q %v", rawBytes, cleanBytes, err)
	}
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	world := &governanceBarrierReads{}
	for _, path := range []string{raw, clean} {
		for _, kind := range []string{"metadata", "read-bytes", "canonicalize", "content-digest"} {
			follow := kind == "metadata"
			key := governanceProbeKey{Path: path, Kind: kind, FollowLinks: follow}
			original := governanceObserveProbe(key)
			observed := capture.probe(governanceProbeRequest{ID: path + kind, Path: path, Kind: kind, FollowLinks: follow})
			if !reflect.DeepEqual(governanceProbeFingerprint(original), governanceProbeFingerprint(observed)) || original.Status != "known" {
				t.Fatalf("operation changed: %s %s %#v %#v", path, kind, original, observed)
			}
			if world.probe(key) != governanceProbeFingerprint(original) {
				t.Fatal("fresh barrier substituted an operand")
			}
		}
	}
	if len(capture.probeObservations) != 8 || len(world.probes) != 8 || len(world.reads) != 2 {
		t.Fatal("distinct raw aliases were merged")
	}
	if valid, err := capture.Verify(); !valid || err != nil {
		t.Fatalf("unchanged raw observations failed: %v %v", valid, err)
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "other/sub"), link); err != nil {
		t.Fatal(err)
	}
	// Both targets have the same metadata projection; byte and canonicalization
	// guards independently catch the retarget, rather than inventing inode checks.
	if valid, _ := capture.Verify(); valid {
		t.Fatal("raw symlink retarget escaped the original fresh guards")
	}
	if bytes, err := os.ReadFile(clean); err != nil || string(bytes) != "local" {
		t.Fatal("clean alias changed unexpectedly")
	}
}

func TestOwnedRawAliasesErrorsAndLateOverlapsRemainExact(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "dir"), 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "file")
	if err := os.WriteFile(file, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	aliases := []string{file, root + "/dir/../file", root + "/./file", root + "//file"}
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	for _, path := range aliases {
		key := governanceProbeKey{Path: path, Kind: "read-bytes"}
		row := capture.probe(governanceProbeRequest{ID: path, Path: path, Kind: key.Kind})
		if row.Status != "known" || row.Value.(map[string]string)["bytesBase64"] != base64.StdEncoding.EncodeToString([]byte("old")) {
			t.Fatal("original alias read changed")
		}
	}
	if len(capture.probeObservations) != len(aliases) {
		t.Fatal("inode-equal raw operands collapsed")
	}
	for _, path := range []string{file + "/", file + "/../file", root + "/missing/../file", root + "/file\x00"} {
		for _, kind := range []string{"metadata", "read-bytes", "directory", "canonicalize"} {
			key := governanceProbeKey{Path: path, Kind: kind}
			physical := governanceObserveProbe(key)
			row := capture.probe(governanceProbeRequest{ID: path + kind, Path: path, Kind: kind})
			if (kind != "canonicalize" && (physical.Status != "error" || physical.Error == nil)) || governanceProbeFingerprint(physical) != governanceProbeFingerprint(row) {
				t.Fatalf("raw error was inferred from cleaned success: %s %s %#v", path, kind, row)
			}
		}
	}
	if valid, err := capture.Verify(); !valid || err != nil {
		t.Fatalf("unchanged original raw errors failed: %v %v", valid, err)
	}
	if err := os.WriteFile(file, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if valid, _ := capture.Verify(); valid {
		t.Fatal("same-size alias byte change escaped")
	}
	for _, path := range aliases {
		late := &governanceCapture{observations: map[string]governanceObservation{}}
		late.read(path)
		late.ownedGenericBytes = map[string][]byte{path: []byte("old")}
		late.read(path)
		if !late.probeInconsistent {
			t.Fatalf("late owned overlap was skipped for raw path %q", path)
		}
	}
}

// This exercises the qualified original Rust binary through the actual Go
// admission, rather than supplying a synthetic journal. Git owns all metadata
// below this temporary root; no existing checkout or user Git files are edited.
func TestOwnedOriginalGitWorktreeRawJournalAndFreshRecovery(t *testing.T) {
	artifact := ownedArtifactTestBytes(t)
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skip("private Git worktree fixture requires git")
	}
	base := t.TempDir()
	main := filepath.Join(base, "main")
	linked := filepath.Join(base, "linked")
	if err := os.MkdirAll(main, 0700); err != nil {
		t.Fatal(err)
	}
	gitRun := func(args ...string) {
		t.Helper()
		command := exec.Command(git, args...)
		command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null")
		if out, err := command.CombinedOutput(); err != nil {
			t.Fatalf("private git command failed: %v %s", err, out)
		}
	}
	gitRun("-C", main, "init", "--quiet")
	gitRun("-C", main, "-c", "user.name=Owned fixture", "-c", "user.email=fixture@invalid", "commit", "--quiet", "--allow-empty", "-m", "private fixture")
	gitRun("-C", main, "worktree", "add", "--quiet", "--detach", linked, "HEAD")
	governanceWrite(t, linked, "source.ts", "export const value=1;\n")
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	artifactPath := filepath.Join(filepath.Dir(executable), governanceOwnedArtifactName)
	if _, err := os.Lstat(artifactPath); !os.IsNotExist(err) {
		t.Fatal("private test sidecar already exists")
	}
	if err := os.WriteFile(artifactPath, artifact, 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(artifactPath) })
	store := filepath.Join(filepath.Dir(executable), ".owned-artifacts-v1")
	t.Cleanup(func() {
		filepath.WalkDir(store, func(path string, entry os.DirEntry, err error) error {
			if err == nil && entry.IsDir() {
				os.Chmod(path, 0700)
			}
			return nil
		})
		os.RemoveAll(store)
	})
	makeSession := func(token string) *governanceSession {
		project, err := captureGovernedProject(linked, governanceTestPolicy())
		if err != nil {
			t.Fatal(err)
		}
		return &governanceSession{root: linked, productsSession: &governanceProductsSession{Project: project, Token: token, Generation: token, GenericSuspended: true, GenericEngine: &governanceGenericEngine{Version: "1.81.0", ArtifactDigest: governanceOwnedArtifactSHA}}}
	}
	capture := func(session *governanceSession) map[string]any {
		raw, _ := json.Marshal(map[string]any{"token": session.productsSession.Token, "configPath": filepath.Join(linked, ".oxlintrc.json"), "config": map[string]any{"categories": map[string]string{"correctness": "off"}}, "commandIgnorePatterns": []string{}})
		value, err := session.captureOwnedGeneric(raw)
		if err != nil {
			t.Fatal(err)
		}
		closed := value.(map[string]any)
		if closed["status"] != "owned-generic" {
			t.Fatalf("original raw journal did not close: %#v", closed)
		}
		return closed
	}
	first := makeSession("first")
	t.Cleanup(func() {
		first.discardProducts()
		if first.genericProducer != nil {
			first.genericProducer.close()
		}
	})
	capture(first)
	actual := first.productsSession.Project.capture
	rawGit := 0
	for key := range actual.ownedGenericRows {
		if strings.Contains(key.Path, "/../") && strings.Contains(key.Path, "/info/exclude") {
			rawGit++
			if filepath.Clean(key.Path) == key.Path {
				t.Fatal("original Git operand was cleaned")
			}
			if _, present := actual.probeObservations[key]; !present {
				t.Fatal("raw Git operation lost its fresh obligation")
			}
		}
	}
	if rawGit == 0 {
		t.Fatal("actual Rust journal lacks the private Git dotdot operand")
	}
	if valid, err := actual.Verify(); !valid || err != nil {
		t.Fatalf("unchanged real raw journal failed: %v %v", valid, err)
	}
	governanceWrite(t, main, ".git/info/exclude", "source.ts\n")
	if valid, _ := actual.Verify(); valid {
		t.Fatal("edited Git exclude escaped old original obligations")
	}
	second := makeSession("second")
	t.Cleanup(func() {
		second.discardProducts()
		if second.genericProducer != nil {
			second.genericProducer.close()
		}
	})
	closed := capture(second)
	var membership struct {
		Paths []string `json:"paths"`
	}
	if err := json.Unmarshal(closed["membership"].(json.RawMessage), &membership); err != nil {
		t.Fatal(err)
	}
	if len(membership.Paths) != 0 {
		t.Fatalf("fresh original ignore recovery retained excluded source: %v", membership.Paths)
	}
	if valid, err := second.productsSession.Project.capture.Verify(); !valid || err != nil {
		t.Fatalf("fresh raw recovery failed: %v %v", valid, err)
	}
}
