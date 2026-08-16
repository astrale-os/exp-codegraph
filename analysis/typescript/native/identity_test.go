package main

import (
	"path/filepath"
	"testing"
)

func TestStableJSONMatchesPortableUnicodeSeparatorSpelling(t *testing.T) {
	actual := stableJSON(map[string]any{
		"actual":  "line\u2028paragraph\u2029separator",
		"literal": `line\u2028paragraph\u2029separator`,
	})
	expected := `{"actual":"line\u2028paragraph\u2029separator","literal":"line\\u2028paragraph\\u2029separator"}`
	if actual != expected {
		t.Fatalf("portable canonical JSON differs:\nactual:   %s\nexpected: %s", actual, expected)
	}
}

func TestOwnedPathNormalizesPackageManagerAndSymlinkedDependencies(t *testing.T) {
	root := t.TempDir()
	dependency := filepath.Join(
		root,
		"node_modules", ".pnpm", "@jsr+astrale__typescript-config@1.1.3",
		"node_modules", "@jsr", "astrale__typescript-config", "base.json",
	)
	extractor := extractor{root: root}
	actual, owned := extractor.ownedPath(dependency)
	if owned {
		t.Fatal("installed package configuration was classified as project-owned")
	}
	if actual != "package:@jsr/astrale__typescript-config/base.json" {
		t.Fatalf("dependency coordinate is %q", actual)
	}
}

func TestOwnedPathExcludesEveryTypeScriptDeclarationExtension(t *testing.T) {
	root := t.TempDir()
	extractor := extractor{root: root}
	for _, name := range []string{"types.d.ts", "types.d.mts", "types.d.cts"} {
		if _, owned := extractor.ownedPath(filepath.Join(root, "src", name)); owned {
			t.Fatalf("%s was classified as an executable project-owned source", name)
		}
	}
}

func TestPortableSignatureNormalizesPackageManagerAndRelocatedImports(t *testing.T) {
	physical := `(value: import("micromark-util-types").Value): import(".pnpm/@types+mdast@4.0.4/node_modules/@types/mdast").Root`
	relocated := `(value: import("micromark-util-types").Value): import("../../checkout/node_modules/.pnpm/@types+mdast@4.0.4/node_modules/@types/mdast/index.js").Root`
	expected := `(value: import("micromark-util-types").Value): import("@types/mdast").Root`
	for name, input := range map[string]string{"physical": physical, "relocated": relocated} {
		if actual := portableSignature(input); actual != expected {
			t.Fatalf("%s signature is not portable:\nactual:   %s\nexpected: %s", name, actual, expected)
		}
	}
}
