package main

import (
	"slices"
	"strings"
	"testing"
)

// Keep the former expressions as an oracle for the collision key, independently
// of the new field order, typed encoding and workspace lifetime.
func legacySymbolIdentityKey(name, syntax string, lexical []string) string {
	return stableJSON(map[string]any{
		"name": name, "syntax": syntax, "lexical": lexical,
	})
}

func TestSymbolIdentityKeyCanonicalParity(t *testing.T) {
	var workspace symbolIdentityKeyWorkspace
	const pinned = `{"lexical":["Outer","inner"],"name":"value","syntax":"VariableDeclaration"}`
	if got := workspace.key("value", "VariableDeclaration", []string{"Outer", "inner"}); got != pinned {
		t.Fatalf("collision key changed: %q != %q", got, pinned)
	}
	cases := []struct {
		label   string
		name    string
		syntax  string
		lexical []string
	}{
		{"name", "other", "VariableDeclaration", []string{"Outer", "inner"}},
		{"syntax", "value", "FunctionDeclaration", []string{"Outer", "inner"}},
		{"lexical", "value", "VariableDeclaration", []string{"Outer", "other"}},
		{"lexical-order", "value", "VariableDeclaration", []string{"inner", "Outer"}},
		{"empty", "", "", []string{}},
		{"nil-lexical", "", "", nil},
		{"empty-entry", "", "", []string{""}},
		{"private", "#value", "PropertyDeclaration", []string{"Outer", "Inner"}},
		{"anonymous", "<anonymous>", "FunctionExpression", []string{}},
		{"unicode", "値😀", "識別子\u2028\u2029", []string{"東京", "é😀\u2028\u2029"}},
		{"escapes", "value:<&>\"\\/\x00\b\f\n\r\t\x1f", "syntax:\\u2028\\ufffd", []string{"owner:\x00\x01\n\"\\", "<&>/"}},
		{"invalid-name", "value:\xff\xfe\xed\xa0\x80", "Identifier", []string{"Outer"}},
		{"invalid-syntax", "value", "kind:\xe2\x82", []string{"Outer"}},
		{"invalid-first-lexical", "value", "Identifier", []string{"outer:\xc0\xaf", "inner"}},
		{"invalid-later-lexical", "value", "Identifier", []string{"outer", "inner:\xf0\x80\x80\x80"}},
		{"invalid-all", "\xff", "\xfe", []string{"\xff", "\xfe"}},
		{"internal-object", "\xfeobject", "ObjectLiteralExpression", []string{"createQuery"}},
		{"internal-lexical", "result", "PropertyAssignment", []string{"createQuery", "\xfefunction", "\xfeobject"}},
		{"replacement-rune", "value:�", "syntax:�", []string{"owner:�"}},
	}
	for _, test := range cases {
		t.Run(test.label, func(t *testing.T) {
			want := legacySymbolIdentityKey(test.name, test.syntax, test.lexical)
			if got := workspace.key(test.name, test.syntax, test.lexical); got != want {
				t.Fatalf("canonical collision key differs: %q != %q", got, want)
			}
		})
	}
	if got := workspace.key("", "", []string{}); got != `{"lexical":[],"name":"","syntax":""}` {
		t.Fatalf("empty lexical chain must remain an array: %q", got)
	}
	if workspace.key("", "", nil) == workspace.key("", "", []string{}) {
		t.Fatal("null and empty lexical chains must remain distinct")
	}
}

func TestSymbolIdentityKeyKeepsNormalizedCollisionEquality(t *testing.T) {
	var workspace symbolIdentityKeyWorkspace
	invalid := workspace.key("\xff", "Identifier", []string{"Outer", "\xfe"})
	replacement := workspace.key("�", "Identifier", []string{"Outer", "�"})
	const pinned = `{"lexical":["Outer","�"],"name":"�","syntax":"Identifier"}`
	if invalid != pinned || replacement != pinned {
		t.Fatalf("normalized collision equality changed: invalid=%q replacement=%q", invalid, replacement)
	}
	if workspace.key(`\ufffd`, "Identifier", []string{"Outer", `\ufffd`}) == replacement {
		t.Fatal("literal escape text must not become a replacement rune")
	}
}

func TestSymbolIdentityKeyNormalizesEachInvalidDecodingStep(t *testing.T) {
	var workspace symbolIdentityKeyWorkspace
	for _, test := range []struct {
		label      string
		input      string
		normalized string
	}{
		{"internal-name", "\xfeobject", "�object"},
		{"adjacent", "\xff\xfe", "��"},
		{"overlong", "\xc0\xaf", "��"},
		{"surrogate", "\xed\xa0\x80", "���"},
		{"truncated", "\xf0\x9f", "��"},
		{"separated", "\xffx\xfe", "�x�"},
		{"literal-and-invalid", "�\xff😀\xfe�", "��😀��"},
		{"escaped-and-invalid", "\xff\"\\\x00<&>\u2028\u2029", "�\"\\\x00<&>\u2028\u2029"},
	} {
		t.Run(test.label, func(t *testing.T) {
			got := workspace.key(test.input, test.input, []string{test.input})
			want := legacySymbolIdentityKey(test.input, test.input, []string{test.input})
			if got != want || got != workspace.key(test.normalized, test.normalized, []string{test.normalized}) {
				t.Fatalf("invalid decoding steps changed collision equality: %q != %q", got, want)
			}
		})
	}
	const pinned = `{"lexical":["��"],"name":"��","syntax":"��"}`
	if got := workspace.key("\xff\xfe", "\xff\xfe", []string{"\xff\xfe"}); got != pinned {
		t.Fatalf("adjacent invalid bytes collapsed: %q != %q", got, pinned)
	}
}

func TestSymbolIdentityKeyNormalizationOwnsAndClearsLexicalScratch(t *testing.T) {
	var workspace symbolIdentityKeyWorkspace
	workspace.key("value", "Identifier", []string{"Outer", "inner"})
	if workspace.lexicalScratch != nil {
		t.Fatal("valid lexical chains should be borrowed without scratch")
	}
	large := strings.Repeat("owner長い😀", 8192)
	lexical := []string{"Outer", "\xfefunction", large, "\xfeobject", "\xff\xfe"}
	original := slices.Clone(lexical)
	want := legacySymbolIdentityKey("\xfeobject", "ObjectLiteralExpression", lexical)
	published := workspace.key("\xfeobject", "ObjectLiteralExpression", lexical)
	counts := map[string]int{published: 2}
	if !slices.Equal(lexical, original) {
		t.Fatal("normalization mutated the caller's lexical chain")
	}
	if cap(workspace.lexicalScratch) < len(lexical) {
		t.Fatal("invalid lexical chains need an owned normalization buffer")
	}
	assertCleared := func() {
		t.Helper()
		if workspace.input.Lexical != nil || workspace.input.Name != "" || workspace.input.Syntax != "" || len(workspace.lexicalScratch) != 0 {
			t.Fatal("workspace retained input after encoding")
		}
		for _, value := range workspace.lexicalScratch[:cap(workspace.lexicalScratch)] {
			if value != "" {
				t.Fatal("normalization scratch retained a lexical name")
			}
		}
	}
	assertCleared()
	lexical[1] = "mutated after encoding"
	// Reuse less scratch, then borrow a valid chain. Historical slots must stay
	// empty, and neither the published key nor the caller's new data may change.
	workspace.key("\xfeobject", "ObjectLiteralExpression", []string{"\xfefunction"})
	assertCleared()
	workspace.key("value", "Identifier", []string{"Outer"})
	assertCleared()
	workspace.key("", "", nil)
	assertCleared()
	workspace.key("", "", []string{})
	assertCleared()
	if published != want || counts[want] != 2 || lexical[1] != "mutated after encoding" {
		t.Fatal("normalization scratch corrupted a caller or collision inventory")
	}
}

func TestSymbolIdentityKeyWorkspaceKeepsOwnedKeys(t *testing.T) {
	var first, second symbolIdentityKeyWorkspace
	lexical := []string{"Outer", "inner"}
	want := legacySymbolIdentityKey("value", "VariableDeclaration", lexical)
	published := first.key("value", "VariableDeclaration", lexical)
	counts := map[string]int{published: 2}
	lexical[0] = "mutated after encoding"
	large := strings.Repeat("長い😀<&>\"\\\x00", 8192)
	cases := []struct {
		name    string
		syntax  string
		lexical []string
	}{
		{large, "FunctionDeclaration", []string{large, "inner"}},
		{"\xff", "Identifier", []string{"\xfe"}},
		{"value", "VariableDeclaration", []string{"Outer", "inner"}},
		{"", "", []string{}},
	}
	var retained, expected []string
	for _, test := range cases {
		retained = append(retained, first.key(test.name, test.syntax, test.lexical))
		expected = append(expected, legacySymbolIdentityKey(test.name, test.syntax, test.lexical))
		if got := second.key(test.name, test.syntax, test.lexical); got != expected[len(expected)-1] {
			t.Fatal("independent extractor workspace changed the key")
		}
		if first.input.Lexical != nil || first.input.Name != "" || first.input.Syntax != "" {
			t.Fatal("workspace retained the caller's lexical chain or names")
		}
	}
	for index, got := range retained {
		if got != expected[index] {
			t.Fatalf("retained key %d changed after workspace reuse", index)
		}
	}
	if published != want || retained[2] != want || counts[want] != 2 {
		t.Fatal("reusing the key encoder corrupted a collision inventory")
	}
}

var symbolIdentityKeyBenchmarkResult string

func BenchmarkSymbolIdentityKey(b *testing.B) {
	for _, input := range []struct {
		label   string
		name    string
		syntax  string
		lexical []string
	}{
		{"top-level", "createQuery", "VariableDeclaration", []string{}},
		{"nested", "result", "VariableDeclaration", []string{"defineQuery", "projector", "resolve"}},
		{"escaped-owner", "result", "VariableDeclaration", []string{"__type\x00owner", "projector"}},
		// TypeScript-Go internal/ast/symbol.go defines the invalid UTF-8 prefix
		// \xFE for anonymous object/function symbols. These are representative
		// compiler inputs, not a measurement of their frequency in a corpus.
		{"internal-object", "\xfeobject", "ObjectLiteralExpression", []string{"createQuery"}},
		{"internal-lexical", "result", "PropertyAssignment", []string{"createQuery", "\xfeobject"}},
		{"internal-nested", "\xfeobject", "ObjectLiteralExpression", []string{"createQuery", "\xfefunction", "\xfeobject"}},
	} {
		b.Run(input.label, func(b *testing.B) {
			b.Run("legacy", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					symbolIdentityKeyBenchmarkResult = legacySymbolIdentityKey(input.name, input.syntax, input.lexical)
				}
			})
			b.Run("workspace", func(b *testing.B) {
				var workspace symbolIdentityKeyWorkspace
				workspace.key(input.name, input.syntax, input.lexical)
				b.ReportAllocs()
				for b.Loop() {
					symbolIdentityKeyBenchmarkResult = workspace.key(input.name, input.syntax, input.lexical)
				}
			})
		})
	}
}
