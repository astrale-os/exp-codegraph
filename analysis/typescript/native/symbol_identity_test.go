package main

import (
	"path/filepath"
	"testing"
)

func TestSymbolSourceCoordinateIsPortableAcrossDependencyLayouts(t *testing.T) {
	originalRoot := filepath.Join(string(filepath.Separator), "workspace", "codegraph")
	mirrorRoot := filepath.Join(string(filepath.Separator), "private", "mirror")
	dependency := filepath.Join(
		originalRoot,
		"node_modules", ".pnpm", "pkg@1.0.0", "node_modules", "pkg", "index.d.ts",
	)

	original := &extractor{root: originalRoot}
	mirror := &extractor{root: mirrorRoot}

	originalCoordinate, originalOwned := original.symbolSourceCoordinate(dependency)
	mirrorCoordinate, mirrorOwned := mirror.symbolSourceCoordinate(dependency)
	if originalOwned || mirrorOwned {
		t.Fatalf("dependency declarations must remain external: original=%t mirror=%t", originalOwned, mirrorOwned)
	}
	if originalCoordinate != mirrorCoordinate {
		t.Fatalf("relocated dependency coordinate differs: original=%q mirror=%q", originalCoordinate, mirrorCoordinate)
	}
	if originalCoordinate != "package:pkg/index.d.ts" {
		t.Fatalf("unexpected portable dependency coordinate: %q", originalCoordinate)
	}
}
