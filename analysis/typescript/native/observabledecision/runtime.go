package observabledecision

// RuntimeProducts share immutable captured AST indexing and source fingerprints.
// Independent demands still retain their original budgets and fresh proof state.
type RuntimeProducts struct {
	Queries     QueryProduct
	Definitions DefinitionProduct
}

func ObserveRuntime(context DemandContext) RuntimeProducts {
	observer := newDemandObserver(context)
	return RuntimeProducts{Queries: observeQueries(context, observer, false), Definitions: observeDefinitionIDs(context, observer)}
}

// RuntimeDecisionGraph owns one immutable captured generation. Missing intrinsic
// answers may be admitted monotonically through context callbacks. A ready cell
// includes authoritative unknown/negative outcomes, but never migration residuals.
// Independent evaluations retain fresh demandRun budget and proof accounting.
// Changing captured bytes, policy, budgets or callback meaning requires a new graph.
type RuntimeDecisionGraph struct {
	context                                 DemandContext
	observer                                *demandObserver
	products                                RuntimeProducts
	queriesReady, definitionsReady          bool
	QueryEvaluations, DefinitionEvaluations int
}

func NewRuntimeDecisionGraph(context DemandContext) *RuntimeDecisionGraph {
	return &RuntimeDecisionGraph{context: context, observer: newDemandObserver(context)}
}
func (graph *RuntimeDecisionGraph) Resume() RuntimeProducts {
	if !graph.queriesReady {
		graph.QueryEvaluations++
		graph.products.Queries = observeQueries(graph.context, graph.observer, false)
		graph.queriesReady = graph.products.Queries.InventoryKnown && len(graph.products.Queries.Residual) == 0
	}
	if !graph.definitionsReady {
		graph.DefinitionEvaluations++
		graph.products.Definitions = observeDefinitionIDs(graph.context, graph.observer)
		graph.definitionsReady = graph.products.Definitions.InventoryKnown && len(graph.products.Definitions.Residual) == 0
	}
	return graph.products
}
