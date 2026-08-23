package main

import (
	"fmt"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
)

// publicSymbolIdentity is portable semantic identity, not a source span.
// Source positions remain provenance, while an insertion before a declaration
// must not rename the declaration throughout the materialized graph.
func (x *extractor) publicSymbolIdentity(symbol *shimast.Symbol) string {
	if symbol == nil {
		return ""
	}
	if platformSymbol(symbol) {
		return "platform:typescript#" + publicSymbolPath(symbol)
	}
	coordinates := []string{}
	for _, declaration := range symbol.Declarations {
		file := shimast.GetSourceFileOfNode(declaration)
		if file == nil {
			continue
		}
		coordinate, _ := x.publicSourceCoordinate(file.FileName())
		coordinates = append(coordinates, coordinate)
	}
	coordinates = sortedUnique(coordinates)
	if len(coordinates) == 0 {
		return "ts:<synthetic>#" + percentEncode(symbol.Name)
	}
	return fmt.Sprintf("ts:%s#%s", strings.Join(coordinates, "|"), publicSymbolPath(symbol))
}

// Qualified lexical ownership distinguishes same-spelled nested declarations
// without depending on compiler allocation order. Source-file module symbols
// are already represented by the source coordinate and are omitted.
func publicSymbolPath(symbol *shimast.Symbol) string {
	parts := []string{percentEncode(stableSymbolName(symbol))}
	for parent := symbol.Parent; parent != nil; parent = parent.Parent {
		declaration := firstDeclaration(parent)
		if declaration == nil || declaration.Kind == shimast.KindSourceFile {
			break
		}
		name := stableSymbolName(parent)
		if name != "" {
			parts = append(parts, percentEncode(name))
		}
	}
	for left, right := 0, len(parts)-1; left < right; left, right = left+1, right-1 {
		parts[left], parts[right] = parts[right], parts[left]
	}
	return strings.Join(parts, ".")
}
