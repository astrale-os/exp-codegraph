package observabledecision

import ast "github.com/microsoft/typescript-go/shim/ast"

func (observer *demandObserver) dataArguments(path string, call *ast.Node) bool {
	if call == nil || call.Kind != ast.KindCallExpression {
		return false
	}
	reader := &NativeValueReader{observer: observer}
	type pendingValue struct {
		plan  NativeDemandPlan
		depth int
	}
	pending := []pendingValue{}
	for _, argument := range call.AsCallExpression().Arguments.Nodes {
		pending = append(pending, pendingValue{plan: reader.Expression(path, argument)})
	}
	remaining := 4096
	for len(pending) > 0 {
		remaining--
		if remaining < 0 {
			return false
		}
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		proof := current.plan.Resolve(Limits{MaximumSteps: 4096, MaximumDepth: 64, MaximumAlternatives: 32})
		if proof.Outcome.Kind != "known" {
			return false
		}
		value := proof.Value
		switch value.Kind {
		case "string", "number", "literal", "undefined":
			continue
		case "object":
			if !value.Complete || current.depth >= 64 || len(value.Properties) > remaining {
				return false
			}
			for _, property := range value.Properties {
				pending = append(pending, pendingValue{plan: current.plan.Property(property), depth: current.depth + 1})
			}
		default:
			return false
		}
	}
	return true
}
