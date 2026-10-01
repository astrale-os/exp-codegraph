package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

type actionRegistry struct {
	kind, message string
	ambiguous     bool
}

func actionLocalInitializer(source *ast.SourceFile, name string) *ast.Node {
	var result *ast.Node
	authored.Walk(source.AsNode(), func(node *ast.Node) {
		if result == nil && node.Kind == ast.KindVariableDeclaration && node.Name().Kind == ast.KindIdentifier && node.Name().Text() == name && node.AsVariableDeclaration().Initializer != nil {
			result = authored.Unwrap(node.AsVariableDeclaration().Initializer)
		}
	})
	return result
}
func actionObjectValues(project *Project, file *File, expression *ast.Node, out *Result) actionRegistry {
	not := actionRegistry{kind: "not-object-values"}
	if expression.Kind != ast.KindCallExpression {
		return not
	}
	call := expression.AsCallExpression()
	access := authored.Unwrap(call.Expression)
	if access == nil || access.Kind != ast.KindPropertyAccessExpression || file.Source.Text()[scanner.GetTokenPosOfNode(access, file.Source, false):access.End()] != "Object.values" || call.Arguments == nil || len(call.Arguments.Nodes) != 1 {
		return not
	}
	binding := authored.Unwrap(call.Arguments.Nodes[0])
	invalid := func(message string, ambiguous bool) actionRegistry {
		return actionRegistry{"invalid", message, ambiguous}
	}
	if binding.Kind != ast.KindIdentifier {
		return invalid("Object.values Functions registry must use one imported Functions facade.", false)
	}
	symbol, ok := project.Authored(file).ImportedSymbol(binding)
	module := ""
	if ok {
		module = symbol.Module
	}
	if module == "" {
		module, _ = project.Authored(file).NamespaceModule(binding.Text())
	}
	var target *File
	if module != "" {
		var known bool
		target, known = familyResolve(project, file, module, "FNC-ONE-IMPL", out)
		if !known {
			return actionRegistry{kind: "residual"}
		}
	}
	if target == nil || target.Layer != "functions" || target.Submodule != "" {
		return invalid("Object.values Functions registry must resolve to the Functions layer facade.", target == nil)
	}
	exported := 0
	for _, statement := range target.Source.Statements.Nodes {
		if statement.Kind == ast.KindExportDeclaration {
			d := statement.AsExportDeclaration()
			if d.ModuleSpecifier == nil || d.ModuleSpecifier.Kind != ast.KindStringLiteral || d.ExportClause == nil || d.ExportClause.Kind != ast.KindNamedExports {
				return invalid("Functions facade must use explicit named re-exports from semantic submodules.", false)
			}
			owner, known := familyResolve(project, target, d.ModuleSpecifier.Text(), "FNC-ONE-IMPL", out)
			if !known {
				return actionRegistry{kind: "residual"}
			}
			if owner == nil {
				return invalid("Functions facade re-export owner cannot be resolved.", true)
			}
			if owner.Layer != "functions" || owner.Submodule == "" {
				return invalid("Functions facade re-exports a value without one semantic Functions submodule owner.", false)
			}
			exported += len(d.ExportClause.AsNamedExports().Elements.Nodes)
			continue
		}
		if statement.Kind == ast.KindExportAssignment || ast.GetCombinedModifierFlags(statement)&ast.ModifierFlagsExport != 0 {
			return invalid("Functions facade exports a root-owned value without a semantic submodule owner.", false)
		}
	}
	if exported > 0 {
		return actionRegistry{kind: "valid"}
	}
	return invalid("Functions facade exports no statically owned Function bindings.", false)
}
func EvaluateActions(project *Project) Result {
	out := familyResult()
	if project.CompositionPaths == nil {
		familyMissing(&out, "FNC-ONE-IMPL", nil, nil, "Captured composition-root policy is unavailable.")
		return out
	}
	registered := map[string]bool{}
	for _, file := range familyProduction(project, "") {
		if !project.CompositionPaths[file.Path] {
			continue
		}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			factory := authored.Unwrap(node.AsCallExpression().Expression)
			if factory.Kind != ast.KindCallExpression {
				return
			}
			symbol, ok := project.Authored(file).ImportedSymbol(factory.AsCallExpression().Expression)
			if !ok || symbol.Name != "defineRuntime" {
				return
			}
			input := authored.Unwrap(authored.Argument(node, 0))
			if input == nil || input.Kind != ast.KindObjectLiteralExpression {
				familyEmit(&out, "FNC-ONE-IMPL", file, node, "ambiguity", "defineRuntime input is not a static object literal.")
				return
			}
			var functions *ast.Node
			for _, property := range input.AsObjectLiteralExpression().Properties.Nodes {
				if property.Kind != ast.KindPropertyAssignment && property.Kind != ast.KindShorthandPropertyAssignment {
					continue
				}
				name := property.Name()
				if name != nil && (name.Kind == ast.KindIdentifier || name.Kind == ast.KindStringLiteral) && name.Text() == "functions" {
					functions = property
					break
				}
			}
			if functions == nil {
				return
			}
			var registry *ast.Node
			if functions.Kind == ast.KindPropertyAssignment {
				registry = authored.Unwrap(functions.AsPropertyAssignment().Initializer)
			} else {
				registry = actionLocalInitializer(file.Source, functions.Name().Text())
			}
			if registry == nil {
				familyEmit(&out, "FNC-ONE-IMPL", file, functions, "ambiguity", "defineRuntime functions binding cannot be resolved locally.")
				return
			}
			values := actionObjectValues(project, file, registry, &out)
			if values.kind == "valid" || values.kind == "residual" {
				return
			}
			if values.kind == "invalid" {
				kind := "violation"
				if values.ambiguous {
					kind = "ambiguity"
				}
				familyEmit(&out, "FNC-ONE-IMPL", file, registry, kind, values.message)
				return
			}
			if registry.Kind != ast.KindArrayLiteralExpression {
				familyEmit(&out, "FNC-ONE-IMPL", file, registry, "ambiguity", "defineRuntime functions is not a static array literal.")
				return
			}
			for _, element := range registry.AsArrayLiteralExpression().Elements.Nodes {
				if element.Kind == ast.KindSpreadElement {
					element = element.AsSpreadElement().Expression
				}
				value := authored.Unwrap(element)
				if value.Kind != ast.KindIdentifier {
					familyEmit(&out, "FNC-ONE-IMPL", file, value, "violation", "Function must be one imported Functions binding.")
					continue
				}
				symbol, ok := project.Authored(file).ImportedSymbol(value)
				var target *File
				if ok {
					var known bool
					target, known = familyResolve(project, file, symbol.Module, "FNC-ONE-IMPL", &out)
					if !known {
						continue
					}
				}
				if target != nil && target.Layer == "functions" && target.Submodule == "" {
					familyEmit(&out, "FNC-ONE-IMPL", file, value, "ambiguity", "Function "+value.Text()+" reaches the Functions layer facade but its ultimate semantic submodule owner is unresolved.")
					continue
				}
				if target == nil || target.Layer != "functions" || target.Submodule == "" {
					familyEmit(&out, "FNC-ONE-IMPL", file, value, "violation", "Function "+value.Text()+" is not owned by one Functions submodule.")
					continue
				}
				key := target.Path + "\x00" + symbol.Name
				if registered[key] {
					familyEmit(&out, "FNC-ONE-IMPL", file, value, "violation", "Function "+value.Text()+" is registered more than once from "+target.Path+".")
				} else {
					registered[key] = true
				}
			}
		})
	}
	return out
}
