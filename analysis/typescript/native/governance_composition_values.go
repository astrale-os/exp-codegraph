package main

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

func governancePrimitiveCompositionKey(expression *ast.Node) bool {
	v := authored.Unwrap(expression)
	return v != nil && (v.Kind == ast.KindStringLiteral || v.Kind == ast.KindNoSubstitutionTemplateLiteral || v.Kind == ast.KindNumericLiteral || v.Kind == ast.KindTrueKeyword || v.Kind == ast.KindFalseKeyword || v.Kind == ast.KindNullKeyword)
}
func governanceStaticCompositionValue(project *governedProject, file *governedFile, expression *ast.Node, depth int) bool {
	if depth > 32 {
		return false
	}
	v := authored.Unwrap(expression)
	if v == nil {
		return false
	}
	nested := func(n *ast.Node) bool { return governanceStaticCompositionValue(project, file, n, depth+1) }
	if v.Kind == ast.KindIdentifier || governancePrimitiveCompositionKey(v) {
		return true
	}
	switch v.Kind {
	case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression:
		return governanceSchemaCompositionAccess(project, file, v, depth)
	case ast.KindArrayLiteralExpression:
		for _, e := range v.AsArrayLiteralExpression().Elements.Nodes {
			if e.Kind == ast.KindOmittedExpression {
				continue
			}
			if e.Kind == ast.KindSpreadElement {
				n := e.AsSpreadElement().Expression
				if authored.Unwrap(n).Kind != ast.KindArrayLiteralExpression || !nested(n) {
					return false
				}
			} else if !nested(e) {
				return false
			}
		}
		return true
	case ast.KindObjectLiteralExpression:
		for _, p := range v.AsObjectLiteralExpression().Properties.Nodes {
			switch p.Kind {
			case ast.KindSpreadAssignment:
				n := p.AsSpreadAssignment().Expression
				if authored.Unwrap(n).Kind != ast.KindObjectLiteralExpression || !nested(n) {
					return false
				}
			case ast.KindShorthandPropertyAssignment:
				continue
			case ast.KindPropertyAssignment:
				if p.Name().Kind == ast.KindComputedPropertyName && !governancePrimitiveCompositionKey(p.Name().AsComputedPropertyName().Expression) || !nested(p.AsPropertyAssignment().Initializer) {
					return false
				}
			default:
				return false
			}
		}
		return true
	case ast.KindCallExpression:
		call := v.AsCallExpression()
		callee := authored.Unwrap(call.Expression)
		if callee.Kind != ast.KindPropertyAccessExpression || callee.Name().Text() != "resolve" {
			return false
		}
		owner := file.authoring().ResolveImportedSymbol(callee.AsPropertyAccessExpression().Expression)
		return owner.Kind == "resolved" && owner.Name == "schema" && (owner.Module == "@astrale-os/sdk/schema" || owner.Module == "@astrale-os/kernel-dsl" || strings.HasPrefix(owner.Module, "@astrale-os/kernel-dsl/")) && call.Arguments != nil && len(call.Arguments.Nodes) == 1 && nested(call.Arguments.Nodes[0])
	}
	return false
}
func governanceSchemaCompositionAccess(project *governedProject, file *governedFile, expression *ast.Node, depth int) bool {
	if depth > 32 {
		return false
	}
	v := authored.Unwrap(expression)
	if v == nil {
		return false
	}
	switch v.Kind {
	case ast.KindPropertyAccessExpression:
		return governanceSchemaCompositionAccess(project, file, v.AsPropertyAccessExpression().Expression, depth+1)
	case ast.KindElementAccessExpression:
		e := v.AsElementAccessExpression()
		return governancePrimitiveCompositionKey(e.ArgumentExpression) && governanceSchemaCompositionAccess(project, file, e.Expression, depth+1)
	case ast.KindIdentifier:
		return governanceResolvedSchemaBinding(project, file, v.Text(), depth+1, false)
	case ast.KindCallExpression:
		return governanceStaticCompositionValue(project, file, v, depth+1)
	}
	return false
}
func governanceResolvedSchemaBinding(project *governedProject, file *governedFile, name string, depth int, exported bool) bool {
	if depth > 32 {
		return false
	}
	aliases := map[string]bool{name: true}
	for pass := 0; pass < 32; pass++ {
		count := len(aliases)
		authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
			if n.Kind == ast.KindVariableDeclaration && n.AsVariableDeclaration().Initializer != nil {
				v := authored.Unwrap(n.AsVariableDeclaration().Initializer)
				if v.Kind == ast.KindIdentifier && aliases[v.Text()] && n.Name().Kind == ast.KindIdentifier {
					aliases[n.Name().Text()] = true
				}
			}
		})
		if len(aliases) == count {
			break
		}
		if pass == 31 {
			return false
		}
	}
	held := func(expression *ast.Node) bool {
		v := authored.Unwrap(expression)
		for v != nil && (v.Kind == ast.KindPropertyAccessExpression || v.Kind == ast.KindElementAccessExpression) {
			v = authored.Unwrap(v.Expression())
		}
		return v != nil && v.Kind == ast.KindIdentifier && aliases[v.Text()]
	}
	unsafe := false
	authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
		switch n.Kind {
		case ast.KindBinaryExpression:
			b := n.AsBinaryExpression()
			if b.OperatorToken.Kind >= ast.KindFirstAssignment && b.OperatorToken.Kind <= ast.KindLastAssignment && held(b.Left) {
				unsafe = true
			}
		case ast.KindPrefixUnaryExpression:
			u := n.AsPrefixUnaryExpression()
			if (u.Operator == ast.KindPlusPlusToken || u.Operator == ast.KindMinusMinusToken) && held(u.Operand) {
				unsafe = true
			}
		case ast.KindPostfixUnaryExpression:
			u := n.AsPostfixUnaryExpression()
			if (u.Operator == ast.KindPlusPlusToken || u.Operator == ast.KindMinusMinusToken) && held(u.Operand) {
				unsafe = true
			}
		case ast.KindCallExpression:
			c := n.AsCallExpression()
			if held(c.Expression) {
				unsafe = true
			}
			if c.Arguments != nil {
				for _, arg := range c.Arguments.Nodes {
					if held(arg) {
						unsafe = true
					}
				}
			}
		case ast.KindDeleteExpression:
			if held(n.AsDeleteExpression().Expression) {
				unsafe = true
			}
		case ast.KindVariableDeclaration:
			if n.Name().Kind != ast.KindIdentifier && n.AsVariableDeclaration().Initializer != nil && held(n.AsVariableDeclaration().Initializer) {
				unsafe = true
			}
		}
	})
	if unsafe {
		return false
	}
	for _, stmt := range file.Source.Statements.Nodes {
		if stmt.Kind == ast.KindVariableStatement {
			list := stmt.AsVariableStatement().DeclarationList
			if list.Flags&ast.NodeFlagsConst != 0 && (!exported || stmt.ModifierFlags()&ast.ModifierFlagsExport != 0) {
				for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
					if d.Name().Kind == ast.KindIdentifier && d.Name().Text() == name && d.AsVariableDeclaration().Initializer != nil {
						v := authored.Unwrap(d.AsVariableDeclaration().Initializer)
						if v.Kind == ast.KindIdentifier {
							return governanceResolvedSchemaBinding(project, file, v.Text(), depth+1, false)
						}
						return v.Kind == ast.KindCallExpression && governanceStaticCompositionValue(project, file, v, depth+1)
					}
				}
			}
		}
		if !exported && stmt.Kind == ast.KindImportDeclaration {
			d := stmt.AsImportDeclaration()
			if d.ImportClause == nil || d.ImportClause.AsImportClause().IsTypeOnly() || d.ModuleSpecifier == nil || d.ModuleSpecifier.Kind != ast.KindStringLiteral {
				continue
			}
			bindings := d.ImportClause.AsImportClause().NamedBindings
			if bindings == nil || bindings.Kind != ast.KindNamedImports {
				continue
			}
			for _, b := range bindings.AsNamedImports().Elements.Nodes {
				e := b.AsImportSpecifier()
				if !e.IsTypeOnly && e.Name().Text() == name {
					target := project.resolveProjectImport(file, d.ModuleSpecifier.Text())
					if target != nil {
						imported := e.Name().Text()
						if e.PropertyName != nil {
							imported = e.PropertyName.Text()
						}
						return governanceResolvedSchemaBinding(project, target, imported, depth+1, true)
					}
					break
				}
			}
		}
		if exported && stmt.Kind == ast.KindExportDeclaration {
			e := stmt.AsExportDeclaration()
			if e.IsTypeOnly || e.ExportClause == nil || e.ExportClause.Kind != ast.KindNamedExports {
				continue
			}
			for _, b := range e.ExportClause.AsNamedExports().Elements.Nodes {
				x := b.AsExportSpecifier()
				if x.IsTypeOnly || x.Name().Text() != name {
					continue
				}
				target := file
				if e.ModuleSpecifier != nil && e.ModuleSpecifier.Kind == ast.KindStringLiteral {
					target = project.resolveProjectImport(file, e.ModuleSpecifier.Text())
				}
				if target == nil {
					return false
				}
				imported := x.Name().Text()
				if x.PropertyName != nil {
					imported = x.PropertyName.Text()
				}
				return governanceResolvedSchemaBinding(project, target, imported, depth+1, target != file)
			}
		}
	}
	return false
}
func governanceDomainDefinitionCall(file *governedFile, call *ast.Node) bool {
	expression := authored.Unwrap(call.AsCallExpression().Expression)
	direct, ok := file.authoring().ImportedSymbol(expression)
	if ok && strings.HasPrefix(direct.Module, "@astrale-os/sdk") && authored.Contains([]string{"defineApplication", "defineFrontend", "defineRuntime", "requirements"}, direct.Name) {
		return true
	}
	if expression.Kind != ast.KindCallExpression {
		return false
	}
	factory, ok := file.authoring().ImportedSymbol(expression.AsCallExpression().Expression)
	return ok && factory.Name == "defineRuntime" && strings.HasPrefix(factory.Module, "@astrale-os/sdk")
}
func governanceCompositionStatement(project *governedProject, file *governedFile, stmt *ast.Node) bool {
	switch stmt.Kind {
	case ast.KindImportDeclaration, ast.KindExportDeclaration, ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindEmptyStatement:
		return true
	case ast.KindVariableStatement:
		for _, d := range stmt.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
			decl := d.AsVariableDeclaration()
			if decl.Initializer == nil {
				return false
			}
			value := authored.Unwrap(decl.Initializer)
			if value.Kind == ast.KindObjectLiteralExpression || value.Kind == ast.KindArrayLiteralExpression {
				if decl.Name().Kind != ast.KindIdentifier {
					return false
				}
				name := strings.ToLower(decl.Name().Text())
				if !authored.Contains([]string{"actions", "application", "frontend", "functions", "integrations", "providers", "routes", "runtime", "workflows"}, name) && !(stmt.AsVariableStatement().DeclarationList.Flags&ast.NodeFlagsConst != 0 && governanceStaticCompositionValue(project, file, value, 0)) {
					return false
				}
			} else if value.Kind == ast.KindArrowFunction || value.Kind == ast.KindFunctionExpression {
				if decl.Name().Kind != ast.KindIdentifier || strings.ToLower(decl.Name().Text()) != "initialize" {
					return false
				}
			} else if value.Kind != ast.KindCallExpression || !governanceDomainDefinitionCall(file, value) {
				return false
			}
		}
		return true
	case ast.KindExportAssignment:
		value := authored.Unwrap(stmt.AsExportAssignment().Expression)
		if value.Kind == ast.KindIdentifier {
			return authored.Contains([]string{"actions", "application", "frontend", "functions", "integrations", "providers", "routes", "runtime", "workflows"}, strings.ToLower(value.Text()))
		}
		return value.Kind == ast.KindCallExpression && governanceDomainDefinitionCall(file, value)
	}
	return false
}
