package jsstring

import (
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

// FromLiteral recovers the exact JavaScript code units from the captured literal
// and its source spelling. Escaped non-ASCII characters are normalized before
// scanning because the pinned scanner otherwise consumes only their first byte;
// escaped LS/PS are ECMAScript line continuations, not string characters.
// The pinned compiler scanner replaces lone surrogate
// escapes with U+FFFD. For those escapes only, we shield each unit with an absent
// scalar, let that same scanner own every other escape/template rule, and restore
// units in its cooked result. No independent ECMAScript escape interpreter runs.
// Neither the source nor the AST is mutated. Ordinary literals use AST.Text.
func FromLiteral(source *ast.SourceFile, node *ast.Node) (String, error) {
	if source == nil || node == nil || (node.Kind != ast.KindStringLiteral && node.Kind != ast.KindNoSubstitutionTemplateLiteral) {
		return String{}, errors.New("JavaScript string requires an owned literal and source")
	}
	if node.Parent != nil && node.Parent.Kind == ast.KindJsxAttribute {
		return FromCompilerText(node.Text()) // JSX attributes have no JS escape cooking.
	}
	start := scanner.GetTokenPosOfNode(node, source, false)
	if start < 0 || node.End() < start || node.End() > len(source.Text()) {
		return String{}, errors.New("JavaScript literal lies outside its captured source")
	}
	raw := source.Text()[start:node.End()]
	type escape struct {
		start, end  int
		unit        uint16
		replacement string
		surrogate   bool
	}
	var escapes []escape
	for pos := 0; pos < len(raw); {
		if raw[pos] != '\\' {
			_, size := utf8.DecodeRuneInString(raw[pos:])
			pos += size
			continue
		}
		begin := pos
		pos++
		if pos == len(raw) {
			break
		}
		if raw[pos] >= utf8.RuneSelf {
			scalar, size := utf8.DecodeRuneInString(raw[pos:])
			if scalar == utf8.RuneError && size == 1 {
				return String{}, errors.New("Invalid JavaScript literal source encoding")
			}
			pos += size
			replacement := ""
			if scalar != 0x2028 && scalar != 0x2029 {
				replacement = "\\u{" + strconv.FormatInt(int64(scalar), 16) + "}"
			}
			escapes = append(escapes, escape{start: begin, end: pos, replacement: replacement})
			continue
		}
		if raw[pos] != 'u' {
			pos++
			continue
		}
		pos++
		digits := pos
		end := pos + 4
		extended := pos < len(raw) && raw[pos] == '{'
		if extended {
			digits++
			end = digits
			for end < len(raw) && hex(raw[end]) >= 0 {
				end++
			}
		}
		valid := end <= len(raw) && end > digits
		var value uint32
		if valid {
			for i := digits; i < end; i++ {
				digit := hex(raw[i])
				if digit < 0 || value > 0x10ffff {
					valid = false
					break
				}
				value = value*16 + uint32(digit)
			}
		}
		if extended {
			valid = valid && end < len(raw) && raw[end] == '}' && value <= 0x10ffff
			if valid {
				end++
			}
		}
		if !valid {
			continue
		}
		pos = end
		if value >= 0xd800 && value <= 0xdfff {
			escapes = append(escapes, escape{start: begin, end: end, unit: uint16(value), surrogate: true})
		}
	}
	if len(escapes) == 0 {
		return FromCompilerText(node.Text())
	}
	// A replacement must be absent both from raw spelling and actual cooked text.
	// At most 2,048 different surrogate units need distinct scalars.
	occupied := map[rune]bool{}
	for _, text := range []string{raw, node.Text()} {
		for _, scalar := range text {
			if scalar >= 0xf0000 {
				occupied[scalar] = true
			}
		}
	}
	markers := map[uint16]rune{}
	restored := map[rune]uint16{}
	next := rune(0xf0000)
	for _, item := range escapes {
		if !item.surrogate {
			continue
		}
		if _, ok := markers[item.unit]; ok {
			continue
		}
		for next <= utf8.MaxRune && occupied[next] {
			next++
		}
		if next > utf8.MaxRune {
			return String{}, errors.New("JavaScript literal exhausts shielding scalar domain")
		}
		markers[item.unit] = next
		restored[next] = item.unit
		next++
	}
	var shield strings.Builder
	previous := 0
	for _, item := range escapes {
		shield.WriteString(raw[previous:item.start])
		if item.surrogate {
			shield.WriteString("\\u{")
			shield.WriteString(strconv.FormatInt(int64(markers[item.unit]), 16))
			shield.WriteByte('}')
		} else {
			shield.WriteString(item.replacement)
		}
		previous = item.end
	}
	shield.WriteString(raw[previous:])
	ownedScanner := scanner.NewScanner()
	ownedScanner.SetText(shield.String())
	kind := ownedScanner.Scan()
	if node.Kind == ast.KindNoSubstitutionTemplateLiteral {
		tagged := node.Parent != nil && node.Parent.Kind == ast.KindTaggedTemplateExpression
		kind = ownedScanner.ReScanTemplateToken(tagged)
	}
	if kind != node.Kind {
		return String{}, errors.New("JavaScript literal shielding changed token kind")
	}
	cooked, err := FromCompilerText(ownedScanner.TokenValue())
	if err != nil {
		return String{}, err
	}
	var units []uint16
	cookedUnits := cooked.Units()
	for i := 0; i < len(cookedUnits); i++ {
		unit := cookedUnits[i]
		if unit >= 0xd800 && unit <= 0xdbff && i+1 < len(cookedUnits) && cookedUnits[i+1] >= 0xdc00 && cookedUnits[i+1] <= 0xdfff {
			scalar := rune(0x10000 + (uint32(unit)-0xd800)*0x400 + (uint32(cookedUnits[i+1]) - 0xdc00))
			if restoredUnit, ok := restored[scalar]; ok {
				units = append(units, restoredUnit)
				i++
				continue
			}
		}
		units = append(units, unit)
	}
	return FromUnits(units), nil
}

func hex(ch byte) int {
	switch {
	case ch >= '0' && ch <= '9':
		return int(ch - '0')
	case ch >= 'a' && ch <= 'f':
		return int(ch-'a') + 10
	case ch >= 'A' && ch <= 'F':
		return int(ch-'A') + 10
	default:
		return -1
	}
}

// FromNode follows the actual AST parent ownership to its captured source.
// A detached/synthetic literal has no authority and returns an error.
func FromNode(node *ast.Node) (String, error) {
	return FromLiteral(ast.GetSourceFileOfNode(node), node)
}
