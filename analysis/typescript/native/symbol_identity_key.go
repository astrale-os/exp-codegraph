package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// One extractor owns this scratch for collision lookups and inventories. The
// fixed key shape is declared in canonical order; encoding/json still owns all
// string spelling. Returned keys own their bytes before the next encoding.
type symbolIdentityKeyWorkspace struct {
	buffer         bytes.Buffer
	encoder        *json.Encoder
	input          symbolIdentityKeyInput
	lexicalScratch []string
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
	// Borrow valid lexical chains; copy only if an entry needs normalization.
	// In particular, keep nil and an empty non-nil chain distinct.
	normalizedLexical := lexical
	for index, value := range lexical {
		if utf8.ValidString(value) {
			continue
		}
		if len(w.lexicalScratch) == 0 {
			w.lexicalScratch = append(w.lexicalScratch[:0], lexical...)
			normalizedLexical = w.lexicalScratch
		}
		normalizedLexical[index] = normalizeSymbolKeyString(value)
	}
	w.input = symbolIdentityKeyInput{
		Lexical: normalizedLexical,
		Name:    normalizeSymbolKeyString(name),
		Syntax:  normalizeSymbolKeyString(syntax),
	}
	err := w.encoder.Encode(&w.input)
	// Do not retain the caller's lexical slice or names after this encoding.
	w.input = symbolIdentityKeyInput{}
	clear(w.lexicalScratch)
	w.lexicalScratch = w.lexicalScratch[:0]
	if err != nil {
		panic(fmt.Errorf("canonical JSON: %w", err))
	}
	encoded := w.buffer.Bytes()
	encoded = encoded[:len(encoded)-1] // Encode appends exactly one newline.
	return string(encoded)
}

func normalizeSymbolKeyString(value string) string {
	if utf8.ValidString(value) {
		return value
	}
	// JSON escapes invalid UTF-8 as \ufffd; canonical keys use literal U+FFFD.
	// Map preserves one replacement rune per invalid decoding step, unlike
	// ToValidUTF8 which collapses adjacent invalid bytes into one replacement.
	return strings.Map(func(value rune) rune { return value }, value)
}
