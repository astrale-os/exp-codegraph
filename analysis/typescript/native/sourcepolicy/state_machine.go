package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

type StateIdentity struct {
	Known          bool
	Kind, Identity string
}

func stateResult(kind string) StateIdentity { return StateIdentity{Known: true, Kind: kind} }
func copySeen(seen map[string]bool, key string) map[string]bool {
	out := map[string]bool{}
	for k, v := range seen {
		out[k] = v
	}
	out[key] = true
	return out
}
func localVariable(file *File, name string) (*ast.Node, bool) {
	for _, statement := range file.Source.Statements.Nodes {
		if statement.Kind != ast.KindVariableStatement {
			continue
		}
		list := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
		for _, declaration := range list.Declarations.Nodes {
			if declaration.Name().Kind == ast.KindIdentifier && declaration.Name().Text() == name && declaration.AsVariableDeclaration().Initializer != nil {
				return declaration.AsVariableDeclaration().Initializer, list.Flags&ast.NodeFlagsConst != 0
			}
		}
	}
	return nil, false
}

func StateMachineConstructorOrigin(project *Project, file *File, expression *ast.Node) string {
	return constructorOrigin(project, file, expression, map[string]bool{}, "stateMachine", []string{"@astrale-os/sdk/state"})
}
func StatePropertyOrigin(project *Project, file *File, expression *ast.Node) string {
	return propertyOrigin(project, file, expression, map[string]bool{})
}
func constructorOrigin(project *Project, file *File, expression *ast.Node, seen map[string]bool, name string, modules []string) string {
	value := authored.Unwrap(expression)
	if value == nil {
		return "absent"
	}
	symbol := project.Authored(file).ResolveImportedSymbol(value)
	if symbol.Kind == "resolved" {
		if symbol.Name == name && authored.Contains(modules, symbol.Module) {
			return "resolved"
		}
		return "absent"
	}
	if symbol.Kind == "ambiguous" && symbol.Name == name {
		return "ambiguous"
	}
	if value.Kind != ast.KindIdentifier || seen[value.Text()] {
		return "absent"
	}
	initializer, constant := localVariable(file, value.Text())
	if initializer == nil {
		return "absent"
	}
	origin := constructorOrigin(project, file, initializer, copySeen(seen, value.Text()), name, modules)
	if constant || origin == "absent" {
		return origin
	}
	return "ambiguous"
}
func propertyOrigin(project *Project, file *File, expression *ast.Node, seen map[string]bool) string {
	value := authored.Unwrap(expression)
	if value == nil {
		return "absent"
	}
	if value.Kind == ast.KindCallExpression {
		symbol := project.Authored(file).ResolveImportedSymbol(value.AsCallExpression().Expression)
		if symbol.Kind == "resolved" {
			if symbol.Name == "stateProperty" && symbol.Module == "@astrale-os/sdk/schema" {
				return "resolved"
			}
			return "absent"
		}
		if symbol.Kind == "ambiguous" && symbol.Name == "stateProperty" {
			return "ambiguous"
		}
	}
	if value.Kind != ast.KindIdentifier || seen[value.Text()] {
		return "absent"
	}
	initializer, constant := localVariable(file, value.Text())
	if initializer == nil {
		return "absent"
	}
	origin := propertyOrigin(project, file, initializer, copySeen(seen, value.Text()))
	if constant || origin == "absent" {
		return origin
	}
	return "ambiguous"
}
func staticMemberReceiver(expression *ast.Node, member string) *ast.Node {
	value := authored.Unwrap(expression)
	if value == nil {
		return nil
	}
	if value.Kind == ast.KindPropertyAccessExpression && value.Name().Text() == member {
		return value.AsPropertyAccessExpression().Expression
	}
	if value.Kind == ast.KindElementAccessExpression {
		if name, ok := authored.StaticText(value.AsElementAccessExpression().ArgumentExpression); ok && name == member {
			return value.AsElementAccessExpression().Expression
		}
	}
	return nil
}
func importedBinding(file *File, expression *ast.Node) (Import, string, bool) {
	value := authored.Unwrap(expression)
	if value == nil {
		return Import{}, "", false
	}
	if value.Kind == ast.KindIdentifier {
		for _, imp := range file.Imports {
			for _, binding := range imp.Bindings {
				if binding.Local == value.Text() {
					return imp, binding.Imported, true
				}
			}
		}
	}
	if value.Kind == ast.KindPropertyAccessExpression && value.AsPropertyAccessExpression().Expression.Kind == ast.KindIdentifier {
		namespace := value.AsPropertyAccessExpression().Expression.Text()
		for _, imp := range file.Imports {
			if imp.Namespace == namespace {
				return imp, value.Name().Text(), true
			}
		}
	}
	return Import{}, "", false
}
func projectImport(project *Project, file *File, imp Import) Resolution {
	if !strings.HasPrefix(imp.Specifier, ".") && !strings.HasPrefix(imp.Specifier, "#") {
		return Resolution{Known: true}
	}
	if project.Resolve == nil {
		return Resolution{}
	}
	return project.Resolve(file, imp)
}
func StateMachineIdentity(project *Project, file *File, expression *ast.Node) StateIdentity {
	return stateMachineIdentity(project, file, expression, map[string]bool{})
}
func stateMachineIdentity(project *Project, file *File, expression *ast.Node, seen map[string]bool) StateIdentity {
	value := authored.Unwrap(expression)
	if value == nil {
		return stateResult("absent")
	}
	if value.Kind == ast.KindIdentifier {
		initializer, constant := localVariable(file, value.Text())
		if initializer != nil {
			identity := file.Path + "\x00" + value.Text()
			if seen[identity] {
				return stateResult("ambiguous")
			}
			call := authored.Unwrap(initializer)
			if call.Kind == ast.KindCallExpression {
				origin := StateMachineConstructorOrigin(project, file, call.AsCallExpression().Expression)
				if origin == "ambiguous" {
					return stateResult("ambiguous")
				}
				if origin == "resolved" {
					if !constant {
						return stateResult("ambiguous")
					}
					if MachineExportStatus(file, call) == "exported" {
						return StateIdentity{Known: true, Kind: "resolved", Identity: file.Path + "#" + value.Text()}
					}
					return stateResult("absent")
				}
			}
			result := stateMachineIdentity(project, file, initializer, copySeen(seen, identity))
			if !result.Known || constant || result.Kind == "absent" {
				return result
			}
			return stateResult("ambiguous")
		}
	}
	imp, imported, found := importedBinding(file, value)
	if !found {
		return stateResult("absent")
	}
	resolution := projectImport(project, file, imp)
	if !resolution.Known {
		return StateIdentity{}
	}
	if resolution.Target == nil {
		return stateResult("ambiguous")
	}
	return resolveMachineExport(project, resolution.Target, imported, map[string]bool{})
}
func StateSchemaIdentity(project *Project, file *File, expression *ast.Node) StateIdentity {
	return stateSchemaIdentity(project, file, expression, map[string]bool{})
}
func stateSchemaIdentity(project *Project, file *File, expression *ast.Node, seen map[string]bool) StateIdentity {
	value := authored.Unwrap(expression)
	if value == nil {
		return stateResult("absent")
	}
	if owner := staticMemberReceiver(value, "stateSchema"); owner != nil {
		return StateMachineIdentity(project, file, owner)
	}
	if value.Kind == ast.KindCallExpression {
		symbol := project.Authored(file).ResolveImportedSymbol(value.AsCallExpression().Expression)
		if symbol.Kind == "resolved" && symbol.Name == "property" && authored.Contains([]string{"@astrale-os/sdk", "@astrale-os/sdk/schema", "@astrale-os/kernel-dsl", "@astrale-os/kernel-dsl/v1"}, symbol.Module) {
			return stateSchemaIdentity(project, file, authored.Argument(value, 0), seen)
		}
	}
	if value.Kind == ast.KindIdentifier {
		initializer, constant := localVariable(file, value.Text())
		if initializer == nil {
			return stateResult("absent")
		}
		if seen[value.Text()] {
			return stateResult("ambiguous")
		}
		result := stateSchemaIdentity(project, file, initializer, copySeen(seen, value.Text()))
		if !result.Known || constant || result.Kind == "absent" {
			return result
		}
		return stateResult("ambiguous")
	}
	candidate, known := false, true
	authored.Walk(value, func(node *ast.Node) {
		if owner := staticMemberReceiver(node, "stateSchema"); owner != nil {
			r := StateMachineIdentity(project, file, owner)
			known = known && r.Known
			if r.Known && r.Kind != "absent" {
				candidate = true
			}
		}
		if node.Kind == ast.KindIdentifier && node != value && !seen[node.Text()] {
			initializer, _ := localVariable(file, node.Text())
			if initializer != nil {
				r := stateSchemaIdentity(project, file, initializer, copySeen(seen, node.Text()))
				known = known && r.Known
				if r.Known && r.Kind != "absent" {
					candidate = true
				}
			}
		}
	})
	if !known {
		return StateIdentity{}
	}
	if candidate {
		return stateResult("ambiguous")
	}
	return stateResult("absent")
}
func StatePropertyIdentity(project *Project, file *File, expression *ast.Node) StateIdentity {
	return statePropertyIdentity(project, file, expression, map[string]bool{})
}
func statePropertyIdentity(project *Project, file *File, expression *ast.Node, seen map[string]bool) StateIdentity {
	value := authored.Unwrap(expression)
	if value == nil {
		return stateResult("absent")
	}
	if value.Kind == ast.KindCallExpression {
		symbol := project.Authored(file).ResolveImportedSymbol(value.AsCallExpression().Expression)
		if symbol.Kind == "resolved" && symbol.Name == "stateProperty" && symbol.Module == "@astrale-os/sdk/schema" {
			return StateMachineIdentity(project, file, authored.Argument(value, 0))
		}
	}
	if value.Kind == ast.KindIdentifier {
		initializer, constant := localVariable(file, value.Text())
		if initializer == nil {
			return stateResult("absent")
		}
		if seen[value.Text()] {
			return stateResult("ambiguous")
		}
		result := statePropertyIdentity(project, file, initializer, copySeen(seen, value.Text()))
		if !result.Known || constant || result.Kind == "absent" {
			return result
		}
		return stateResult("ambiguous")
	}
	candidate := false
	authored.Walk(value, func(node *ast.Node) {
		if node.Kind == ast.KindCallExpression {
			symbol := project.Authored(file).ResolveImportedSymbol(node.AsCallExpression().Expression)
			if symbol.Kind != "local" && symbol.Name == "stateProperty" && (symbol.Kind == "ambiguous" || symbol.Module == "@astrale-os/sdk/schema") {
				candidate = true
			}
		}
	})
	if candidate {
		return stateResult("ambiguous")
	}
	return stateResult("absent")
}
func MachineExportStatus(file *File, call *ast.Node) string {
	for _, statement := range file.Source.Statements.Nodes {
		if statement.Kind != ast.KindVariableStatement {
			continue
		}
		list := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
		for _, declaration := range list.Declarations.Nodes {
			if declaration.Name().Kind != ast.KindIdentifier || declaration.AsVariableDeclaration().Initializer == nil || authored.Unwrap(declaration.AsVariableDeclaration().Initializer) != call {
				continue
			}
			if list.Flags&ast.NodeFlagsConst == 0 {
				return "mutable"
			}
			if statement.ModifierFlags()&ast.ModifierFlagsExport != 0 || locallyExported(file, declaration.Name().Text()) {
				return "exported"
			}
			return "private"
		}
	}
	return "not-a-declaration"
}
func locallyExported(file *File, name string) bool {
	for _, statement := range file.Source.Statements.Nodes {
		if statement.Kind != ast.KindExportDeclaration {
			continue
		}
		e := statement.AsExportDeclaration()
		if e.ModuleSpecifier != nil || e.ExportClause == nil || e.ExportClause.Kind != ast.KindNamedExports {
			continue
		}
		for _, element := range e.ExportClause.AsNamedExports().Elements.Nodes {
			local := element.Name().Text()
			if element.AsExportSpecifier().PropertyName != nil {
				local = element.AsExportSpecifier().PropertyName.Text()
			}
			if local == name {
				return true
			}
		}
	}
	return false
}
func localMachineOrigin(project *Project, file *File, name string) string {
	initializer, constant := localVariable(file, name)
	if initializer == nil || authored.Unwrap(initializer).Kind != ast.KindCallExpression {
		return "absent"
	}
	origin := StateMachineConstructorOrigin(project, file, authored.Unwrap(initializer).AsCallExpression().Expression)
	if constant || origin == "absent" {
		return origin
	}
	return "ambiguous"
}
func resolveMachineExport(project *Project, file *File, exported string, seen map[string]bool) StateIdentity {
	key := file.Path + "\x00" + exported
	if seen[key] {
		return stateResult("absent")
	}
	seen = copySeen(seen, key)
	identities := map[string]bool{}
	unresolved, known := false, true
	merge := func(result StateIdentity) {
		known = known && result.Known
		if result.Kind == "resolved" {
			identities[result.Identity] = true
		} else if result.Kind == "ambiguous" {
			unresolved = true
		}
	}
	resolve := func(specifier, name string) {
		res := projectImport(project, file, Import{Specifier: specifier})
		if !res.Known {
			known = false
		} else if res.Target == nil {
			unresolved = true
		} else {
			merge(resolveMachineExport(project, res.Target, name, copySeen(seen, key)))
		}
	}
	for _, statement := range file.Source.Statements.Nodes {
		if statement.Kind == ast.KindVariableStatement {
			if statement.ModifierFlags()&ast.ModifierFlagsExport != 0 {
				origin := localMachineOrigin(project, file, exported)
				if origin == "resolved" {
					identities[file.Path+"#"+exported] = true
				} else if origin == "ambiguous" {
					unresolved = true
				}
			}
			continue
		}
		if statement.Kind != ast.KindExportDeclaration {
			continue
		}
		e := statement.AsExportDeclaration()
		if e.ExportClause == nil {
			if e.ModuleSpecifier != nil && e.ModuleSpecifier.Kind == ast.KindStringLiteral {
				resolve(e.ModuleSpecifier.Text(), exported)
			}
			continue
		}
		if e.ExportClause.Kind != ast.KindNamedExports {
			continue
		}
		for _, element := range e.ExportClause.AsNamedExports().Elements.Nodes {
			if element.Name().Text() != exported {
				continue
			}
			local := element.Name().Text()
			if element.AsExportSpecifier().PropertyName != nil {
				local = element.AsExportSpecifier().PropertyName.Text()
			}
			if e.ModuleSpecifier != nil && e.ModuleSpecifier.Kind == ast.KindStringLiteral {
				resolve(e.ModuleSpecifier.Text(), local)
				continue
			}
			origin := localMachineOrigin(project, file, local)
			if origin == "resolved" {
				identities[file.Path+"#"+local] = true
			} else if origin == "ambiguous" {
				unresolved = true
			} else {
				for _, imp := range file.Imports {
					for _, binding := range imp.Bindings {
						if binding.Local == local {
							resolve(imp.Specifier, binding.Imported)
							goto resolvedLocal
						}
					}
				}
			resolvedLocal:
			}
		}
	}
	if !known {
		return StateIdentity{}
	}
	if unresolved || len(identities) > 1 {
		return stateResult("ambiguous")
	}
	for identity := range identities {
		return StateIdentity{Known: true, Kind: "resolved", Identity: identity}
	}
	return stateResult("absent")
}
