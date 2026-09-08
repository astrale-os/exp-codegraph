package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func writePackageFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestPackageOwnershipReadsDirectoriesOncePerSnapshot(t *testing.T) {
	root := t.TempDir()
	writePackageFixture(t, filepath.Join(root, "package.json"), `{"name":"@test/owner"}`)
	writePackageFixture(t, filepath.Join(root, "src", "package.json"), `{"type":"module"}`)
	resolver := newPackageCoordinateResolver(root)
	for index := range 100 {
		path := fmt.Sprintf("src/deep/file%d.ts", index)
		if actual := resolver.coordinate(filepath.Join(root, filepath.FromSlash(path))); actual != "package:@test/owner/"+path {
			t.Fatalf("wrong source coordinate: %q", actual)
		}
	}
	if resolver.reads != 3 {
		t.Fatalf("100 sibling files read %d manifests instead of 3 directories", resolver.reads)
	}
	if resolver.coordinate(filepath.Join(root, "src/other/file.ts")) != "package:@test/owner/src/other/file.ts" || resolver.reads != 4 {
		t.Fatal("a sibling subtree did not share its parent ownership")
	}
	writePackageFixture(t, filepath.Join(root, "src/deep/package.json"), `{"name":"nested"}`)
	if actual := newPackageCoordinateResolver(root).coordinate(filepath.Join(root, "src/deep/file0.ts")); actual != "package:nested/file0.ts" {
		t.Fatalf("a new extraction retained old package ownership: %q", actual)
	}
}

func TestPackageOwnershipRetainsNegativeLookupsOnlyWithinItsSnapshot(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "project")
	writePackageFixture(t, filepath.Join(parent, "package.json"), `{"name":"outside"}`)
	writePackageFixture(t, filepath.Join(root, "src/deep/file.ts"), "")
	resolver := newPackageCoordinateResolver(root)
	if resolver.coordinate(filepath.Join(root, "src/deep/file.ts")) != "" {
		t.Fatal("an owned file escaped the project boundary")
	}
	writePackageFixture(t, filepath.Join(root, "package.json"), `{"name":"current"}`)
	if resolver.coordinate(filepath.Join(root, "src/deep/another.ts")) != "" {
		t.Fatal("one extraction mixed metadata snapshots")
	}
	if actual := newPackageCoordinateResolver(root).coordinate(filepath.Join(root, "src/deep/another.ts")); actual != "package:current/src/deep/another.ts" {
		t.Fatalf("a negative result escaped its extraction snapshot: %q", actual)
	}
	writePackageFixture(t, filepath.Join(root, "src/package.json"), `{malformed`)
	if newPackageCoordinateResolver(root).coordinate(filepath.Join(root, "src/deep/file.ts")) != "" {
		t.Fatal("malformed nearest metadata was ignored")
	}
	writePackageFixture(t, filepath.Join(root, "src/package.json"), `{"type":"module"}`)
	if newPackageCoordinateResolver(root).coordinate(filepath.Join(root, "src/deep/file.ts")) == "" {
		t.Fatal("repaired nameless metadata remained negative")
	}
}
