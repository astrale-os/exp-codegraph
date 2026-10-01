package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	js "astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
	"unicode/utf8"
)

func qmText(node *ast.Node) (string, bool) {
	if node == nil {
		return "", false
	}
	value := authored.Unwrap(node)
	if value.Kind == ast.KindStringLiteral || value.Kind == ast.KindNoSubstitutionTemplateLiteral {
		literal, err := js.FromNode(value)
		if err != nil {
			return "", false
		}
		return literal.WTF8(), true
	}
	return authored.StaticText(node)
}

// JSON.stringify spelling is itself observable inside the evidence message;
// JSONText subsequently transports that message without surrogate replacement.
func qmQuoteJSON(value string) string {
	literal, err := js.FromCompilerText(value)
	if err != nil {
		return ""
	}
	units := literal.Units()
	var out strings.Builder
	out.WriteByte('"')
	const hex = "0123456789abcdef"
	escape := func(unit uint16) {
		out.WriteString(`\u`)
		out.WriteByte(hex[unit>>12])
		out.WriteByte(hex[(unit>>8)&15])
		out.WriteByte(hex[(unit>>4)&15])
		out.WriteByte(hex[unit&15])
	}
	for index := 0; index < len(units); index++ {
		unit := units[index]
		switch unit {
		case '"', '\\':
			out.WriteByte('\\')
			out.WriteByte(byte(unit))
		case '\b':
			out.WriteString(`\b`)
		case '\f':
			out.WriteString(`\f`)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		default:
			if unit < 0x20 {
				escape(unit)
			} else if unit >= 0xd800 && unit <= 0xdbff && index+1 < len(units) && units[index+1] >= 0xdc00 && units[index+1] <= 0xdfff {
				r := rune(0x10000 + (uint32(unit)-0xd800)*0x400 + uint32(units[index+1]) - 0xdc00)
				out.WriteString(string(utf8.AppendRune(nil, r)))
				index++
			} else if unit >= 0xd800 && unit <= 0xdfff {
				escape(unit)
			} else {
				out.WriteString(string(rune(unit)))
			}
		}
	}
	out.WriteByte('"')
	return out.String()
}
