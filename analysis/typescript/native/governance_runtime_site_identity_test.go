package main

import (
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"reflect"
	"sort"
	"testing"
)

// This oracle retains the exact predecessor projection and opaque original ID
// algorithm. It does not initialize any actual sparse-owner cache.
func eagerRuntimeCalls(identity *governanceRuntimeIdentity) (map[*ast.Node]string, map[string]sourceSpan) {
	ids := map[*ast.Node]string{}
	spans := map[string]sourceSpan{}
	workspace := occurrenceIdentityWorkspace{}
	for path, source := range identity.OwnedProgramFiles {
		sourceID := deriveID("source", "typescript:"+identity.Universe, map[string]any{"path": path})
		revision := deriveID("source-revision", sourceID, map[string]any{"digest": hashText(source.Text())})
		coordinates := indexSourceCoordinates(source.Text())
		walk(source.AsNode(), func(node *ast.Node) bool {
			if node.Kind == ast.KindCallExpression {
				start := scanner.SkipTrivia(source.Text(), node.Pos())
				span := sourceSpan{Source: sourceID, Revision: revision, Start: coordinates.utf16(start), End: coordinates.utf16(node.End())}
				ids[node] = workspace.identify(identity.Universe, span, "body-call")
				spans[fmt.Sprintf("%s:%d:%d", path, start, node.End())] = span
			}
			return true
		})
	}
	return ids, spans
}
func siteIdentityFixture(t *testing.T) (*governedProject, *governanceRuntimeIdentity) {
	t.Helper()
	root := t.TempDir()
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleDetection":"force","target":"ES2022"},"include":["mutations","queries"]}`)
	governanceWrite(t, root, "mutations/é😀.ts", "declare function f(...a:any[]):any;const emoji='😀';const v=f( /*é😀*/ f(),f(f()));function p(x:any){return f(x)};class O {value=f();method(){f()}}")
	governanceWrite(t, root, "queries/other.ts", `declare function g():any;export const value=g();`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	id := governanceBuildRuntimeIdentity(project)
	if !id.Complete {
		t.Fatal(id.Reason)
	}
	t.Cleanup(func() {
		if project.typeRelease != nil {
			project.typeRelease()
			project.typeRelease = nil
		}
	})
	return project, id
}
func TestRuntimeSiteIdentitySameOriginalPreimagesAnyDemandOrder(t *testing.T) {
	project, id := siteIdentityFixture(t)
	expected, spans := eagerRuntimeCalls(id)
	if len(id.Calls) != 0 || len(id.CallSpans) != 0 || len(id.CallSources) != 0 || id.CallIdentityHashes != 0 {
		t.Fatal("construction eagerly materialized occurrences")
	}
	nodes := []*ast.Node{}
	for n := range expected {
		nodes = append(nodes, n)
	}
	sort.Slice(nodes, func(i, j int) bool { return expected[nodes[i]] < expected[nodes[j]] })
	for index := len(nodes) - 1; index >= 0; index-- {
		node := nodes[index]
		source := ast.GetSourceFileOfNode(node)
		path, _ := governanceRuntimeProgramOwned(project.Root, source.FileName())
		got, ok := id.nativeCallIdentity(path, node)
		if !ok || got != expected[node] {
			t.Fatalf("site ID differs %v %s != %s", ok, got, expected[node])
		}
	}
	count := id.CallIdentityHashes
	for _, node := range nodes {
		source := ast.GetSourceFileOfNode(node)
		path, _ := governanceRuntimeProgramOwned(project.Root, source.FileName())
		got, ok := id.nativeCallIdentity(path, node)
		if !ok || got != expected[node] {
			t.Fatal("repeated site")
		}
	}
	if id.CallIdentityHashes != count || count != len(expected) || !reflect.DeepEqual(id.CallSpans, spans) {
		t.Fatal("sparse original materialization", id.CallIdentityHashes, len(expected))
	}
	for _, file := range governanceSharedProject(project).Files {
		walk(file.Source.AsNode(), func(node *ast.Node) bool {
			if node.Kind == ast.KindCallExpression {
				got, known := id.CallIdentity(file, node)
				key := fmt.Sprintf("%s:%d:%d", file.Path, scanner.SkipTrivia(file.Source.Text(), node.Pos()), node.End())
				span, present := spans[key]
				workspace := occurrenceIdentityWorkspace{}
				if known != present || (known && got != workspace.identify(id.Universe, span, "body-call")) {
					t.Fatal("authored/program exact-span bridge differs", key)
				}
			}
			return true
		})
	}
}
func TestRuntimeSiteIdentityAuthoredSeekAndCurrentRevision(t *testing.T) {
	project, id := siteIdentityFixture(t)
	_, spans := eagerRuntimeCalls(id)
	shared := governanceSharedProject(project)
	for _, file := range shared.Files {
		walk(file.Source.AsNode(), func(node *ast.Node) bool {
			if node.Kind == ast.KindCallExpression {
				got, known := id.CallIdentity(file, node)
				key := fmt.Sprintf("%s:%d:%d", file.Path, scanner.SkipTrivia(file.Source.Text(), node.Pos()), node.End())
				span, present := spans[key]
				workspace := occurrenceIdentityWorkspace{}
				if known != present || (known && got != workspace.identify(id.Universe, span, "body-call")) {
					t.Fatal("seek must use original Program call spans", key)
				}
			}
			return true
		})
	}
	if id.CallSeekNodes == 0 {
		t.Fatal("authored bridge did not actually seek original parser calls")
	}
	path := "queries/other.ts"
	old := id.CallSources[path].Revision
	governanceWrite(t, project.Root, path, `declare function g():any;export const value=g(); // actual late edit`)
	next, err := captureGovernedProject(project.Root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(next)
	nextID := governanceBuildRuntimeIdentity(next)
	if !nextID.Complete {
		t.Fatal(nextID.Reason)
	}
	defer next.typeRelease()
	if nextID.callSource(path).Revision == old {
		t.Fatal("source revision reused across actual source edit")
	}
	valid, err := project.capture.Verify()
	if err != nil || valid {
		t.Fatal("old/current original fresh seal must reject late edit", valid, err)
	}
}
func TestRuntimeSiteIdentityOpaqueAlgorithmDuplicateAndMalformedFields(t *testing.T) {
	spans := []sourceSpan{{Source: "s😀", Revision: "r", Start: 1, End: 2}, {Source: "s😀", Revision: "r", Start: 1, End: 2}, {Source: string([]byte{0xff}), Revision: "r\u2028", Start: 7, End: 3}, {Source: "s", Revision: "r", Start: 0, End: 0}}
	workspace := occurrenceIdentityWorkspace{}
	eager := []string{}
	for _, span := range spans {
		eager = append(eager, workspace.identify("u", span, "body-call"))
	}
	for index := len(spans) - 1; index >= 0; index-- {
		sparse := occurrenceIdentityWorkspace{}
		if sparse.identify("u", spans[index], "body-call") != eager[index] {
			t.Fatal("opaque original scratch order/invalidUTF8 difference")
		}
	}
	if eager[0] != eager[1] {
		t.Fatal("original duplicate preimage policy changed")
	}
}
func TestRuntimeSiteAdmissionsRemainOriginalAndGloballyUnique(t *testing.T) {
	_, id := siteIdentityFixture(t)
	owner := governanceNewRuntimeAuthority(id)
	if len(owner.Admitted) != 0 || len(owner.FunctionOwners) != 0 || owner.AdmissionsFiles != 0 {
		t.Fatal("constructor eagerly materialized admissions")
	}
	first := owner.ByPath["queries/other.ts"]
	var call *ast.Node
	walk(first.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindCallExpression {
			call = node
		}
		return true
	})
	if admitted, known := owner.CandidateAdmitted(first, call, "call"); !admitted || !known {
		t.Fatal("original thin call admission missing")
	}
	if owner.AdmissionsFiles != 1 {
		t.Fatal("unrequested source admitted")
	}
	owner.ensureAllAdmissions()
	if owner.AdmissionsFiles != len(id.OwnedProgramFiles) {
		t.Fatal("global ownership not complete")
	}
	before := owner.AdmissionsFiles
	owner.ensureAllAdmissions()
	if before != owner.AdmissionsFiles {
		t.Fatal("duplicate admission retirement/materialization")
	}
	for path, source := range id.OwnedProgramFiles {
		file := owner.ByPath[path]
		walk(source.AsNode(), func(node *ast.Node) bool {
			if ast.IsFunctionLike(node) && node.Body() != nil {
				key := owner.functionKey(node)
				if !owner.FunctionBodies[node] || !containsFunction(owner.FunctionOwners[key], node) {
					t.Fatal("global original function owners omitted")
				}
			}
			return true
		})
		_ = file
	}
	// These are actual private native observations, not imported expected journals.
	if owner.Identity.Project.capture.semanticTicket() == "" {
		t.Fatal("actual input capture unavailable")
	}
}
func containsFunction(nodes []*ast.Node, wanted *ast.Node) bool {
	for _, node := range nodes {
		if node == wanted {
			return true
		}
	}
	return false
}

func TestRuntimeSiteMalformedNestedCallsUseOriginalParserSpans(t *testing.T) {
	for _, text := range []string{"f(f(,g()));", "f(f(", "f()(g())", "f(f())"} {
		source := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/finite/mutations/a.ts"}, text, core.ScriptKindTS)
		ast.SetParentInChildren(source.AsNode())
		identity := &governanceRuntimeIdentity{Universe: "finite-original-universe", Complete: true, OwnedProgramFiles: map[string]*ast.SourceFile{"mutations/a.ts": source}, Calls: map[*ast.Node]string{}, CallSpans: map[string]sourceSpan{}, CallSources: map[string]*governanceRuntimeCallSource{}}
		expected, _ := eagerRuntimeCalls(identity)
		walk(source.AsNode(), func(node *ast.Node) bool {
			if node.Kind == ast.KindCallExpression {
				got, known := identity.nativeCallIdentity("mutations/a.ts", node)
				if !known || got != expected[node] {
					t.Fatal("malformed original parser span changed", text)
				}
			}
			return true
		})
	}
}
func TestRuntimeSiteInventoryExactEagerProjectionAndOrdering(t *testing.T) {
	_, identity := siteIdentityFixture(t)
	expectedIDs, expectedSpans := eagerRuntimeCalls(identity)
	originalProjection := &governanceRuntimeIdentity{Project: identity.Project, TypeOwner: identity.TypeOwner, Universe: identity.Universe, Complete: true, OwnedProgramFiles: identity.OwnedProgramFiles, Calls: expectedIDs, CallSpans: expectedSpans, CallSources: map[string]*governanceRuntimeCallSource{}}
	eager := governanceNewRuntimeAuthority(originalProjection)
	eager.ensureAllAdmissions()
	sparse := governanceNewRuntimeAuthority(identity)
	for _, path := range []string{"mutations/é😀.ts", "queries/other.ts"} {
		actual := sparse.Calls([]string{path})
		expected := eager.Calls([]string{path})
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("original inventory/site-order/budget observations differ: sparse=%#v eager=%#v", actual, expected)
		}
	}
	if identity.CallIdentityHashes >= len(expectedIDs) {
		t.Fatalf("inventory should hash only original admitted calls: %d vs all %d", identity.CallIdentityHashes, len(expectedIDs))
	}
}
