package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

type CallableTarget struct {
	Module   string
	Selector []string
}
type CallableSet struct {
	Keys          map[string]bool
	Indeterminate bool
	Known         bool
}
type DomainDependencies struct {
	Aliases       map[string]string
	Indeterminate bool
}

func CallableSelector(s []string) bool {
	return len(s) == 2 && s[0] == "functions" || len(s) == 4 && s[0] == "classes" && s[2] == "methods" || len(s) == 5 && s[0] == "classes" && s[2] == "static" && s[3] == "methods"
}
func ExternalFacade(m string) bool {
	return !strings.HasPrefix(m, ".") && !strings.HasPrefix(m, "#") && !strings.HasPrefix(m, "@astrale-os/sdk") && !strings.HasPrefix(m, "@astrale-os/kernel-")
}
func RemoteCallableKey(t CallableTarget) string {
	return t.Module + "\000" + strings.Join(t.Selector, "\000")
}
func BindingContains(binding *ast.Node, name string) bool {
	if binding == nil {
		return false
	}
	if binding.Kind == ast.KindIdentifier {
		return binding.Text() == name
	}
	switch binding.Kind {
	case ast.KindObjectBindingPattern, ast.KindArrayBindingPattern:
		for _, element := range binding.AsBindingPattern().Elements.Nodes {
			if element.Kind != ast.KindOmittedExpression && BindingContains(element.AsBindingElement().Name(), name) {
				return true
			}
		}
	}
	return false
}
func LexicalConstInitializer(identifier *ast.Node) *ast.Node {
	child := identifier
	for current := identifier.Parent; current != nil; current = current.Parent {
		if ast.IsFunctionLike(current) {
			for _, parameter := range current.Parameters() {
				if BindingContains(parameter.AsParameterDeclaration().Name(), identifier.Text()) {
					return nil
				}
			}
		}
		var statements []*ast.Node
		switch current.Kind {
		case ast.KindBlock:
			statements = current.AsBlock().Statements.Nodes
		case ast.KindSourceFile:
			statements = current.AsSourceFile().Statements.Nodes
		case ast.KindModuleBlock:
			statements = current.AsModuleBlock().Statements.Nodes
		}
		if statements != nil {
			index := len(statements)
			for i, stmt := range statements {
				if stmt.Pos() <= child.Pos() && stmt.End() >= child.End() {
					index = i
					break
				}
			}
			for i := index - 1; i >= 0; i-- {
				stmt := statements[i]
				if stmt.Kind != ast.KindVariableStatement {
					continue
				}
				list := stmt.AsVariableStatement().DeclarationList
				for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
					decl := d.AsVariableDeclaration()
					if decl.Name().Kind == ast.KindIdentifier && decl.Name().Text() == identifier.Text() {
						if list.Flags&ast.NodeFlagsConst != 0 {
							return decl.Initializer
						}
						return nil
					}
				}
			}
		}
		child = current
	}
	return nil
}
func CallableReference(expression *ast.Node) (*ast.Node, bool) {
	if expression == nil {
		return nil, false
	}
	if expression.Kind != ast.KindIdentifier {
		return expression, true
	}
	initializer := LexicalConstInitializer(expression)
	if initializer == nil {
		return expression, false
	}
	return authored.Unwrap(initializer), true
}
func DeclaredDomainDependencies(project *Project) DomainDependencies {
	out := DomainDependencies{Aliases: map[string]string{}}
	definitions := 0
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" {
			continue
		}
		for _, definition := range project.Authored(file).Definitions("defineSchema", "", authored.DSLModules, 1) {
			definitions++
			if definition.Origin != "resolved" || definition.Object == nil {
				out.Indeterminate = true
				continue
			}
			value := authored.PropertyExpression(definition.Object, "dependencies")
			if value == nil {
				continue
			}
			if value.Kind != ast.KindObjectLiteralExpression {
				out.Indeterminate = true
				continue
			}
			for _, property := range value.AsObjectLiteralExpression().Properties.Nodes {
				input := callablePropertyValue(property)
				name := property.Name()
				alias := ""
				if name != nil && (name.Kind == ast.KindIdentifier || name.Kind == ast.KindStringLiteral) {
					alias = name.Text()
				}
				if input == nil || alias == "" {
					out.Indeterminate = true
					continue
				}
				symbol := project.Authored(file).ResolveImportedSymbol(input)
				if symbol.Kind == "resolved" && symbol.Name == "KernelSchema" && authored.Contains([]string{"@astrale-os/sdk/schema", "@astrale-os/kernel-core"}, symbol.Module) {
					continue
				}
				if symbol.Kind != "resolved" || !ExternalFacade(symbol.Module) {
					out.Indeterminate = true
					continue
				}
				if previous, ok := out.Aliases[alias]; ok && previous != symbol.Module {
					delete(out.Aliases, alias)
					out.Indeterminate = true
					continue
				}
				out.Aliases[alias] = symbol.Module
			}
		}
	}
	out.Indeterminate = out.Indeterminate || definitions != 1
	return out
}
func callablePropertyValue(property *ast.Node) *ast.Node {
	if property == nil {
		return nil
	}
	switch property.Kind {
	case ast.KindPropertyAssignment:
		return property.AsPropertyAssignment().Initializer
	case ast.KindShorthandPropertyAssignment:
		return property.AsShorthandPropertyAssignment().Name()
	}
	return nil
}
func RequiredCallable(project *Project, file *File, input *ast.Node) (*CallableTarget, bool) {
	current, resolved := CallableReference(authored.Unwrap(input))
	if !resolved {
		return nil, true
	}
	selector := []string{}
	for current != nil && authored.Unwrap(current).Kind == ast.KindPropertyAccessExpression {
		property := authored.Unwrap(current).AsPropertyAccessExpression()
		selector = append([]string{property.Name().Text()}, selector...)
		current = authored.Unwrap(property.Expression)
	}
	if current != nil && current.Kind == ast.KindIdentifier {
		current, _ = CallableReference(current)
	}
	if current == nil || current.Kind != ast.KindCallExpression {
		return nil, true
	}
	call := current.AsCallExpression()
	resolve := authored.Unwrap(call.Expression)
	if resolve.Kind != ast.KindPropertyAccessExpression || resolve.AsPropertyAccessExpression().Name().Text() != "resolve" {
		return nil, true
	}
	symbol := project.Authored(file).ResolveImportedSymbol(resolve.AsPropertyAccessExpression().Expression)
	if symbol.Kind != "resolved" || symbol.Name != "schema" || symbol.Module != "@astrale-os/sdk/schema" {
		return nil, true
	}
	value := authored.Argument(current, 0)
	if value == nil {
		return nil, true
	}
	facade := project.Authored(file).ResolveImportedSymbol(value)
	if facade.Kind == "resolved" && ExternalFacade(facade.Module) {
		if !CallableSelector(selector) {
			return nil, true
		}
		return &CallableTarget{facade.Module, selector}, true
	}
	if facade.Kind == "local" {
		return nil, true
	}
	local := project.Resolve(file, Import{Specifier: facade.Module})
	if !local.Known {
		return nil, false
	}
	if facade.Name != "schema" || local.Target == nil || local.Target.Layer != "schema" || len(selector) < 2 || selector[0] != "dependencies" || !CallableSelector(selector[2:]) {
		return nil, true
	}
	dependency, ok := DeclaredDomainDependencies(project).Aliases[selector[1]]
	if !ok {
		return nil, true
	}
	return &CallableTarget{dependency, selector[2:]}, true
}
func ApplicationFunctionRequirements(project *Project) CallableSet {
	empty := func(indeterminate bool) CallableSet {
		return CallableSet{Keys: map[string]bool{}, Indeterminate: indeterminate, Known: true}
	}
	file := project.FilesByPath[project.ApplicationPath]
	if file == nil {
		return empty(true)
	}
	applications := []*ast.Node{}
	authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind != ast.KindCallExpression {
			return
		}
		symbol := project.Authored(file).ResolveImportedSymbol(node.AsCallExpression().Expression)
		if symbol.Kind == "resolved" && symbol.Name == "defineApplication" && authored.Contains([]string{"@astrale-os/sdk", "@astrale-os/sdk/application"}, symbol.Module) {
			applications = append(applications, node)
		}
	})
	if len(applications) != 1 {
		return empty(true)
	}
	input := authored.Unwrap(authored.Argument(applications[0], 0))
	if input == nil || input.Kind != ast.KindObjectLiteralExpression {
		return empty(true)
	}
	property := authored.ObjectProperty(input, "requirements")
	if property == nil {
		return empty(false)
	}
	requirements := callablePropertyValue(property)
	if requirements == nil {
		return empty(true)
	}
	call, _ := CallableReference(authored.Unwrap(requirements))
	if call == nil || call.Kind != ast.KindCallExpression {
		return empty(true)
	}
	symbol := project.Authored(file).ResolveImportedSymbol(call.AsCallExpression().Expression)
	if symbol.Kind != "resolved" || symbol.Name != "requirements" || !authored.Contains([]string{"@astrale-os/sdk", "@astrale-os/sdk/application"}, symbol.Module) {
		return empty(true)
	}
	definition := authored.Unwrap(authored.Argument(call, 0))
	if definition == nil {
		return empty(false)
	}
	if definition.Kind != ast.KindObjectLiteralExpression {
		return empty(true)
	}
	functions := authored.ObjectProperty(definition, "functions")
	if functions == nil {
		return empty(false)
	}
	if functions.Kind != ast.KindPropertyAssignment {
		return empty(true)
	}
	values := authored.Unwrap(functions.AsPropertyAssignment().Initializer)
	if values.Kind != ast.KindArrayLiteralExpression {
		return empty(true)
	}
	out := empty(false)
	for _, element := range values.AsArrayLiteralExpression().Elements.Nodes {
		if element.Kind == ast.KindSpreadElement {
			out.Indeterminate = true
			continue
		}
		target, known := RequiredCallable(project, file, element)
		if !known {
			out.Known = false
		}
		if target == nil {
			out.Indeterminate = true
		} else {
			out.Keys[RemoteCallableKey(*target)] = true
		}
	}
	return out
}
