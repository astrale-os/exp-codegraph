package main

import (
	"sort"
	"unicode/utf16"
	"unicode/utf8"
)

// The compiler owns UTF-8 byte ranges. Public TypeScript facts use JavaScript
// UTF-16 offsets. Record only the points where those coordinate systems diverge;
// ASCII sources need no table, and a lookup never rescans the source prefix.
type sourceCoordinateChange struct {
	end, removed int
}

type sourceCoordinates []sourceCoordinateChange

func indexSourceCoordinates(text string) sourceCoordinates {
	var changes sourceCoordinates
	removed := 0
	for offset := 0; offset < len(text); {
		if text[offset] < utf8.RuneSelf {
			offset++
			continue
		}
		value, size := utf8.DecodeRuneInString(text[offset:])
		offset += size
		removed += size - utf16.RuneLen(value)
		if size > 1 {
			changes = append(changes, sourceCoordinateChange{end: offset, removed: removed})
		}
	}
	return changes
}

// AST positions are rune boundaries. Retain the existing positive-width
// convention for empty/synthetic spans after conversion, not in byte space.
func (coordinates sourceCoordinates) utf16(offset int) int {
	index := sort.Search(len(coordinates), func(index int) bool { return coordinates[index].end > offset })
	if index == 0 {
		return offset
	}
	return offset - coordinates[index-1].removed
}
