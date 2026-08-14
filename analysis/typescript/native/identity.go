package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
)

func deriveID(kind, namespace string, input any) string {
	digest := sha256.New()
	digest.Write([]byte("astrale.analysis.identity\x00"))
	digest.Write([]byte(kind))
	digest.Write([]byte{0})
	digest.Write([]byte(namespace))
	digest.Write([]byte{0})
	digest.Write([]byte(stableJSON(input)))
	return kind + ":" + hex.EncodeToString(digest.Sum(nil))
}

func stableJSON(value any) string {
	// Round-trip through JSON's data model so structs become maps. encoding/json
	// sorts valid UTF-8 map keys by Unicode scalar value, matching the portable
	// TypeScript canonicalizer recursively rather than preserving Go
	// declaration-field order or applying environment-dependent collation.
	raw, err := json.Marshal(value)
	if err != nil {
		panic(fmt.Errorf("canonical JSON input: %w", err))
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var canonical any
	if err := decoder.Decode(&canonical); err != nil {
		panic(fmt.Errorf("canonical JSON model: %w", err))
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(canonical); err != nil {
		panic(fmt.Errorf("canonical JSON: %w", err))
	}
	encoded := buffer.Bytes()
	if len(encoded) != 0 && encoded[len(encoded)-1] == '\n' {
		encoded = encoded[:len(encoded)-1]
	}
	return string(encoded)
}

func sortedUnique(values []string) []string {
	sort.Strings(values)
	if len(values) < 2 {
		return values
	}
	output := values[:1]
	for _, value := range values[1:] {
		if value != output[len(output)-1] {
			output = append(output, value)
		}
	}
	return output
}

func hashText(text string) string {
	digest := sha256.Sum256([]byte(text))
	return hex.EncodeToString(digest[:])
}

func shardDigest(shard factShard) string {
	facts := make([]map[string]any, 0, len(shard.Facts))
	for _, entry := range shard.Facts {
		facts = append(facts, map[string]any{
			"id": entry.ID, "namespace": entry.Namespace,
			"schemaVersion": entry.SchemaVersion, "kind": entry.Kind,
			"subject": entry.Subject, "completeness": entry.Completeness,
			"provenance": entry.Provenance, "payload": entry.Payload,
		})
	}
	return deriveID("fact-shard-digest", shard.Namespace, map[string]any{
		"key": shard.Key, "namespace": shard.Namespace,
		"schemaVersion": shard.SchemaVersion, "completion": shard.Completion,
		"facts": facts,
	})
}
