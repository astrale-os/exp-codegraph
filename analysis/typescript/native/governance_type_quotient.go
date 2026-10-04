package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
)

// constantUnknownCallNames observes a declaration-level invariant, not an
// approximation of argument inference. Every canonical overload must have an
// explicitly annotated return whose name quotient is unknown under every type
// argument substitution. Call errors also produce any, which has that quotient.
// Type literals with a literal string/number index keep that index under
// instantiation; mapped/conditional/type-parameter returns are not admitted.
// Callee inference and declarations belong to the original full Program, so
// shadowing, declaration merging, overloads, and global augmentation are visible.
func (owner *governanceTypeAuthority) constantUnknownCallNames(node *ast.Node) bool {
	if node.Kind != ast.KindCallExpression || node.Flags&ast.NodeFlagsOptionalChain != 0 || node.Expression().Kind == ast.KindImportKeyword || node.Expression().Kind == ast.KindSuperKeyword {
		return false
	}
	// JavaScript CommonJS require calls have module-import result semantics.
	// Exclude every direct require spelling conservatively, including shadowing.
	if node.Expression().Kind == ast.KindIdentifier && node.Expression().Text() == "require" {
		return false
	}
	callee := owner.program.Checker.GetTypeAtLocation(node.Expression())
	if callee.Flags()&checker.TypeFlagsAny != 0 {
		return true
	}
	signatures := checker.Checker_getSignaturesOfType(owner.program.Checker, callee, checker.SignatureKindCall)
	if len(signatures) == 0 {
		return false
	}
	for _, signature := range signatures {
		declaration := signature.Declaration()
		if declaration == nil || declaration.Type() == nil {
			return false
		}
		annotation := declaration.Type()
		result := checker.Checker_getReturnTypeOfSignature(owner.program.Checker, signature)
		if result == nil {
			return false
		}
		switch annotation.Kind {
		case ast.KindAnyKeyword, ast.KindUnknownKeyword, ast.KindNeverKeyword:
			if result.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsNever) == 0 {
				return false
			}
		case ast.KindTypeLiteral:
			if result.Flags()&checker.TypeFlagsObject == 0 {
				return false
			}
			constantIndex := false
			for _, member := range annotation.AsTypeLiteralNode().Members.Nodes {
				if member.Kind != ast.KindIndexSignature {
					continue
				}
				parameters := member.Parameters()
				if parameters == nil || len(parameters) != 1 || parameters[0].Type() == nil {
					continue
				}
				key := parameters[0].Type().Kind
				constantIndex = constantIndex || key == ast.KindStringKeyword || key == ast.KindNumberKeyword
			}
			if !constantIndex {
				return false
			}
			indexPresent := false
			for _, info := range checker.Checker_getIndexInfosOfType(owner.program.Checker, result) {
				indexPresent = indexPresent || info.KeyType().IsString() || info.KeyType().Flags()&checker.TypeFlagsNumberLike != 0
			}
			if !indexPresent {
				return false
			}
		default:
			return false
		}
	}
	return true
}
