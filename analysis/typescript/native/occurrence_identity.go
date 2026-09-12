package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

// An extractor owns this scratch for its projection. Occurrence identities have
// one fixed preimage shape: declare its fields in canonical order so encoding
// needs neither an interface map nor a second scan to reorder its JSON fields.
// The standard encoder still owns all string and integer spelling.
type occurrenceIdentityWorkspace struct {
	buffer  bytes.Buffer
	encoder *json.Encoder
	input   occurrenceIdentityPreimage
}

type occurrenceIdentityPreimage struct {
	End      int    `json:"end"`
	Kind     string `json:"kind"`
	Revision string `json:"revision"`
	Source   string `json:"source"`
	Start    int    `json:"start"`
}

func (w *occurrenceIdentityWorkspace) identify(universe string, span sourceSpan, kind string) string {
	w.buffer.Reset()
	w.buffer.WriteString(analysisIdentityPrefix + "occurrence\x00typescript:")
	w.buffer.WriteString(universe)
	w.buffer.WriteByte(0)
	payloadStart := w.buffer.Len()
	if w.encoder == nil {
		w.encoder = json.NewEncoder(&w.buffer)
		w.encoder.SetEscapeHTML(false)
	}
	w.input = occurrenceIdentityPreimage{
		End: span.End, Kind: kind, Revision: span.Revision, Source: span.Source, Start: span.Start,
	}
	if err := w.encoder.Encode(&w.input); err != nil {
		panic(fmt.Errorf("canonical JSON: %w", err))
	}
	w.input = occurrenceIdentityPreimage{}
	// Encode appends exactly one newline. It is not part of the identity preimage.
	encoded := w.buffer.Bytes()
	encoded = encoded[:len(encoded)-1]
	// JSON escapes invalid UTF-8 as \ufffd; canonical identity uses the literal
	// replacement rune. Keep the generic normalizer's authority for this case.
	if !utf8.ValidString(kind) || !utf8.ValidString(span.Revision) || !utf8.ValidString(span.Source) {
		payload := canonicalJSONBytes(encoded[payloadStart:])
		encoded = append(encoded[:payloadStart], payload...)
	}
	digest := sha256.Sum256(encoded)
	var identity [len("occurrence:") + sha256.Size*2]byte
	copy(identity[:], "occurrence:")
	hex.Encode(identity[len("occurrence:"):], digest[:])
	return string(identity[:])
}
