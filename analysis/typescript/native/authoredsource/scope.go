package authoredsource

import ast "github.com/microsoft/typescript-go/shim/ast"

// Preserve the TWO SDK syntactic ownership predicates. imports.ts's
// isLocallyDeclared deliberately excludes imports and includes module/loop
// scopes; shared.ts's isLocallyBound includes imports/function names but not
// module/loop declarations. IMP-STATIC first applies the former then latter.
func BindingContains(binding *ast.Node, name string) bool {
	if binding == nil {
		return false
	}
	if binding.Kind == ast.KindIdentifier {
		return binding.Text() == name
	}
	if binding.Kind != ast.KindObjectBindingPattern && binding.Kind != ast.KindArrayBindingPattern {
		return false
	}
	for _, element := range binding.AsBindingPattern().Elements.Nodes {
		if element.Kind == ast.KindBindingElement && BindingContains(element.Name(), name) {
			return true
		}
	}
	return false
}
func statementDeclares(statement *ast.Node, name string, bound bool) bool {
	if statement.Kind == ast.KindVariableStatement {
		for _, declaration := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
			if BindingContains(declaration.Name(), name) {
				return true
			}
		}
	}
	switch statement.Kind {
	case ast.KindFunctionDeclaration, ast.KindClassDeclaration, ast.KindEnumDeclaration:
		return statement.Name() != nil && statement.Name().Text() == name
	case ast.KindModuleDeclaration:
		return !bound && statement.Name() != nil && statement.Name().Text() == name
	case ast.KindImportDeclaration:
		if !bound {
			return false
		}
		clause := statement.AsImportDeclaration().ImportClause
		if clause == nil {
			return false
		}
		c := clause.AsImportClause()
		if c.Name() != nil && c.Name().Text() == name {
			return true
		}
		if c.NamedBindings == nil {
			return false
		}
		if c.NamedBindings.Kind == ast.KindNamespaceImport {
			return c.NamedBindings.Name().Text() == name
		}
		for _, element := range c.NamedBindings.AsNamedImports().Elements.Nodes {
			if element.Name().Text() == name {
				return true
			}
		}
	}
	return false
}
func LocallyOwned(identifier *ast.Node, bound bool) bool {
	if identifier == nil || identifier.Kind != ast.KindIdentifier {
		return false
	}
	name := identifier.Text()
	for scope := identifier.Parent; scope != nil; scope = scope.Parent {
		if ast.IsFunctionLike(scope) {
			if params := scope.ParameterList(); params != nil {
				for _, p := range params.Nodes {
					if BindingContains(p.Name(), name) {
						return true
					}
				}
			}
			if (bound || scope.Kind == ast.KindFunctionExpression) && scope.Name() != nil && scope.Name().Kind == ast.KindIdentifier && scope.Name().Text() == name {
				return true
			}
		}
		if scope.Kind == ast.KindCatchClause {
			v := scope.AsCatchClause().VariableDeclaration
			if v != nil && BindingContains(v.Name(), name) {
				return true
			}
		}
		if scope.Kind == ast.KindBlock || scope.Kind == ast.KindSourceFile || (!bound && scope.Kind == ast.KindModuleBlock) {
			if statements := scope.StatementList(); statements != nil {
				for _, s := range statements.Nodes {
					if statementDeclares(s, name, bound) {
						return true
					}
				}
			}
		}
		if !bound {
			var initializer *ast.Node
			switch scope.Kind {
			case ast.KindForStatement:
				initializer = scope.AsForStatement().Initializer
			case ast.KindForInStatement, ast.KindForOfStatement:
				initializer = scope.AsForInOrOfStatement().Initializer
			}
			if initializer != nil && initializer.Kind == ast.KindVariableDeclarationList {
				for _, v := range initializer.AsVariableDeclarationList().Declarations.Nodes {
					if BindingContains(v.Name(), name) {
						return true
					}
				}
			}
		}
	}
	return false
}
