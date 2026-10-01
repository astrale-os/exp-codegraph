package observabledecision

import (
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
		if admissions != len(indexed.candidates) {
			t.Fatalf("admission rescanned: %d != %d", admissions, len(indexed.candidates))
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
