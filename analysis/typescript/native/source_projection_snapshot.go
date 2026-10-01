package main

// sourceProjectionSnapshot owns the complete thin semantic rows of one compiler
// capture. It deliberately contains no extractor, checker, node or symbol. The
// live body-demand cache may still use those objects within that same capture to
// materialize a body, but they are not the authority for these sealed rows.
type sourceProjectionSnapshot struct {
	sources      map[string]sourceProjectionRows
	owners       []sourceProjectionRow
	witnesses    []sourceProjectionRow
	initializers []sourceProjectionRow
	mutations    []sourceProjectionRow
	escapes      []sourceProjectionRow
	aliases      []sourceProjectionRow
}

type sourceProjectionRows struct {
	record       sourceRecord
	owners       []demandOwner
	witnesses    []bodyOccurrence
	initializers []demandEffect
	mutations    []demandEffect
	escapes      []demandEffect
	aliases      []demandAlias
	thinReads    []callableRead
	hasThinReads bool
}

// Preserve the existing global array order separately from source ownership.
// Owner identity order and within-owner effect order are observable, including
// duplicate contributions; regrouping by source must not sort or deduplicate.
type sourceProjectionRow struct {
	source string
	index  int
}

func sealSourceProjection(sources map[string]sourceRecord, payload bodyDemandPayload, reads map[string][]callableRead) *sourceProjectionSnapshot {
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
	return snapshot
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
