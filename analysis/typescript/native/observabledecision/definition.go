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
	InventoryKnown    bool
	DiscoveryFailures []DemandDiscoveryFailure
	InventoryReasons  []string
	Observations      []DefinitionObservation
	Residual          []DemandOutcome
	Complete          bool
}

// ObserveDefinitionIDs reads only runtime constructor and selected ID demands.
// It has no call inventory, source membership or universe completeness authority.
func ObserveDefinitionIDs(context DemandContext) DefinitionProduct {
	return observeDefinitionIDs(context, newDemandObserver(context))
}
func observeDefinitionIDs(context DemandContext, observer *demandObserver) DefinitionProduct {
	product := DefinitionProduct{}
	inventory, supplied := observer.callInventory("queries", "mutations")
	product.InventoryKnown = supplied && inventory.Known
	if supplied && !inventory.Known {
		product.Residual = append(product.Residual, demandOutcomeUnknown("Native definition call inventory authority is unavailable."))
		return product
	}
	if supplied && !inventory.Complete {
		product.InventoryReasons = append(product.InventoryReasons, inventory.Reasons...)
	}
	if !supplied {
		inventory.Sites = nil
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
					inventory.Sites = append(inventory.Sites, CapturedCall{Path: captured.Path, Node: node, Callee: node.AsCallExpression().Expression})
				}
				node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
			}
			walk(module.file.Source.AsNode())
		}
	}
	var selected map[CapturedDefinitionSubject]bool
	remaining := []CapturedDefinitionSubject{}
	if context.DefinitionSubjects != nil {
		paths := []string{}
		for _, file := range context.Files {
			if file.Role == "production" && (file.Layer == "queries" || file.Layer == "mutations") {
				paths = append(paths, file.Path)
			}
		}
		subjects := context.DefinitionSubjects(paths)
		if !subjects.Known {
			product.Residual = append(product.Residual, demandOutcomeUnknown("Authored definition subject authority is unavailable."))
			return product
		}
		selected = map[CapturedDefinitionSubject]bool{}
		for _, subject := range subjects.Subjects {
			selected[subject] = true
			remaining = append(remaining, subject)
		}
	} else if supplied {
		product.Residual = append(product.Residual, demandOutcomeUnknown("Authored definition subject authority is unavailable."))
	}
	for _, site := range inventory.Sites {
		module := observer.modules[site.Path]
		start, end := site.Start, site.End
		if module != nil && site.Node != nil {
			start = module.utf16At(scanner.GetTokenPosOfNode(site.Node, module.file.Source, false))
			end = module.utf16At(site.Node.End())
		}
		subject := CapturedDefinitionSubject{Path: site.Path, Start: start, End: end}
		if selected != nil && !selected[subject] {
			continue
		}
		if selected != nil {
			delete(selected, subject)
		}
		failure := func(reason string) {
			product.DiscoveryFailures = append(product.DiscoveryFailures, DemandDiscoveryFailure{Path: site.Path, Start: start, End: end, Reason: reason})
		}
		if module == nil || site.Node == nil || site.Callee == nil {
			failure("Definition call source or callee is unavailable.")
			continue
		}
		if module.reason != "" || ast.GetSourceFileOfNode(site.Node) != module.file.Source {
			product.Residual = append(product.Residual, demandOutcomeUnknown("Runtime definition call anchor is not the current captured AST."))
			continue
		}
		discovery := observer.run()
		discovery.limits = normalizedLimits(Limits{})
		discovery.reads = append(discovery.reads, inventory.Reads...)
		callee := discovery.evalAt(site.Path, site.Callee, nil, 0)
		if discovery.migrationIncomplete {
			product.Residual = append(product.Residual, discovery.finish(callee, ""))
			continue
		}
		name, definite, _ := constructorCandidates(callee, false)
		if name == "" {
			kind, _, _ := discovery.projected(callee)
			if (selected != nil && kind != "known") || discovery.exhausted != "" {
				if context.CompilerLibraryReceiver != nil {
					library := context.CompilerLibraryReceiver(site.Path, site.Node)
					discovery.reads = append(discovery.reads, library.Reads...)
					if !library.Known {
						product.Residual = append(product.Residual, demandOutcomeUnknown("Runtime compiler-library receiver authority is unavailable."))
						continue
					}
					if library.Library {
						if observer.dataArguments(site.Path, site.Node) {
							continue
						}
						// This certified non-namespace library receiver is an
						// external value; its property has no inspectable object
						// structure in the original generic discovery reader.
						if site.Callee.Kind == ast.KindPropertyAccessExpression {
							failure("The receiver has no inspectable object properties.")
							continue
						}
					}
				} else if supplied {
					product.Residual = append(product.Residual, demandOutcomeUnknown("Runtime compiler-library receiver authority is unavailable."))
					continue
				}
				proof := discovery.finish(callee, "")
				reason := PublicQueryReason(proof)
				if proof.Kind == "known" {
					reason = "Definition constructor identity is unavailable."
				}
				failure(reason)
			}
			continue
		}
		call := site.Node.AsCallExpression()
		idRun := observer.run()
		id := demandKnown("undefined", "")
		if len(call.Arguments.Nodes) > 0 {
			projector := idRun.evalAt(site.Path, call.Arguments.Nodes[0], nil, 2)
			object := idRun.invokeAt(projector, nil, 1)
			id = idRun.propertyAt(object, "id", 0)
		}
		ownership := discovery.finish(demandKnown("constructor", name), "")
		if !definite {
			ownership.Kind = "ambiguous"
		}
		idProof := idRun.finish(id, "string")
		if ownership.MigrationIncomplete || idProof.MigrationIncomplete {
			product.Residual = append(product.Residual, DemandOutcome{Kind: "unknown", Reason: "Captured semantic demand authority is unavailable for " + site.Path, MigrationIncomplete: true})
		}
		product.Observations = append(product.Observations, DefinitionObservation{Path: site.Path, Start: start, End: end, Constructor: name, Ownership: ownership, ID: idProof})
	}
	for _, subject := range remaining {
		if selected[subject] {
			product.DiscoveryFailures = append(product.DiscoveryFailures, DemandDiscoveryFailure{Path: subject.Path, Start: subject.Start, End: subject.End, Reason: "The authored call is absent from the call inventory."})
		}
	}

	return product
}
func demandOutcomeUnknown(reason string) DemandOutcome {
	return DemandOutcome{Kind: "unknown", Reason: reason}
}
