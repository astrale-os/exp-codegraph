package main

import (
	"encoding/hex"
)

// The protocol-v1 preimage is unchanged. Retained entries are immutable owned
// encodings, so an edit encodes only its new source/reference entries. Hashing
// the ordered bytes remains linear until the identity contract is versioned.
func nativeSourceManifestIdentity(universe string, configuration []map[string]any, sources []sourceRecord) (string, int, int) {
	digest := identityHash("source-manifest", "typescript:"+universe)
	writeCanonicalPart(digest, `{"configuration":`)
	writeCanonicalValue(digest, configuration)
	writeCanonicalPart(digest, `,"sources":[`)
	encoded, hashedBytes := 0, 0
	for index := range sources {
		if index != 0 {
			writeCanonicalPart(digest, ",")
		}
		source := &sources[index]
		if source.canonical == nil {
			source.canonical = canonicalJSONEncoding(map[string]any{"path": source.Path, "revision": source.Revision})
			encoded++
		}
		hashedBytes += len(source.canonical)
		digest.Write(source.canonical)
	}
	writeCanonicalPart(digest, `]}`)
	return "source-manifest:" + hex.EncodeToString(digest.Sum(nil)), encoded, hashedBytes
}

func nativeGenerationIdentity(generation analysisGeneration, manifest []factShardReference) (string, int, int) {
	digest := identityHash("generation", "astrale.analysis.generation.v1")
	writeCanonicalPart(digest, `{"capabilities":`)
	writeCanonicalValue(digest, generation.Capabilities)
	writeCanonicalPart(digest, `,"manifest":[`)
	encoded, hashedBytes := 0, 0
	for index := range manifest {
		if index != 0 {
			writeCanonicalPart(digest, ",")
		}
		reference := &manifest[index]
		if reference.canonical == nil {
			reference.canonical = canonicalJSONEncoding(*reference)
			encoded++
		}
		hashedBytes += len(reference.canonical)
		digest.Write(reference.canonical)
	}
	writeCanonicalPart(digest, `],"producer":`)
	writeCanonicalValue(digest, generation.Producer)
	writeCanonicalPart(digest, `,"sourceManifest":`)
	writeCanonicalValue(digest, generation.SourceManifest)
	writeCanonicalPart(digest, `,"universe":`)
	writeCanonicalValue(digest, generation.Universe)
	writeCanonicalPart(digest, `}`)
	return "generation:" + hex.EncodeToString(digest.Sum(nil)), encoded, hashedBytes
}
