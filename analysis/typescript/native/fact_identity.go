package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"hash"
	"sort"
)

// A prepared fact's canonical logical payload remains valid until its shard is
// finalized. Published facts and retained generations never carry these bytes.
// Preparation seals the payload; metadata such as a module's logical fact ID
// may still be finalized before finishShard consumes the prepared value.
type preparedFact struct {
	fact
	canonicalPayload []byte
}

func prepareFact(entry fact) (preparedFact, error) {
	encoded, err := json.Marshal(entry.Payload)
	if err != nil {
		return preparedFact{}, err
	}
	// Admission measures the original semantic JSON spelling. In particular,
	// HTML escapes can make it longer than the canonical identity spelling.
	entry.semanticBytes = len(encoded)
	payload := canonicalJSONBytes(encoded)
	entry.ID = nativeFactIdentity(entry, payload)
	return preparedFact{fact: entry, canonicalPayload: payload}, nil
}

// Body shards finalize one fact immediately. One projection-owned workspace
// can therefore reuse its encoded payload after finishShard returns. Other
// namespaces accumulate prepared facts and keep using independently owned bytes.
// Metadata hashing deliberately keeps its own encoders: the canonical payload
// below must survive both the fact and shard preimages without being overwritten.
type bodyIdentityWorkspace struct {
	semantic  bytes.Buffer
	encoder   *json.Encoder
	canonical canonicalJSON
}

func (w *bodyIdentityWorkspace) prepare(entry fact) (preparedFact, error) {
	w.semantic.Reset()
	if w.encoder == nil {
		w.encoder = json.NewEncoder(&w.semantic)
	}
	if err := w.encoder.Encode(entry.Payload); err != nil {
		return preparedFact{}, err
	}
	// Encoder preserves Marshal's HTML escaping and adds exactly one newline.
	// Admission counts the same spelling as prepareFact, without that separator.
	encoded := w.semantic.Bytes()
	encoded = encoded[:len(encoded)-1]
	entry.semanticBytes = len(encoded)
	payload := w.canonical.encode(encoded)
	entry.ID = nativeFactIdentity(entry, payload)
	return preparedFact{fact: entry, canonicalPayload: payload}, nil
}

func nativeFactIdentity(entry fact, payload []byte) string {
	digest := identityHash("fact", entry.Namespace)
	writeCanonicalPart(digest, `{"evidence":`)
	writeCanonicalValue(digest, entry.Provenance.Evidence)
	writeCanonicalPart(digest, `,"kind":`)
	writeCanonicalValue(digest, entry.Kind)
	writeCanonicalPart(digest, `,"payload":`)
	digest.Write(payload)
	writeCanonicalPart(digest, `,"subject":`)
	writeCanonicalValue(digest, entry.Subject)
	writeCanonicalPart(digest, `}`)
	return "fact:" + hex.EncodeToString(digest.Sum(nil))
}

func finishShard(namespace, owner string, completion completeness, facts []preparedFact) factShard {
	return finishShardVersion(namespace, owner, completion, facts, 1)
}

func finishShardVersion(namespace, owner string, completion completeness, facts []preparedFact, schemaVersion int) factShard {
	sort.Slice(facts, func(i, j int) bool { return facts[i].ID < facts[j].ID })
	var published []fact
	if facts != nil {
		published = make([]fact, len(facts))
	}
	for index := range facts {
		published[index] = facts[index].fact
	}
	shard := factShard{
		Key:       deriveID("fact-shard-key", namespace, map[string]any{"owner": owner}),
		Namespace: namespace, SchemaVersion: schemaVersion, Completion: completion, Facts: published,
	}
	shard.Digest = nativeShardIdentity(shard, facts)
	return shard
}

func nativeShardIdentity(shard factShard, facts []preparedFact) string {
	digest := identityHash("fact-shard-digest", shard.Namespace)
	writeCanonicalPart(digest, `{"completion":`)
	writeCanonicalValue(digest, shard.Completion)
	writeCanonicalPart(digest, `,"facts":[`)
	for index := range facts {
		if index != 0 {
			writeCanonicalPart(digest, ",")
		}
		writePreparedFact(digest, facts[index])
	}
	writeCanonicalPart(digest, `],"key":`)
	writeCanonicalValue(digest, shard.Key)
	writeCanonicalPart(digest, `,"namespace":`)
	writeCanonicalValue(digest, shard.Namespace)
	writeCanonicalPart(digest, `,"schemaVersion":`)
	writeCanonicalValue(digest, shard.SchemaVersion)
	writeCanonicalPart(digest, `}`)
	return "fact-shard-digest:" + hex.EncodeToString(digest.Sum(nil))
}

func writePreparedFact(digest hash.Hash, entry preparedFact) {
	writeCanonicalPart(digest, `{"completeness":`)
	writeCanonicalValue(digest, entry.Completeness)
	writeCanonicalPart(digest, `,"id":`)
	writeCanonicalValue(digest, entry.ID)
	writeCanonicalPart(digest, `,"kind":`)
	writeCanonicalValue(digest, entry.Kind)
	writeCanonicalPart(digest, `,"namespace":`)
	writeCanonicalValue(digest, entry.Namespace)
	writeCanonicalPart(digest, `,"payload":`)
	digest.Write(entry.canonicalPayload)
	writeCanonicalPart(digest, `,"provenance":`)
	writeCanonicalValue(digest, entry.Provenance)
	writeCanonicalPart(digest, `,"schemaVersion":`)
	writeCanonicalValue(digest, entry.SchemaVersion)
	writeCanonicalPart(digest, `,"subject":`)
	writeCanonicalValue(digest, entry.Subject)
	writeCanonicalPart(digest, `}`)
}
