package observabledecision

import (
	"reflect"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
)

// The oracle keeps the original independent reader over the same owned AST.
// Resolver/effect premises are fixtureContext's explicit scalar authorities;
// this checks the reader handoff, not compiler-library origin production.
func TestLibraryReceiverBorrowsCaptureWithoutSharingProofAllowances(t *testing.T) {
	for _, fixture := range []struct {
		name, binding    string
		proofs, failures int
	}{
		{"library", `import {library} from 'fixture-library';`, 2, 0},
		// A closed missing property is known undefined: discovery must not ask
		// for library authority or turn this original negative into a failure.
		{"shadow", `const library={};`, 0, 0},
		{"missing", ``, 2, 2},
		{"nested-unknown", `const library=(()=>unknown)();`, 2, 2},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			text := fixture.binding + `const alias=library;alias.parse({id:'one'});alias.parse({id:'two'});`
			file, _ := structuralFixture(text)
			foreign, _ := structuralFixture(text)
			var sites []CapturedCall
			var subjects []CapturedDefinitionSubject
			for _, statement := range file.Source.Statements.Nodes {
				if statement.Kind != ast.KindExpressionStatement {
					continue
				}
				call := statement.AsExpressionStatement().Expression
				start, end := utf16At(text, call.Pos()), utf16At(text, call.End())
				sites = append(sites, CapturedCall{Path: file.Path, Node: call, Callee: call.AsCallExpression().Expression, Start: start, End: end})
				subjects = append(subjects, CapturedDefinitionSubject{Path: file.Path, Start: start, End: end})
			}
			if len(sites) != 2 {
				t.Fatal("original call inventory fixture missing")
			}
			var products [2]RuntimeProducts
			var proofs [2][]NativeDemandProof
			var traces [2][]string
			for mode := range products {
				context := fixtureContext([]CapturedFile{file})
				context.Limits = Limits{MaximumSteps: 1}
				context.Resolve = func(path, specifier, export string) Resolution {
					traces[mode] = append(traces[mode], "resolve:"+specifier+":"+export)
					return Resolution{Origin: &Origin{File: "bundled:/lib.es5.d.ts", Path: []string{export}}, Reads: []SemanticRead{{Kind: "qualified-export", Path: specifier, Name: export, Fingerprint: "fixture-library-v1"}}}
				}
				effect := context.Effect
				context.Effect = func(request EffectRequest) EffectSummary {
					traces[mode] = append(traces[mode], "effect:"+request.Operation)
					return effect(request)
				}
				context.Calls = func([]string) NativeCallInventory {
					return NativeCallInventory{Known: true, Complete: true, Sites: sites}
				}
				context.DefinitionSubjects = func([]string) NativeDefinitionSubjects {
					return NativeDefinitionSubjects{Known: true, Subjects: subjects}
				}
				var original *NativeValueReader
				if mode == 0 {
					original = NewNativeValueReader(context)
				}
				var borrowed *NativeValueReader
				context.CompilerLibraryReceiver = func(path string, call *ast.Node, reader *NativeValueReader) LibraryReceiverObservation {
					if mode == 0 {
						reader = original
					} else if borrowed != nil && borrowed != reader {
						t.Fatal("one definition attempt must lend one reader facade")
					}
					borrowed = reader
					if bad := reader.Expression(path, foreign.Source.AsNode()).Resolve(Limits{}); bad.Outcome.Reason != "expression does not belong to captured reader" {
						t.Fatal("different captured AST became admissible", bad)
					}
					receiver := call.AsCallExpression().Expression.AsPropertyAccessExpression().Expression
					proof := reader.Expression(path, receiver).Resolve(Limits{})
					proofs[mode] = append(proofs[mode], proof)
					library := proof.Outcome.Kind == "known" && proof.Value.Kind == "external" && proof.Value.Origin != nil && proof.Value.Origin.File == "bundled:/lib.es5.d.ts"
					if fixture.name == "library" {
						limited := reader.Expression(path, receiver).Resolve(context.Limits)
						if !library || limited.Outcome.Reason != "VALUE_STEP_LIMIT" {
							t.Fatal("helper default allowance inherited graph exhaustion", proof, limited)
						}
					} else if library {
						t.Fatal("shadowed/missing/nested unknown receiver became a library")
					}
					return LibraryReceiverObservation{Known: !proof.Outcome.MigrationIncomplete, Library: library, Reads: proof.Outcome.Reads}
				}
				products[mode] = NewRuntimeDecisionGraph(context).Resume()
				if len(proofs[mode]) != fixture.proofs || (len(proofs[mode]) == 2 && !reflect.DeepEqual(proofs[mode][0], proofs[mode][1])) {
					t.Fatal("receiver proofs were omitted or inherited earlier consumption", proofs[mode])
				}
				failures := len(products[mode].Definitions.DiscoveryFailures)
				if failures != fixture.failures {
					t.Fatal("library/shadow distinction lost", products[mode])
				}
			}
			if !reflect.DeepEqual(products[0], products[1]) || !reflect.DeepEqual(proofs[0], proofs[1]) || !reflect.DeepEqual(traces[0], traces[1]) {
				t.Fatal("borrowed reader changed original complete products, proofs or ordered resolver/effect prefix", products, proofs, traces)
			}
		})
	}
}
