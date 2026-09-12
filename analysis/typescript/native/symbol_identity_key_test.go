package main

import (
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
