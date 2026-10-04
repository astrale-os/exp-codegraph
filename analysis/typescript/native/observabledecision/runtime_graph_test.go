package observabledecision

import (
	"reflect"
	"testing"
)

func TestRuntimeGraphResumesOnlyBlockedCellsAndRetainsNegativeInventory(t *testing.T) {
	ready := false
	calls := 0
	context := DemandContext{
		Calls: func([]string) NativeCallInventory {
			calls++
			return NativeCallInventory{Known: ready, Complete: true}
		},
		DefinitionSubjects: func([]string) NativeDefinitionSubjects { return NativeDefinitionSubjects{Known: true} },
	}
	graph := NewRuntimeDecisionGraph(context)
	graph.Resume()
	if graph.QueryEvaluations != 1 || graph.DefinitionEvaluations != 1 {
		t.Fatal("initial cells omitted")
	}
	ready = true
	second := graph.Resume()
	if graph.QueryEvaluations != 2 || graph.DefinitionEvaluations != 2 {
		t.Fatal("blocked cells did not resume")
	}
	previousCalls := calls
	third := graph.Resume()
	if calls != previousCalls || graph.QueryEvaluations != 2 || graph.DefinitionEvaluations != 2 {
		t.Fatal("completed negative inventory evaluated again")
	}
	if !reflect.DeepEqual(second, third) || !reflect.DeepEqual(third, ObserveRuntime(context)) {
		t.Fatal("replayed runtime differs from fresh evaluation")
	}
}
