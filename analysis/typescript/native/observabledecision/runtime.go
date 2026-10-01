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
