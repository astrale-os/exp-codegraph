package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"sort"
)

const analysisIdentityPrefix = "astrale.analysis.identity\x00"

func deriveID(kind, namespace string, input any) string {
	digest := identityHash(kind, namespace)
	digest.Write(canonicalJSONEncoding(input))
	return kind + ":" + hex.EncodeToString(digest.Sum(nil))
}

func identityHash(kind, namespace string) hash.Hash {
	digest := sha256.New()
	digest.Write([]byte(analysisIdentityPrefix + kind + "\x00" + namespace + "\x00"))
	return digest
}

func writeCanonicalValue(destination hash.Hash, value any) {
	destination.Write(canonicalJSONEncoding(value))
}

func writeCanonicalPart(destination hash.Hash, value string) {
	destination.Write([]byte(value))
}

func stableJSON(value any) string {
	return string(canonicalJSONEncoding(value))
}

func canonicalJSONEncoding(value any) []byte {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		panic(fmt.Errorf("canonical JSON: %w", err))
	}
	return canonicalJSONBytes(buffer.Bytes())
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
