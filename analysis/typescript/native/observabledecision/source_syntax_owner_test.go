package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"reflect"
	"sync"
	"testing"
)

func TestSourceSyntaxRetainsStructureNotProofsOrAllowances(t *testing.T) {
	file, _ := structuralFixture("function f(parameter){let value=parameter;value=parameter;return value;}")
	var reference *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindIdentifier && node.Text() == "value" {
			reference = node
		}
	})
	owner := NewSourceSyntaxOwner()
	warm := newDemandObserver(DemandContext{Files: []CapturedFile{file}, Syntax: owner})
	warm.localStructure(file.Path, effectFunctionOwner(reference), reference)
	retained := owner.Retain([]*ast.SourceFile{file.Source})
	var before *demandFunctionStructure
	for _, structure := range warm.structures {
		before = structure
	}
	for _, limit := range []int{1, 4096, 1} {
		for _, argument := range []string{"first", "second", "first"} {
			for _, mutation := range []bool{false, true} {
				type result struct {
					Outcome DemandOutcome
					Effects []EffectRequest
				}
				var rows [2]result
				for mode := range rows {
					context := fixtureContext([]CapturedFile{file})
					if mode == 1 {
						context.Syntax = retained
					}
					context.Effect = func(request EffectRequest) EffectSummary {
						rows[mode].Effects = append(rows[mode].Effects, request)
						return EffectSummary{Pure: !mutation, VirtualSteps: 1, ChargeKey: request.Operation, Reason: "VALUE_MUTATION_UNSUPPORTED", Reads: []SemanticRead{{Kind: "current", Fingerprint: argument}}}
					}
					observer := newDemandObserver(context)
					if mode == 0 {
						observer.structures = nil
					}
					run := observer.run()
					run.limits.MaximumSteps = limit
					value, found := run.localIdentifier(file.Path, reference, map[string]demandValue{"parameter": demandKnown("string", argument)})
					if !found {
						t.Fatal("binding unavailable")
					}
					rows[mode].Outcome = run.finish(value, "")
					if mode == 1 && observer.structures[effectFunctionOwner(reference)] != nil && observer.structures[effectFunctionOwner(reference)] != before {
						t.Fatal("pointer-owned plan not reused")
					}
				}
				if !reflect.DeepEqual(rows[0], rows[1]) {
					t.Fatalf("fresh budgets/arguments/ordered effects changed: %#v %#v", rows[0], rows[1])
				}
			}
		}
	}
	other, _ := structuralFixture(file.Text)
	filtered := retained.Retain([]*ast.SourceFile{other.Source})
	if len(filtered.sources) != 0 {
		t.Fatal("equal text/coordinates borrowed foreign AST")
	}
}

func TestSourceSyntaxMalformedAndContextCapturesStayFresh(t *testing.T) {
	file, _ := structuralFixture("export const value='current';")
	owner := NewSourceSyntaxOwner()
	newDemandObserver(DemandContext{Files: []CapturedFile{file}, Syntax: owner})
	for _, files := range [][]CapturedFile{
		{file, file},
		{{Path: file.Path, AbsolutePath: file.AbsolutePath, Text: "different", Source: file.Source}},
		{{Path: "different.ts", AbsolutePath: file.AbsolutePath, Role: "test", Layer: "mutations", Text: file.Text, Source: file.Source}},
	} {
		original := newDemandObserver(DemandContext{Files: files})
		current := newDemandObserver(DemandContext{Files: files, Syntax: owner})
		if !reflect.DeepEqual(original.modules, current.modules) {
			t.Fatal("duplicate/mismatch/context admission changed")
		}
	}
	freshCore := NewNativeEffectCore([]CapturedFile{file}, NativeEffectAuthority{})
	corrupt := file
	corrupt.Text = "different"
	if !NewCapturedNativeEffectCoreWithSyntax([]CapturedFile{corrupt}, NativeEffectAuthority{}, owner).invalidCapture || freshCore.invalidCapture {
		t.Fatal("text mismatch acquired effect authority")
	}
}

func TestSourceSyntaxConcurrentConsumersKeepFreshSemanticState(t *testing.T) {
	file, _ := structuralFixture("function f(parameter){let value=parameter;value=parameter;return value;}")
	var reference *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindIdentifier && node.Text() == "value" {
			reference = node
		}
	})
	shared := NewSourceSyntaxOwner().Retain([]*ast.SourceFile{file.Source})
	type result struct {
		Outcome DemandOutcome
		Effects []EffectRequest
	}
	var actual, expected [2]result
	evaluate := func(index int, syntax *SourceSyntaxOwner, row *result) {
		context := fixtureContext([]CapturedFile{file})
		context.Syntax = syntax
		context.Effect = func(request EffectRequest) EffectSummary {
			row.Effects = append(row.Effects, request)
			return EffectSummary{Pure: true, VirtualSteps: 1, Reads: []SemanticRead{{Kind: "current", Fingerprint: []string{"left", "right"}[index]}}}
		}
		observer := newDemandObserver(context)
		run := observer.run()
		value, _ := run.localIdentifier(file.Path, reference, map[string]demandValue{"parameter": demandKnown("string", []string{"left", "right"}[index])})
		row.Outcome = run.finish(value, "")
	}
	var group sync.WaitGroup
	for index := range actual {
		group.Add(1)
		go func() { defer group.Done(); evaluate(index, shared, &actual[index]) }()
	}
	group.Wait()
	for index := range expected {
		evaluate(index, nil, &expected[index])
		if !reflect.DeepEqual(actual[index], expected[index]) {
			t.Fatal("shared parser plan leaked semantic state", actual[index], expected[index])
		}
	}
	foreign, _ := structuralFixture(file.Text)
	newDemandObserver(DemandContext{Files: []CapturedFile{foreign}, Syntax: shared})
	if shared.sources[foreign.Source] != nil {
		t.Fatal("foreign AST entered current Program membership")
	}
}
