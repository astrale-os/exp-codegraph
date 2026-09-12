package main

import (
	"strings"
	"testing"
)

// Keep the former extractor expression as the oracle, including its generic
// canonicalization. It independently determines field order and JSON spelling.
func legacyOccurrenceIdentity(universe string, span sourceSpan, kind string) string {
	return deriveID("occurrence", "typescript:"+universe, map[string]any{
		"source": span.Source, "revision": span.Revision,
		"start": span.Start, "end": span.End, "kind": kind,
	})
}

func TestOccurrenceIdentityCanonicalParity(t *testing.T) {
	base := sourceSpan{Source: "source:entry", Revision: "source-revision:before", Start: 12, End: 42}
	var workspace occurrenceIdentityWorkspace
	// This literal also pins the namespace and prefix independently of deriveID.
	const pinned = "occurrence:45fa943ff03d51ca3ce9f7552b6474e8ff7599b03f3447ac94a5a9dc8221b963"
	if got := workspace.identify("project-universe:test", base, "CallExpression"); got != pinned {
		t.Fatalf("published occurrence identity changed: %s != %s", got, pinned)
	}

	maxInt := int(^uint(0) >> 1)
	cases := []struct {
		name     string
		universe string
		span     sourceSpan
		kind     string
	}{
		{"universe", "project-universe:other", base, "CallExpression"},
		{"source", "project-universe:test", sourceSpan{Source: "source:other", Revision: base.Revision, Start: 12, End: 42}, "CallExpression"},
		{"revision", "project-universe:test", sourceSpan{Source: base.Source, Revision: "source-revision:after", Start: 12, End: 42}, "CallExpression"},
		{"start", "project-universe:test", sourceSpan{Source: base.Source, Revision: base.Revision, Start: 13, End: 42}, "CallExpression"},
		{"end", "project-universe:test", sourceSpan{Source: base.Source, Revision: base.Revision, Start: 12, End: 43}, "CallExpression"},
		{"kind", "project-universe:test", base, "Identifier"},
		{"empty", "", sourceSpan{}, ""},
		{"integer-limit", "project-universe:test", sourceSpan{Source: base.Source, Revision: base.Revision, Start: maxInt - 1, End: maxInt}, "CallExpression"},
		{"unicode", "univers:東京😀", sourceSpan{Source: "source:é\u2028東京", Revision: "revision:😀\u2029", Start: 0, End: 9}, "Expression\u2028\u2029"},
		{"escapes", "universe:\x00\"\\", sourceSpan{Source: "source:<&>\"\\/\x00\b\f\n\r\t\x1f", Revision: "literal:\\u2028\\u2029", Start: 0, End: 0}, "kind:\n<&>"},
		{"invalid-source", "project-universe:test", sourceSpan{Source: "source:\xff\xfe\xed\xa0\x80", Revision: base.Revision, Start: 1, End: 2}, "Identifier"},
		{"invalid-revision", "project-universe:test", sourceSpan{Source: base.Source, Revision: "revision:\xe2\x82", Start: 1, End: 2}, "Identifier"},
		{"invalid-kind", "project-universe:test", base, "kind:\xf0\x80\x80\x80"},
		{"raw-universe", "universe:\xff\xc0\xaf\x00", base, "Identifier"},
		{"replacement-rune", "universe:�", sourceSpan{Source: "source:�", Revision: "revision:�", Start: 1, End: 2}, "kind:�"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			want := legacyOccurrenceIdentity(test.universe, test.span, test.kind)
			if got := workspace.identify(test.universe, test.span, test.kind); got != want {
				t.Fatalf("canonical occurrence preimage changed: %s != %s", got, want)
			}
			if want == pinned {
				t.Fatal("changing an occurrence input must change its identity")
			}
		})
	}
}

func TestOccurrenceIdentityWorkspaceKeepsPublishedIdentities(t *testing.T) {
	a := sourceSpan{Source: "source:a", Revision: "source-revision:a", Start: 0, End: 7}
	b := sourceSpan{Source: strings.Repeat("長い😀<&>\"\\", 8192), Revision: strings.Repeat("revision", 8192), Start: 1024, End: 65536}
	inputs := []struct {
		universe string
		span     sourceSpan
		kind     string
	}{
		{"project-universe:a", a, "Identifier"},
		{strings.Repeat("other-universe", 4096), b, "CallExpression"},
		{"project-universe:a", a, "Identifier"},
		{"", sourceSpan{}, ""},
	}
	var first, second occurrenceIdentityWorkspace
	var published, expected []string
	for _, input := range inputs {
		published = append(published, first.identify(input.universe, input.span, input.kind))
		expected = append(expected, legacyOccurrenceIdentity(input.universe, input.span, input.kind))
		if got := second.identify(input.universe, input.span, input.kind); got != expected[len(expected)-1] {
			t.Fatal("another extractor's workspace changed the identity")
		}
	}
	for index, got := range published {
		if got != expected[index] {
			t.Fatalf("retained identity %d changed after workspace reuse: %s != %s", index, got, expected[index])
		}
	}
	if published[0] != published[2] {
		t.Fatal("returning to an earlier occurrence must recover its identity")
	}
}

var occurrenceIdentityBenchmarkResult string

func BenchmarkOccurrenceIdentity(b *testing.B) {
	universe := "project-universe:" + strings.Repeat("a", 64)
	span := sourceSpan{Source: "source:" + strings.Repeat("b", 64), Revision: "source-revision:" + strings.Repeat("c", 64), Start: 1234, End: 1296}
	const kind = "CallExpression"
	b.Run("legacy", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			occurrenceIdentityBenchmarkResult = legacyOccurrenceIdentity(universe, span, kind)
		}
	})
	b.Run("workspace", func(b *testing.B) {
		var workspace occurrenceIdentityWorkspace
		workspace.identify(universe, span, kind)
		b.ReportAllocs()
		for b.Loop() {
			occurrenceIdentityBenchmarkResult = workspace.identify(universe, span, kind)
		}
	})
}
