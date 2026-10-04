package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConfigurationFrontierAdmitsAbsenceAndRejectsLaterTopologyChanges(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "absent")
	session := governanceSession{}
	product, err := session.captureConfiguration(root)
	if err != nil || product["configKind"] != "absent" {
		t.Fatalf("%+v %v", product, err)
	}
	if ok, err := session.policySuspension.Capture.Verify(); !ok || err != nil {
		t.Fatalf("initial absent %v %v", ok, err)
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if ok, _ := session.policySuspension.Capture.Verify(); ok {
		t.Fatal("created root reused an absent topology receipt")
	}
	for _, edit := range []string{"delete", "replace", "retarget"} {
		t.Run(edit, func(t *testing.T) {
			parent := t.TempDir()
			original := filepath.Join(parent, "original")
			other := filepath.Join(parent, "other")
			for _, p := range []string{original, other} {
				if err := os.Mkdir(p, 0700); err != nil {
					t.Fatal(err)
				}
			}
			root := original
			if edit == "retarget" {
				root = filepath.Join(parent, "link")
				if err := os.Symlink(original, root); err != nil {
					t.Fatal(err)
				}
			}
			session := governanceSession{}
			_, err := session.captureConfiguration(root)
			if err != nil {
				t.Fatal(err)
			}
			if ok, err := session.policySuspension.Capture.Verify(); !ok || err != nil {
				t.Fatalf("before %v %v", ok, err)
			}
			if edit == "retarget" {
				os.Remove(root)
				os.Symlink(other, root)
			} else {
				os.Remove(root)
				if edit == "replace" {
					os.WriteFile(root, []byte("file"), 0600)
				}
			}
			if ok, _ := session.policySuspension.Capture.Verify(); ok {
				t.Fatal("changed root topology sealed")
			}
		})
	}
}
