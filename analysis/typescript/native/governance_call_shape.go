package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

// This product deliberately omits argument/parameter symbol relations. Effects
// continue to request Call independently, including its selected signature.
func (owner *governanceRuntimeAuthority) DemandCallShapes() func(string, *ast.Node) observabledecision.NativeEffectCall {
	cache := map[*ast.Node]observabledecision.NativeEffectCall{}
	return func(path string, node *ast.Node) observabledecision.NativeEffectCall {
		if result, ok := cache[node]; ok {
			return result
		}
		file, ok := owner.ByPath[path]
		if !ok {
			return observabledecision.NativeEffectCall{}
		}
		result, matched := owner.callTargetOwner(file, node)
		if matched == nil {
			return result
		}
		if !owner.canonicalFactoryReturnsNoRest(matched) {
			result = owner.Call(file, node)
			for index := range result.Bindings {
				result.Bindings[index].Argument = nil
				result.Bindings[index].Parameter = ""
			}
		}
		cache[node] = result
		return result
	}
}

// A direct SDK factory's declared return interface is sufficient for the
// negative rest observation when EVERY merged callable declaration has no rest.
// Generic substitution propagates signature rest flags; it cannot introduce a
// rest parameter. Other templates, aliases, heritage and augmentations fall
// back to the original selected signature. This proves no runtime constructor.
func (owner *governanceRuntimeAuthority) canonicalFactoryReturnsNoRest(node *ast.Node) bool {
	outer := node.AsCallExpression().Expression
	if outer == nil || outer.Kind != ast.KindCallExpression {
		return false
	}
	factory := outer.AsCallExpression()
	if factory.Arguments != nil && len(factory.Arguments.Nodes) != 0 {
		return false
	}
	check := owner.Identity.TypeOwner.program.Checker
	expression := factory.Expression
	if expression.Kind != ast.KindIdentifier && expression.Kind != ast.KindPropertyAccessExpression {
		return false
	}
	// Reject const aliases, asserted callables and local declaration lookalikes.
	imported := check.GetSymbolAtLocation(expression)
	if imported == nil || len(imported.Declarations) == 0 {
		return false
	}
	for _, declaration := range imported.Declarations {
		if declaration.Kind != ast.KindImportSpecifier {
			return false
		}
	}
	symbol := unalias(check, imported)
	if symbol == nil || len(symbol.Declarations) == 0 {
		return false
	}
	var template *ast.Symbol
	for _, declaration := range symbol.Declarations {
		if declaration.Kind != ast.KindFunctionDeclaration || !owner.canonicalSDKDeclaration(declaration) {
			return false
		}
		function := declaration.AsFunctionDeclaration()
		if function.Parameters != nil && len(function.Parameters.Nodes) != 0 {
			return false
		}
		result := function.Type
		if result == nil || result.Kind != ast.KindTypeReference {
			return false
		}
		candidate := unalias(check, check.GetSymbolAtLocation(result.AsTypeReferenceNode().TypeName))
		if candidate == nil || (template != nil && template != candidate) {
			return false
		}
		template = candidate
	}
	if template == nil || len(template.Declarations) == 0 {
		return false
	}
	signatures := 0
	for _, declaration := range template.Declarations {
		if declaration.Kind != ast.KindInterfaceDeclaration || !owner.canonicalSDKDeclaration(declaration) {
			return false
		}
		shape := declaration.AsInterfaceDeclaration()
		if shape.HeritageClauses != nil && len(shape.HeritageClauses.Nodes) != 0 {
			return false
		}
		if shape.Members == nil {
			return false
		}
		for _, member := range shape.Members.Nodes {
			if member.Kind != ast.KindCallSignature {
				return false
			}
			signatures++
			for _, parameter := range member.Parameters() {
				if parameter.AsParameterDeclaration().DotDotDotToken != nil {
					return false
				}
			}
		}
	}
	return signatures > 0
}
func (owner *governanceRuntimeAuthority) canonicalSDKDeclaration(node *ast.Node) bool {
	source := ast.GetSourceFileOfNode(node)
	if source == nil {
		return false
	}
	coordinate, err := governanceRuntimeDeclarationCoordinate(owner.Identity.Project, source.FileName())
	return err == nil && strings.HasPrefix(coordinate, "package:@astrale-os/sdk/")
}
