package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
)

// Graph digests in testdata were captured from the unmodified c06a97c CFG,
// including occurrences, ordered blocks/edges, and exact completion messages.
// The production projection shares its grammar; no classifier is cloned here.
func cfgCompletionFixtures() []struct {
	name, text string
	codes      []string
} {
	return []struct {
		name, text string
		codes      []string
	}{
		{"empty", "", nil},
		{"straight", "const é='😀'; f(é); await(f());", nil},
		{"branches", "if (x) {f()} else {g()} h();", nil},
		{"returns", "function f(x) {if(x)return 1;else throw x; h();}", nil},
		{"unreachable-break", "return; break;", []string{"unresolvedBreak"}},
		{"continue", "continue; f();", []string{"CFG_UNRESOLVED_CONTINUE"}},
		{"loops", "while(x){if(y)break;continue;} for(;;){f();} for(const x in xs){continue;} for(const x of xs){break;} do {continue;} while(x);", nil},
		{"labels", "outer: while(x){break outer;continue outer;} missing: {break missing;}", []string{"CFG_LABEL_PARTIAL", "unresolvedBreak"}},
		{"switch", "switch(x){case 1: break; default: continue;} f();", []string{"CFG_SWITCH_PARTIAL"}},
		{"try", "try {break;} catch(e){continue;} finally {return;}", []string{"CFG_TRY_PARTIAL"}},
		{"with", "with (x) {break; continue;}", []string{"CFG_WITH_UNSUPPORTED"}},
		{"expressions", "x && f(); x || g(); x ?? h(); x &&= f(); x ||= g(); x ??= h(); x ? f() : g();", []string{"CFG_EXPRESSION_BRANCH_PARTIAL"}},
		{"nested-function", "function f(){x&&g();break;} const h=()=>x?y:z;", nil},
		{"nested-scopes", "class C {value=x&&f(); method(){g()}} const C2=class{static{h()}}; namespace N {f();}", []string{"CFG_NESTED_SCOPE_UNSUPPORTED"}},
		{"ordered-reasons", "x&&f(); label: {break;} continue; switch(x){} try{}finally{} with(x){} class C{}", []string{"CFG_EXPRESSION_BRANCH_PARTIAL", "CFG_LABEL_PARTIAL", "CFG_NESTED_SCOPE_UNSUPPORTED", "CFG_SWITCH_PARTIAL", "CFG_TRY_PARTIAL", "CFG_UNRESOLVED_CONTINUE", "CFG_WITH_UNSUPPORTED", "unresolvedBreak"}},
		{"unicode-bom", "\ufeff//é😀\r\nif(é){f('𝌆')}else{g()}\u2028x??h();", []string{"CFG_EXPRESSION_BRANCH_PARTIAL"}},
		{"malformed-call", "f(f(,g())); if( {return; else break;", nil},
		{"malformed-loop", "while( {continue; break;", nil},
		{"malformed-expression", "const x = a ? ; f(f(", []string{"CFG_EXPRESSION_BRANCH_PARTIAL"}},
		{"aliases", "import {f as g} from './mod'; const alias=g; alias(); let unknown; unknown(); function p(q){q();} alias?.();", nil},
	}
}

func cfgCompletionFixtureSource(name, text string, force bool, kind core.ScriptKind) *ast.SourceFile {
	source := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName:                       "/finite/é😀/" + name + ".ts",
		ExternalModuleIndicatorOptions: ast.ExternalModuleIndicatorOptions{Force: force},
	}, text, kind)
	ast.SetParentInChildren(source.AsNode())
	return source
}

func cfgCompletionBodies(source *ast.SourceFile) []*ast.Node {
	bodies := []*ast.Node{source.AsNode()}
	walk(source.AsNode(), func(node *ast.Node) bool {
		if ast.IsFunctionLike(node) && node.Body() != nil {
			bodies = append(bodies, node.Body())
		}
		return true
	})
	return bodies
}

func cfgCompletionFullBody(source *ast.SourceFile, body *ast.Node, duplicate bool) *bodyBuilder {
	builder := &bodyBuilder{file: source, body: body, occurrence: map[*ast.Node]string{}, occurrenceIndex: map[string]int{}}
	walk(body, func(node *ast.Node) bool {
		id := governanceRuntimeNodeKey(source, node)
		if duplicate {
			id = "same-original-occurrence"
		}
		builder.occurrence[node] = id
		builder.occurrenceIndex[id] = len(builder.occurrences)
		builder.occurrences = append(builder.occurrences, bodyOccurrence{ID: id, Span: sourceSpan{Start: node.Pos(), End: node.End()}})
		return true
	})
	return builder
}

func cfgCompletionDigest(t *testing.T, flow controlFlowResult) string {
	t.Helper()
	bytes, err := json.Marshal(struct {
		Blocks     []controlFlowBlock
		Edges      []controlFlowEdge
		Completion completeness
	}{flow.blocks, flow.edges, flow.completion})
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf("%x", sha256.Sum256(bytes))
}

func TestControlFlowCompletionExactOriginalProduct(t *testing.T) {
	data, err := os.ReadFile("testdata/cfg_completion_original_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden map[string]string
	if err = json.Unmarshal(data, &golden); err != nil {
		t.Fatal(err)
	}
	tested := 0
	for _, fixture := range cfgCompletionFixtures() {
		for _, force := range []bool{false, true} {
			for _, kind := range []core.ScriptKind{core.ScriptKindTS, core.ScriptKindTSX, core.ScriptKindJS} {
				source := cfgCompletionFixtureSource(fixture.name, fixture.text, force, kind)
				for index, body := range cfgCompletionBodies(source) {
					key := fmt.Sprintf("%s/force=%v/kind=%d/body=%d", fixture.name, force, kind, index)
					t.Run(key, func(t *testing.T) {
						full := buildControlFlow(cfgCompletionFullBody(source, body, false))
						if got := cfgCompletionDigest(t, full); got != golden[key] {
							t.Fatalf("original full graph changed: got %s want %s", got, golden[key])
						}
						projected := buildControlFlowCompletion(source, body)
						if !reflect.DeepEqual(projected, full.completion) {
							t.Fatalf("projection differs: %#v vs %#v", projected, full.completion)
						}
						collision := buildControlFlow(cfgCompletionFullBody(source, body, true))
						if !reflect.DeepEqual(projected, collision.completion) {
							t.Fatal("completion incorrectly depends on occurrence identity/dedup")
						}
						// Stable original parser cases have an independently asserted code order.
						// Recovery cases use the frozen actual original graph rather than a
						// hand-written interpretation of malformed syntax.
						if index == 0 && fixture.name != "malformed-call" && fixture.name != "malformed-loop" {
							codes := []string(nil)
							for _, raw := range projected.Reasons {
								codes = append(codes, raw.(map[string]any)["code"].(string))
							}
							if !reflect.DeepEqual(codes, fixture.codes) {
								t.Fatalf("ordered original reasons: %v want %v", codes, fixture.codes)
							}
						}
					})
					tested++
				}
			}
		}
	}
	if tested != len(golden) {
		t.Fatalf("stale original graph fixture membership: tested %d entries %d", tested, len(golden))
	}
}

func TestControlFlowCompletionNilBody(t *testing.T) {
	full := buildControlFlow(&bodyBuilder{occurrence: map[*ast.Node]string{}, occurrenceIndex: map[string]int{}})
	if projected := buildControlFlowCompletion(nil, nil); !reflect.DeepEqual(full.completion, projected) || projected.Kind != "complete" {
		t.Fatal("nil body semantics changed")
	}
}

func TestNativeCallsCompletionProjectionKeepsOriginalNegativeReasons(t *testing.T) {
	for caseIndex, text := range []string{
		`declare function f():void; const alias=f; alias(); function parameter(g:()=>void){g();} alias?.();`,
		`declare function f():void; f(); return; break; continue;`,
		`declare function f():void; class Hidden {field=f();method(){f();with(x){f()}}} namespace N {f();}`,
		`declare function f():void; f(); missing(); function nested(){class C{}; break;} switch(x){default:break;} try{f()}finally{f()}`,
	} {
		t.Run(text, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleDetection":"force"},"include":["mutations"]}`)
			governanceWrite(t, root, "mutations/input.ts", text)
			project, err := captureGovernedProject(root, governanceTestPolicy())
			if err != nil {
				t.Fatal(err)
			}
			governanceSharedProject(project)
			identity := governanceBuildRuntimeIdentity(project)
			if !identity.Complete {
				t.Fatal(identity.Reason)
			}
			defer project.typeRelease()
			owner := governanceNewRuntimeAuthority(identity)
			actual := owner.Calls([]string{"mutations/input.ts"})
			if !actual.Known {
				t.Fatalf("actual original authority unavailable: %#v", actual)
			}
			expectedComplete := identity.Complete
			expectedReasons := []string(nil)
			// Callee/alias uncertainty is the unchanged original symbol observer, not
			// part of the CFG projection. Assert that its negative survives the join.
			for _, site := range actual.Sites {
				if site.Callee == nil {
					expectedComplete = false
					if !containsString(expectedReasons, "A call site lacks its callee relation or logical source path.") {
						expectedReasons = append(expectedReasons, "A call site lacks its callee relation or logical source path.")
					}
				}
			}
			source := identity.OwnedProgramFiles["mutations/input.ts"]
			bodies := []*ast.Node{source.AsNode()}
			walkFile(source, func(node *ast.Node) bool {
				if owner.FunctionBodies[node] {
					bodies = append(bodies, node.Body())
				}
				return true
			})
			for _, body := range bodies {
				full := buildControlFlow(cfgCompletionFullBody(source, body, false))
				for _, raw := range full.completion.Reasons {
					reason := raw.(map[string]any)
					switch reason["code"] {
					case "CFG_EXPRESSION_BRANCH_PARTIAL", "CFG_SWITCH_PARTIAL", "CFG_TRY_PARTIAL", "CFG_LABEL_PARTIAL", "CFG_UNRESOLVED_CONTINUE", "CFG_UNRESOLVED_BREAK":
						continue
					}
					expectedComplete = false
					expectedReasons = append(expectedReasons, fmt.Sprint(reason["message"]))
				}
			}
			if actual.Complete != expectedComplete || !reflect.DeepEqual(actual.Reasons, expectedReasons) {
				t.Fatalf("original negative reasons/order changed: got %#v want complete=%v reasons=%v", actual, expectedComplete, expectedReasons)
			}
			if caseIndex == 3 && !containsString(actual.Reasons, "A call site lacks its callee relation or logical source path.") {
				t.Fatal("original unresolved callee negative disappeared")
			}
			if caseIndex == 0 && !actual.Complete {
				t.Fatal("simple aliases became incomplete")
			}
		})
	}
}
