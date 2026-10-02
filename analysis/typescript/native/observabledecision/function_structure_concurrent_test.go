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

// Both readers share the original immutable parsed capture. The baseline uses
// unchanged helper walks; only the actual reader starts concurrent initialization.
// The fixture also fails if semantic callbacks are serialized behind a plan lock.
func TestFunctionStructureConcurrentReaderFreshProofs(t *testing.T) {
	file, _ := structuralFixture(`const f=(parameter)=>{let value=parameter;return value;};const g=(parameter)=>{const value=parameter;return value;};const left='left';const right='right';`)
	var functions, arguments []*ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindArrowFunction {
			functions = append(functions, node)
		}
		if node.Kind == ast.KindStringLiteral && (node.Text() == "left" || node.Text() == "right") {
			arguments = append(arguments, node)
		}
	})
	if len(functions) != 2 || len(arguments) != 2 {
		t.Fatal("fixture functions/arguments missing")
	}
	limits := []Limits{{}, {MaximumSteps: 1}, {MaximumSteps: 4}, {MaximumDepth: 1}}
	baseline := NewNativeValueReader(fixtureContext([]CapturedFile{file}))
	baseline.observer.structures = nil
	var expected [2][2][4]NativeDemandProof
	for function := range functions {
		for argument := range arguments {
			plan := baseline.Expression(file.Path, functions[function]).Invoke(baseline.Expression(file.Path, arguments[argument]))
			for limit := range limits {
				expected[function][argument][limit] = plan.Resolve(limits[limit])
			}
			if expected[function][argument][0].Outcome.Kind != "known" || len(expected[function][argument][0].Outcome.Reads) == 0 {
				t.Fatal("original pure reader proof missing")
			}
		}
	}
	const workers = 32
	entered := make(chan struct{}, workers)
	release := make(chan struct{})
	var invocationCount, effectCount atomic.Int64
	context := fixtureContext([]CapturedFile{file})
	originalEffect := context.Effect
	context.Effect = func(request EffectRequest) EffectSummary {
		effectCount.Add(1)
		if request.Operation == "invoke-function" && invocationCount.Add(1) <= workers {
			// Every worker must reach its first semantic invocation before any
			// function-flow or lexical-index initialization can begin.
			entered <- struct{}{}
			<-release
		}
		return originalEffect(request)
	}
	reader := NewNativeValueReader(context)
	var plans [2][2]NativeDemandPlan
	for function := range functions {
		for argument := range arguments {
			plans[function][argument] = reader.Expression(file.Path, functions[function]).Invoke(reader.Expression(file.Path, arguments[argument]))
		}
	}
	start := make(chan struct{})
	errors := make(chan string, workers)
	var completed sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		completed.Add(1)
		go func(worker int) {
			defer completed.Done()
			<-start
			function, argument := worker%2, (worker/2)%2
			for iteration := 0; iteration < 24; iteration++ {
				limit := iteration % len(limits)
				proof := plans[function][argument].Resolve(limits[limit])
				if !reflect.DeepEqual(proof, expected[function][argument][limit]) {
					errors <- fmt.Sprintf("worker=%d iteration=%d: independent proof differs: actual=%#v expected=%#v", worker, iteration, proof, expected[function][argument][limit])
					return
				}
				// Public outcomes may be modified by their consumer. No later
				// proof or immutable structural vector may share this mutable data.
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
	for count := 0; count < workers; count++ {
		select {
		case <-entered:
		case <-timer.C:
			close(release)
			completed.Wait()
			t.Fatal("pure semantic callbacks serialized behind structural initialization")
		}
	}
	close(release)
	completed.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	if len(reader.observer.structures) != len(functions) || invocationCount.Load() < workers || effectCount.Load() < workers {
		t.Fatal("actual shared reader did not exercise both initialization owners/fresh callbacks")
	}
	for _, function := range functions {
		structure := reader.observer.structures[function]
		if structure == nil || structure.lexical == nil {
			t.Fatal("actual shared flow/binding publication missing")
		}
	}
}
