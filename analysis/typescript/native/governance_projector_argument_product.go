package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
)

// This product contains exactly the signature fields observed by argument
// bindings. No Type, inferred return, callback, body owner or selected-signature
// pointer escapes. It belongs to this actual immutable Program/capture only.
type governanceArgumentShapeProduct struct {
	Known      bool
	Parameters []string
	Rest       bool
}

func (owner *governanceRuntimeAuthority) projectorArgumentShape(node *ast.Node) governanceArgumentShapeProduct {
	if before, seen := owner.ProjectorArgumentShapes[node]; seen {
		return before
	}
	product := owner.computeProjectorArgumentShape(node)
	if owner.ProjectorArgumentShapes == nil {
		owner.ProjectorArgumentShapes = map[*ast.Node]governanceArgumentShapeProduct{}
	}
	owner.ProjectorArgumentShapes[node] = product
	return product
}

func (owner *governanceRuntimeAuthority) computeProjectorArgumentShape(node *ast.Node) governanceArgumentShapeProduct {
	unknown := governanceArgumentShapeProduct{}
	if node == nil || node.Kind != ast.KindCallExpression || node.Flags&ast.NodeFlagsOptionalChain != 0 || !owner.canonicalFactoryReturnsNoRest(node) {
		return unknown
	}
	outer := node.AsCallExpression().Expression
	if outer.Flags&ast.NodeFlagsOptionalChain != 0 {
		return unknown
	}
	// Observe the original factory return type, not the inner callback's inferred
	// signature. The existing declaration certificate admits only a direct SDK
	// import with an explicit interface return and no runtime factory arguments.
	// Complete explicit factory type arguments prevent contextual return inference.
	factory := outer.AsCallExpression()
	check := owner.Identity.TypeOwner.program.Checker
	symbol := unalias(check, check.GetSymbolAtLocation(factory.Expression))
	if symbol == nil || len(symbol.Declarations) != 1 {
		return unknown
	}
	declaration := symbol.Declarations[0]
	source := ast.GetSourceFileOfNode(declaration)
	if source == nil || !source.IsDeclarationFile || len(outer.TypeArguments()) != len(declaration.TypeParameters()) {
		return unknown
	}
	if node.TypeArguments() != nil {
		return unknown
	}
	callee := check.GetTypeAtLocation(outer)
	if callee == nil || callee.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsNever|checker.TypeFlagsUnion|checker.TypeFlagsIntersection|checker.TypeFlagsNull|checker.TypeFlagsUndefined) != 0 {
		return unknown
	}
	callee = check.GetApparentType(callee)
	signatures := checker.Checker_getSignaturesOfType(check, callee, checker.SignatureKindCall)
	if len(signatures) != 1 || len(checker.Checker_getSignaturesOfType(check, callee, checker.SignatureKindConstruct)) != 0 {
		return unknown
	}
	signature := signatures[0]
	decl := signature.Declaration()
	if decl == nil || decl.Kind != ast.KindCallSignature || !owner.canonicalSDKDeclaration(decl) || checker.Signature_hasRestParameter(signature) {
		return unknown
	}
	parameters := checker.Signature_parameters(signature)
	if len(parameters) != len(decl.Parameters()) {
		return unknown
	} // excludes a `this` parameter
	product := governanceArgumentShapeProduct{Known: true, Parameters: make([]string, len(parameters))}
	for index, parameter := range parameters {
		// Original instantiateSymbol preserves the complete declaration vector.
		// The sole-candidate success and overload-failure paths instantiate that
		// same signature; synthetic/combined/declaration-free parameters decline.
		if parameter == nil || len(parameter.Declarations) != 1 || parameter.Declarations[0] != decl.Parameters()[index] || parameter.Declarations[0].Kind != ast.KindParameter {
			return unknown
		}
		if parameter.Declarations[0].Name() == nil || parameter.Declarations[0].Name().Text() == "this" {
			return unknown
		}
		product.Parameters[index] = owner.symbolKey(parameter)
		if product.Parameters[index] == "" {
			return unknown
		}
	}
	return product
}
