package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"reflect"
	"strings"
	"testing"
)

func structuralFixture(text string) (CapturedFile, *demandObserver) {
	file := captured("structure.ts", text)
	file.Source = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: file.AbsolutePath}, text, core.ScriptKindTS)
	ast.SetParentInChildren(file.Source.AsNode())
	return file, newDemandObserver(fixtureContext([]CapturedFile{file}))
}

func visitStructuralNodes(node *ast.Node, visit func(*ast.Node)) {
	visit(node)
	node.ForEachChild(func(child *ast.Node) bool { visitStructuralNodes(child, visit); return false })
}

func TestFunctionStructurePreservesOriginalLexicalSelection(t *testing.T) {
	for _, text := range []string{
		`function f(parameter){ let x=parameter; x="later"; return x; }`,
		`function f(parameter){ let x=parameter; {let x="inner"; x="write"; use(x);} return x; }`,
		`function f(){ use(x); let x=use(x); x=use(x); return x; }`,
		`function f(p){ if(p){var x="a";}else{var x="b";} x="c"; return x; }`,
		`function f(p){ let x="a"; for(let x of p){x+="b"; use(x);} return x; }`,
		`function f(x){ function nested(x){return x;} const closure=()=>x; return closure; }`,
		`function f(){ let x="outer"; class C{static value=(x="class"); method(){x="method";}} return x; }`,
		`function f(){ let x="outer"; namespace N{export const value=(x="namespace");} return x; }`,
		`function f(p){ let x=p; try{x="try";}catch(error){let x=error; use(x);} return x; }`,
		`function f({x},...rest){const {y}=rest; return x+y;}`,
		`function f(){let x; let y=use(x=(y="nested")); return x+y;}`,
	} {
		t.Run(text, func(t *testing.T) {
			file, observer := structuralFixture(text)
			visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
				if node.Kind != ast.KindIdentifier {
					return
				}
				function := effectFunctionOwner(node)
				if function == nil || function.Body() == nil {
					return
				}
				originalFlow := inspectDemandFlow(function)
				if flow := observer.functionFlow(file.Path, function); !reflect.DeepEqual(flow, originalFlow) {
					t.Fatal("flow changed", node.Text())
				}
				original := selectedLocalBinding(function, node, originalFlow)
				for iteration := 0; iteration < 2; iteration++ {
					selected := observer.localStructure(file.Path, function, node)
					if !reflect.DeepEqual(selected, original) {
						t.Fatalf("binding changed %s@%d: actual=%#v original=%#v", node.Text(), node.Pos(), selected, original)
					}
				}
			})
		})
	}
}

func TestFunctionStructureRetainsBindingsOnceAndSeparatesCaptures(t *testing.T) {
	file, observer := structuralFixture(`function f(flag){let x="a";if(flag)x="b";use(x);return x;}`)
	var references []*ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindIdentifier && node.Text() == "x" {
			references = append(references, node)
		}
	})
	if len(references) < 3 {
		t.Fatal("fixture lacks repeated binding demands")
	}
	function := effectFunctionOwner(references[0])
	first := observer.localStructure(file.Path, function, references[0])
	snapshotDefinitions := append([]*ast.Node(nil), first.definitions...)
	snapshotInitializers := append([]*ast.Node(nil), first.initializers...)
	for _, node := range references {
		observer.localStructure(file.Path, function, node)
	}
	if !reflect.DeepEqual(first.definitions, snapshotDefinitions) || !reflect.DeepEqual(first.initializers, snapshotInitializers) {
		t.Fatal("later selections changed retained plan")
	}
	structure := observer.structures[function]
	if len(observer.structures) != 1 || len(structure.lexical.bindings["x"]) != 1 {
		t.Fatal("binding retained per occurrence")
	}
	// Same coordinates/text in a distinct captured AST must never borrow nodes.
	nextFile, next := structuralFixture(file.Text)
	var nextReference *ast.Node
	visitStructuralNodes(nextFile.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindIdentifier && node.Text() == "x" {
			nextReference = node
		}
	})
	nextFunction := effectFunctionOwner(nextReference)
	next.localStructure(nextFile.Path, nextFunction, nextReference)
	if next.structures[nextFunction] == structure {
		t.Fatal("structure crossed captures")
	}
	before := len(next.structures)
	foreign := next.localStructure(nextFile.Path, function, references[0])
	if len(next.structures) != before || !reflect.DeepEqual(foreign, selectedLocalBinding(function, references[0], inspectDemandFlow(function))) {
		t.Fatal("foreign fallback changed or retained old nodes")
	}
}

func TestFunctionStructureDoesNotRetainValuesOrIndependentAllowances(t *testing.T) {
	file, observer := structuralFixture(`function f(parameter){const value=parameter;return value;}`)
	var reference *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindIdentifier && node.Text() == "value" {
			reference = node
		}
	})
	function := effectFunctionOwner(reference)
	reads := []EffectRequest{}
	observer.context.Effect = func(request EffectRequest) EffectSummary {
		reads = append(reads, request)
		return EffectSummary{Pure: true, EffectKind: "local", VirtualSteps: 1, ChargeKey: "same-binding"}
	}
	first := observer.run()
	left, found := first.localIdentifier(file.Path, reference, map[string]demandValue{"parameter": demandKnown("string", "left")})
	if !found {
		t.Fatal("fixture binding unavailable")
	}
	snapshot := observer.structures[function]
	second := observer.run()
	right, found := second.localIdentifier(file.Path, reference, map[string]demandValue{"parameter": demandKnown("string", "right")})
	if !found || left.text != "left" || right.text != "right" {
		t.Fatal("caller environment reused", left, right)
	}
	if first.steps != second.steps || first.steps == 0 || len(first.reads) == 0 || !reflect.DeepEqual(first.reads, second.reads) || len(reads) < 2 {
		t.Fatal("fresh steps, reads or guards suppressed")
	}
	limited := observer.run()
	limited.limits.MaximumSteps = 0
	limited.localIdentifier(file.Path, reference, map[string]demandValue{"parameter": demandKnown("string", "third")})
	if limited.exhausted != "VALUE_STEP_LIMIT" || observer.structures[function] != snapshot {
		t.Fatal("independent allowance or structure changed")
	}
}

func TestFunctionStructureFreshRunOutcomesMatchOriginalWalks(t *testing.T) {
	for _, source := range []string{
		`function f(parameter){const value=parameter;return value;}`,
		`function f(parameter){let value=parameter;value="updated";return value;}`,
		`function f(parameter){let value=parameter;if(parameter)value="branch";return value;}`,
		`function f(parameter){let value=parameter;value+="compound";return value;}`,
		`function f(parameter){let value=parameter;class C{static field=(value="static")}return value;}`,
	} {
		t.Run(source, func(t *testing.T) {
			file, _ := structuralFixture(source)
			var reference *ast.Node
			visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
				if node.Kind == ast.KindIdentifier && node.Text() == "value" {
					reference = node
				}
			})
			if reference == nil {
				t.Fatal("fixture demand missing")
			}
			for _, mutation := range []bool{false, true} {
				for _, limit := range []int{1, 2, 4, 16, 4096} {
					type row struct {
						Outcomes []DemandOutcome
						Effects  []EffectRequest
					}
					var rows [2]row
					for mode := range rows {
						context := fixtureContext([]CapturedFile{file})
						context.Effect = func(request EffectRequest) EffectSummary {
							rows[mode].Effects = append(rows[mode].Effects, request)
							return EffectSummary{Pure: !mutation, Reason: "VALUE_MUTATION_UNSUPPORTED", VirtualSteps: 1, ChargeKey: request.Operation, Reads: []SemanticRead{{Kind: "effect", Path: request.Path, Name: request.Operation, Fingerprint: "current"}}}
						}
						observer := newDemandObserver(context)
						if mode == 0 {
							// Private oracle: a missing structural owner delegates to the
							// unchanged original helpers, without a public mode/flag.
							observer.structures = nil
						}
						for _, argument := range []string{"first", "second", "first"} {
							run := observer.run()
							run.limits.MaximumSteps = limit
							value, found := run.localIdentifier(file.Path, reference, map[string]demandValue{"parameter": demandKnown("string", argument)})
							if !found {
								t.Fatal("actual binding unavailable")
							}
							rows[mode].Outcomes = append(rows[mode].Outcomes, run.finish(value, ""))
						}
					}
					if !reflect.DeepEqual(rows[0], rows[1]) {
						t.Fatalf("full outcome/read/charge/ordered guard differs mutation=%v limit=%d: original=%#v actual=%#v", mutation, limit, rows[0], rows[1])
					}
				}
			}
		})
	}
}

func TestFunctionStructureRepeatedReferencesShareOneWriteIndex(t *testing.T) {
	file, observer := structuralFixture(`function f(flag){let value="initial";if(flag)value="other";` + strings.Repeat(`use(value);`, 400) + `return value;}`)
	count := 0
	var function *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindIdentifier && node.Text() == "value" {
			function = effectFunctionOwner(node)
			observer.localStructure(file.Path, function, node)
			count++
		}
	})
	if count < 400 || len(observer.structures) != 1 {
		t.Fatal("repeated references or unique function owner missing")
	}
	index := observer.structures[function].lexical
	bindings := index.bindings["value"]
	if len(bindings) != 1 {
		t.Fatal("one selected scope retained per reference")
	}
	for _, binding := range bindings {
		if len(binding.definitions) != 2 || len(binding.frontier) != 2 || len(binding.initializers) != 1 {
			t.Fatal("write slices duplicated with references")
		}
	}
}

func TestFunctionStructureInvocationAndQueryProductsKeepFreshProofs(t *testing.T) {
	texts := []string{
		`import {defineQuery,Query} from '@astrale-os/sdk/query';const prefix='queries.';function id(value){const selected=prefix+value;return selected;}export const query=defineQuery<any>()((domain)=>({id:id('one'),build:()=>{const builder=Query.from({nodes:[]});return builder.select({});},project:result=>result}));`,
		`import {defineQuery,Query} from '@astrale-os/sdk/query';function id(value){let selected=value;if(value)selected='alternate';return selected;}export const query=defineQuery<any>()((domain)=>({id:id('one'),build:()=>{const builder=Query.from({nodes:[]});return builder.select({});},project:result=>result}));`,
		`import {defineQuery,Query} from '@astrale-os/sdk/query';export const query=defineQuery<any>()((domain)=>{const selected={id:'one',build:()=>{const builder=Query.from({nodes:[]});return builder.select({});},project:result=>result};return selected;});`,
	}
	for _, text := range texts {
		t.Run(text, func(t *testing.T) {
			file, _ := structuralFixture(text)
			for _, limits := range []Limits{{MaximumSteps: 1}, {MaximumSteps: 4}, {MaximumSteps: 12}, {MaximumDepth: 1}, {MaximumAlternatives: 1}, {}} {
				type row struct {
					Products []RuntimeProducts
					Effects  []EffectRequest
				}
				var rows [2]row
				for mode := range rows {
					context := fixtureContext([]CapturedFile{file})
					context.Limits = limits
					oldEffect := context.Effect
					context.Effect = func(request EffectRequest) EffectSummary {
						rows[mode].Effects = append(rows[mode].Effects, request)
						return oldEffect(request)
					}
					graph := NewRuntimeDecisionGraph(context)
					if mode == 0 {
						graph.observer.structures = nil
					}
					for i := 0; i < 2; i++ {
						rows[mode].Products = append(rows[mode].Products, graph.Resume())
					}
				}
				if !reflect.DeepEqual(rows[0], rows[1]) {
					t.Fatalf("FIRST/repeated production products, budgets, read vectors or effect order changed limits=%#v: original=%#v actual=%#v", limits, rows[0], rows[1])
				}
				if limits == (Limits{}) && (len(rows[1].Products[0].Queries.Observations) != 1 || len(rows[1].Effects) == 0) {
					t.Fatal("unbounded fixture did not actually reach query/effect products")
				}
			}
		})
	}
}

func TestFunctionStructurePublicProofMutationCannotChangePlans(t *testing.T) {
	file, _ := structuralFixture(`const f=(parameter)=>{const value=parameter;return value;};const input="current";`)
	var function, input *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindArrowFunction {
			function = node
		}
		if node.Kind == ast.KindStringLiteral {
			input = node
		}
	})
	if function == nil || input == nil {
		t.Fatal("fixture expressions missing")
	}
	reader := NewNativeValueReader(fixtureContext([]CapturedFile{file}))
	plan := reader.Expression(file.Path, function).Invoke(reader.Expression(file.Path, input))
	first := plan.Resolve(Limits{})
	second := plan.Resolve(Limits{})
	if first.Outcome.Kind != "known" || first.Value.Literal != "current" || len(first.Outcome.Reads) == 0 || !reflect.DeepEqual(first, second) {
		t.Fatal("actual independent public proofs missing or changed", first, second)
	}
	first.Value.Literal = "corrupt"
	first.Outcome.Reads[0].Fingerprint = "corrupt"
	if again := plan.Resolve(Limits{}); !reflect.DeepEqual(again, second) {
		t.Fatal("published proof escaped into retained structure", again, second)
	}
}
