package observabledecision

import (
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"reflect"
	"testing"
)

func TestCanonicalEffectPartitionEqualsOriginalScanIncludingBudgetsAndNegativeClosure(t *testing.T) {
	fixtures := []string{
		`const object={}; const alias=object; alias.x=1; const quiet={}; opaque(alias);`,
		`const object={}; inspect(object); function inspect(parameter){parameter.x=1;} function local(){const localValue={}; localValue.x=1;}`,
		`const object={}; const one=object; const two=one; const cycle=two; one=cycle; opaque(two);`,
		`const object={}; delete object.x; opaque(delete object.y);`,
		`const object={}; unrelated.x=1;`,
	}
	for _, text := range fixtures {
		indexed, file := effectFixture(text)
		candidateCount := len(indexed.candidates)
		indexed.immutableProofOwner = true
		originalAuthority := indexed.authority
		originalAuthority.Match = func(file CapturedFile, node *ast.Node, symbol string) (bool, bool, []SemanticRead) {
			root := originalAuthority.Symbol(file, node)
			return root.Key == symbol, root.Known, nil
		}
		original := NewNativeEffectCore([]CapturedFile{*file}, originalAuthority)
		admissions := 0
		before := indexed.authority.CandidateAdmitted
		indexed.authority.CandidateAdmitted = func(file CapturedFile, node *ast.Node, kind string) (bool, bool) {
			admissions++
			return before(file, node, kind)
		}
		for _, kind := range []string{"mutation", "escape"} {
			for _, symbol := range []string{"object", "alias", "quiet", "one", "two", "cycle", "parameter", "localValue", "unrelated", "absent"} {
				for _, owner := range []string{"", "local-function"} {
					actual, want := indexed.Proof(kind, symbol, owner), original.Proof(kind, symbol, owner)
					if !reflect.DeepEqual(actual, want) {
						t.Fatalf("%s %s owner=%s\nactual=%+v\noriginal=%+v", kind, symbol, owner, actual, want)
					}
				}
			}
		}
		if admissions != candidateCount {
			t.Fatalf("admission rescanned: %d != %d", admissions, candidateCount)
		}
	}
}

func TestCanonicalEffectPartitionRetainsUnknownGlobalAdmissionGap(t *testing.T) {
	indexed, file := effectFixture(`const object={}; unrelated.x=1;`)
	before := indexed.authority.CandidateAdmitted
	indexed.authority.CandidateAdmitted = func(file CapturedFile, node *ast.Node, kind string) (bool, bool) {
		if kind == "mutation" {
			return false, false
		}
		return before(file, node, kind)
	}
	authority := indexed.authority
	authority.Match = func(file CapturedFile, node *ast.Node, symbol string) (bool, bool, []SemanticRead) {
		root := authority.Symbol(file, node)
		return root.Key == symbol, root.Known, nil
	}
	original := NewNativeEffectCore([]CapturedFile{*file}, authority)
	for _, kind := range []string{"mutation", "escape"} {
		actual, want := indexed.Proof(kind, "object", ""), original.Proof(kind, "object", "")
		if actual.Known || !reflect.DeepEqual(actual, want) {
			t.Fatalf("unknown negative admission erased: %+v %+v", actual, want)
		}
	}
}

// The retaining owner runs the original partition loop before acquiring the
// immutable proof-cache lifetime. It keeps the old candidate backing storage,
// while all actual proof/ceiling operations use the same unchanged algorithms.
func TestCapturedEffectPartitionTransfersStorageWithoutChangingOrderedDemands(t *testing.T) {
	for _, gap := range []string{"", "admission", "symbol"} {
		for _, ceilingFirst := range []bool{false, true} {
			fixture, file := effectFixture(`const object={}; const alias=object; alias.x=1; inspect(alias); function inspect(parameter){parameter.x=1;} delete object.x; opaque(delete object.y); unrelated.x=1;`)
			var owners [2]*NativeEffectCore
			var traces [2][]string
			for mode := range owners {
				authority := fixture.authority
				admit, symbol, call, deleted := authority.CandidateAdmitted, authority.Symbol, authority.Call, authority.DeleteAdmitted
				trace := func(kind string, node *ast.Node) {
					traces[mode] = append(traces[mode], fmt.Sprintf("%s:%d:%d:%d", kind, node.Kind, node.Pos(), node.End()))
				}
				authority.CandidateAdmitted = func(f CapturedFile, n *ast.Node, kind string) (bool, bool) {
					trace("admit:"+kind, n)
					if gap == "admission" && kind == "mutation" {
						return false, false
					}
					return admit(f, n, kind)
				}
				authority.Symbol = func(f CapturedFile, n *ast.Node) NativeEffectSymbol {
					trace("symbol", n)
					if gap == "symbol" && n.Kind == ast.KindIdentifier && n.Text() == "unrelated" {
						return NativeEffectSymbol{}
					}
					return symbol(f, n)
				}
				authority.Call = func(f CapturedFile, n *ast.Node) NativeEffectCall { trace("call", n); return call(f, n) }
				authority.DeleteAdmitted = func(f CapturedFile, n *ast.Node) (bool, bool) { trace("delete", n); return deleted(f, n) }
				owners[mode] = NewCapturedNativeEffectCore([]CapturedFile{*file}, authority)
			}
			var ceilings [2]func(string) (int, bool)
			for mode, owner := range owners {
				ceilings[mode] = owner.NewDiscoveryAliasCeiling(func(_ CapturedFile, n *ast.Node) (bool, bool) { return n.Text() == "parameter", true }, func(CapturedFile, *ast.Node, string) bool { return true })
			}
			prepareOriginal := func() {
				if !owners[0].canonicalCandidatesIndexed {
					owners[0].immutableProofOwner = false
					owners[0].indexCanonicalCandidates()
					owners[0].immutableProofOwner = true
				}
			}
			checkCeiling := func() {
				prepareOriginal()
				left, lk := ceilings[0]("object")
				right, rk := ceilings[1]("object")
				if left != right || lk != rk || !reflect.DeepEqual(traces[0], traces[1]) {
					t.Fatal("ceiling changed original ordered authority prefix", left, lk, right, rk, traces)
				}
			}
			checkProofs := func() {
				for _, kind := range []string{"mutation", "escape"} {
					for _, root := range []string{"object", "alias", "parameter", "absent"} {
						for _, local := range []string{"", "local-function"} {
							prepareOriginal()
							left, right := owners[0].Proof(kind, root, local), owners[1].Proof(kind, root, local)
							if !reflect.DeepEqual(left, right) || !reflect.DeepEqual(traces[0], traces[1]) {
								t.Fatal("proof/read/charge or callback prefix changed", left, right, traces)
							}
						}
					}
				}
			}
			if ceilingFirst {
				checkCeiling()
				checkProofs()
			} else {
				checkProofs()
				checkCeiling()
			}
			checkProofs()
			checkCeiling()
			if len(owners[0].candidates) == 0 || owners[1].candidates != nil {
				t.Fatal("completed immutable partition did not transfer only redundant storage")
			}
		}
	}
}

func TestEffectMatchAuthorityRetainsOriginalPoolAcrossRepeatedDemands(t *testing.T) {
	fixture, file := effectFixture(`const object={}; const alias=object; opaque(alias);`)
	for _, immutable := range []bool{false, true} {
		authority := fixture.authority
		matches := 0
		authority.Match = func(f CapturedFile, n *ast.Node, root string) (bool, bool, []SemanticRead) {
			matches++
			symbol := authority.Symbol(f, n)
			return symbol.Key == root, symbol.Known, []SemanticRead{{Kind: "binding-comparison", Name: n.Text(), Fingerprint: root}}
		}
		owner := NewNativeEffectCore([]CapturedFile{*file}, authority)
		owner.immutableProofOwner = immutable
		count := len(owner.candidates)
		owner.indexCanonicalCandidates()
		if len(owner.candidates) != count {
			t.Fatal("Match authority lost its original scan pool")
		}
		before := matches
		first := owner.Proof("escape", "object", "")
		afterFirst := matches
		second := owner.Proof("escape", "object", "")
		if !first.Known || !reflect.DeepEqual(first, second) || matches == before {
			t.Fatal("Match scan or repeated proof changed", first, second, matches)
		}
		if !immutable && matches == afterFirst {
			t.Fatal("dynamic repeated demand stopped original Match callbacks")
		}
		if len(owner.candidates) != count {
			t.Fatal("repeated Match demand retired its pool")
		}
	}
}
