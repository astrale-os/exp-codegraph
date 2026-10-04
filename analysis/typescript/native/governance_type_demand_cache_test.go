package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func typeDemandTestProject(t *testing.T, root string, cache *governanceTypeDemandCache) (*governedProject, *sourcepolicy.File, *ast.Node) {
	t.Helper()
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	project.typeDemandCache = cache
	shared := governanceSharedProject(project)
	file := shared.FilesByPath["mutations/demand.ts"]
	if file == nil {
		t.Fatal("demand file absent")
	}
	var expression *ast.Node
	walkFile(file.Source, func(node *ast.Node) bool {
		if node.Kind == ast.KindExpressionStatement {
			expression = node.AsExpressionStatement().Expression
		}
		return true
	})
	if expression == nil {
		t.Fatal("demand expression absent")
	}
	return project, file, expression
}
func typeDemandFixture(t *testing.T) string {
	t.Helper()
	root := governanceTempDir(t)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","noLib":true,"types":[]},"include":["mutations","queries","schema"]}`)
	governanceWrite(t, root, "mutations/demand.ts", `import { subject } from '../schema/value.js'; subject;`)
	governanceWrite(t, root, "schema/value.ts", `export const subject = { before: 1 };`)
	governanceWrite(t, root, "queries/independent.ts", `export const independent = (): number => 1;`)
	return root
}
func testTypeDemand(t *testing.T, root string, cache *governanceTypeDemandCache) (*governedProject, sourcepolicy.NamesObservation) {
	t.Helper()
	project, file, node := typeDemandTestProject(t, root, cache)
	value := project.typeOwner.names(file, node)
	if project.typeRelease != nil {
		project.typeRelease()
		project.typeRelease = nil
	}
	return project, value
}
func TestGovernanceTypeDemandReusesExactIndependentBodyEdit(t *testing.T) {
	root := typeDemandFixture(t)
	cache := &governanceTypeDemandCache{}
	first, old := testTypeDemand(t, root, cache)
	if first.stats.CompilerPrograms != 1 || !reflect.DeepEqual(old.Names, []string{"before"}) {
		t.Fatalf("first=%#v stats=%#v", old, first.stats)
	}
	governanceWrite(t, root, "queries/independent.ts", `export const independent = (): number => 2;`)
	next, current := testTypeDemand(t, root, cache)
	if next.stats.TypeCacheHits != 1 || next.stats.CompilerPrograms != 0 || !reflect.DeepEqual(old, current) {
		t.Fatalf("current=%#v stats=%#v", current, next.stats)
	}
	same, err := next.capture.Verify()
	if err != nil || !same {
		t.Fatalf("seal %v %v", same, err)
	}
	// A fresh original checker, with no cache, must produce exactly the same cell.
	_, fresh := testTypeDemand(t, root, &governanceTypeDemandCache{})
	if !reflect.DeepEqual(current, fresh) {
		t.Fatalf("replay=%#v current=%#v", current, fresh)
	}
	governanceWrite(t, root, "queries/independent.ts", `export const independent = (): number => 3;`)
	same, err = next.capture.Verify()
	if err != nil || same {
		t.Fatalf("start receipt certified later edit: %v %v", same, err)
	}
}
func TestGovernanceTypeDemandRejectsContextAndDependencyChanges(t *testing.T) {
	cases := []struct{ name, path, text string }{
		{"direct", "mutations/demand.ts", `const subject={after:1}; subject;`},
		{"dependency", "schema/value.ts", `export const subject={after:1};`},
		{"new-global", "queries/independent.ts", `const independent=2;`},
		{"augmentation", "queries/independent.ts", `export {}; declare module '../schema/value.js' { interface Added { x: number } }`},
		{"global-augmentation", "queries/independent.ts", `export {}; declare global { interface Object { x: number } }`},
		{"new-reference", "queries/independent.ts", `import type { subject } from '../schema/value.js'; export const independent = (): number => 2;`},
		{"options", "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"ESNext","noLib":true,"types":[],"strict":true},"include":["mutations","queries","schema"]}`},
		{"membership", "queries/new.ts", `export const newMember=1;`},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			root := typeDemandFixture(t)
			cache := &governanceTypeDemandCache{}
			testTypeDemand(t, root, cache)
			governanceWrite(t, root, item.path, item.text)
			next, current := testTypeDemand(t, root, cache)
			if next.stats.CompilerPrograms != 1 || next.stats.TypeCacheHits != 0 {
				t.Fatalf("stale hit: %#v", next.stats)
			}
			_, fresh := testTypeDemand(t, root, &governanceTypeDemandCache{})
			if !reflect.DeepEqual(current, fresh) {
				t.Fatalf("fresh=%#v current=%#v", fresh, current)
			}
		})
	}
}
func TestGovernanceTypeDemandNegativeResolutionAndSameStatReads(t *testing.T) {
	root := typeDemandFixture(t)
	governanceWrite(t, root, "mutations/demand.ts", `import { subject } from '../schema/missing.js'; subject;`)
	cache := &governanceTypeDemandCache{}
	testTypeDemand(t, root, cache)
	governanceWrite(t, root, "schema/missing.ts", `export const subject={appeared:1};`)
	next, value := testTypeDemand(t, root, cache)
	if next.stats.CompilerPrograms != 1 || !reflect.DeepEqual(value.Names, []string{"appeared"}) {
		t.Fatalf("negative=%#v stats=%#v", value, next.stats)
	}
	path := filepath.Join(root, "schema/missing.ts")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	governanceWrite(t, root, "schema/missing.ts", `export const subject={modified:1};`)
	if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	next, value = testTypeDemand(t, root, cache)
	if next.stats.CompilerPrograms != 1 || !reflect.DeepEqual(value.Names, []string{"modified"}) {
		t.Fatalf("same-stat=%#v stats=%#v", value, next.stats)
	}
}
func TestGovernanceTypeDemandSameOwnerMemo(t *testing.T) {
	root := typeDemandFixture(t)
	project, file, node := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
	defer func() {
		if project.typeRelease != nil {
			project.typeRelease()
		}
	}()
	first := project.typeOwner.names(file, node)
	second := project.typeOwner.names(file, node)
	if !reflect.DeepEqual(first, second) || project.stats.TypeCacheHits != 1 || project.stats.CompilerPrograms != 1 {
		t.Fatal(project.stats)
	}
}

func TestGovernanceTypeDemandReferenceFormsAndPackageConditions(t *testing.T) {
	cases := []struct {
		name       string
		setup      map[string]string
		path, text string
	}{
		{"reexport", map[string]string{"schema/barrel.ts": `export * from './value.js';`, "mutations/demand.ts": `import {subject} from '../schema/barrel.js'; subject;`}, "schema/value.ts", `export const subject={after:1};`},
		{"typeof-import", map[string]string{"mutations/demand.ts": `export {}; const subject={} as typeof import('../schema/value.js').subject; subject;`}, "schema/value.ts", `export const subject={after:1};`},
		{"triple-slash", map[string]string{"schema/global.ts": `interface GlobalSubject {before:number}`, "mutations/demand.ts": "/// <reference path='../schema/global.ts'/>\nexport {};const subject={} as GlobalSubject;subject;"}, "schema/global.ts", `interface GlobalSubject {after:number}`},
		{"augmentation-backreference", map[string]string{"schema/value.ts": `export interface Subject {before:number};export const subject={} as Subject;`, "queries/augment.ts": `export {}; declare module '../schema/value.js' {interface Subject {merged:number}}`}, "queries/augment.ts", `export {}; declare module '../schema/value.js' {interface Subject {changed:number}}`},
		{"package-conditions", map[string]string{"node_modules/cache-pkg/package.json": `{"name":"cache-pkg","exports":{"types":"./first.d.ts"}}`, "node_modules/cache-pkg/first.d.ts": `export const subject:{before:number};`, "node_modules/cache-pkg/second.d.ts": `export const subject:{after:number};`, "mutations/demand.ts": `import {subject} from 'cache-pkg';subject;`}, "node_modules/cache-pkg/package.json", `{"name":"cache-pkg","exports":{"types":"./second.d.ts"}}`},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			root := typeDemandFixture(t)
			for path, text := range item.setup {
				governanceWrite(t, root, path, text)
			}
			cache := &governanceTypeDemandCache{}
			testTypeDemand(t, root, cache)
			governanceWrite(t, root, item.path, item.text)
			next, current := testTypeDemand(t, root, cache)
			if item.name == "package-conditions" {
				if next.stats.CompilerPrograms != 0 || next.stats.TypeCacheHits != 1 {
					t.Fatalf("expected private deferred candidate: %#v", next.stats)
				}
				if _, forged := next.capture.compiler.observed[compilerInputKey{filepath.Join(root, "node_modules/cache-pkg/first.d.ts"), inputRead}]; forged {
					t.Fatal("pending external bytes promoted to actual compiler reads")
				}
				same, err := next.capture.Verify()
				if err != nil || same {
					t.Fatalf("changed external obligations sealed %v %v", same, err)
				}
				if len(cache.entries) != 0 {
					t.Fatal("failed receipt was not evicted")
				}
				next, current = testTypeDemand(t, root, cache)
			}
			if next.stats.CompilerPrograms != 1 || next.stats.TypeCacheHits != 0 {
				t.Fatalf("stale hit: %#v", next.stats)
			}
			_, fresh := testTypeDemand(t, root, &governanceTypeDemandCache{})
			if !reflect.DeepEqual(current, fresh) {
				t.Fatalf("fresh=%#v current=%#v", fresh, current)
			}
		})
	}
}

func TestGovernanceTypeDemandDeferredExternalSealRetriesAndRecovers(t *testing.T) {
	root := typeDemandFixture(t)
	governanceWrite(t, root, "node_modules/cache-pkg/package.json", `{"name":"cache-pkg","exports":{"types":"./first.d.ts"}}`)
	governanceWrite(t, root, "node_modules/cache-pkg/first.d.ts", `export const subject:{before:number};`)
	governanceWrite(t, root, "mutations/demand.ts", `import {subject} from 'cache-pkg';subject;`)
	cache := &governanceTypeDemandCache{}
	testTypeDemand(t, root, cache)
	governanceWrite(t, root, "node_modules/cache-pkg/first.d.ts", `export const subject:{after:number};`)
	proposed, value := testTypeDemand(t, root, cache)
	if proposed.stats.TypeCacheHits != 1 || proposed.stats.CompilerPrograms != 0 || !reflect.DeepEqual(value.Names, []string{"before"}) {
		t.Fatal("expected pending private oldcell", proposed.stats, value)
	}
	digest := strings.Repeat("a", 64)
	session := &governanceSession{productsSession: &governanceProductsSession{Project: proposed, Token: "pending", ProductsDigest: digest, InputCertificate: proposed.capture.certificate(), Generation: "1"}}
	response, err := session.sealProducts("pending", digest, strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	if response.(map[string]any)["status"] != "retry" || len(cache.entries) != 0 {
		t.Fatal("stale obligation published or retained", response, len(cache.entries))
	}
	recovered, current := testTypeDemand(t, root, cache)
	if recovered.stats.CompilerPrograms != 1 || !reflect.DeepEqual(current.Names, []string{"after"}) {
		t.Fatal("retry did not recover", recovered.stats, current)
	}
	session.productsSession = &governanceProductsSession{Project: recovered, Token: "fresh", ProductsDigest: digest, InputCertificate: recovered.capture.certificate(), Generation: "2"}
	response, err = session.sealProducts("fresh", digest, strings.Repeat("c", 64))
	if err != nil || response.(map[string]any)["status"] != "committed" {
		t.Fatal("current recovery did not seal", response, err)
	}
}
