package main

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

func governanceIntegrationStaticValue(file *governedFile, expression *ast.Node) bool {
	v := authored.Unwrap(expression)
	if v == nil {
		return false
	}
	if v.Kind == ast.KindArrowFunction || v.Kind == ast.KindFunctionExpression || v.Kind == ast.KindIdentifier || governancePrimitiveCompositionKey(v) {
		return true
	}
	switch v.Kind {
	case ast.KindPropertyAccessExpression:
		return governanceIntegrationStaticValue(file, v.AsPropertyAccessExpression().Expression)
	case ast.KindArrayLiteralExpression:
		for _, item := range v.AsArrayLiteralExpression().Elements.Nodes {
			if item.Kind == ast.KindOmittedExpression {
				continue
			}
			n := item
			if item.Kind == ast.KindSpreadElement {
				n = item.AsSpreadElement().Expression
			}
			if !governanceIntegrationStaticValue(file, n) {
				return false
			}
		}
		return true
	case ast.KindObjectLiteralExpression:
		for _, item := range v.AsObjectLiteralExpression().Properties.Nodes {
			switch item.Kind {
			case ast.KindShorthandPropertyAssignment:
				continue
			case ast.KindMethodDeclaration:
				if item.Name().Kind == ast.KindComputedPropertyName && !governancePrimitiveCompositionKey(item.Name().AsComputedPropertyName().Expression) {
					return false
				}
			case ast.KindSpreadAssignment:
				if !governanceIntegrationStaticValue(file, item.AsSpreadAssignment().Expression) {
					return false
				}
			case ast.KindPropertyAssignment:
				if item.Name().Kind == ast.KindComputedPropertyName && !governancePrimitiveCompositionKey(item.Name().AsComputedPropertyName().Expression) || !governanceIntegrationStaticValue(file, item.AsPropertyAssignment().Initializer) {
					return false
				}
			default:
				return false
			}
		}
		return true
	case ast.KindCallExpression:
		callee := authored.Unwrap(v.AsCallExpression().Expression)
		ownerNode := callee
		if callee.Kind == ast.KindPropertyAccessExpression {
			ownerNode = callee.AsPropertyAccessExpression().Expression
		}
		owner := file.authoring().ResolveImportedSymbol(ownerNode)
		if owner.Kind != "resolved" || owner.Module != "@astrale-os/sdk/integration" || owner.Name != "defineIntegration" || callee.Kind == ast.KindPropertyAccessExpression && callee.Name().Text() != "operation" {
			return false
		}
		if v.AsCallExpression().Arguments != nil {
			for _, arg := range v.AsCallExpression().Arguments.Nodes {
				if !governanceIntegrationStaticValue(file, arg) {
					return false
				}
			}
		}
		return true
	}
	return false
}
func governanceIntegrationBinding(project *governedProject, file *governedFile, name string, exported bool, seen map[string]bool, owners *[]*governedFile) bool {
	key := fmt.Sprintf("%s:%s:%t", file.Path, name, exported)
	if seen[key] || len(seen) >= 32 {
		return false
	}
	next := map[string]bool{}
	for k, v := range seen {
		next[k] = v
	}
	next[key] = true
	found := false
	for _, owner := range *owners {
		found = found || owner == file
	}
	if !found {
		*owners = append(*owners, file)
	}
	for _, stmt := range file.Source.Statements.Nodes {
		if stmt.Kind == ast.KindVariableStatement {
			list := stmt.AsVariableStatement().DeclarationList
			if list.Flags&ast.NodeFlagsConst != 0 && (!exported || stmt.ModifierFlags()&ast.ModifierFlagsExport != 0) {
				for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
					if d.Name().Kind != ast.KindIdentifier || d.Name().Text() != name || d.AsVariableDeclaration().Initializer == nil {
						continue
					}
					value := authored.Unwrap(d.AsVariableDeclaration().Initializer)
					if value.Kind == ast.KindIdentifier {
						return governanceIntegrationBinding(project, file, value.Text(), false, next, owners)
					}
					if value.Kind == ast.KindObjectLiteralExpression {
						valid := true
						for _, property := range value.AsObjectLiteralExpression().Properties.Nodes {
							accepted := false
							if property.Kind == ast.KindShorthandPropertyAssignment {
								accepted = governanceIntegrationBinding(project, file, property.Name().Text(), false, next, owners)
							} else if property.Kind == ast.KindPropertyAssignment && !(property.Name().Kind == ast.KindComputedPropertyName && !governancePrimitiveCompositionKey(property.Name().AsComputedPropertyName().Expression)) {
								entry := authored.Unwrap(property.AsPropertyAssignment().Initializer)
								accepted = entry.Kind == ast.KindIdentifier && governanceIntegrationBinding(project, file, entry.Text(), false, next, owners)
							}
							valid = valid && accepted
						}
						return valid
					}
					if value.Kind != ast.KindCallExpression {
						return false
					}
					owner := file.authoring().ResolveImportedSymbol(value.AsCallExpression().Expression)
					return owner.Kind == "resolved" && owner.Module == "@astrale-os/sdk/integration" && owner.Name == "defineIntegration"
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
				return governanceIntegrationBinding(project, target, imported, target != file, next, owners)
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
				x := b.AsImportSpecifier()
				if x.IsTypeOnly || x.Name().Text() != name {
					continue
				}
				target := project.resolveProjectImport(file, d.ModuleSpecifier.Text())
				if target == nil {
					return false
				}
				imported := x.Name().Text()
				if x.PropertyName != nil {
					imported = x.PropertyName.Text()
				}
				return governanceIntegrationBinding(project, target, imported, true, next, owners)
			}
		}
	}
	if exported {
		targets := map[*governedFile]bool{}
		for _, stmt := range file.Source.Statements.Nodes {
			if stmt.Kind != ast.KindExportDeclaration {
				continue
			}
			e := stmt.AsExportDeclaration()
			if e.IsTypeOnly || e.ExportClause != nil || e.ModuleSpecifier == nil || e.ModuleSpecifier.Kind != ast.KindStringLiteral {
				continue
			}
			target := project.resolveProjectImport(file, e.ModuleSpecifier.Text())
			if target == nil {
				return false
			}
			targets[target] = true
		}
		if len(targets) == 1 {
			for target := range targets {
				return governanceIntegrationBinding(project, target, name, true, next, owners)
			}
		}
	}
	return false
}
func governanceIntegrationModuleEvidence(file *governedFile) []governanceEvidence {
	rule := "ROOT-COMPOSE"
	out := []governanceEvidence{}
	for _, stmt := range file.Source.Statements.Nodes {
		switch stmt.Kind {
		case ast.KindImportDeclaration, ast.KindExportDeclaration, ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindEmptyStatement, ast.KindFunctionDeclaration:
			continue
		}
		if stmt.Kind == ast.KindClassDeclaration {
			c := stmt.AsClassDeclaration()
			accepted := true
			if c.HeritageClauses != nil {
				for _, clause := range c.HeritageClauses.Nodes {
					for _, t := range clause.AsHeritageClause().Types.Nodes {
						e := t.AsExpressionWithTypeArguments().Expression
						accepted = accepted && e.Kind == ast.KindIdentifier && e.Text() == "Error"
					}
				}
			}
			for _, member := range c.Members.Nodes {
				n := member.Name()
				if n != nil && n.Kind == ast.KindComputedPropertyName && !governancePrimitiveCompositionKey(n.AsComputedPropertyName().Expression) {
					accepted = false
				}
				if member.Kind == ast.KindClassStaticBlockDeclaration {
					accepted = false
				}
				if member.Kind == ast.KindPropertyDeclaration && member.AsPropertyDeclaration().Initializer != nil && !governanceIntegrationStaticValue(file, member.AsPropertyDeclaration().Initializer) {
					accepted = false
				}
			}
			if accepted {
				continue
			}
		}
		expressions := []*ast.Node{}
		if stmt.Kind == ast.KindVariableStatement {
			for _, d := range stmt.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				var expression *ast.Node
				if d.Name().Kind == ast.KindIdentifier {
					expression = d.AsVariableDeclaration().Initializer
				}
				expressions = append(expressions, expression)
			}
		} else if stmt.Kind == ast.KindExportAssignment {
			expressions = append(expressions, stmt.AsExportAssignment().Expression)
		}
		accepted := len(expressions) > 0
		for _, expression := range expressions {
			accepted = accepted && expression != nil && governanceIntegrationStaticValue(file, expression)
		}
		if accepted {
			continue
		}
		eagerIO := false
		var inspect func(*ast.Node)
		inspect = func(n *ast.Node) {
			if ast.IsFunctionLike(n) {
				name := n.Name()
				if name != nil && name.Kind == ast.KindComputedPropertyName {
					inspect(name.AsComputedPropertyName().Expression)
				}
				return
			}
			if n.Kind == ast.KindCallExpression {
				callee := authored.Unwrap(n.AsCallExpression().Expression)
				if callee.Kind == ast.KindIdentifier && authored.Contains([]string{"fetch", "require", "setTimeout", "setInterval"}, callee.Text()) && !governanceLocallyOwned(callee, true) || callee.Kind == ast.KindImportKeyword {
					eagerIO = true
				}
			}
			n.ForEachChild(func(child *ast.Node) bool { inspect(child); return false })
		}
		inspect(stmt)
		message := "Integration composition module has an unproved eager expression."
		kind := "ambiguity"
		if eagerIO {
			message = "Integration composition module contains eager IO outside declarative construction."
			kind = "violation"
		}
		e := governanceViolation(rule, file, stmt, message)
		e.Kind = kind
		out = append(out, e)
	}
	return out
}
func governanceIntegrationCompositionEvidence(project *governedProject, file *governedFile, imp governanceImport) []governanceEvidence {
	erased := map[string]bool{}
	if imp.Node != nil && imp.Node.Kind == ast.KindImportDeclaration {
		clause := imp.Node.AsImportDeclaration().ImportClause
		if clause != nil {
			bindings := clause.AsImportClause().NamedBindings
			if bindings != nil && bindings.Kind == ast.KindNamedImports {
				for _, b := range bindings.AsNamedImports().Elements.Nodes {
					x := b.AsImportSpecifier()
					if x.IsTypeOnly {
						name := x.Name().Text()
						if x.PropertyName != nil {
							name = x.PropertyName.Text()
						}
						erased[name] = true
					}
				}
			}
		}
	}
	names := []string{}
	for _, binding := range imp.Bindings {
		if !erased[binding.Imported] {
			names = append(names, binding.Imported)
		}
	}
	ambiguity := func(message string) governanceEvidence {
		e := governanceViolation("ROOT-COMPOSE", file, file.Source.AsNode(), message)
		e.Kind = "ambiguity"
		return e
	}
	if imp.Namespace != "" || len(names) == 0 {
		return []governanceEvidence{ambiguity("Composition import has no exact Integration binding provenance.")}
	}
	out := []governanceEvidence{}
	owners := []*governedFile{file}
	for _, name := range names {
		if !governanceIntegrationBinding(project, file, name, true, map[string]bool{}, &owners) {
			out = append(out, ambiguity(fmt.Sprintf("Imported %s cannot be traced to the canonical SDK defineIntegration constructor.", name)))
		}
	}
	for _, owner := range owners {
		out = append(out, governanceIntegrationModuleEvidence(owner)...)
	}
	return out
}
