package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Location cannot replace the authority linked by -X, and its observed bytes
// participate in the same journal as the actual original Rust producer.
func TestOwnedGenericExplicitArtifactLocation(t *testing.T) {
	original := ownedArtifactTestBytes(t)
	for _, variant := range []string{"separate-cache", "same-length-corrupt", "relative-path", "absent-path"} {
		t.Run(variant, func(t *testing.T) {
			session, early := governanceLaneFixture(t, true)
			session.ownedSignals = governanceNewOwnedSessionSignals()
			t.Cleanup(func() { session.discardProducts(); session.ownedSignals.stop() })
			root := t.TempDir()
			packagePath := filepath.Join(root, "package.json")
			packageBytes := []byte(`{"version":"1.81.0"}`)
			if err := os.WriteFile(packagePath, packageBytes, 0600); err != nil {
				t.Fatal(err)
			}
			engine := governanceGenericEngine{Version: "1.81.0", ArtifactDigest: governanceOwnedArtifactSHA, PackagePath: packagePath, PackageRevision: governanceHash(packageBytes)}
			raw, _ := json.Marshal(map[string]any{"token": early["token"], "kind": "generic-engine", "engine": engine})
			if _, err := session.continueGeneric(raw); err != nil {
				t.Fatal(err)
			}
			artifactPath := filepath.Join(root, "independent-content-cache-"+governanceOwnedArtifactSHA)
			bytes := append([]byte(nil), original...)
			if variant == "same-length-corrupt" {
				bytes[0] ^= 1
			}
			if variant != "absent-path" {
				if err := os.WriteFile(artifactPath, bytes, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if variant == "relative-path" {
				artifactPath = filepath.Base(artifactPath)
			}
			raw, _ = json.Marshal(map[string]any{"token": early["token"], "artifactPath": artifactPath,
				"configPath": filepath.Join(session.root, ".oxlintrc.json"), "config": map[string]any{"categories": map[string]string{"correctness": "off"}}, "commandIgnorePatterns": []string{}})
			actual, err := session.captureOwnedGeneric(raw)
			switch variant {
			case "relative-path":
				if err == nil || !strings.Contains(err.Error(), "must be absolute") {
					t.Fatalf("relative location admitted: %#v %v", actual, err)
				}
			case "same-length-corrupt":
				if err == nil || !strings.Contains(err.Error(), "differs from qualified bytes") {
					t.Fatalf("path bypassed linked digest: %#v %v", actual, err)
				}
			case "absent-path":
				if err != nil || actual.(map[string]any)["status"] != "retry" {
					t.Fatalf("missing observed input was not retried: %#v %v", actual, err)
				}
			case "separate-cache":
				if err != nil || actual.(map[string]any)["status"] != "owned-generic" {
					t.Fatalf("separate real worker did not close: %#v %v", actual, err)
				}
				capture := session.productsSession.Project.capture
				if valid, err := capture.Verify(); err != nil || !valid {
					t.Fatalf("unchanged location not captured: %v %v", valid, err)
				}
				bytes[0] ^= 1
				if err := os.WriteFile(artifactPath, bytes, 0600); err != nil {
					t.Fatal(err)
				}
				if valid, err := capture.Verify(); err != nil || valid {
					t.Fatalf("changed explicit worker escaped publication guard: %v %v", valid, err)
				}
			}
		})
	}
}
