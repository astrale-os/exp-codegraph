package main

import (
	"astrale-typespec-v2-native-analysis/authoredsource"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

var governanceCanonicalTypes = []string{"ClassKey", "ClassRef", "IdentityId", "MutationAST", "NodeId", "Path", "PropertyKey", "QueryAST", "QueryResult"}

func governanceCanonicalModule(module string) bool {
	return module == "@astrale-os/kernel-core" || strings.HasPrefix(module, "@astrale-os/kernel-core/") || module == "@astrale-os/sdk/auth" || module == "@astrale-os/sdk/mutation" || module == "@astrale-os/sdk/query" || module == "@astrale-os/sdk/schema" || module == "@astrale-os/kernel-dsl" || strings.HasPrefix(module, "@astrale-os/kernel-dsl/") || strings.HasPrefix(module, "@astrale-os/sdk/graph")
}
func governanceCanonicalTypeName(file *governedFile, name *ast.Node) string {
	if name.Kind == ast.KindIdentifier {
		symbol, ok := file.authoring().ImportedSymbol(name)
		if ok && authoredsource.Contains(governanceCanonicalTypes, symbol.Name) && governanceCanonicalModule(symbol.Module) {
			return symbol.Name
		}
		return ""
	}
	if name.Kind != ast.KindQualifiedName {
		return ""
	}
	right := name.AsQualifiedName().Right.Text()
	left := name
	for left.Kind == ast.KindQualifiedName {
		left = left.AsQualifiedName().Left
	}
	module, ok := file.authoring().NamespaceModule(left.Text())
	if ok && authoredsource.Contains(governanceCanonicalTypes, right) && governanceCanonicalModule(module) {
		return right
	}
	return ""
}
func governanceGlobalSyntax(project *governedProject, rule string) governanceOutcome {
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
		if rule == "QLT-TYPED-COORD" && file.Layer != "queries" && file.Layer != "mutations" {
			continue
		}
		if rule == "NODE-INHERITED" && file.Layer != "schema" {
			continue
		}
		out.SubjectCount++
		switch rule {
		case "QLT-TYPED-COORD":
			authoredsource.Walk(file.Source.AsNode(), func(node *ast.Node) {
				if node.Kind != ast.KindCallExpression {
					return
				}
				call := node.AsCallExpression()
				symbol := file.authoring().ResolveImportedSymbol(call.Expression)
				schemaModule := symbol.Module == "@astrale-os/sdk" || symbol.Module == "@astrale-os/sdk/schema" || symbol.Module == "@astrale-os/kernel-dsl" || strings.HasPrefix(symbol.Module, "@astrale-os/kernel-dsl/")
				if symbol.Kind == "resolved" && (symbol.Name == "ClassKey" || symbol.Name == "PropertyKey") && schemaModule {
					emit(file, node, "violation", fmt.Sprintf("Graph %s coordinate is constructed from a raw key; derive it from the Query or Mutation Domain projection.", symbol.Name))
					return
				}
				expression := authoredsource.Unwrap(call.Expression)
				if expression.Kind != ast.KindPropertyAccessExpression || expression.AsPropertyAccessExpression().Name().Text() != "from" || authoredsource.ObjectArgument(node, 0) == nil {
					return
				}
				owner := file.authoring().ResolveImportedSymbol(expression.AsPropertyAccessExpression().Expression)
				if owner.Kind == "resolved" && owner.Name == "ClassPath" && (strings.HasPrefix(owner.Module, "@astrale-os/sdk/graph") || governanceCanonicalModule(owner.Module)) {
					emit(file, node, "violation", "Graph ClassPath is constructed from a structural object; derive it from a rich Domain definition.")
				}
			})
		case "QLT-CANON-VALUES":
			authoredsource.Walk(file.Source.AsNode(), func(node *ast.Node) {
				if node.Kind != ast.KindAsExpression && node.Kind != ast.KindTypeAssertionExpression {
					return
				}
				typ := node.Type()
				if typ == nil || typ.Kind != ast.KindTypeReference {
					return
				}
				name := governanceCanonicalTypeName(file, typ.AsTypeReferenceNode().TypeName)
				if name != "" {
					emit(file, node, "violation", fmt.Sprintf("Unchecked cast fabricates canonical %s; use its owning constructor or decoder.", name))
				}
			})
		case "NODE-INHERITED":
			for _, definition := range file.authoring().Definitions("nodeClass", "", authoredsource.DSLModules, 0) {
				if definition.Origin == "ambiguous" {
					emit(file, definition.Call, "ambiguity", "nodeClass declaration resolves through a local facade whose ultimate public constructor origin is unknown.")
					continue
				}
				if definition.Object == nil {
					if callArgs := definition.Call.AsCallExpression().Arguments; callArgs != nil && len(callArgs.Nodes) > 0 {
						emit(file, definition.Call, "ambiguity", "nodeClass input is not a static object literal.")
					}
					continue
				}
				properties := authoredsource.PropertyExpression(definition.Object, "properties")
				if properties == nil {
					continue
				}
				if properties.Kind != ast.KindObjectLiteralExpression {
					emit(file, properties, "ambiguity", "Node properties are not a static object literal.")
					continue
				}
				for _, property := range properties.AsObjectLiteralExpression().Properties.Nodes {
					name := property.Name()
					if name != nil && (name.Kind == ast.KindIdentifier || name.Kind == ast.KindStringLiteral) && authoredsource.Contains([]string{"name", "description", "createdAt", "updatedAt"}, name.Text()) {
						emit(file, property, "violation", fmt.Sprintf("Node Class redeclares inherited property %s.", name.Text()))
					}
				}
			}
		}
	}
	return out
}
