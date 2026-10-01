package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

// DependencyBoundary is the bounded SDK declaration vocabulary, not an effect
// interpreter. Known distinguishes unavailable capture authority from unknown
// authored source (the latter is an actual public ambiguity outcome).
func DependencyBoundary(project *Project, file *File, imp Import) (string, bool) {
	if imp.TypeOnly {
		return "erased", true
	}
	resolution := project.Resolve(file, imp)
	if !resolution.Known {
		return "", false
	}
	if file.Layer != "rules" || resolution.Target == nil || resolution.Target.Layer != "schema" {
		return "runtime", true
	}
	proof, known := closedSchemaData(project, resolution.Target, map[string]bool{})
	if !known {
		return "", false
	}
	if proof == "pure" {
		return "pure-schema", true
	}
	if proof == "unknown" {
		return "ambiguous", true
	}
	return "runtime", true
}
func closedSchemaData(project *Project, file *File, active map[string]bool) (string, bool) {
	if active[file.Path] {
		return "unknown", true
	}
	active[file.Path] = true
	defer delete(active, file.Path)
	unknown := false
	for _, stmt := range file.Source.Statements.Nodes {
		switch stmt.Kind {
		case ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindEmptyStatement:
			continue
		case ast.KindImportDeclaration:
			var imp *Import
			for i := range file.Imports {
				if file.Imports[i].Node == stmt {
					imp = &file.Imports[i]
					break
				}
			}
			if imp == nil {
				return "unknown", true
			}
			if imp.TypeOnly {
				continue
			}
			if imp.Specifier == "@astrale-os/sdk/state" {
				clause := stmt.AsImportDeclaration().ImportClause
				if clause == nil {
					return "effect", true
				}
				c := clause.AsImportClause()
				if c.Name() != nil || c.NamedBindings == nil || c.NamedBindings.Kind != ast.KindNamedImports {
					return "effect", true
				}
				for _, element := range c.NamedBindings.AsNamedImports().Elements.Nodes {
					e := element.AsImportSpecifier()
					name := e.Name()
					if e.PropertyName != nil {
						name = e.PropertyName
					}
					if !e.IsTypeOnly && name.Text() != "stateMachine" {
						return "effect", true
					}
				}
				continue
			}
			resolution := project.Resolve(file, *imp)
			if !resolution.Known {
				return "", false
			}
			if resolution.Target == nil {
				unknown = true
				continue
			}
			if resolution.Target.Layer != "schema" {
				return "effect", true
			}
			proof, known := closedSchemaData(project, resolution.Target, active)
			if !known {
				return "", false
			}
			if proof == "effect" {
				return proof, true
			}
			unknown = unknown || proof == "unknown"
			continue
		case ast.KindExportDeclaration:
			e := stmt.AsExportDeclaration()
			if e.IsTypeOnly || e.ModuleSpecifier == nil {
				continue
			}
			if e.ModuleSpecifier.Kind != ast.KindStringLiteral {
				return "unknown", true
			}
			resolution := project.Resolve(file, Import{Specifier: e.ModuleSpecifier.Text()})
			if !resolution.Known {
				return "", false
			}
			if resolution.Target == nil {
				unknown = true
				continue
			}
			if resolution.Target.Layer != "schema" {
				return "effect", true
			}
			proof, known := closedSchemaData(project, resolution.Target, active)
			if !known {
				return "", false
			}
			if proof == "effect" {
				return proof, true
			}
			unknown = unknown || proof == "unknown"
			continue
		}
		if stmt.Kind != ast.KindVariableStatement {
			return "effect", true
		}
		list := stmt.AsVariableStatement().DeclarationList
		if list.Flags&ast.NodeFlagsConst == 0 {
			return "effect", true
		}
		for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
			decl := d.AsVariableDeclaration()
			if decl.Name().Kind != ast.KindIdentifier {
				return "effect", true
			}
			if decl.Initializer == nil {
				return "unknown", true
			}
			value := authored.Unwrap(decl.Initializer)
			if staticSchemaData(value) {
				continue
			}
			if value.Kind == ast.KindCallExpression {
				call := value.AsCallExpression()
				origin := StateMachineConstructorOrigin(project, file, call.Expression)
				if origin == "ambiguous" {
					unknown = true
					continue
				}
				if origin == "resolved" && call.Arguments != nil && len(call.Arguments.Nodes) == 1 && staticSchemaData(call.Arguments.Nodes[0]) {
					continue
				}
				return "effect", true
			}
			unknown = true
		}
	}
	if unknown {
		return "unknown", true
	}
	return "pure", true
}
func staticSchemaData(expression *ast.Node) bool {
	value := authored.Unwrap(expression)
	if value == nil {
		return false
	}
	switch value.Kind {
	case ast.KindStringLiteral, ast.KindNoSubstitutionTemplateLiteral, ast.KindNumericLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword:
		return true
	case ast.KindArrayLiteralExpression:
		for _, element := range value.AsArrayLiteralExpression().Elements.Nodes {
			if element.Kind == ast.KindSpreadElement || !staticSchemaData(element) {
				return false
			}
		}
		return true
	case ast.KindObjectLiteralExpression:
		for _, property := range value.AsObjectLiteralExpression().Properties.Nodes {
			if property.Kind != ast.KindPropertyAssignment {
				return false
			}
			p := property.AsPropertyAssignment()
			if p.Name().Kind == ast.KindComputedPropertyName || !staticSchemaData(p.Initializer) {
				return false
			}
		}
		return true
	}
	return false
}
