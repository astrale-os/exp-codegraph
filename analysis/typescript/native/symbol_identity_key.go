package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

// One extractor owns this scratch for collision lookups and inventories. The
// fixed key shape is declared in canonical order; encoding/json still owns all
// string spelling. Returned keys own their bytes before the next encoding.
type symbolIdentityKeyWorkspace struct {
	buffer  bytes.Buffer
	encoder *json.Encoder
	input   symbolIdentityKeyInput
}

type symbolIdentityKeyInput struct {
	Lexical []string `json:"lexical"`
	Name    string   `json:"name"`
	Syntax  string   `json:"syntax"`
}

func (w *symbolIdentityKeyWorkspace) key(name, syntax string, lexical []string) string {
	w.buffer.Reset()
	if w.encoder == nil {
		w.encoder = json.NewEncoder(&w.buffer)
		w.encoder.SetEscapeHTML(false)
	}
	w.input = symbolIdentityKeyInput{Lexical: lexical, Name: name, Syntax: syntax}
	if err := w.encoder.Encode(&w.input); err != nil {
		panic(fmt.Errorf("canonical JSON: %w", err))
	}
	// Do not retain the caller's lexical slice or names after this encoding.
	w.input = symbolIdentityKeyInput{}
	encoded := w.buffer.Bytes()
	encoded = encoded[:len(encoded)-1] // Encode appends exactly one newline.
	valid := utf8.ValidString(name) && utf8.ValidString(syntax)
	if valid {
		for _, value := range lexical {
			if !utf8.ValidString(value) {
				valid = false
				break
			}
		}
	}
	// JSON escapes invalid UTF-8 as \ufffd; canonical keys use the literal
	// replacement rune. Preserve the former normalizer's authority here.
	if !valid {
		encoded = canonicalJSONBytes(encoded)
	}
	return string(encoded)
}
