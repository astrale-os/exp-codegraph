package main

import (
	"encoding/json"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func governanceTestPolicy() governancePolicy {
	return governancePolicy{Rules: "id\tscope\tkind\tseverity\tmessage\tverification\texample\nIMP-STATIC\timports\tdependency\terror\tmessage\tproof\tproof.md\n", Layers: []governanceLayer{{ID: "schema", SourcePath: "schema/", Required: true}, {ID: "mutations", SourcePath: "mutations/"}, {ID: "tests", SourcePath: "tests/"}}, RootFiles: []governanceRoot{{ID: "package", SourcePath: "index.ts", Role: "package-facade", Required: true}}, Dependencies: json.RawMessage("[]"), Aliases: json.RawMessage("[]")}
}
func governanceTempDir(t *testing.T) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return root
}
func governanceWrite(t *testing.T, root, path, text string) {
	t.Helper()
	absolute := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(absolute), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(absolute, []byte(text), 0644); err != nil {
		t.Fatal(err)
	}
}
func TestGovernanceCaptureCanonicalizesSymlinkedParentAndGuardsRetarget(t *testing.T) {
	parent, replacement := governanceTempDir(t), governanceTempDir(t)
	for _, directory := range []string{parent, replacement} {
		governanceWrite(t, directory, "domain/index.ts", "export {}")
	}
	alias := filepath.Join(governanceTempDir(t), "parent")
	if err := os.Symlink(parent, alias); err != nil {
		t.Fatal(err)
	}
	requested := filepath.Join(alias, "domain")
	project, err := captureGovernedProject(requested, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	canonical := filepath.Join(parent, "domain")
	if project.Root != canonical || project.capture.root != canonical {
		t.Fatalf("capture retained requested alias: project=%q capture=%q", project.Root, project.capture.root)
	}
	if ok, err := project.capture.Verify(); !ok || err != nil {
		t.Fatalf("unchanged requested root failed verification: %v", err)
	}
	if err := os.Remove(alias); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(replacement, alias); err != nil {
		t.Fatal(err)
	}
	if ok, _ := project.capture.Verify(); ok {
		t.Fatal("publication accepted a retargeted requested root")
	}
}
func TestGovernanceFinalBarrierRejectsNewNegativeConfig(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "require('x')")
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	session := governanceSession{}
	candidate := session.stage(project, `{"report":"private-not-qualified"}`)
	governanceWrite(t, root, "pnpm-workspace.yaml", "packages: []\n")
	result, err := session.seal(candidate.token, candidate.reportDigest)
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "retry" {
		t.Fatal("published report after negative config observation changed")
	}
	result, err = session.seal(candidate.token, candidate.reportDigest)
	if err != nil || result["status"] != "retry" {
		t.Fatal("replayed token was accepted")
	}
}
func TestGovernanceFinalBarrierRejectsBytesAfterConsumerAdmission(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "require('x')")
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	session := governanceSession{}
	candidate := session.stage(project, `{"report":"private-not-qualified"}`)
	governanceWrite(t, root, "mutations/source.ts", "require('y')")
	result, err := session.seal(candidate.token, candidate.reportDigest)
	if err != nil || result["status"] != "retry" {
		t.Fatalf("accepted same-size edit%v%v", result, err)
	}
}
func TestGovernanceFinalBarrierLeavesUnobservedIgnoredBytesAlone(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", "require('x')")
	governanceWrite(t, root, "node_modules/ignored.ts", "const x=1")
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceWrite(t, root, "node_modules/ignored.ts", "not syntax!!!")
	same, err := project.capture.Verify()
	if err != nil || !same {
		t.Fatalf("unobserved ignored bytes changed capture%v%v", same, err)
	}
}
func TestGovernanceCapturesAllGovernedOutsideProgramAndCoordinates(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "tsconfig.json", `{"files":[]}`)
	governanceWrite(t, root, "mutations/outside.d.ts", "\ufeff//😀\r\ntype Bad=import(Variable).T;\u2028")
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if len(project.Files) != 1 || !strings.HasPrefix(project.Files[0].Text, "\ufeff") {
		t.Fatal("governed membership or BOM lost")
	}
	var imported *ast.Node
	walk(project.Files[0].Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindImportType {
			if imported != nil {
				t.Fatal("unexpected second parser-owned import type")
			}
			imported = node
		}
		return true
	})
	if imported == nil {
		t.Fatal("missing parser-owned import type")
	}
	location := governanceLocation(project.Files[0], imported)
	if location.Line != 2 || location.Column != 10 || location.Offset != 16 {
		t.Fatalf("wrong coordinates%v", location)
	}
	if project.Files[0].Source.AsNode().Kind != ast.KindSourceFile {
		t.Fatal("missing parsed source")
	}
}
func TestGovernanceDefinitionIDsPreserveOriginalIterationAndFacadeUnknown(t *testing.T) {
	root := t.TempDir()
	policy := governanceTestPolicy()
	policy.Layers = append(policy.Layers, governanceLayer{ID: "queries", SourcePath: "queries/"})
	governanceWrite(t, root, "queries/a.ts", `import {defineQuery as dq} from '@astrale-os/sdk';const alias=dq;dq()(()=>({id:'same'}));alias()(()=>({id:'same'}));function nested(){dq()(()=>({id:'InvalidCaps'}))}`)
	governanceWrite(t, root, "queries/z.ts", `import {defineCollectionQuery} from '@astrale-os/sdk';defineCollectionQuery()(()=>({id:'same'}));`)
	governanceWrite(t, root, "queries/relative.ts", `import {defineQuery} from './facade.js';function nested(){defineQuery()(()=>({id:'same'}))}`)
	project, err := captureGovernedProject(root, policy)
	if err != nil {
		t.Fatal(err)
	}
	out := governanceDefinitionIDs(project)
	if len(out.Findings) != 2 {
		t.Fatalf("unexpected findings%v", out.Findings)
	}
	if out.Findings[0].Kind != "violation" || out.Findings[0].Location.Path != "queries/a.ts" || !strings.Contains(out.Findings[0].Evidence, "first declared in queries/z.ts.") {
		t.Fatalf("category iteration/order changed%v", out.Findings[0])
	}
	if out.Findings[1].Kind != "ambiguity" || out.Findings[1].Location.Path != "queries/relative.ts" {
		t.Fatalf("relative facade unknown strengthened or top-level filter reordered%v", out.Findings[1])
	}
}
func TestGovernanceResolverContextsAndImportModeConflictWithoutProgram(t *testing.T) {
	root := t.TempDir()
	policy := governanceTestPolicy()
	governanceWrite(t, root, "package.json", `{"type":"module","imports":{"#helper":"./mutations/package.ts"}}`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","paths":{"#helper":["./tests/compiler.ts"]}}}`)
	governanceWrite(t, root, "mutations/package.ts", "export const value=1")
	governanceWrite(t, root, "tests/compiler.ts", "export const value=2")
	governanceWrite(t, root, "mutations/use.ts", `import {value} from '#helper';`)
	project, err := captureGovernedProject(root, policy)
	if err != nil {
		t.Fatal(err)
	}
	file := project.FilesByPath["mutations/use.ts"]
	compiler := project.resolveImport(file, "#helper", false)
	packaged := project.resolveImport(file, "#helper", true)
	if !compiler.IsResolved() || !packaged.IsResolved() || !strings.HasSuffix(compiler.ResolvedFileName, "/tests/compiler.ts") || !strings.HasSuffix(packaged.ResolvedFileName, "/mutations/package.ts") {
		t.Fatalf("contexts merged%v%v", compiler, packaged)
	}
	before := project.capture.certificate()
	governanceWrite(t, root, "package.json", `{"type":"commonjs","imports":{"#helper":"./mutations/package.ts"}}`)
	same, err := project.capture.Verify()
	if err != nil || same {
		t.Fatal("resolution metadata changed after observations but final barrier accepted")
	}
	if before == "" {
		t.Fatal("missing input certificate")
	}
}

func TestGovernanceResidentCaptureReusesOnlyIdenticalAuthoredBytes(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/a.ts", `const a=1;`)
	governanceWrite(t, root, "mutations/b.ts", `const b=1;`)
	cache := map[string]*governedFile{}
	first, err := captureGovernedProjectCached(root, governanceTestPolicy(), cache)
	if err != nil {
		t.Fatal(err)
	}
	if first.stats.Parses != 2 {
		t.Fatalf("cold parses %+v", first.stats)
	}
	cache = first.FilesByPath
	governanceWrite(t, root, "mutations/a.ts", `const a=2;`)
	second, err := captureGovernedProjectCached(root, governanceTestPolicy(), cache)
	if err != nil {
		t.Fatal(err)
	}
	if second.stats.Parses != 1 || second.stats.ParseReuses != 1 || second.FilesByPath["mutations/b.ts"].Source != first.FilesByPath["mutations/b.ts"].Source || second.FilesByPath["mutations/a.ts"].Source == first.FilesByPath["mutations/a.ts"].Source {
		t.Fatalf("actual edited bytes must alone reparse: %+v", second.stats)
	}
	governanceWrite(t, root, "mutations/b.ts", `const b=2;`)
	valid, err := second.capture.Verify()
	if err != nil || valid {
		t.Fatalf("resident AST cache must not weaken uncached final barrier: %t %v", valid, err)
	}
}

func TestGovernanceCanonicalIgnoreUsesJavaScriptCodeUnits(t *testing.T) {
	one := governanceAdmittedIgnore([][]uint16{{'m', 'o', 'c', 'k', 'u', 'p', 's', '/', '?', '.', 't', 's'}})
	two := governanceAdmittedIgnore([][]uint16{{'m', 'o', 'c', 'k', 'u', 'p', 's', '/', '?', '?', '.', 't', 's'}})
	if one("mockups/😀.ts") || !two("mockups/😀.ts") {
		t.Fatal("JS non-u '?' consumes one UTF16 codeunit")
	}
	tree := governanceAdmittedIgnore([][]uint16{{'m', 'o', 'c', 'k', 'u', 'p', 's', '/', '*', '*'}})
	if !tree("mockups/.hidden/file.ts") || tree("queries/file.ts") {
		t.Fatal("prefix pruning must preserve canonical owner glob semantics")
	}
}
func TestGovernanceCanonicalPolicyContinuationRetainsInitialConfigObservation(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "astrale.lint.json", `{"ignore":[]}`)
	governanceWrite(t, root, "mutations/a.ts", `const a=1;`)
	session := governanceSession{}
	configuration, err := session.captureConfiguration(root)
	if err != nil {
		t.Fatal(err)
	}
	governanceWrite(t, root, "astrale.lint.json", `{"ignore":["mockups/**"]}`)
	authority := governanceCompiledPolicy{Source: governanceTestPolicy(), Digest: "canonical-js-owned"}
	project, err := session.continuePolicy(configuration["token"].(string), authority)
	if err != nil {
		t.Fatal(err)
	}
	valid, err := project.capture.Verify()
	if err != nil || valid {
		t.Fatalf("canonical owner must never compile one config then seal another: %t %v", valid, err)
	}
	if project.policyDigest != authority.Digest {
		t.Fatal("native must not recreate canonical digest")
	}
}

func TestGovernanceRuntimeIdentityUsesActualProgramMembership(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "tsconfig.json", `{"files":["mutations/in.ts"],"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","noEmit":true}}`)
	governanceWrite(t, root, "mutations/in.ts", "// 😀\nconst run=()=>1;run();")
	governanceWrite(t, root, "mutations/out.ts", `const outside=()=>1;outside();`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	shared := governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if project.typeRelease != nil {
		defer project.typeRelease()
	}
	if !identity.Complete || identity.OwnedProgramFiles["mutations/out.ts"] != nil {
		t.Fatalf("outside Program governed sources cannot mint runtime identities: %+v", identity.Reason)
	}
	oldSession, _, err := newCompilerSession(root, "tsconfig.json")
	if err != nil {
		t.Fatal(err)
	}
	defer oldSession.Close()
	legacy := analyzer{root: root, session: oldSession}
	expected, _, err := legacy.projectUniverse()
	if err != nil {
		t.Fatal(err)
	}
	if identity.Universe != expected {
		t.Fatalf("runtime universe must match actual legacy compiler owner: %s != %s", identity.Universe, expected)
	}
	for _, path := range []string{"mutations/in.ts", "mutations/out.ts"} {
		file := shared.FilesByPath[path]
		var call *ast.Node
		var visit func(*ast.Node)
		visit = func(n *ast.Node) {
			if n.Kind == ast.KindCallExpression {
				call = n
			}
			n.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
		}
		visit(file.Source.AsNode())
		id, known := identity.CallIdentity(file, call)
		if path == "mutations/in.ts" && (!known || id == "") {
			t.Fatal("actual Program call must own body-call identity")
		}
		if path == "mutations/out.ts" && known {
			t.Fatal("governance alone must not invent compiler membership")
		}
	}
}
