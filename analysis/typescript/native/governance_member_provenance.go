package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

// Exploratory consumer projection: only direct external interface return heads.
// It does not certify a Call product or change the general value/effect reader.
func (owner *governanceRuntimeAuthority) externalFactoryMemberCannotSelfOriginal(expression *ast.Node, self string) bool {
	if self == "" || expression == nil || expression.Kind != ast.KindPropertyAccessExpression || expression.Name() == nil || expression.Name().Kind != ast.KindIdentifier {
		return false
	}
	receiver := expression.AsPropertyAccessExpression().Expression
	if receiver == nil || receiver.Kind != ast.KindCallExpression {
		return false
	}
	check := owner.Identity.TypeOwner.program.Checker
	x := &extractor{checker: check}
	factory := x.canonicalCallSymbol(receiver.AsCallExpression().Expression, func(*ast.Symbol) {})
	if factory == nil || len(factory.Declarations) == 0 {
		return false
	}
	canonical := func(node *ast.Node) bool {
		source := ast.GetSourceFileOfNode(node)
		if source == nil {
			return false
		}
		coordinate, err := governanceRuntimeDeclarationCoordinate(owner.Identity.Project, source.FileName())
		return err == nil && strings.HasPrefix(coordinate, "package:@astrale-os/kernel-core/")
	}
	memberName := expression.Name().Text()
	var heads func(*ast.Node) bool
	heads = func(result *ast.Node) bool {
		if result == nil {
			return false
		}
		if result.Kind == ast.KindUnionType {
			for _, branch := range result.AsUnionTypeNode().Types.Nodes {
				if !heads(branch) {
					return false
				}
			}
			return len(result.AsUnionTypeNode().Types.Nodes) > 0
		}
		if result.Kind != ast.KindTypeReference {
			return false
		}
		symbol := unalias(check, check.GetSymbolAtLocation(result.AsTypeReferenceNode().TypeName))
		if symbol == nil || len(symbol.Declarations) == 0 {
			return false
		}
		found := false
		for _, declaration := range symbol.Declarations {
			if declaration.Kind != ast.KindInterfaceDeclaration || !canonical(declaration) {
				return false
			}
			shape := declaration.AsInterfaceDeclaration()
			if shape.HeritageClauses != nil && len(shape.HeritageClauses.Nodes) > 0 {
				return false
			}
			if shape.Members == nil {
				return false
			}
			for _, member := range shape.Members.Nodes {
				name := member.Name()
				if name == nil || name.Kind != ast.KindIdentifier || (member.Kind != ast.KindMethodSignature && member.Kind != ast.KindPropertySignature) {
					return false
				}
				if name.Text() != memberName {
					continue
				}
				if member.Kind != ast.KindMethodSignature || !canonical(member) || member.Symbol() == nil {
					return false
				}
				target := owner.symbolKey(member.Symbol())
				if target == "" || target == self {
					return false
				}
				for _, origin := range member.Symbol().Declarations {
					if origin.Kind != ast.KindMethodSignature || !canonical(origin) {
						return false
					}
				}
				found = true
			}
		}
		return found
	}
	for _, declaration := range factory.Declarations {
		if declaration.Kind != ast.KindMethodSignature || !canonical(declaration) || !heads(declaration.Type()) {
			return false
		}
	}
	return true
}
