// Package jsstring owns JavaScript string identity: immutable UTF16 code units.
// Compiler literal text may contain WTF8 lone surrogates. Go's rune conversion,
// string equality after replacement, and encoding/json string encoder are not
// admissible substitutes. This package has no filesystem or semantic rule.
package jsstring

import (
	"encoding/binary"
	"errors"
	"strconv"
	"unicode/utf8"
)

// String stores two bytes per code unit in a private immutable comparable key.
// The zero value is the JavaScript empty string.
type String struct{ key string }

func FromUnits(units []uint16) String {
	bytes := make([]byte, 2*len(units))
	for i, unit := range units {
		binary.BigEndian.PutUint16(bytes[2*i:], unit)
	}
	return String{string(bytes)}
}
func DecodeWire(units []uint16, maximum int) (String, error) {
	if maximum < 0 || len(units) > maximum {
		return String{}, errors.New("JavaScript string exceeds code-unit budget")
	}
	return FromUnits(units), nil
}
func (value String) Units() []uint16 {
	out := make([]uint16, len(value.key)/2)
	for i := range out {
		out[i] = binary.BigEndian.Uint16([]byte(value.key[2*i : 2*i+2]))
	}
	return out
}
func (value String) Length() int                { return len(value.key) / 2 }
func (value String) Equal(other String) bool    { return value.key == other.key }
func (value String) Concat(other String) String { return String{value.key + other.key} }
func (value String) Key() string                { return value.key }
func (value String) Slice(start, end int) (String, error) {
	if start < 0 || end < start || end > value.Length() {
		return String{}, errors.New("JavaScript code-unit slice out of range")
	}
	return String{value.key[2*start : 2*end]}, nil
}

// FromCompilerText accepts UTF8 plus the exact WTF8 encoding of surrogate code
// points. Every other invalid sequence is rejected, never replaced silently.
func FromCompilerText(text string) (String, error) {
	units := make([]uint16, 0, len(text))
	for offset := 0; offset < len(text); {
		if offset+2 < len(text) && text[offset] == 0xed && text[offset+1] >= 0xa0 && text[offset+1] <= 0xbf && text[offset+2]&0xc0 == 0x80 {
			unit := uint16(text[offset]&0x0f)<<12 | uint16(text[offset+1]&0x3f)<<6 | uint16(text[offset+2]&0x3f)
			units = append(units, unit)
			offset += 3
			continue
		}
		scalar, size := utf8.DecodeRuneInString(text[offset:])
		if scalar == utf8.RuneError && size == 1 {
			return String{}, errors.New("Invalid compiler JavaScript string encoding")
		}
		if scalar <= 0xffff {
			units = append(units, uint16(scalar))
		} else {
			value := uint32(scalar) - 0x10000
			units = append(units, uint16(0xd800+(value>>10)), uint16(0xdc00+(value&0x3ff)))
		}
		offset += size
	}
	return FromUnits(units), nil
}

// WTF8 returns a lossless Go string for existing native text algorithms. Paired
// surrogates normalize to the scalar UTF8 form; unpaired units remain WTF8.
// Consumers must use MarshalJSON or Units at a JSON boundary, never plain Go
// string JSON encoding on this result.
func (value String) WTF8() string {
	units := value.Units()
	out := make([]byte, 0, len(units)*3)
	for i := 0; i < len(units); i++ {
		unit := units[i]
		if unit >= 0xd800 && unit <= 0xdbff && i+1 < len(units) && units[i+1] >= 0xdc00 && units[i+1] <= 0xdfff {
			scalar := rune(0x10000 + (uint32(unit)-0xd800)*0x400 + (uint32(units[i+1]) - 0xdc00))
			out = utf8.AppendRune(out, scalar)
			i++
			continue
		}
		if unit >= 0xd800 && unit <= 0xdfff {
			out = append(out, byte(0xe0|(unit>>12)), byte(0x80|((unit>>6)&0x3f)), byte(0x80|(unit&0x3f)))
			continue
		}
		out = utf8.AppendRune(out, rune(unit))
	}
	return string(out)
}

// Explicit code-unit escapes are JSON exact on all ECMAScript runtimes. This
// also preserves lone surrogates in authored IDs embedded in evidence strings.
func (value String) MarshalJSON() ([]byte, error) {
	const hex = "0123456789abcdef"
	out := make([]byte, 0, value.Length()*6+2)
	out = append(out, '"')
	for _, unit := range value.Units() {
		out = append(out, '\\', 'u', hex[unit>>12], hex[(unit>>8)&15], hex[(unit>>4)&15], hex[unit&15])
	}
	out = append(out, '"')
	return out, nil
}
func (value String) GoString() string { return "jsstring(" + strconv.Quote(value.WTF8()) + ")" }

// ValidUnicode distinguishes scalar Unicode strings from valid JavaScript
// strings containing lone surrogate units. Only the former may cross a plain
// Go encoding/json string boundary without losing identity.
func (value String) ValidUnicode() bool {
	units := value.Units()
	for i := 0; i < len(units); i++ {
		unit := units[i]
		if unit >= 0xd800 && unit <= 0xdbff {
			if i+1 == len(units) || units[i+1] < 0xdc00 || units[i+1] > 0xdfff {
				return false
			}
			i++
		} else if unit >= 0xdc00 && unit <= 0xdfff {
			return false
		}
	}
	return true
}

// JSONText admits existing native evidence text while preserving every WTF8
// surrogate. It is a JSON boundary owner, not a JavaScript identity key. Native
// comparisons and primitive operations should use String itself.
type JSONText string

func (text JSONText) MarshalJSON() ([]byte, error) {
	value, err := FromCompilerText(string(text))
	if err != nil {
		return nil, err
	}
	return value.MarshalJSON()
}
