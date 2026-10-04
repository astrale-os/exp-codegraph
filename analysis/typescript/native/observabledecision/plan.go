package observabledecision

import ast "github.com/microsoft/typescript-go/shim/ast"

// NativeValueReader owns plans over an immutable native capture. It never
// returns a whole-body representation or executes an authored runtime callback.
// Resolve/Effect callbacks must be bound to the same immutable capture lifetime.
type NativeValueReader struct{ observer *demandObserver }
type NativeDemandPlan struct {
	reader   *NativeValueReader
	evaluate func(*demandRun, int) demandValue
}
type NativeValueSummary struct {
	Kind, Literal string
	Identity      string   `json:",omitempty"`
	Properties    []string `json:",omitempty"`
	Complete      bool     `json:",omitempty"`
	Origin        *Origin
	Function      *DemandShape
}
type NativeDemandProof struct {
	Outcome DemandOutcome
	Value   NativeValueSummary
}

func NewNativeValueReader(context DemandContext) *NativeValueReader {
	return &NativeValueReader{observer: newDemandObserver(context)}
}
func (reader *NativeValueReader) Expression(path string, node *ast.Node) NativeDemandPlan {
	return NativeDemandPlan{reader: reader, evaluate: func(run *demandRun, depth int) demandValue {
		module := reader.observer.modules[path]
		if module == nil || node == nil || ast.GetSourceFileOfNode(node) != module.file.Source {
			return demandUnknown("expression does not belong to captured reader")
		}
		if !run.checkDepth(depth) {
			return demandUnknown(run.exhausted)
		}
		return run.evalAt(path, node, nil, depth)
	}}
}
func (plan NativeDemandPlan) Property(name string) NativeDemandPlan {
	return NativeDemandPlan{reader: plan.reader, evaluate: func(run *demandRun, depth int) demandValue {
		if !run.checkDepth(depth) {
			return demandUnknown(run.exhausted)
		}
		return run.propertyAt(plan.evaluate(run, depth+1), name, depth)
	}}
}
func (plan NativeDemandPlan) Invoke(arguments ...NativeDemandPlan) NativeDemandPlan {
	return NativeDemandPlan{reader: plan.reader, evaluate: func(run *demandRun, depth int) demandValue {
		if !run.checkDepth(depth) {
			return demandUnknown(run.exhausted)
		}
		callee := plan.evaluate(run, depth+1)
		args := make([]demandValue, 0, len(arguments))
		for _, argument := range arguments {
			if argument.reader != plan.reader {
				return demandUnknown("plans belong to different captured readers")
			}
			args = append(args, argument.evaluate(run, depth+1))
		}
		return run.invokeAt(callee, args, depth)
	}}
}

// Resolve starts a fresh proof allowance. Demands for ID, callback presence,
// request provenance, etc. must not share consumption or inherit discovery's
// allowance. Current accounting is exploratory and not legacy-parity qualified.
func (plan NativeDemandPlan) Resolve(limits Limits) NativeDemandProof {
	if plan.reader == nil || plan.evaluate == nil {
		return NativeDemandProof{Outcome: DemandOutcome{Kind: "unknown", Reason: "missing captured plan"}}
	}
	run := plan.reader.observer.run()
	run.limits = normalizedLimits(limits)
	value := plan.evaluate(run, 0)
	summary := valueSummary(value)
	return NativeDemandProof{Outcome: run.finish(value, ""), Value: summary}
}
