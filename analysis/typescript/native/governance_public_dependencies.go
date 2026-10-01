package main

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

func governancePublicDependencies(project *governedProject) governanceOutcome {
	rule := "DOM-PUBLIC-DEPS"
	out := governanceOutcome{Rule: rule, Revision: governanceRevisions[rule], Status: "pass", Findings: []governanceEvidence{}}
	facades := map[string]bool{}
	packages := map[string]bool{}
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
		if file.Layer != "schema" {
			continue
		}
		for _, definition := range file.authoring().Definitions("defineSchema", "", authored.DSLModules, 1) {
			if definition.Origin == "ambiguous" {
				emit(file, definition.Call, "ambiguity", "Schema definition resolves through a local facade whose ultimate public constructor origin is unknown.")
				continue
			}
			if definition.Object == nil {
				emit(file, definition.Call, "ambiguity", "defineSchema contract is not a static object literal.")
				continue
			}
			dependencies := authored.PropertyExpression(definition.Object, "dependencies")
			if dependencies == nil {
				continue
			}
			if dependencies.Kind != ast.KindObjectLiteralExpression {
				emit(file, dependencies, "ambiguity", "Schema dependencies are not a static object.")
				continue
			}
			for _, property := range dependencies.AsObjectLiteralExpression().Properties.Nodes {
				var element *ast.Node
				switch property.Kind {
				case ast.KindPropertyAssignment:
					element = property.AsPropertyAssignment().Initializer
				case ast.KindShorthandPropertyAssignment:
					element = property.AsShorthandPropertyAssignment().Name()
				}
				if element == nil {
					emit(file, property, "ambiguity", "Schema dependency is not one statically aliased Domain facade.")
					continue
				}
				symbol, ok := governanceDependencySchemaSymbol(file, element)
				if ok && symbol.Module == "@astrale-os/sdk/schema" && symbol.Name == "KernelSchema" {
					continue
				}
				if ok && governanceExternalPackage(symbol.Module) {
					facades[symbol.Module] = true
					packages[governancePackageRoot(symbol.Module)] = true
				} else {
					emit(file, property, "ambiguity", "Schema dependency cannot be mapped to one foreign Domain facade.")
				}
			}
		}
	}
	type reference struct {
		file *governedFile
		node *ast.Node
	}
	references := map[string]reference{}
	order := []string{}
	for _, file := range project.Files {
		if file.Role != "production" || !authored.Contains([]string{"schema", "queries", "mutations"}, file.Layer) {
			continue
		}
		if file.Layer == "queries" || file.Layer == "mutations" {
			names := []string{"defineMutation"}
			if file.Layer == "queries" {
				names = []string{"defineCollectionQuery", "defineQuery", "defineCompositeQuery"}
			}
			for _, name := range names {
				for _, definition := range file.authoring().Definitions(name, "", nil, 0) {
					if definition.Projector != nil {
						for _, node := range governanceTransitiveSelections(definition.Projector) {
							emit(file, node, "violation", "Graph authoring selects a transitive Domain independently; declare and use one exact root dependency alias.")
						}
					}
				}
			}
		}
		for _, imp := range file.Imports {
			if !governanceForeignDomain(imp.Specifier) && !packages[governancePackageRoot(imp.Specifier)] {
				continue
			}
			if file.Layer == "queries" || file.Layer == "mutations" {
				emit(file, imp.Node, "violation", fmt.Sprintf("Graph authoring imports %s directly; use the root Domain projector and its declared dependency alias.", governancePackageRoot(imp.Specifier)))
				continue
			}
			if _, ok := references[imp.Specifier]; !ok {
				order = append(order, imp.Specifier)
			}
			references[imp.Specifier] = reference{file, imp.Node}
		}
	}
	for _, facade := range order {
		if !facades[facade] {
			ref := references[facade]
			emit(ref.file, ref.node, "violation", fmt.Sprintf("Graph reference to %s lacks one exact defineSchema dependency.", facade))
		}
	}
	return out
}
func governanceExternalPackage(m string) bool {
	return !strings.HasPrefix(m, ".") && !strings.HasPrefix(m, "#") && !strings.HasPrefix(m, "@astrale-os/sdk") && !strings.HasPrefix(m, "@astrale-os/kernel-core") && !strings.HasPrefix(m, "@astrale-os/kernel-dsl")
}
func governancePackageRoot(m string) string {
	p := strings.Split(m, "/")
	if strings.HasPrefix(m, "@") {
		return strings.Join(p[:min(2, len(p))], "/")
	}
	return p[0]
}
func governanceDependencySchemaSymbol(file *governedFile, expression *ast.Node) (authored.Origin, bool) {
	target := authored.Unwrap(expression)
	if direct, ok := file.authoring().ImportedSymbol(target); ok || target.Kind != ast.KindIdentifier {
		return direct, ok
	}
	declarations := []*ast.Node{}
	for _, statement := range file.Source.Statements.Nodes {
		if statement.Kind != ast.KindVariableStatement {
			continue
		}
		list := statement.AsVariableStatement().DeclarationList
		if list.Flags&ast.NodeFlagsConst == 0 {
			continue
		}
		for _, decl := range list.AsVariableDeclarationList().Declarations.Nodes {
			if decl.Name().Kind == ast.KindIdentifier && decl.Name().Text() == target.Text() {
				declarations = append(declarations, decl)
			}
		}
	}
	if len(declarations) != 1 {
		return authored.Origin{}, false
	}
	accepted := authored.Unwrap(declarations[0].AsVariableDeclaration().Initializer)
	if accepted == nil || accepted.Kind != ast.KindCallExpression {
		return authored.Origin{}, false
	}
	callee := authored.Unwrap(accepted.AsCallExpression().Expression)
	if callee.Kind != ast.KindPropertyAccessExpression || callee.AsPropertyAccessExpression().Name().Text() != "accept" {
		return authored.Origin{}, false
	}
	owner := file.authoring().ResolveImportedSymbol(callee.AsPropertyAccessExpression().Expression)
	if owner.Kind != "resolved" || owner.Name != "schema" || !(owner.Module == "@astrale-os/sdk/schema" || owner.Module == "@astrale-os/kernel-dsl" || strings.HasPrefix(owner.Module, "@astrale-os/kernel-dsl/")) {
		return authored.Origin{}, false
	}
	admitted := authored.Argument(accepted, 0)
	if admitted == nil {
		return authored.Origin{}, false
	}
	return file.authoring().ImportedSymbol(authored.Unwrap(admitted))
}
func governanceStaticAccessChain(expression *ast.Node) []string {
	v := authored.Unwrap(expression)
	if v == nil {
		return nil
	}
	switch v.Kind {
	case ast.KindIdentifier:
		return []string{v.Text()}
	case ast.KindPropertyAccessExpression:
		base := governanceStaticAccessChain(v.AsPropertyAccessExpression().Expression)
		if base != nil {
			return append(base, v.AsPropertyAccessExpression().Name().Text())
		}
	case ast.KindElementAccessExpression:
		e := v.AsElementAccessExpression()
		base := governanceStaticAccessChain(e.Expression)
		key := authored.Unwrap(e.ArgumentExpression)
		if base != nil && key != nil && (key.Kind == ast.KindStringLiteral || key.Kind == ast.KindNoSubstitutionTemplateLiteral) {
			return append(base, key.Text())
		}
	}
	return nil
}
func governanceTransitiveSelections(projector *ast.Node) []*ast.Node {
	params := projector.Parameters()
	if len(params) == 0 || params[0].Name().Kind != ast.KindIdentifier || projector.Body() == nil {
		return nil
	}
	domain := params[0].Name().Text()
	aliases := map[string]bool{}
	walk := func(callback func(*ast.Node)) {
		var visit func(*ast.Node)
		visit = func(node *ast.Node) {
			callback(node)
			if node != projector.Body() && ast.IsFunctionLike(node) {
				return
			}
			node.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
		}
		visit(projector.Body())
	}
	walk(func(node *ast.Node) {
		if node.Kind != ast.KindVariableDeclaration || node.AsVariableDeclaration().Initializer == nil {
			return
		}
		chain := governanceStaticAccessChain(node.AsVariableDeclaration().Initializer)
		name := node.Name()
		if name.Kind == ast.KindIdentifier {
			if len(chain) == 3 && chain[0] == domain && chain[1] == "dependencies" {
				aliases[name.Text()] = true
			}
			return
		}
		if name.Kind == ast.KindObjectBindingPattern && len(chain) == 2 && chain[0] == domain && chain[1] == "dependencies" {
			for _, element := range name.AsBindingPattern().Elements.Nodes {
				e := element.AsBindingElement()
				if e.DotDotDotToken == nil && e.Name().Kind == ast.KindIdentifier {
					aliases[e.Name().Text()] = true
				}
			}
		}
	})
	out := []*ast.Node{}
	walk(func(node *ast.Node) {
		if node.Kind != ast.KindPropertyAccessExpression && node.Kind != ast.KindElementAccessExpression {
			return
		}
		parent := node.Parent
		if parent != nil && (parent.Kind == ast.KindPropertyAccessExpression || parent.Kind == ast.KindElementAccessExpression) && authored.Unwrap(parent.Expression()) == node {
			return
		}
		chain := governanceStaticAccessChain(node)
		count := 0
		for _, part := range chain {
			if part == "dependencies" {
				count++
			}
		}
		if count > 0 && len(chain) > 0 && (chain[0] == domain && count > 1 || aliases[chain[0]]) {
			out = append(out, node)
		}
	})
	return out
}
func governanceForeignDomain(m string) bool {
	root := governancePackageRoot(m)
	return strings.HasPrefix(m, "@astrale-domains/") || root == "domain" || strings.HasSuffix(root, "-domain") || strings.HasSuffix(root, "/domain")
}
