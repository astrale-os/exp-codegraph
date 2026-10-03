package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"reflect"
	"testing"
)

func TestGovernanceTypeLiteralFidelityKinds(t *testing.T) {
	for _, test := range []struct {
		source   string
		faithful bool
	}{
		{`const value='\uFFFD';`, true},
		{`const value='\uD800\uDC00';`, true},
		{`const value='\u{10000}';`, true},
		{`const value='\\uD800';`, true},
		{`const value='\uD800';`, false},
		{"const value=`\\uD800`;", false},
		{"type Value=`\\uD800${string}x`;", false},
		{"type Value=`x${string}\\uD800${number}y`;", false},
		{"type Value=`x${string}\\uDFFF`;", false},
		{"type Value=`\\uFFFD${string}\\uD800\\uDC00${number}z`;", true},
		{"const value=tag`\\u{ZZ}`;", false},
		{`/** @type {{"\uD800": number}} */ const value={};`, false},
		{`/** @import {Value} from "\uD800" */ export {};`, false},
		{`/** Documentation says \u0041. */ export {};`, false},
		{`/** Ordinary documentation. */ const value="\\uD800";`, true},
		{`/** @type {{"\uD800": number}} */`, false},
	} {
		source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/private/fidelity.ts"}, test.source, core.ScriptKindTS)
		if actual := governanceTypeLiteralFidelity(source); actual != test.faithful {
			t.Fatalf("source=%q faithful=%v expected=%v", test.source, actual, test.faithful)
		}
	}
}

func TestGovernanceTypeLiteralFidelityFreshOwnedUniverse(t *testing.T) {
	for _, test := range []struct{ path, text string }{
		{"schema/value.ts", `export const subject={'\uD800':1,'\uFFFD':2};`},
		{"queries/independent.ts", `export const independent={'\uD800':1};`},
		{"schema/global.d.ts", `declare const globalValue:{'\uD800':1};`},
		{"schema/template.d.ts", "type GlobalKey=`x${string}\\uD800`;"},
		{"schema/docs.d.ts", `/** @type {{"\uD800": number}} */ declare const globalValue:{};`},
		{"schema/doc-import.d.ts", `/** @import {Value} from "\uD800" */ export {};`},
	} {
		t.Run(test.path, func(t *testing.T) {
			root := typeDemandFixture(t)
			governanceWrite(t, root, test.path, test.text)
			project, file, expression := typeDemandTestProject(t, root, nil)
			t.Cleanup(func() {
				if project.typeRelease != nil {
					project.typeRelease()
				}
			})
			if value := project.typeOwner.names(file, expression); value.Known || len(project.typeOwner.cells) != 0 {
				t.Fatalf("unsafe fresh names published: %#v", value)
			}
			if value := project.typeOwner.collectionKind(file, expression); value.Known || len(project.typeOwner.cells) != 0 {
				t.Fatalf("unsafe fresh collection published: %#v", value)
			}
			for _, source := range project.typeOwner.program.TSProgram.SourceFiles() {
				if _, present := project.typeOwner.typeSourceBase[source.FileName()]; !present {
					t.Fatal("compiler source omitted from prerequisite", source.FileName())
				}
			}
		})
	}
}

func TestGovernanceTypeLiteralFidelityCacheAndRepair(t *testing.T) {
	root := typeDemandFixture(t)
	governanceWrite(t, root, "schema/value.ts", `export const subject={'\uFFFD':1};`)
	cache := &governanceTypeDemandCache{}
	_, first := testTypeDemand(t, root, cache)
	if !first.Known || !reflect.DeepEqual(first.Names, []string{"\uFFFD"}) || len(cache.entries) != 1 {
		t.Fatalf("valid replacement character was rejected: %#v", first)
	}
	warm, second := testTypeDemand(t, root, cache)
	if warm.stats.TypeCacheHits != 1 || warm.stats.CompilerPrograms != 0 || !reflect.DeepEqual(first, second) {
		t.Fatalf("witnessed hit failed: %#v %#v", second, warm.stats)
	}
	for key, entry := range cache.entries {
		entry.value.literalFaithful = false
		cache.entries[key] = entry
	}
	miss, third := testTypeDemand(t, root, cache)
	if miss.stats.TypeCacheHits != 0 || miss.stats.CompilerPrograms != 1 || !reflect.DeepEqual(first, third) {
		t.Fatalf("unwitnessed entry reused: %#v %#v", third, miss.stats)
	}
	governanceWrite(t, root, "queries/independent.ts", `export const independent={'\uD800':1};`)
	unsafe, fourth := testTypeDemand(t, root, cache)
	if fourth.Known || unsafe.stats.TypeCacheHits != 0 || len(unsafe.typeOwner.cells) != 0 {
		t.Fatalf("changed ordinary source escaped prerequisite: %#v %#v", fourth, unsafe.stats)
	}
	governanceWrite(t, root, "queries/independent.ts", `export const independent=1;`)
	_, repaired := testTypeDemand(t, root, nil)
	if !reflect.DeepEqual(first, repaired) {
		t.Fatalf("repair did not recover original names: %#v", repaired)
	}
}
