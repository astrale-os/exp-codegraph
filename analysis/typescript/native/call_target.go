package main

import (
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
)

// Origin identifies the actual declaration reached through compiler aliases,
// never the spelling of the import or the shape of its callable type.
func (x *extractor) callTargetOrigin(symbol *shimast.Symbol) *callTargetOrigin {
	symbol = unalias(x.checker, symbol)
	if symbol == nil {
		return nil
	}
	if x.callOrigins == nil {
		x.callOrigins = map[*shimast.Symbol]*callTargetOrigin{}
		x.packageCoordinates = map[string]string{}
	}
	if origin, exists := x.callOrigins[symbol]; exists {
		return origin
	}
	x.callOrigins[symbol] = nil
	var origin *callTargetOrigin
	for _, declaration := range symbol.Declarations {
		file := shimast.GetSourceFileOfNode(declaration)
		if file == nil {
			return nil
		}
		coordinate, exists := x.packageCoordinates[file.FileName()]
		if !exists {
			coordinate = workspacePackageCoordinate(x.root, file.FileName())
			x.packageCoordinates[file.FileName()] = coordinate
		}
		if !strings.HasPrefix(coordinate, "package:") {
			return nil
		}
		qualified := strings.TrimPrefix(coordinate, "package:")
		pkg := packageNameFromSpecifier(qualified)
		path := strings.TrimPrefix(qualified, pkg+"/")
		if path == qualified || path == "" {
			return nil
		}
		names := []string{stableSymbolName(symbol)}
		if names[0] == "" {
			return nil
		}
		for parent := declaration.Parent; parent != nil && parent.Kind != shimast.KindSourceFile; parent = parent.Parent {
			if parent.Name() == nil {
				continue
			}
			if owner := parent.Symbol(); owner != nil {
				if name := stableSymbolName(owner); name != "" {
					names = append(names, name)
				}
			}
		}
		for left, right := 0, len(names)-1; left < right; left, right = left+1, right-1 {
			names[left], names[right] = names[right], names[left]
		}
		candidate := &callTargetOrigin{Package: pkg, File: path, Path: names}
		if origin != nil && stableJSON(origin) != stableJSON(candidate) {
			return nil
		}
		origin = candidate
	}
	x.callOrigins[symbol] = origin
	return origin
}

// A const alias preserves a callable's value identity. Its resolved signature
// alone would also match mutable or merely structurally compatible lookalikes.
func (b *bodyBuilder) canonicalCallSymbol(node *shimast.Node) *shimast.Symbol {
	symbol := unalias(b.x.checker, b.x.checker.GetSymbolAtLocation(node))
	seen := map[*shimast.Symbol]bool{}
	for symbol != nil && !seen[symbol] {
		seen[symbol] = true
		declaration := declarationNode(symbol)
		if declaration == nil || declaration.Kind != shimast.KindVariableDeclaration || !shimast.IsConst(declaration) {
			break
		}
		initializer := declaration.AsVariableDeclaration().Initializer
		for initializer != nil {
			switch initializer.Kind {
			case shimast.KindParenthesizedExpression, shimast.KindAsExpression, shimast.KindSatisfiesExpression,
				shimast.KindNonNullExpression, shimast.KindTypeAssertionExpression:
				initializer = initializer.Expression()
			default:
				goto unwrapped
			}
		}
	unwrapped:
		if initializer == nil || (initializer.Kind != shimast.KindIdentifier && initializer.Kind != shimast.KindPropertyAccessExpression) {
			break
		}
		next := unalias(b.x.checker, b.x.checker.GetSymbolAtLocation(initializer))
		if next == nil {
			break
		}
		symbol = next
	}
	return symbol
}

// Only the value assigned to a callable binding is an executable target.
// A callback nested inside an object is not the body of that object's binding.
func functionInitializer(declaration *shimast.Node) *shimast.Node {
	if declaration == nil {
		return nil
	}
	var initializer *shimast.Node
	switch declaration.Kind {
	case shimast.KindVariableDeclaration:
		if !shimast.IsConst(declaration) {
			return nil
		}
		initializer = declaration.AsVariableDeclaration().Initializer
	case shimast.KindPropertyAssignment:
		initializer = declaration.AsPropertyAssignment().Initializer
	}
	for initializer != nil {
		switch initializer.Kind {
		case shimast.KindParenthesizedExpression, shimast.KindAsExpression, shimast.KindSatisfiesExpression,
			shimast.KindNonNullExpression, shimast.KindTypeAssertionExpression:
			initializer = initializer.Expression()
		default:
			if shimast.IsFunctionLike(initializer) {
				return initializer
			}
			return nil
		}
	}
	return nil
}
