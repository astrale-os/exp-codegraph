package main

import (
	"bytes"
	"encoding/json"
	"sort"
	"unicode/utf8"
)

// Canonicalization owns encoded bytes, not a second graph of maps, strings and
// json.Numbers. encoding/json retains authority over Go values and JSON number
// spelling; this pass changes object order while copying primitive byte spans.
type canonicalJSON struct {
	input  []byte
	output []byte
}

type canonicalField struct {
	key                  []byte
	nameStart, nameEnd   int
	valueStart, valueEnd int
}

func canonicalJSONBytes(input []byte) []byte {
	writer := canonicalJSON{input: input, output: make([]byte, 0, len(input))}
	writer.value(0)
	return writer.output
}

func (w *canonicalJSON) space(position int) int {
	for position < len(w.input) {
		switch w.input[position] {
		case ' ', '\n', '\r', '\t':
			position++
		default:
			return position
		}
	}
	return position
}

func (w *canonicalJSON) stringEnd(position int) int {
	for position++; position < len(w.input); position++ {
		switch w.input[position] {
		case '\\':
			position++
		case '"':
			return position + 1
		}
	}
	panic("canonical JSON: unterminated admitted string")
}

// Input has already passed encoding/json validation, so the scanner only
// needs token boundaries. It never interprets primitive values as interface{}.
func (w *canonicalJSON) end(position int) int {
	position = w.space(position)
	switch w.input[position] {
	case '"':
		return w.stringEnd(position)
	case '{', '[':
		depth := 1
		for position++; position < len(w.input); position++ {
			switch w.input[position] {
			case '"':
				position = w.stringEnd(position) - 1
			case '{', '[':
				depth++
			case '}', ']':
				depth--
				if depth == 0 {
					return position + 1
				}
			}
		}
	default:
		for position < len(w.input) {
			switch w.input[position] {
			case ',', '}', ']', ' ', '\n', '\r', '\t':
				return position
			default:
				position++
			}
		}
		return position
	}
	panic("canonical JSON: unterminated admitted container")
}

func (w *canonicalJSON) value(position int) int {
	position = w.space(position)
	switch w.input[position] {
	case '{':
		return w.object(position)
	case '[':
		w.output = append(w.output, '[')
		position = w.space(position + 1)
		for w.input[position] != ']' {
			position = w.space(w.value(position))
			if w.input[position] == ',' {
				w.output = append(w.output, ',')
				position = w.space(position + 1)
			}
		}
		w.output = append(w.output, ']')
		return position + 1
	case '"':
		end := w.stringEnd(position)
		w.output = appendCanonicalString(w.output, w.input[position:end])
		return end
	default:
		end := w.end(position)
		w.output = append(w.output, w.input[position:end]...)
		return end
	}
}

func (w *canonicalJSON) object(position int) int {
	var fields []canonicalField
	position = w.space(position + 1)
	for w.input[position] != '}' {
		field := canonicalField{nameStart: position, nameEnd: w.stringEnd(position)}
		field.key = w.input[field.nameStart+1 : field.nameEnd-1]
		if bytes.IndexByte(field.key, '\\') >= 0 || !utf8.Valid(field.key) {
			var key string
			if err := json.Unmarshal(w.input[field.nameStart:field.nameEnd], &key); err != nil {
				panic(err)
			}
			field.key = []byte(key)
		}
		position = w.space(field.nameEnd)
		field.valueStart = w.space(position + 1)
		field.valueEnd = w.end(field.valueStart)
		fields = append(fields, field)
		position = w.space(field.valueEnd)
		if w.input[position] == ',' {
			position = w.space(position + 1)
		}
	}
	sort.SliceStable(fields, func(i, j int) bool { return bytes.Compare(fields[i].key, fields[j].key) < 0 })
	w.output = append(w.output, '{')
	written := false
	for index, field := range fields {
		// A custom JSON marshaler may emit duplicate keys. Preserve the same
		// last-value semantics as the former JSON decoder map representation.
		if index+1 < len(fields) && bytes.Equal(field.key, fields[index+1].key) {
			continue
		}
		if written {
			w.output = append(w.output, ',')
		}
		written = true
		w.output = appendCanonicalString(w.output, w.input[field.nameStart:field.nameEnd])
		w.output = append(w.output, ':')
		w.value(field.valueStart)
	}
	w.output = append(w.output, '}')
	return position + 1
}

func appendCanonicalString(output, encoded []byte) []byte {
	// Ordinary Go strings have already received the canonical spelling from
	// encoding/json. Normalize uncommon custom-marshaler escape spellings only.
	for index := 1; index+1 < len(encoded); index++ {
		if encoded[index] == '\\' {
			index++
			if encoded[index] == '/' || encoded[index] == 'u' {
				return appendNormalizedString(output, encoded)
			}
		} else if encoded[index] >= utf8.RuneSelf {
			value, size := utf8.DecodeRune(encoded[index:])
			if size == 1 || value == '\u2028' || value == '\u2029' {
				return appendNormalizedString(output, encoded)
			}
			index += size - 1
		}
	}
	return append(output, encoded...)
}

func appendNormalizedString(output, encoded []byte) []byte {
	var value string
	if err := json.Unmarshal(encoded, &value); err != nil {
		panic(err)
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		panic(err)
	}
	return append(output, bytes.TrimSuffix(buffer.Bytes(), []byte{'\n'})...)
}
