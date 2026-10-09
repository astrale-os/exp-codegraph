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
		coordinate := x.declarationSourcePackageCoordinate(file)
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
func (x *extractor) canonicalCallSymbol(node *shimast.Node, read func(*shimast.Symbol)) *shimast.Symbol {
	if x.typeOnlyValueReference(node, read) {
		return nil
	}
	symbol := unalias(x.checker, x.checker.GetSymbolAtLocation(node))
	seen := map[*shimast.Symbol]bool{}
	for symbol != nil && !seen[symbol] {
		seen[symbol] = true
		read(symbol)
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
		next := unalias(x.checker, x.checker.GetSymbolAtLocation(initializer))
		if next == nil {
			break
		}
		symbol = next
	}
	return symbol
}

// A resolved signature does not certify that its authored reference exists at
// runtime. Inspect import/export aliases before erasing them, including aliases
// reached through variable initializers and namespace receivers. This certificate
// is shared by canonical exports and callable body selection.
func (x *extractor) typeOnlyValueReference(node *shimast.Node, read func(*shimast.Symbol)) bool {
	pending := []*shimast.Node{node}
	seen := map[*shimast.Node]bool{}
	aliases := map[*shimast.Symbol]bool{}
	for len(pending) > 0 {
		node = pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if node == nil || seen[node] {
			continue
		}
		seen[node] = true
		switch node.Kind {
		case shimast.KindParenthesizedExpression, shimast.KindAsExpression, shimast.KindSatisfiesExpression,
			shimast.KindNonNullExpression, shimast.KindTypeAssertionExpression:
			pending = append(pending, node.Expression())
			continue
		case shimast.KindPropertyAccessExpression:
			pending = append(pending, node.AsPropertyAccessExpression().Expression)
		case shimast.KindIdentifier:
		default:
			continue
		}
		symbol := x.checker.GetSymbolAtLocation(node)
		for symbol != nil && symbol.Flags&shimast.SymbolFlagsAlias != 0 && !aliases[symbol] {
			aliases[symbol] = true
			read(symbol)
			if x.checker.GetTypeOnlyAliasDeclaration(symbol) != nil {
				return true
			}
			symbol = x.checker.GetImmediateAliasedSymbol(symbol)
		}
		declaration := declarationNode(unalias(x.checker, symbol))
		// This only detects non-runtime provenance; the canonical target selector
		// independently keeps its const-only value identity restriction.
		if declaration != nil && declaration.Kind == shimast.KindVariableDeclaration {
			pending = append(pending, declaration.AsVariableDeclaration().Initializer)
		}
	}
	return false
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

func (x *extractor) packageCoordinate(source string) string {
	if x.packageCoordinates == nil {
		x.packageCoordinates = newPackageCoordinateResolver(x.root)
	}
	return x.packageCoordinates.coordinate(source)
}
