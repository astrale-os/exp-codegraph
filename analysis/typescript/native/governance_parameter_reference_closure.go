package main

import ast "github.com/microsoft/typescript-go/shim/ast"

type governanceParameterReferenceKey struct {
	Source *ast.SourceFile
	Value  *ast.Symbol
}

// Flow-sensitive property narrowing needs non-call reads. This conservative
// owner-local closure accepts only import bindings and direct member calls.
// It is indexed once per immutable source/value pair, not once per Query use.
func (owner *governanceRuntimeAuthority) closedParameterReferences(source *ast.SourceFile, value *ast.Symbol) bool {
	if source == nil || value == nil {
		return false
	}
	key := governanceParameterReferenceKey{source, value}
	if owner.ParameterReferenceClosure == nil {
		owner.ParameterReferenceClosure = map[governanceParameterReferenceKey]bool{}
	}
	if known, exists := owner.ParameterReferenceClosure[key]; exists {
		return known
	}
	if owner.ParameterReferenceSources == nil {
		owner.ParameterReferenceSources = map[*ast.SourceFile]bool{}
	}
	if owner.ParameterReferenceSources[source] {
		return false
	}
	owner.ParameterReferenceSources[source] = true
	check := owner.Identity.TypeOwner.program.Checker
	names := map[string]*ast.Symbol{}
	walk(source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindImportSpecifier && node.Name() != nil && node.Name().Kind == ast.KindIdentifier {
			imported := unalias(check, check.GetSymbolAtLocation(node.Name()))
			if imported != nil {
				names[node.Name().Text()] = imported
				owner.ParameterReferenceClosure[governanceParameterReferenceKey{source, imported}] = true
			}
		}
		return true
	})
	walk(source.AsNode(), func(node *ast.Node) bool {
		if node.Kind != ast.KindIdentifier {
			return true
		}
		imported := names[node.Text()]
		if imported == nil || unalias(check, check.GetSymbolAtLocation(node)) != imported {
			return true
		}
		referenceKey := governanceParameterReferenceKey{source, imported}
		parent := node.Parent
		if parent != nil && parent.Kind == ast.KindImportSpecifier && parent.Name() == node {
			return true
		}
		if parent == nil || parent.Kind != ast.KindPropertyAccessExpression || parent.AsPropertyAccessExpression().Expression != node || parent.Name().Kind != ast.KindIdentifier {
			owner.ParameterReferenceClosure[referenceKey] = false
			return true
		}
		call := parent.Parent
		if call == nil || call.Kind != ast.KindCallExpression || call.AsCallExpression().Expression != parent {
			owner.ParameterReferenceClosure[referenceKey] = false
		}
		return true
	})
	return owner.ParameterReferenceClosure[key]
}

// Direct calls to an asserts-this member can narrow another member without
// passing a visible property as an argument. Close every callable literal
// header, conservatively rejecting aliases and predicates rather than inferring.
func (owner *governanceRuntimeAuthority) literalHasNoThisPredicate(literal *ast.Node) bool {
	if literal == nil || literal.Kind != ast.KindTypeLiteral || literal.AsTypeLiteralNode().Members == nil {
		return false
	}
	check := owner.Identity.TypeOwner.program.Checker
	for _, member := range literal.AsTypeLiteralNode().Members.Nodes {
		if member.Kind == ast.KindMethodSignature {
			if member.Type() == nil || member.Type().Kind == ast.KindTypePredicate {
				return false
			}
			continue
		}
		typ := member.Type()
		if typ == nil {
			return false
		}
		if typ.Kind == ast.KindFunctionType {
			if typ.Type() == nil || typ.Type().Kind == ast.KindTypePredicate {
				return false
			}
			continue
		}
		if typ.Kind != ast.KindTypeQuery {
			return false
		}
		query := typ.AsTypeQueryNode()
		if query.ExprName.Kind != ast.KindIdentifier || (query.TypeArguments != nil && len(query.TypeArguments.Nodes) > 0) {
			return false
		}
		headers := owner.plainParameterHeaders(unalias(check, check.GetSymbolAtLocation(query.ExprName)))
		if !headers.Known {
			return false
		}
		for _, header := range headers.Headers {
			if header.Declaration.Type() == nil || header.Declaration.Type().Kind == ast.KindTypePredicate {
				return false
			}
		}
	}
	return true
}
