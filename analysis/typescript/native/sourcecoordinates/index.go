// Package sourcecoordinates indexes the exact original Go UTF8-prefix to
// UTF16-length operation. The source string is immutable and private to its owner.
package sourcecoordinates

import (
	"sort"
	"unicode/utf8"
)

type adjustment struct{ end, delta int }
type Index struct {
	text        string
	adjustments []adjustment
}

// ASCII byte and UTF16 offsets coincide. Only completed multibyte runes need a
// correction: a cut inside a valid rune leaves one replacement rune per byte,
// exactly as []rune(text[:offset]) does. Invalid UTF8 bytes also contribute one.
func New(text string) *Index {
	out := &Index{text: text}
	delta := 0
	for offset := 0; offset < len(text); {
		r, size := utf8.DecodeRuneInString(text[offset:])
		units := 1
		if r > 0xffff {
			units = 2
		}
		delta += size - units
		offset += size
		if size > 1 {
			out.adjustments = append(out.adjustments, adjustment{offset, delta})
		}
	}
	return out
}
func (index *Index) Text() string { return index.text }
func (index *Index) Offset(offset int) int {
	if offset < 0 {
		offset = 0
	}
	if offset > len(index.text) {
		offset = len(index.text)
	}
	at := sort.Search(len(index.adjustments), func(i int) bool { return index.adjustments[i].end > offset })
	if at == 0 {
		return offset
	}
	return offset - index.adjustments[at-1].delta
}

// Count is the allocation-free original operation for an isolated lookup. Repeated
// source-owned lookups use Index and avoid rescanning the same prefix.
func Count(text string, offset int) int {
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	units := 0
	for _, r := range text[:offset] {
		units++
		if r > 0xffff {
			units++
		}
	}
	return units
}
