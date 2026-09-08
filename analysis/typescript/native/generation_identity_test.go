package main

import "testing"

func TestNativeIdentityRetainsOnlyImmutableEntryEncodings(t *testing.T) {
	sources := []sourceRecord{{Path: "a.ts", Revision: "source-revision:a"}, {Path: "é.ts", Revision: "source-revision:b"}}
	configuration := []map[string]any{{"path": "tsconfig.json", "digest": "config"}}
	manifest := []factShardReference{{Key: "fact-shard-key:a", Digest: "before", Namespace: bodyNamespaceForTest, SchemaVersion: 1, Facts: 2}, {Key: "fact-shard-key:b", Digest: "same", Namespace: bodyNamespaceForTest, SchemaVersion: 1, Facts: 1}}
	generation := analysisGeneration{Universe: "project-universe:test", Producer: producerIdentity{Name: "native", Version: "test", ProtocolVersion: 1}, Capabilities: []string{bodyNamespaceForTest}}
	sourceID, encoded, _ := nativeSourceManifestIdentity(generation.Universe, configuration, sources)
	if encoded != len(sources) {
		t.Fatal("cold source entries were not encoded once")
	}
	assertSourceIdentity := func(values []sourceRecord, actual string) {
		entries := make([]map[string]any, 0, len(values))
		for _, value := range values {
			entries = append(entries, map[string]any{"path": value.Path, "revision": value.Revision})
		}
		expected := deriveID("source-manifest", "typescript:"+generation.Universe, map[string]any{"configuration": configuration, "sources": entries})
		if actual != expected {
			t.Fatalf("source manifest preimage changed: %s != %s", actual, expected)
		}
	}
	assertSourceIdentity(sources, sourceID)
	generation.SourceManifest = sourceID
	assertGenerationIdentity := func(values []factShardReference, actual string) {
		expected := deriveID("generation", "astrale.analysis.generation.v1", map[string]any{"universe": generation.Universe, "producer": generation.Producer, "sourceManifest": generation.SourceManifest, "capabilities": generation.Capabilities, "manifest": values})
		if actual != expected {
			t.Fatalf("generation preimage changed: %s != %s", actual, expected)
		}
	}
	before, encoded, _ := nativeGenerationIdentity(generation, manifest)
	if encoded != len(manifest) {
		t.Fatal("cold shard references were not encoded once")
	}
	assertGenerationIdentity(manifest, before)
	if warm, encoded, _ := nativeGenerationIdentity(generation, manifest); warm != before || encoded != 0 {
		t.Fatal("warm immutable entries were encoded again")
	}
	updated := append([]factShardReference{}, manifest...)
	updated[0] = factShardReference{Key: manifest[0].Key, Digest: "after", Namespace: manifest[0].Namespace, SchemaVersion: 1, Facts: 2}
	after, encoded, _ := nativeGenerationIdentity(generation, updated)
	if after == before || encoded != 1 {
		t.Fatal("delta must encode exactly its replaced reference")
	}
	assertGenerationIdentity(updated, after)
	if retained, encoded, _ := nativeGenerationIdentity(generation, manifest); retained != before || encoded != 0 {
		t.Fatal("pending delta mutated the retained base identity")
	}
	updatedSources := append([]sourceRecord{}, sources...)
	updatedSources[1] = sourceRecord{Path: sources[1].Path, Revision: "source-revision:after"}
	if afterSource, encoded, _ := nativeSourceManifestIdentity(generation.Universe, configuration, updatedSources); afterSource == sourceID || encoded != 1 {
		t.Fatal("source delta must encode exactly its changed revision")
	} else {
		assertSourceIdentity(updatedSources, afterSource)
	}
	if retained, encoded, _ := nativeSourceManifestIdentity(generation.Universe, configuration, sources); retained != sourceID || encoded != 0 {
		t.Fatal("source delta mutated the retained base identity")
	}
}

const bodyNamespaceForTest = "typescript.body"
