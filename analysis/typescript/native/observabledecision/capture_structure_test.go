package observabledecision

import (
	"fmt"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	ast "github.com/microsoft/typescript-go/shim/ast"
)

func capturedFunctions(file CapturedFile) []*ast.Node {
	var functions []*ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if ast.IsFunctionLike(node) && node.Body() != nil {
			functions = append(functions, node)
		}
	})
	return functions
}

func TestCaptureStructureMatchesOriginalWholeBodySelection(t *testing.T) {
	for _, text := range []string{
		`function outer(parameter){const value=parameter;return()=>value;}`,
		`function outer(){var value='first';{const f=()=>value;let value='inner';}var value='last';}`,
		`function outer(){var value='before';const f=()=>value;var value;}`,
		`function outer(parameter){for(let value of parameter){const f=()=>value;}for(var value in parameter){const g=()=>value;}}`,
		`function outer(){try{}catch(error){let value=error;const f=()=>value;}return()=>value;}`,
		`function outer(){switch(0){case 0:let value='case';const f=()=>value;}return()=>value;}`,
		`function outer(){const {value}=input;let [other]=input;function nested(){const hidden='nested';return()=>hidden;}return()=>value;}`,
		`function outer(){class C{static value=(()=>{let hidden='method';return()=>hidden;})();method(){return()=>value;}}namespace N{export const value='namespace';}return()=>value;}`,
		`function outer(){type T={value:()=>string};const value='current';return()=>value;}`,
		`const f=()=> 'top';function outer(){function inner(){return 'inner';}return inner;}`,
	} {
		t.Run(text, func(t *testing.T) {
			file, observer := structuralFixture(text)
			for _, function := range capturedFunctions(file) {
				for _, current := range []string{"left", "right", "left"} {
					environment := map[string]demandValue{"parameter": demandKnown("string", current), "untouched": demandKnown("string", "caller")}
					original := captureDemandEnvironment(file.Path, function, environment)
					for repeat := 0; repeat < 2; repeat++ {
						actual := observer.captureDemandEnvironment(file.Path, function, environment)
						if !reflect.DeepEqual(actual, original) {
							t.Fatalf("whole-body capture differs @%d: actual=%#v original=%#v", function.Pos(), actual, original)
						}
						actual["untouched"] = demandKnown("string", "caller changed returned map")
						if environment["untouched"].text != "caller" {
							t.Fatal("returned map aliases the current caller map")
						}
					}
				}
			}
		})
	}
}

func TestCaptureStructureRetainsOriginalPreorderAndNil(t *testing.T) {
	for _, text := range []string{
		`function outer(){var value='first';{const f=()=>value;let value='inner';}var value='last';}`,
		`function outer(){var value='before';const f=()=>value;var value;}`,
	} {
		file, observer := structuralFixture(text)
		var closure *ast.Node
		visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind == ast.KindArrowFunction {
				closure = node
			}
		})
		if closure == nil {
			t.Fatal("closure fixture missing")
		}
		actual := observer.captureDemandEnvironment(file.Path, closure, nil)["value"]
		original := captureDemandEnvironment(file.Path, closure, nil)["value"]
		if actual.kind != "reference" || actual.node != original.node {
			t.Fatal("last original declaration was not selected")
		}
		if original.node != nil && original.node.Text() != "last" {
			t.Fatal("preorder counterexample did not select later outer declaration")
		}
	}
}

func TestCaptureStructureKeepsFreshEnvironmentsWithoutFlowDemand(t *testing.T) {
	file, observer := structuralFixture(`function outer(parameter){const value=parameter;return()=>value;}`)
	functions := capturedFunctions(file)
	if len(functions) != 2 {
		t.Fatal("outer and closure missing")
	}
	outer, closure := functions[0], functions[1]
	left := map[string]demandValue{"parameter": demandKnown("string", "left")}
	right := map[string]demandValue{"parameter": demandKnown("string", "right")}
	first := observer.captureDemandEnvironment(file.Path, closure, left)
	structure := observer.structures[outer]
	if structure == nil || structure.capture == nil || !reflect.DeepEqual(structure.flow, demandFlow{}) || structure.lexical != nil {
		t.Fatal("capture initialized unrelated flow/binding products or lacks its owner")
	}
	second := observer.captureDemandEnvironment(file.Path, closure, right)
	left["parameter"] = demandKnown("string", "changed left after capture")
	if first["value"].env["parameter"].text != "changed left after capture" || second["value"].env["parameter"].text != "right" {
		t.Fatal("lazy references do not point to their CURRENT caller environments")
	}
	first["value"] = demandKnown("string", "mutated result")
	if again := observer.captureDemandEnvironment(file.Path, closure, right); !reflect.DeepEqual(again, second) || observer.structures[outer] != structure {
		t.Fatal("returned map mutation changed retained declarations")
	}
	if len(structure.capture.scopes) != 1 || len(structure.capture.scopes[outer.Body()]) != 1 {
		t.Fatal("capture declarations duplicated per call")
	}
}

func TestCaptureStructureSeparatesActualCapturesAndFallbacks(t *testing.T) {
	file, observer := structuralFixture(`function outer(parameter){const value=parameter;return()=>value;}`)
	functions := capturedFunctions(file)
	closure := functions[1]
	env := map[string]demandValue{"parameter": demandKnown("string", "current")}
	observer.captureDemandEnvironment(file.Path, closure, env)
	structure := observer.structures[functions[0]]
	nextFile, next := structuralFixture(file.Text)
	nextFunctions := capturedFunctions(nextFile)
	next.captureDemandEnvironment(nextFile.Path, nextFunctions[1], env)
	if next.structures[nextFunctions[0]] == structure {
		t.Fatal("immutable declaration owner crossed source capture identity")
	}
	before := len(next.structures)
	for _, path := range []string{file.Path, "unknown.ts"} {
		if actual := next.captureDemandEnvironment(path, closure, env); !reflect.DeepEqual(actual, captureDemandEnvironment(path, closure, env)) || len(next.structures) != before {
			t.Fatal("foreign/unknown capture changed original fallback or retained foreign AST")
		}
	}
	duplicate := newDemandObserver(fixtureContext([]CapturedFile{file, file}))
	if actual := duplicate.captureDemandEnvironment(file.Path, closure, env); !reflect.DeepEqual(actual, captureDemandEnvironment(file.Path, closure, env)) || len(duplicate.structures) != 0 {
		t.Fatal("incomplete duplicate module retained a declaration owner")
	}
	// The existing private missing-owner seam retains the unchanged eager helper.
	next.structures = nil
	if actual := next.captureDemandEnvironment(nextFile.Path, nextFunctions[1], env); !reflect.DeepEqual(actual, captureDemandEnvironment(nextFile.Path, nextFunctions[1], env)) {
		t.Fatal("missing-owner fallback changed")
	}
}

func TestCaptureStructureSharesScopesWithoutSharingClosureEnvironments(t *testing.T) {
	file, observer := structuralFixture(`function outer(){const base='base';{let value='left';const first=()=>value;}{let value='right';const second=()=>value;}}`)
	functions := capturedFunctions(file)
	if len(functions) != 3 {
		t.Fatal("distinct closure scopes missing")
	}
	for _, closure := range functions[1:] {
		env := map[string]demandValue{"caller": demandKnown("string", "current")}
		actual := observer.captureDemandEnvironment(file.Path, closure, env)
		if !reflect.DeepEqual(actual, captureDemandEnvironment(file.Path, closure, env)) {
			t.Fatal("distinct scope projection changed")
		}
		if actual["value"].node == nil {
			t.Fatal("eligible block binding missing")
		}
	}
	if len(observer.structures) != 1 || observer.structures[functions[0]].capture == nil {
		t.Fatal("outer declaration structure was retained per closure")
	}
}

func TestCaptureStructureFullFreshProofsMatchEagerOracle(t *testing.T) {
	for _, text := range []string{
		`const f=(parameter)=>{const value=parameter;return()=>value;};const input='current';`,
		`const f=(parameter)=>{var value=parameter;const closure=()=>value;var value;return closure;};const input='current';`,
		`const f=(parameter)=>{let value=parameter;if(parameter)value='changed';return()=>value;};const input='current';`,
		`const f=(parameter)=>{for(let value of parameter){use(value);}return()=>parameter;};const input='current';`,
	} {
		t.Run(text, func(t *testing.T) {
			file, _ := structuralFixture(text)
			var outer, input *ast.Node
			visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
				if node.Kind == ast.KindArrowFunction && effectFunctionOwner(node) == nil {
					outer = node
				}
				if node.Kind == ast.KindStringLiteral && node.Text() == "current" {
					input = node
				}
			})
			if outer == nil || input == nil {
				t.Fatal("actual invocation fixture missing")
			}
			for _, denied := range []bool{false, true} {
				for _, limits := range []Limits{{}, {MaximumSteps: 1}, {MaximumSteps: 4}, {MaximumSteps: 16}, {MaximumDepth: 1}, {MaximumAlternatives: 1}} {
					type row struct {
						Proofs  []NativeDemandProof
						Effects []EffectRequest
					}
					var rows [2]row
					for mode := range rows {
						context := fixtureContext([]CapturedFile{file})
						originalEffect := context.Effect
						context.Effect = func(request EffectRequest) EffectSummary {
							rows[mode].Effects = append(rows[mode].Effects, request)
							out := originalEffect(request)
							out.VirtualSteps, out.ChargeKey = 1, request.Operation
							if denied {
								out.Pure, out.Reason = false, "VALUE_MUTATION_UNSUPPORTED"
							}
							return out
						}
						reader := NewNativeValueReader(context)
						if mode == 0 {
							reader.observer.structures = nil
						}
						plan := reader.Expression(file.Path, outer).Invoke(reader.Expression(file.Path, input)).Invoke()
						for repeat := 0; repeat < 3; repeat++ {
							proof := plan.Resolve(limits)
							snapshot := proof
							if proof.Outcome.Reads != nil {
								snapshot.Outcome.Reads = append([]SemanticRead{}, proof.Outcome.Reads...)
							}
							rows[mode].Proofs = append(rows[mode].Proofs, snapshot)
							proof.Value.Literal = "caller mutation"
							if len(proof.Outcome.Reads) != 0 {
								proof.Outcome.Reads[0].Fingerprint = "caller mutation"
							}
						}
					}
					// Compare untouched snapshots, including exact reads/steps and
					// later proofs after public mutation of earlier returned slices.
					if !reflect.DeepEqual(rows[0], rows[1]) {
						t.Fatalf("complete proof/steps/reads/guard order differs denied=%v limits=%#v: old=%#v actual=%#v", denied, limits, rows[0], rows[1])
					}
				}
			}
		})
	}
}

func TestCaptureStructureAllCreationPathsMatchEagerOracle(t *testing.T) {
	file, _ := structuralFixture(`function outer(parameter){const value=parameter;function inner(){return value;}const literal=()=>value;const lookup=()=>external;const invoke=()=>callMe();}`)
	var inner, literal, external, call *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindFunctionDeclaration && node.Name() != nil && node.Name().Text() == "inner" {
			inner = node
		}
		if node.Kind == ast.KindArrowFunction && node.Body().Kind == ast.KindIdentifier && node.Body().Text() == "value" {
			literal = node
		}
		if node.Kind == ast.KindIdentifier && node.Text() == "external" {
			external = node
		}
		if node.Kind == ast.KindCallExpression {
			call = node
		}
	})
	if inner == nil || literal == nil || external == nil || call == nil {
		t.Fatal("creation-site fixtures missing")
	}
	for _, subject := range []*ast.Node{literal, external, call} {
		type row struct {
			Proof   NativeDemandProof
			Effects []EffectRequest
		}
		var rows [2]row
		for mode := range rows {
			context := fixtureContext([]CapturedFile{file})
			originalEffect := context.Effect
			context.Effect = func(request EffectRequest) EffectSummary {
				rows[mode].Effects = append(rows[mode].Effects, request)
				return originalEffect(request)
			}
			context.GlobalValue = func(path string, node *ast.Node) GlobalValueObservation {
				out := GlobalValueObservation{Known: true, Reads: []SemanticRead{{Kind: "fixture-global", Path: path, Name: node.Text(), Fingerprint: "current"}}}
				if node.Text() == "external" {
					out.Target, out.TargetPath = inner, file.Path
				}
				return out
			}
			context.CallTarget = func(path string, node *ast.Node) NativeEffectCall {
				return NativeEffectCall{Known: true, BodyPresent: true, CallableOwner: true, Target: inner, TargetPath: file.Path}
			}
			observer := newDemandObserver(context)
			if mode == 0 {
				observer.structures = nil
			}
			run := observer.run()
			value := run.evalAt(file.Path, subject, map[string]demandValue{"parameter": demandKnown("string", "current")}, 0)
			if subject.Kind != ast.KindCallExpression {
				value = run.invokeAt(value, nil, 0)
			}
			rows[mode].Proof = NativeDemandProof{Outcome: run.finish(value, ""), Value: valueSummary(value)}
			if rows[mode].Proof.Outcome.Kind != "known" || rows[mode].Proof.Value.Literal != "current" {
				t.Fatal("original creation path did not reach its expected current value", rows[mode].Proof)
			}
		}
		if !reflect.DeepEqual(rows[0], rows[1]) {
			t.Fatal("creation path changed full proof/effects", rows)
		}
	}
}

func TestCaptureStructureConcurrentColdReaderFreshProofs(t *testing.T) {
	file, _ := structuralFixture(`const f=(parameter)=>{const value=parameter;return()=>value;};const g=(parameter)=>{let value=parameter;return()=>value;};const left='left';const right='right';`)
	var functions, arguments []*ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindArrowFunction && effectFunctionOwner(node) == nil {
			functions = append(functions, node)
		}
		if node.Kind == ast.KindStringLiteral {
			arguments = append(arguments, node)
		}
	})
	if len(functions) != 2 || len(arguments) != 2 {
		t.Fatal("concurrent capture fixture missing")
	}
	limits := []Limits{{}, {MaximumSteps: 1}, {MaximumSteps: 16}, {MaximumDepth: 1}}
	baseline := NewNativeValueReader(fixtureContext([]CapturedFile{file}))
	baseline.observer.structures = nil
	var expected [2][2][4]NativeDemandProof
	for f := range functions {
		for a := range arguments {
			for l := range limits {
				expected[f][a][l] = baseline.Expression(file.Path, functions[f]).Invoke(baseline.Expression(file.Path, arguments[a])).Invoke().Resolve(limits[l])
			}
		}
		if expected[f][0][0].Outcome.Kind != "known" || expected[f][0][0].Value.Literal != "left" {
			t.Fatal("original supported closure proof missing")
		}
	}
	const workers = 32
	entered := make(chan struct{}, workers)
	release := make(chan struct{})
	start := make(chan struct{})
	var count atomic.Int64
	context := fixtureContext([]CapturedFile{file})
	originalEffect := context.Effect
	context.Effect = func(request EffectRequest) EffectSummary {
		if request.Operation == "invoke-function" && count.Add(1) <= workers {
			entered <- struct{}{}
			<-release
		}
		return originalEffect(request)
	}
	reader := NewNativeValueReader(context)
	var plans [2][2]NativeDemandPlan
	for f := range functions {
		for a := range arguments {
			plans[f][a] = reader.Expression(file.Path, functions[f]).Invoke(reader.Expression(file.Path, arguments[a])).Invoke()
		}
	}
	errors := make(chan string, workers)
	var completed sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		completed.Add(1)
		go func(worker int) {
			defer completed.Done()
			<-start
			f, a := worker%2, (worker/2)%2
			for iteration := 0; iteration < 16; iteration++ {
				l := iteration % len(limits)
				proof := plans[f][a].Resolve(limits[l])
				if !reflect.DeepEqual(proof, expected[f][a][l]) {
					errors <- fmt.Sprintf("worker=%d iteration=%d complete proof mismatch", worker, iteration)
					return
				}
				proof.Value.Literal = "caller-owned"
				if len(proof.Outcome.Reads) != 0 {
					proof.Outcome.Reads[0].Fingerprint = "caller-owned"
				}
			}
		}(worker)
	}
	close(start)
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for worker := 0; worker < workers; worker++ {
		select {
		case <-entered:
		case <-timer.C:
			close(release)
			completed.Wait()
			t.Fatal("semantic callbacks serialized before capture initialization")
		}
	}
	close(release)
	completed.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	for _, function := range functions {
		structure := reader.observer.structures[function]
		if structure == nil || structure.capture == nil {
			t.Fatal("concurrent first capture index was not published")
		}
	}
}
