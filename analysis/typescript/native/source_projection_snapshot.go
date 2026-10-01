package main

import "sort"

// sourceProjectionSnapshot owns the complete thin semantic rows of one compiler
// capture. It deliberately contains no extractor, checker, node or symbol. The
// live body-demand cache may still use those objects within that same capture to
// materialize a body, but they are not the authority for these sealed rows.
type sourceProjectionSnapshot struct {
	sources              map[string]sourceProjectionRows
	owners               []sourceProjectionRow
	witnesses            []sourceProjectionRow
	initializers         []sourceProjectionRow
	mutations            []sourceProjectionRow
	escapes              []sourceProjectionRow
	aliases              []sourceProjectionRow
	dependenciesCaptured bool
}

type sourceProjectionRows struct {
	record               sourceRecord
	owners               []demandOwner
	witnesses            []bodyOccurrence
	initializers         []demandEffect
	mutations            []demandEffect
	escapes              []demandEffect
	aliases              []demandAlias
	thinReads            []callableRead
	hasThinReads         bool
	rawCalls             []demandEffectCall
	dependencies         []string
	dependenciesComplete bool
}

// Keep every root argument call, including calls suppressed as local. Current
// complete owner membership can then reclassify escapes without an old AST.
type demandEffectCall struct {
	Symbol     string
	Target     string
	Occurrence string
	Owner      string
}

// Preserve the existing global array order separately from source ownership.
// Owner identity order and within-owner effect order are observable, including
// duplicate contributions; regrouping by source must not sort or deduplicate.
type sourceProjectionRow struct {
	source string
	index  int
}

func sealSourceProjection(sources map[string]sourceRecord, payload bodyDemandPayload, reads map[string][]callableRead, observations ...*extractor) *sourceProjectionSnapshot {
	snapshot := &sourceProjectionSnapshot{sources: map[string]sourceProjectionRows{}}
	for physical, record := range sources {
		record.canonical = append([]byte(nil), record.canonical...)
		thinReads, hasReads := reads[physical]
		snapshot.sources[record.Source] = sourceProjectionRows{record: record, thinReads: copyProjectionReads(thinReads), hasThinReads: hasReads}
	}
	ownerSources := map[string]string{}
	for _, owner := range payload.Owners {
		ownerSources[owner.Owner] = owner.Span.Source
		rows := snapshot.sources[owner.Span.Source]
		owner.Materialized, owner.Fact = false, ""
		owner.Header = copyFunctionHeader(owner.Header)
		snapshot.owners = append(snapshot.owners, sourceProjectionRow{owner.Span.Source, len(rows.owners)})
		rows.owners = append(rows.owners, owner)
		snapshot.sources[owner.Span.Source] = rows
	}
	for _, witness := range payload.Witnesses {
		rows := snapshot.sources[witness.Span.Source]
		snapshot.witnesses = append(snapshot.witnesses, sourceProjectionRow{witness.Span.Source, len(rows.witnesses)})
		rows.witnesses = append(rows.witnesses, copyProjectionWitness(witness))
		snapshot.sources[witness.Span.Source] = rows
	}
	for _, row := range payload.Initializers {
		source := ownerSources[row.Owner]
		rows := snapshot.sources[source]
		snapshot.initializers = append(snapshot.initializers, sourceProjectionRow{source, len(rows.initializers)})
		rows.initializers = append(rows.initializers, row)
		snapshot.sources[source] = rows
	}
	for _, row := range payload.Mutations {
		source := ownerSources[row.Owner]
		rows := snapshot.sources[source]
		snapshot.mutations = append(snapshot.mutations, sourceProjectionRow{source, len(rows.mutations)})
		rows.mutations = append(rows.mutations, row)
		snapshot.sources[source] = rows
	}
	for _, row := range payload.Escapes {
		source := ownerSources[row.Owner]
		rows := snapshot.sources[source]
		snapshot.escapes = append(snapshot.escapes, sourceProjectionRow{source, len(rows.escapes)})
		rows.escapes = append(rows.escapes, row)
		snapshot.sources[source] = rows
	}
	for _, row := range payload.Aliases {
		source := ownerSources[row.Owner]
		rows := snapshot.sources[source]
		snapshot.aliases = append(snapshot.aliases, sourceProjectionRow{source, len(rows.aliases)})
		rows.aliases = append(rows.aliases, row)
		snapshot.sources[source] = rows
	}
	if len(observations) != 0 {
		x := observations[0]
		snapshot.dependenciesCaptured = true
		for source, rows := range snapshot.sources {
			rows.dependencies = x.sourceProjectionDependencies(rows.record.Physical)
			_, captured := x.projectionDependencies[rows.record.Physical]
			rows.dependenciesComplete = captured && !x.incompleteProjection[rows.record.Physical]
			snapshot.sources[source] = rows
		}
		for _, call := range x.rawDemandCalls {
			source := ownerSources[call.Owner]
			rows := snapshot.sources[source]
			rows.rawCalls = append(rows.rawCalls, call)
			snapshot.sources[source] = rows
		}
	}
	return snapshot
}

func (snapshot *sourceProjectionSnapshot) mergeRetained(reuse *demandSourceReuse) *sourceProjectionSnapshot {
	merged := &sourceProjectionSnapshot{sources: map[string]sourceProjectionRows{}, dependenciesCaptured: true}
	for source, rows := range snapshot.sources {
		if retained, exists := reuse.sources[rows.record.Physical]; exists && !reuse.selected[rows.record.Physical] {
			rows = retained.rows
		}
		merged.sources[source] = rows
	}
	membership := map[string]bool{}
	for _, rows := range merged.sources {
		for _, owner := range rows.owners {
			membership[owner.Owner] = true
		}
	}
	for source, rows := range merged.sources {
		// Copy-on-write even when membership did not change. Never rewrite the
		// older acknowledged authority's slices during candidate preparation.
		rows.escapes = []demandEffect{}
		for _, call := range rows.rawCalls {
			if call.Target == "" || !membership[call.Target] {
				rows.escapes = append(rows.escapes, demandEffect{call.Symbol, call.Occurrence, call.Owner})
			}
		}
		merged.sources[source] = rows
		refs := func(count int) []sourceProjectionRow {
			result := make([]sourceProjectionRow, count)
			for index := range result {
				result[index] = sourceProjectionRow{source, index}
			}
			return result
		}
		merged.owners = append(merged.owners, refs(len(rows.owners))...)
		merged.witnesses = append(merged.witnesses, refs(len(rows.witnesses))...)
		merged.initializers = append(merged.initializers, refs(len(rows.initializers))...)
		merged.mutations = append(merged.mutations, refs(len(rows.mutations))...)
		merged.escapes = append(merged.escapes, refs(len(rows.escapes))...)
		merged.aliases = append(merged.aliases, refs(len(rows.aliases))...)
	}
	// Each eligible owner is unique. Sorting by owner preserves the original
	// within-owner rows; witness IDs follow the baseline global deduped order.
	sort.Slice(merged.owners, func(i, j int) bool {
		a, b := merged.owners[i], merged.owners[j]
		return merged.sources[a.source].owners[a.index].Owner < merged.sources[b.source].owners[b.index].Owner
	})
	sort.Slice(merged.witnesses, func(i, j int) bool {
		a, b := merged.witnesses[i], merged.witnesses[j]
		return merged.sources[a.source].witnesses[a.index].ID < merged.sources[b.source].witnesses[b.index].ID
	})
	for _, kind := range []string{"initializers", "mutations", "escapes", "aliases"} {
		var rows []sourceProjectionRow
		switch kind {
		case "initializers":
			rows = merged.initializers
		case "mutations":
			rows = merged.mutations
		case "escapes":
			rows = merged.escapes
		case "aliases":
			rows = merged.aliases
		}
		owner := func(ref sourceProjectionRow) string {
			row := merged.sources[ref.source]
			switch kind {
			case "initializers":
				return row.initializers[ref.index].Owner
			case "mutations":
				return row.mutations[ref.index].Owner
			case "escapes":
				return row.escapes[ref.index].Owner
			default:
				return row.aliases[ref.index].Owner
			}
		}
		sort.SliceStable(rows, func(i, j int) bool { return owner(rows[i]) < owner(rows[j]) })
	}
	return merged
}

// Each certificate owns its arrays and mutable origin metadata. Materialization,
// coverage and body fact IDs are fresh overlays, never stored in the catalogue.
func (snapshot *sourceProjectionSnapshot) payload(recipe *bodyDemandRecipe, selected map[string]bool) bodyDemandPayload {
	payload := bodyDemandPayload{
		Observed: recipe.Owners != nil, Paths: append([]string{}, recipe.Paths...),
		Owners: make([]demandOwner, 0, len(snapshot.owners)), Witnesses: make([]bodyOccurrence, 0, len(snapshot.witnesses)),
		Initializers: make([]demandEffect, 0, len(snapshot.initializers)), Mutations: make([]demandEffect, 0, len(snapshot.mutations)),
		Escapes: make([]demandEffect, 0, len(snapshot.escapes)), Aliases: make([]demandAlias, 0, len(snapshot.aliases)),
		Coverage: []demandCoverage{}, Completeness: complete(),
	}
	for _, ref := range snapshot.owners {
		owner := snapshot.sources[ref.source].owners[ref.index]
		owner.Materialized = selected[owner.Owner]
		owner.Header = copyFunctionHeader(owner.Header)
		payload.Owners = append(payload.Owners, owner)
	}
	for _, ref := range snapshot.witnesses {
		payload.Witnesses = append(payload.Witnesses, copyProjectionWitness(snapshot.sources[ref.source].witnesses[ref.index]))
	}
	for _, ref := range snapshot.initializers {
		payload.Initializers = append(payload.Initializers, snapshot.sources[ref.source].initializers[ref.index])
	}
	for _, ref := range snapshot.mutations {
		payload.Mutations = append(payload.Mutations, snapshot.sources[ref.source].mutations[ref.index])
	}
	for _, ref := range snapshot.escapes {
		payload.Escapes = append(payload.Escapes, snapshot.sources[ref.source].escapes[ref.index])
	}
	for _, ref := range snapshot.aliases {
		payload.Aliases = append(payload.Aliases, snapshot.sources[ref.source].aliases[ref.index])
	}
	return payload
}

func (snapshot *sourceProjectionSnapshot) callableReads() map[string][]callableRead {
	reads := map[string][]callableRead{}
	for _, rows := range snapshot.sources {
		if rows.hasThinReads {
			reads[rows.record.Physical] = copyProjectionReads(rows.thinReads)
		}
	}
	return reads
}

func copyProjectionOrigin(origin *callTargetOrigin) *callTargetOrigin {
	if origin == nil {
		return nil
	}
	copy := *origin
	if origin.Path != nil {
		copy.Path = append([]string{}, origin.Path...)
	}
	return &copy
}

func copyProjectionWitness(witness bodyOccurrence) bodyOccurrence {
	witness.SymbolOrigin = copyProjectionOrigin(witness.SymbolOrigin)
	return witness
}

func copyProjectionReads(reads []callableRead) []callableRead {
	if reads == nil {
		return nil
	}
	owned := make([]callableRead, len(reads))
	for index, read := range reads {
		if read.dependencies != nil {
			read.dependencies = append([]string{}, read.dependencies...)
		}
		read.observation.origin = copyProjectionOrigin(read.observation.origin)
		owned[index] = read
	}
	return owned
}
