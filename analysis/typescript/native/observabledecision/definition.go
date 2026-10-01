package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

type DefinitionObservation struct {
	Path          string
	Start, End    int
	Constructor   string
	Ownership, ID DemandOutcome
}
type DefinitionProduct struct {
	Observations []DefinitionObservation
	Residual     []DemandOutcome
	Complete     bool
}

// ObserveDefinitionIDs reads only runtime constructor and selected ID demands.
// It has no call inventory, source membership or universe completeness authority.
func ObserveDefinitionIDs(context DemandContext) DefinitionProduct {
	observer := newDemandObserver(context)
	product := DefinitionProduct{}
	for _, captured := range context.Files {
		module := observer.modules[captured.Path]
		if module == nil || module.reason != "" {
			product.Residual = append(product.Residual, demandOutcomeUnknown("captured definition source unavailable"))
			continue
		}
		if captured.Role != "production" || (captured.Layer != "queries" && captured.Layer != "mutations") {
			continue
		}
		var walk func(*ast.Node)
		walk = func(node *ast.Node) {
			if ast.IsFunctionLike(node) {
				return
			}
			if node.Kind == ast.KindCallExpression {
				discovery := observer.run()
				discovery.limits = normalizedLimits(Limits{})
				call := node.AsCallExpression()
				callee := discovery.evalAt(captured.Path, call.Expression, nil, 0)
				if callee.kind == "factory" {
					idRun := observer.run()
					id := demandKnown("undefined", "")
					if len(call.Arguments.Nodes) > 0 {
						projector := idRun.evalAt(captured.Path, call.Arguments.Nodes[0], nil, 2)
						object := idRun.invokeAt(projector, nil, 1)
						id = idRun.propertyAt(object, "id", 0)
					}
					product.Observations = append(product.Observations, DefinitionObservation{Path: captured.Path, Start: utf16At(module.file.Text, scanner.GetTokenPosOfNode(node, module.file.Source, false)), End: utf16At(module.file.Text, node.End()), Constructor: callee.text, Ownership: discovery.finish(demandKnown("constructor", callee.text), ""), ID: idRun.finish(id, "string")})
				}
			}
			node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
		}
		walk(module.file.Source.AsNode())
	}
	return product
}
func demandOutcomeUnknown(reason string) DemandOutcome {
	return DemandOutcome{Kind: "unknown", Reason: reason}
}
