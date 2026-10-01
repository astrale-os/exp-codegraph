package main

import (
	"sort"
	"time"
)

// Cached facts are sealed values owned by the current captured Program. Recipe
// movement changes publication membership, never the bytes of retained shards.
func (x *extractor) retainSemanticShard(shard factShard) {
	for _, entry := range shard.Facts {
		x.admitPreparedFact(preparedFact{fact: entry}, nil)
	}
}

func (cache *bodyDemandCache) project(plan projectionPlan, maximumSemanticPayloadBytes, maximumDecodedShardBytes int, telemetry *nativeTelemetry, requestID int) ([]factShard, []sourceRecord, map[string][]callableRead, error) {
	started := time.Now()
	x := *cache.extractor
	// These workspaces contain encoders bound to their own buffers. Copying
	// their pointers would encode into the previous extractor's scratch.
	x.occurrenceIdentities = occurrenceIdentityWorkspace{}
	x.symbolIdentityKeys = symbolIdentityKeyWorkspace{}
	x.plan = plan
	x.maximumSemanticPayloadBytes = maximumSemanticPayloadBytes
	x.maximumDecodedShardBytes = maximumDecodedShardBytes
	x.semanticPayloadBytes = 0
	x.payloadEncodingError = nil
	x.telemetry = telemetry
	x.requestID = requestID
	x.callableReads = cache.snapshot.callableReads()
	shards := append([]factShard{}, cache.nonBodyShards...)
	for _, shard := range shards {
		x.retainSemanticShard(shard)
	}
	bodies, err := x.demandBodyShards(cache.files, plan.demand, nil)
	if err != nil {
		return nil, nil, nil, err
	}
	if x.payloadEncodingError != nil {
		return nil, nil, nil, x.payloadEncodingError
	}
	shards = append(shards, bodies...)
	sort.Slice(shards, func(i, j int) bool { return shards[i].Key < shards[j].Key })
	cache.extractor = &x
	telemetry.record(requestID, "projection.demand-cache", started, map[string]any{"reusedInventory": true, "cachedBodyOwners": len(cache.fullBodies), "shards": len(shards), "semanticBytes": x.semanticPayloadBytes})
	return shards, cache.sources, x.callableReads, nil
}

func (x *extractor) retainBodyReads(path string, reads []callableRead) {
	// Contributions are replayed once per selected owner in original body order.
	// Global thin reads are cloned separately, including their original duplicates.
	x.callableReads[path] = append(x.callableReads[path], copyProjectionReads(reads)...)
}
