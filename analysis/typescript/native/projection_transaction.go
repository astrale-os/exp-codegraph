package main

import (
	"sort"
	"time"
)

// Publication is independent of the compiler owner. Both native transports
// publish the same content identities and atomically acknowledged shard lineage.
type projectionPublication struct {
	base             generationState
	baseID, universe string
	configuration    []map[string]any
	capabilities     []string
	shards           []factShard
	sources          []sourceRecord
	replaced         map[string]bool
	full             bool
	telemetry        *nativeTelemetry
	requestID        int
	limits           *recordLimits
}

func assembleProjectionTransaction(publication projectionPublication) (*factTransaction, generationState, error) {
	base, baseID, nextUniverse := publication.base, publication.baseID, publication.universe
	configuration, shards, sources, replaced := publication.configuration, publication.shards, publication.sources, publication.replaced
	hasBase := baseID != "" && base.generation.ID == baseID
	phase := time.Now()
	sourceManifest, encodedSources, sourceBytes := nativeSourceManifestIdentity(nextUniverse, configuration, sources)
	publication.telemetry.record(publication.requestID, "transaction.source-manifest", phase, map[string]any{"sources": len(sources), "encodedSources": encodedSources, "hashedSourceBytes": sourceBytes})
	phase = time.Now()
	manifestByKey := make(map[string]factShardReference, len(base.manifest)+len(shards))
	if hasBase && !publication.full {
		for _, reference := range base.manifest {
			if !replaced[reference.Key] {
				manifestByKey[reference.Key] = reference
			}
		}
	}
	for _, shard := range shards {
		reference := factShardReference{
			Key: shard.Key, Digest: shard.Digest, Namespace: shard.Namespace,
			SchemaVersion: shard.SchemaVersion, Facts: len(shard.Facts),
		}
		if hasBase && base.digests[shard.Key] == shard.Digest {
			index := sort.Search(len(base.manifest), func(index int) bool { return base.manifest[index].Key >= shard.Key })
			if index < len(base.manifest) && base.manifest[index].Key == shard.Key {
				reference = base.manifest[index]
			}
		}
		manifestByKey[shard.Key] = reference
	}
	manifest := make([]factShardReference, 0, len(manifestByKey))
	digests := make(map[string]string, len(manifestByKey))
	for _, reference := range manifestByKey {
		manifest = append(manifest, reference)
		digests[reference.Key] = reference.Digest
	}
	sort.Slice(manifest, func(i, j int) bool { return manifest[i].Key < manifest[j].Key })
	publication.telemetry.record(publication.requestID, "transaction.manifest", phase, map[string]any{"baseShards": len(base.manifest), "candidateShards": len(manifest), "projectedShards": len(shards)})
	if hasBase && base.sourceManifest == sourceManifest && stableJSON(base.manifest) == stableJSON(manifest) {
		return nil, base, nil
	}

	phase = time.Now()
	producer := producerIdentity{
		ID: deriveID("producer", "astrale.analysis.typescript.native", map[string]any{
			"name": "ttsc-typescript-go", "version": producerVersion,
			"protocolVersion": protocolVersion,
		}),
		Name: "ttsc-typescript-go", Version: producerVersion, ProtocolVersion: protocolVersion,
	}
	sequence := 1
	if hasBase {
		sequence = base.generation.Sequence + 1
	}
	generation := analysisGeneration{
		Sequence: sequence, Universe: nextUniverse, Producer: producer,
		SourceManifest: sourceManifest, Capabilities: publication.capabilities,
	}
	generationID, encodedReferences, manifestBytes := nativeGenerationIdentity(generation, manifest)
	generation.ID = generationID
	publication.telemetry.record(publication.requestID, "transaction.generation-identity", phase, map[string]any{"manifestShards": len(manifest), "encodedReferences": encodedReferences, "hashedReferenceBytes": manifestBytes})
	phase = time.Now()
	upserts := make([]factShard, 0, len(shards))
	for _, shard := range shards {
		if hasBase && base.digests[shard.Key] == shard.Digest {
			continue
		}
		// Projection caches own sealed fact metadata. Re-emitting a retired
		// shard must not rename facts in an earlier published transaction.
		if shard.Facts != nil {
			shard.Facts = append([]fact{}, shard.Facts...)
		}
		for index := range shard.Facts {
			shard.Facts[index].Generation = generationID
		}
		upserts = append(upserts, shard)
	}
	deletes := []string{}
	if hasBase {
		for key := range base.digests {
			if _, exists := digests[key]; !exists {
				deletes = append(deletes, key)
			}
		}
	}
	sort.Slice(upserts, func(i, j int) bool { return upserts[i].Key < upserts[j].Key })
	sort.Strings(deletes)
	if publication.limits != nil {
		if err := validateSemanticShardBytes(upserts, publication.limits.MaximumDecodedShardBytes, publication.limits.MaximumTransactionBytes); err != nil {
			return nil, generationState{}, err
		}
	}
	transaction := &factTransaction{
		ProtocolVersion: protocolVersion, Base: baseID, Next: generation,
		Manifest: manifest, Upserts: upserts, Deletes: deletes,
	}
	return transaction, generationState{generation: generation, manifest: manifest, digests: digests, sourceManifest: sourceManifest}, nil
}
