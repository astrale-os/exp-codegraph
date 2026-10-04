package main

import (
	"context"
	ast "github.com/microsoft/typescript-go/shim/ast"
	compiler "github.com/microsoft/typescript-go/shim/compiler"
	"github.com/samchon/ttsc/packages/ttsc/driver"
	"reflect"
	"strings"
	"testing"
)

// Exploratory boundary only: this is not wired into production. In particular,
// UpdateProgram retains the old resolver host, whose observations need their own
// expected-current barrier before a generation may publish.
type generationIdentityHost struct {
	compiler.CompilerHost
	source *ast.SourceFile
}

func (h generationIdentityHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	if opts.Path == h.source.Path() {
		return h.source
	}
	return h.CompilerHost.GetSourceFile(opts)
}
func generationFreshHost(project *governedProject) compiler.CompilerHost {
	overlay := driver.NewOverlayFS(project.capture.compiler)
	for _, file := range project.Files {
		overlay.Set(file.AbsolutePath, file.Text)
	}
	return driver.DefaultHost(project.Root, overlay)
}
func generationInstall(t *testing.T, project *governedProject, program *compiler.Program, host compiler.CompilerHost) {
	t.Helper()
	check, release := program.GetTypeChecker(context.Background())
	project.typeOwner.opened = true
	project.typeOwner.program = &driver.Program{TSProgram: program, ParsedConfig: project.typeOwner.parsed, Checker: check, Host: host}
	project.typeRelease = release
	t.Cleanup(release)
}
func TestGenerationOriginalUpdateFreshChecker(t *testing.T) {
	for _, fixture := range []struct {
		name, path, text string
		reuse            bool
	}{
		{"body", "schema/value.ts", `export const subject = { after: 1 };`, true},
		{"generic-id", "schema/value.ts", `const id = 'after' as const; export const subject = { [id]: 1 };`, true},
		{"imports", "schema/value.ts", `import { independent } from '../queries/independent.js'; export const subject = { after: independent() };`, false},
		{"global", "queries/independent.ts", `const independent = 2;`, true},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			root := typeDemandFixture(t)
			old, file, node := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
			before := old.typeOwner.names(file, node)
			if !reflect.DeepEqual(before.Names, []string{"before"}) {
				t.Fatal(before)
			}
			prior := old.typeOwner.program
			unchanged := prior.TSProgram.GetSourceFile(old.FilesByPath["mutations/demand.ts"].AbsolutePath)
			identityHost := generationIdentityHost{prior.Host, unchanged}
			snapshot, reused := prior.TSProgram.UpdateProgram(unchanged.Path(), identityHost, nil)
			if !reused {
				t.Fatal("identity snapshot unexpectedly rebuilds")
			}
			if snapshot == prior.TSProgram {
				t.Fatal("snapshot must own fresh checker pool")
			}
			old.typeRelease()
			old.typeRelease = nil
			governanceWrite(t, root, fixture.path, fixture.text)
			next, nextFile, nextNode := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
			next.typeOwner.configuration()
			host := generationFreshHost(next)
			changed := prior.TSProgram.GetSourceFile(old.FilesByPath[fixture.path].AbsolutePath)
			updated, reused := snapshot.UpdateProgram(changed.Path(), host, nil)
			if reused != fixture.reuse {
				t.Fatalf("reuse=%v expected=%v", reused, fixture.reuse)
			}
			generationInstall(t, next, updated, host)
			got := next.typeOwner.names(nextFile, nextNode)
			_, fresh := testTypeDemand(t, root, &governanceTypeDemandCache{})
			if !reflect.DeepEqual(got, fresh) {
				t.Fatalf("updated=%#v fresh=%#v", got, fresh)
			}
			// These are exact original compiler outcomes; no retained semantic values.
			t.Logf("reuse=%v names=%v", reused, got.Names)
		})
	}
}

func TestGenerationOriginalUpdateNeedsWorldGuard(t *testing.T) {
	for _, kind := range []string{"config-membership", "package-exports"} {
		t.Run(kind, func(t *testing.T) {
			root := typeDemandFixture(t)
			if kind == "config-membership" {
				governanceWrite(t, root, "mutations/demand.ts", `declare const subject: Selected; subject;`)
				governanceWrite(t, root, "before.d.ts", `interface Selected { before: 1 }`)
				governanceWrite(t, root, "after.d.ts", `interface Selected { after: 1 }`)
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","noLib":true,"types":[]},"files":["mutations/demand.ts","before.d.ts","queries/independent.ts"]}`)
			} else {
				governanceWrite(t, root, "mutations/demand.ts", `import { subject } from 'owned-fixture'; subject;`)
				governanceWrite(t, root, "node_modules/owned-fixture/package.json", `{"name":"owned-fixture","type":"module","exports":"./before.ts"}`)
				governanceWrite(t, root, "node_modules/owned-fixture/before.ts", `export const subject = { before: 1 };`)
				governanceWrite(t, root, "node_modules/owned-fixture/after.ts", `export const subject = { after: 1 };`)
			}
			old, file, node := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
			before := old.typeOwner.names(file, node)
			if !reflect.DeepEqual(before.Names, []string{"before"}) {
				t.Fatal(before)
			}
			prior := old.typeOwner.program
			old.typeRelease()
			old.typeRelease = nil
			if kind == "config-membership" {
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","noLib":true,"types":[]},"files":["mutations/demand.ts","after.d.ts","queries/independent.ts"]}`)
			} else {
				governanceWrite(t, root, "node_modules/owned-fixture/package.json", `{"name":"owned-fixture","type":"module","exports":"./after.ts"}`)
			}
			governanceWrite(t, root, "queries/independent.ts", `export const independent = (): number => 2;`)
			next, nextFile, nextNode := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
			next.typeOwner.configuration()
			host := generationFreshHost(next)
			changed := prior.TSProgram.GetSourceFile(old.FilesByPath["queries/independent.ts"].AbsolutePath)
			updated, reused := prior.TSProgram.UpdateProgram(changed.Path(), host, nil)
			if !reused {
				t.Fatal("expected original single-source updater reuse")
			}
			generationInstall(t, next, updated, host)
			stale := next.typeOwner.names(nextFile, nextNode)
			_, fresh := testTypeDemand(t, root, &governanceTypeDemandCache{})
			if reflect.DeepEqual(stale, fresh) || !reflect.DeepEqual(fresh.Names, []string{"after"}) {
				t.Fatalf("counterexample failed updated=%#v fresh=%#v", stale, fresh)
			}
			same, err := old.capture.Verify()
			if err != nil || same {
				t.Fatalf("original old-world barrier must reject: %v %v", same, err)
			}
			t.Logf("unguarded update=%v fresh=%v, original barrier rejects", stale.Names, fresh.Names)
		})
	}
}

// The resolver retains this host pointer, not the old interface value. Only a
// serial owner may switch its embedded host, after releasing the prior checker.
// Cached resolver payloads still require their complete OLD expected receipts.
type generationHostBroker struct{ compiler.CompilerHost }

func TestGenerationBrokerRoutesRetainedHostOperations(t *testing.T) {
	root := typeDemandFixture(t)
	old, _, _ := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
	old.typeOwner.configuration()
	broker := &generationHostBroker{generationFreshHost(old)}
	prior, _, err := driver.CreateProgramFromConfig(old.typeOwner.parsed, broker)
	if err != nil || prior == nil {
		t.Fatal(err)
	}
	// This host is kept by processedFiles.resolver even after UpdateProgram.
	retained := compiler.CompilerHost(broker)
	governanceWrite(t, root, "schema/value.ts", `export const subject={after:1};`)
	next, file, node := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
	next.typeOwner.configuration()
	broker.CompilerHost = generationFreshHost(next)
	changed := prior.GetSourceFile(old.FilesByPath["schema/value.ts"].AbsolutePath)
	updated, reused := prior.UpdateProgram(changed.Path(), broker, nil)
	if !reused {
		t.Fatal("body-only update should reuse")
	}
	generationInstall(t, next, updated, broker)
	got := next.typeOwner.names(file, node)
	_, fresh := testTypeDemand(t, root, &governanceTypeDemandCache{})
	if !reflect.DeepEqual(got, fresh) {
		t.Fatalf("updated=%#v fresh=%#v", got, fresh)
	}
	// A genuinely new late read goes into the CURRENT operation owner, even
	// when the compiler reaches it through the resolver's retained host.
	late := root + "/late-owner.txt"
	governanceWrite(t, root, "late-owner.txt", "current")
	text, present := retained.FS().ReadFile(late)
	if !present || text != "current" {
		t.Fatalf("late value %q %v", text, present)
	}
	if _, seen := old.capture.compiler.rawReads[late]; seen {
		t.Fatal("late read leaked into old actual owner")
	}
	if next.capture.compiler.rawReads[late].text != "current" {
		t.Fatal("late read missing current actual receipt")
	}
	governanceWrite(t, root, "late-owner.txt", "changed")
	same, err := next.capture.Verify()
	if err != nil || same {
		t.Fatalf("late current dependency not guarded: %v %v", same, err)
	}
}

func TestGenerationGuardedBodyProposalAndDependencyRejection(t *testing.T) {
	for _, kind := range []string{"body", "package", "new-negative", "config", "late-hidden-source", "hidden-before"} {
		t.Run(kind, func(t *testing.T) {
			root := typeDemandFixture(t)
			if kind == "hidden-before" {
				governanceWrite(t, root, "mutations/demand.ts", `import {subject} from 'owned-fixture'; subject;`)
				governanceWrite(t, root, "node_modules/owned-fixture/package.json", `{"name":"owned-fixture","exports":"./value.ts"}`)
				governanceWrite(t, root, "node_modules/owned-fixture/value.ts", `export const subject={before:1};`)
			}
			old, file, node := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
			old.typeOwner.configuration()
			host, _ := governanceGenerationOverlay(old)
			broker := &governanceGenerationBroker{host}
			original, _, err := driver.CreateProgramFromConfig(old.typeOwner.parsed, broker)
			if err != nil || original == nil {
				t.Fatal(err)
			}
			generationInstall(t, old, original, broker)
			before := old.typeOwner.names(file, node)
			if !reflect.DeepEqual(before.Names, []string{"before"}) {
				t.Fatal(before)
			}
			old.typeRelease()
			old.typeRelease = nil
			valid, err := old.capture.Verify()
			if err != nil || !valid {
				t.Fatalf("old seal: %v %v", valid, err)
			}
			retained := governanceRetainProgramGeneration(old, broker)
			if retained == nil {
				t.Fatal("retention failed")
			}
			governanceWrite(t, root, "queries/independent.ts", `export const independent=()=>2;`)
			switch kind {
			case "hidden-before":
				governanceWrite(t, root, "node_modules/owned-fixture/value.ts", `export const subject={after:1};`)
			case "package":
				governanceWrite(t, root, "package.json", `{"name":"new-package-owner"}`)
			case "new-negative":
				governanceWrite(t, root, "queries/new.ts", `export const newMember=1;`)
			case "config":
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"noLib":true,"types":[],"strict":true},"include":["mutations","queries","schema"]}`)
			}
			next, nextFile, nextNode := typeDemandTestProject(t, root, &governanceTypeDemandCache{})
			updated, reused := retained.propose(next)
			session := &governanceSession{programGeneration: retained}
			if reused {
				next.borrowedGeneration = retained
			}
			if kind == "body" || kind == "late-hidden-source" {
				if !reused {
					next.typeOwner.configuration()
					t.Logf("roots equal=%v opts equal=%v", reflect.DeepEqual(next.typeOwner.parsed.FileNames(), retained.program.CommandLine().FileNames()), reflect.DeepEqual(next.typeOwner.parsed.CompilerOptions(), retained.program.Options()))
					for _, r := range retained.receipts {
						w := &governanceTypeReplayWorld{disk: next.capture.compiler.disk, reads: map[string]compilerRawRead{}, observations: map[compilerInputKey]string{}}
						w.preparePlan(r.expectationPlan())
						for path, value := range r.barrierReads {
							if path != old.FilesByPath["queries/independent.ts"].AbsolutePath && w.reads[path] != value {
								t.Logf("read differs %s", path)
							}
						}
						for key, value := range r.barrierObservations {
							if key.path != old.FilesByPath["queries/independent.ts"].AbsolutePath && w.observations[key] != value {
								t.Logf("guard differs %v expected=%s current=%s", key, value, w.observations[key])
							}
						}
					}
					t.Fatal("closed BODY world unexpectedly rejected")
				}
				generationInstall(t, next, updated, broker)
				got := next.typeOwner.names(nextFile, nextNode)
				_, fresh := testTypeDemand(t, root, &governanceTypeDemandCache{})
				if !reflect.DeepEqual(got, fresh) {
					t.Fatalf("updated=%#v fresh=%#v", got, fresh)
				}
				if kind == "late-hidden-source" {
					governanceWrite(t, root, "schema/value.ts", `export const subject={after:1};`)
				}
				status := generationSessionSeal(t, session, next, kind)
				if (status == "committed") != (kind == "body") || status != "committed" && status != "retry" {
					t.Fatalf("final old-dependency seal status=%s", status)
				}
				if status == "retry" && (session.programGeneration != nil || next.borrowedGeneration != nil || next.runtimeSyntax != nil) {
					t.Fatal("rejected proposal survived its owning session seal")
				}
			} else if kind == "config" || kind == "new-negative" {
				if reused || updated != nil {
					t.Fatalf("fresh config/membership gate failed: %s", kind)
				}
			} else {
				if !reused {
					t.Fatalf("private proposal unavailable: %s", kind)
				}
				if status := generationSessionSeal(t, session, next, kind); status != "retry" || session.programGeneration != nil || next.borrowedGeneration != nil || next.runtimeSyntax != nil {
					t.Fatalf("stale proposal not retired by session: %s", status)
				}
				if _, again := session.programGeneration.propose(next); again {
					t.Fatal("retry borrowed retired metadata")
				}
				_, fresh := testTypeDemand(t, root, &governanceTypeDemandCache{})
				expected := []string{"before"}
				if kind == "hidden-before" {
					expected = []string{"after"}
				}
				if !reflect.DeepEqual(fresh.Names, expected) {
					t.Fatal(fresh)
				}
			}
		})
	}
}

func generationSessionSeal(t *testing.T, session *governanceSession, project *governedProject, token string) string {
	t.Helper()
	digest := strings.Repeat("a", 64)
	session.productsSession = &governanceProductsSession{Project: project, Token: token, ProductsDigest: digest, InputCertificate: project.capture.certificate(), Generation: token}
	response, err := session.sealProducts(token, digest, strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	return response.(map[string]any)["status"].(string)
}
func generationSessionCell(t *testing.T, session *governanceSession, root string) (*governedProject, []string) {
	t.Helper()
	project, file, node := typeDemandTestProject(t, root, session.typeDemandOwner())
	project.programGeneration = session.programGeneration
	// Force an original checker observation: this test examines Program ownership,
	// not the separately qualified unchanged type-cell quotient.
	project.typeDemandCache = nil
	value := project.typeOwner.names(file, node)
	return project, value.Names
}
func TestGenerationIntegratedSessionSealsAndAbandons(t *testing.T) {
	root := typeDemandFixture(t)
	session := &governanceSession{}
	first, before := generationSessionCell(t, session, root)
	if !reflect.DeepEqual(before, []string{"before"}) || generationSessionSeal(t, session, first, "first") != "committed" {
		t.Fatal(before)
	}
	if session.programGeneration == nil {
		t.Fatal("no sealed original metadata capsule")
	}
	oldBroker := session.programGeneration.broker
	oldChecker := first.typeOwner.program.Checker
	governanceWrite(t, root, "schema/value.ts", `export const subject={after:1};`)
	next, after := generationSessionCell(t, session, root)
	if !reflect.DeepEqual(after, []string{"after"}) || next.borrowedGeneration == nil || next.typeOwner.generationBroker != oldBroker || next.typeOwner.program.Checker == oldChecker {
		t.Fatal("BODY did not use original update with fresh checker", after)
	}
	if session.programGeneration.program != nil {
		t.Fatal("old capsule not consumed")
	}
	if generationSessionSeal(t, session, next, "next") != "committed" || session.programGeneration == nil || next.borrowedGeneration != nil {
		t.Fatal("updated capsule not sealed")
	}
	governanceWrite(t, root, "schema/value.ts", `export const subject={third:1};`)
	draft, third := generationSessionCell(t, session, root)
	if !reflect.DeepEqual(third, []string{"third"}) || draft.borrowedGeneration == nil {
		t.Fatal(third)
	}
	session.productsSession = &governanceProductsSession{Project: draft}
	session.discardProducts()
	if session.programGeneration != nil {
		t.Fatal("abandoned metadata capsule retained")
	}
	fresh, names := generationSessionCell(t, session, root)
	if fresh.borrowedGeneration != nil || !reflect.DeepEqual(names, third) {
		t.Fatal("abandon recovery not fresh", names)
	}
	if generationSessionSeal(t, session, fresh, "recovered") != "committed" {
		t.Fatal("fresh recovery seal failed")
	}
}
func TestGenerationIntegratedHiddenEditSealRetriesFresh(t *testing.T) {
	root := typeDemandFixture(t)
	governanceWrite(t, root, "mutations/demand.ts", `import {subject} from 'owned-fixture'; subject;`)
	governanceWrite(t, root, "node_modules/owned-fixture/package.json", `{"name":"owned-fixture","exports":"./value.ts"}`)
	governanceWrite(t, root, "node_modules/owned-fixture/value.ts", `export const subject={before:1};`)
	session := &governanceSession{}
	first, before := generationSessionCell(t, session, root)
	syntaxRuntimeOwner(t, first).ensureAllAdmissions()
	if !reflect.DeepEqual(before, []string{"before"}) || generationSessionSeal(t, session, first, "first") != "committed" {
		t.Fatal(before)
	}
	governanceWrite(t, root, "queries/independent.ts", `export const independent=()=>2;`)
	governanceWrite(t, root, "node_modules/owned-fixture/value.ts", `export const subject={after:1};`)
	private, stale := generationSessionCell(t, session, root)
	if private.borrowedGeneration == nil || !reflect.DeepEqual(stale, []string{"before"}) {
		t.Fatal("expected speculative old metadata", stale)
	}
	syntaxRuntimeOwner(t, private).ensureAllAdmissions()
	if generationSessionSeal(t, session, private, "stale") != "retry" || session.programGeneration != nil || private.runtimeSyntax != nil {
		t.Fatal("stale metadata survived seal")
	}
	current, after := generationSessionCell(t, session, root)
	if current.borrowedGeneration != nil || !reflect.DeepEqual(after, []string{"after"}) {
		t.Fatal("fresh retry did not recover", after)
	}
	if generationSessionSeal(t, session, current, "current") != "committed" {
		t.Fatal("recovery seal failed")
	}
}

func TestGenerationRejectedMetadataDropsNewTypeCellDescendants(t *testing.T) {
	root := typeDemandFixture(t)
	governanceWrite(t, root, "mutations/demand.ts", `import {subject} from 'owned-fixture'; subject;`)
	governanceWrite(t, root, "node_modules/owned-fixture/package.json", `{"name":"owned-fixture","exports":"./value.ts"}`)
	governanceWrite(t, root, "node_modules/owned-fixture/value.ts", `export const subject={before:1};`)
	session := &governanceSession{}
	first, _ := generationSessionCell(t, session, root)
	if generationSessionSeal(t, session, first, "first") != "committed" {
		t.Fatal("cold seal")
	}
	governanceWrite(t, root, "queries/independent.ts", `export const independent=()=>2;`)
	governanceWrite(t, root, "node_modules/owned-fixture/value.ts", `export const subject={after:1};`)
	project, file, node := typeDemandTestProject(t, root, session.typeDemandOwner())
	project.programGeneration = session.programGeneration
	value := project.typeOwner.names(file, node)
	if project.borrowedGeneration == nil || !reflect.DeepEqual(value.Names, []string{"before"}) || len(session.typeDemandCache.entries) == 0 {
		t.Fatal("speculative descendant not produced", value)
	}
	if generationSessionSeal(t, session, project, "private") != "retry" || len(session.typeDemandCache.entries) != 0 {
		t.Fatal("new type cells survived rejected producer")
	}
	current, after := generationSessionCell(t, session, root)
	if !reflect.DeepEqual(after, []string{"after"}) || generationSessionSeal(t, session, current, "current") != "committed" {
		t.Fatal("recovery", after)
	}
}

func TestGenerationExpectedReceiptCannotBecomeTypeCacheOwner(t *testing.T) {
	root := typeDemandFixture(t)
	cache := &governanceTypeDemandCache{}
	testTypeDemand(t, root, cache)
	project, file, node := typeDemandTestProject(t, root, cache)
	expected := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{"sentinel": {text: "expected", present: true}}, barrierObservations: map[compilerInputKey]string{}}
	project.capture.compilerAssertions = append(project.capture.compilerAssertions, expected)
	got := project.typeOwner.names(file, node)
	if !reflect.DeepEqual(got.Names, []string{"before"}) || project.stats.TypeCacheHits != 1 {
		t.Fatal(got, project.stats)
	}
	if len(expected.barrierReads) != 1 || expected.barrierReads["sentinel"].text != "expected" {
		t.Fatal("plain expectation acquired cache ownership")
	}
	if len(project.capture.compilerAssertions) != 1 || len(project.capture.typeCacheLeases) != 1 || project.capture.typeCacheLeases[0].cache != cache || len(project.capture.typeCacheLeases[0].cacheKeys) != 1 {
		t.Fatal("current replay receipt lacks exact cache owner")
	}
}

func TestGenerationAssertionUnionPreservesContradictions(t *testing.T) {
	before := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{"x": {text: "before", present: true}}}
	same, ok := governanceUnionCompilerAssertions([]*governanceCompilerReadAssertions{before, before})
	if !ok || len(same.barrierReads) != 1 {
		t.Fatal("equal obligations did not coalesce")
	}
	same.barrierReads["x"] = compilerRawRead{text: "changed", present: true}
	if before.barrierReads["x"].text != "before" {
		t.Fatal("union borrowed a mutable producer map")
	}
	after := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{"x": {text: "after", present: true}}}
	if _, ok := governanceUnionCompilerAssertions([]*governanceCompilerReadAssertions{before, after}); ok {
		t.Fatal("last writer erased contradiction")
	}
	absent := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{"x": {present: false}}}
	if _, ok := governanceUnionCompilerAssertions([]*governanceCompilerReadAssertions{before, absent}); ok {
		t.Fatal("observed absence erased")
	}
}
