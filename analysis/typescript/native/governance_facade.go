package main

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

func governanceImportForLocal(file *governedFile, name string) *governanceImport {
	for i := range file.Imports {
		imp := &file.Imports[i]
		if imp.Namespace == name {
			return imp
		}
		for _, binding := range imp.Bindings {
			if binding.Local == name {
				return imp
			}
		}
	}
	return nil
}
func governanceTypeOnlyBinding(imp *governanceImport, name string) bool {
	if imp.Node == nil || imp.Node.Kind != ast.KindImportDeclaration {
		return false
	}
	clause := imp.Node.AsImportDeclaration().ImportClause
	if clause == nil {
		return false
	}
	c := clause.AsImportClause()
	if c.IsTypeOnly() {
		return true
	}
	bindings := c.NamedBindings
	if bindings != nil && bindings.Kind == ast.KindNamedImports {
		for _, node := range bindings.AsNamedImports().Elements.Nodes {
			e := node.AsImportSpecifier()
			if e.Name().Text() == name && e.IsTypeOnly {
				return true
			}
		}
	}
	return false
}
func governanceErasedExports(project *governedProject, file *governedFile) map[string]bool {
	names := map[string]bool{}
	if project.verbatim {
		return names
	}
	for _, stmt := range file.Source.Statements.Nodes {
		if stmt.Kind == ast.KindInterfaceDeclaration || stmt.Kind == ast.KindTypeAliasDeclaration {
			names[stmt.Name().Text()] = true
		}
	}
	var remove func(*ast.Node)
	remove = func(name *ast.Node) {
		if name == nil {
			return
		}
		if name.Kind == ast.KindIdentifier {
			delete(names, name.Text())
			return
		}
		if name.Kind == ast.KindArrayBindingPattern || name.Kind == ast.KindObjectBindingPattern {
			for _, e := range name.AsBindingPattern().Elements.Nodes {
				if e.Kind == ast.KindBindingElement {
					remove(e.Name())
				}
			}
		}
	}
	for _, stmt := range file.Source.Statements.Nodes {
		if stmt.Kind == ast.KindVariableStatement {
			for _, decl := range stmt.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				remove(decl.Name())
			}
		} else if stmt.Kind == ast.KindClassDeclaration || stmt.Kind == ast.KindFunctionDeclaration || stmt.Kind == ast.KindEnumDeclaration || stmt.Kind == ast.KindModuleDeclaration || stmt.Kind == ast.KindImportEqualsDeclaration {
			name := stmt.Name()
			if name != nil && name.Kind == ast.KindIdentifier {
				delete(names, name.Text())
			}
		}
	}
	for _, imp := range file.Imports {
		for _, binding := range imp.Bindings {
			delete(names, binding.Local)
		}
		delete(names, imp.Namespace)
	}
	return names
}
func governanceLayerFacadeObject(project *governedProject, file *governedFile, expression *ast.Node) bool {
	target := authored.Unwrap(expression)
	if target.Kind == ast.KindCallExpression && target.AsCallExpression().Arguments != nil && len(target.AsCallExpression().Arguments.Nodes) == 1 {
		callee := authored.Unwrap(target.AsCallExpression().Expression)
		if callee.Kind == ast.KindPropertyAccessExpression {
			p := callee.AsPropertyAccessExpression()
			if p.Expression.Kind == ast.KindIdentifier && p.Expression.Text() == "Object" && p.Name().Text() == "freeze" && !governanceLocallyOwned(p.Expression, true) {
				target = authored.Unwrap(authored.Argument(target, 0))
			}
		}
	}
	if target.Kind != ast.KindObjectLiteralExpression {
		return false
	}
	owners := map[string]bool{}
	for _, property := range target.AsObjectLiteralExpression().Properties.Nodes {
		var value *ast.Node
		if property.Kind == ast.KindShorthandPropertyAssignment && property.AsShorthandPropertyAssignment().ObjectAssignmentInitializer == nil {
			value = property.Name()
		} else if property.Kind == ast.KindPropertyAssignment && property.Name().Kind != ast.KindComputedPropertyName {
			value = authored.Unwrap(property.AsPropertyAssignment().Initializer)
		}
		if value == nil || value.Kind != ast.KindIdentifier {
			return false
		}
		imp := governanceImportForLocal(file, value.Text())
		if imp == nil || imp.TypeOnly || governanceTypeOnlyBinding(imp, value.Text()) {
			return false
		}
		owner := project.resolveProjectImport(file, imp.Specifier)
		if owner == nil || owner.Layer != file.Layer {
			return false
		}
		owners[owner.Path] = true
	}
	return len(owners) > 0
}
func governanceLayerFacadeNames(project *governedProject, file *governedFile) map[string]bool {
	names := map[string]bool{}
	for _, stmt := range file.Source.Statements.Nodes {
		if stmt.Kind != ast.KindVariableStatement || stmt.ModifierFlags()&ast.ModifierFlagsExport == 0 {
			continue
		}
		list := stmt.AsVariableStatement().DeclarationList
		if list.Flags&ast.NodeFlagsConst == 0 {
			continue
		}
		for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
			decl := d.AsVariableDeclaration()
			if decl.Name().Kind == ast.KindIdentifier && decl.Initializer != nil && governanceLayerFacadeObject(project, file, decl.Initializer) {
				names[decl.Name().Text()] = true
			}
		}
	}
	return names
}
func governanceRootFacade(project *governedProject) governanceOutcome {
	rule := "ROOT-FACADE"
	out := governanceOutcome{Rule: rule, Revision: governanceRevisions[rule], Status: "pass", Findings: []governanceEvidence{}}
	emit := func(file *governedFile, node *ast.Node, kind, message string) {
		e := governanceViolation(rule, file, node, message)
		e.Kind = kind
		out.Findings = append(out.Findings, e)
		if kind == "violation" {
			out.Status = "fail"
		} else if out.Status == "pass" {
			out.Status = "indeterminate"
		}
	}
	for _, file := range project.Files {
		if file.Role != "production" {
			continue
		}
		out.SubjectCount++
		if file.Layer == "" || file.Submodule != "" {
			continue
		}
		relative := file.Path
		for _, layer := range project.Policy.Layers {
			if layer.ID == file.Layer {
				relative = strings.TrimPrefix(file.Path, layer.SourcePath)
				break
			}
		}
		if relative != "index.ts" && relative != "index.tsx" {
			continue
		}
		facades := governanceLayerFacadeNames(project, file)
		erased := governanceErasedExports(project, file)
		for _, stmt := range file.Source.Statements.Nodes {
			switch stmt.Kind {
			case ast.KindImportDeclaration, ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration, ast.KindEmptyStatement:
				continue
			case ast.KindExportDeclaration:
				export := stmt.AsExportDeclaration()
				erasedImport := false
				for _, imp := range file.Imports {
					if imp.Node == stmt {
						erasedImport = imp.TypeOnly
						break
					}
				}
				if export.IsTypeOnly || erasedImport {
					continue
				}
				if export.ModuleSpecifier != nil && export.ModuleSpecifier.Kind == ast.KindStringLiteral {
					specifier := export.ModuleSpecifier.Text()
					target := project.resolveProjectImport(file, specifier)
					if target == nil {
						kind := "violation"
						message := fmt.Sprintf("Layer index re-exports external package %s.", specifier)
						if strings.HasPrefix(specifier, ".") || strings.HasPrefix(specifier, "#") {
							kind = "ambiguity"
							message = fmt.Sprintf("Layer index export %s cannot be resolved.", specifier)
						}
						emit(file, stmt, kind, message)
					} else if target.Layer != file.Layer {
						emit(file, stmt, "violation", fmt.Sprintf("Layer index export targets source outside its layer: %s.", target.Path))
					}
				} else if export.ExportClause != nil && export.ExportClause.Kind == ast.KindNamedExports {
					for _, node := range export.ExportClause.AsNamedExports().Elements.Nodes {
						element := node.AsExportSpecifier()
						local := element.Name().Text()
						if element.PropertyName != nil {
							local = element.PropertyName.Text()
						}
						if element.IsTypeOnly || erased[local] {
							continue
						}
						imp := governanceImportForLocal(file, local)
						if imp == nil {
							emit(file, node, "ambiguity", fmt.Sprintf("Layer index export %s has no statically resolved import owner.", element.Name().Text()))
							continue
						}
						if governanceTypeOnlyBinding(imp, local) {
							if project.verbatim {
								emit(file, node, "ambiguity", fmt.Sprintf("Export %s retains a runtime binding from a type-only import; use export type.", element.Name().Text()))
							}
							continue
						}
						target := project.resolveProjectImport(file, imp.Specifier)
						if target == nil {
							kind := "violation"
							message := fmt.Sprintf("Layer index exports external package %s.", imp.Specifier)
							if strings.HasPrefix(imp.Specifier, ".") || strings.HasPrefix(imp.Specifier, "#") {
								kind = "ambiguity"
								message = fmt.Sprintf("Layer index import %s cannot be resolved.", imp.Specifier)
							}
							emit(file, node, kind, message)
						} else if target.Layer != file.Layer {
							emit(file, node, "violation", fmt.Sprintf("Layer index export targets source outside its layer: %s.", target.Path))
						}
					}
				}
				continue
			}
			if stmt.Kind == ast.KindVariableStatement && stmt.ModifierFlags()&ast.ModifierFlagsExport != 0 {
				accepted := true
				for _, decl := range stmt.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
					accepted = accepted && decl.Name().Kind == ast.KindIdentifier && facades[decl.Name().Text()]
				}
				if accepted {
					continue
				}
			}
			emit(file, stmt, "violation", fmt.Sprintf("Layer index %s owns behavior or an unproved declaration instead of re-exporting local owners or grouping imported values.", file.Path))
		}
	}
	return out
}
