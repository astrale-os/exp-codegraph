package observabledecision

import (
	"reflect"
	"testing"
)

func TestProofCellsPreserveCompleteTraceAndVirtualCosts(t *testing.T) {
	core, _ := effectFixture(`const object={}; const alias=object; inspect(alias); function inspect(parameter){parameter.x=1;} const quiet={}; opaque(alias);`)
	core.immutableProofOwner = true
	for _, symbol := range []string{"object", "alias", "parameter", "quiet", "absent"} {
		for _, kind := range []string{"mutation", "escape"} {
			for _, owner := range []string{"", "local-function"} {
				original := core.computeProof(kind, symbol, owner)
				for repeat := 0; repeat < 3; repeat++ {
					actual := core.Proof(kind, symbol, owner)
					if !reflect.DeepEqual(actual, original) {
						t.Fatalf("full trace/cost differs %s/%s/%s", kind, symbol, owner)
					}
					if len(actual.Reads) > 0 {
						actual.Reads[0].Fingerprint = "consumer mutation"
					}
				}
			}
		}
	}
	if len(core.proofCells) == 0 {
		t.Fatal("complete cells absent")
	}
}
func TestProofCellsNeverRetainMissingAuthority(t *testing.T) {
	core, _ := effectFixture(`const object={};`)
	core.immutableProofOwner = true
	core.authority.MembershipComplete = false
	if core.Proof("mutation", "object", "").Known {
		t.Fatal("missing membership accepted")
	}
	if len(core.proofCells) != 0 {
		t.Fatal("missing authority became ready")
	}
	core.authority.MembershipComplete = true
	if !core.Proof("mutation", "object", "").Known {
		t.Fatal("fresh complete authority not evaluated")
	}
}
func TestDynamicAuthorityDoesNotUseProofCells(t *testing.T) {
	core, _ := effectFixture(`const object={};`)
	if !core.Proof("mutation", "object", "").Known {
		t.Fatal("fixture")
	}
	core.authority.MembershipComplete = false
	if core.Proof("mutation", "object", "").Known {
		t.Fatal("default dynamic authority reused old observation")
	}
	if len(core.proofCells) != 0 {
		t.Fatal("dynamic authority retained cells")
	}
}
