package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

type providerReference struct {
	expression *ast.Node
	resolved   bool
}
type providerRemote struct {
	file     *File
	node     *ast.Node
	module   string
	selector []string
}

func providerBindingContains(name *ast.Node, text string) bool {
	if name == nil {
		return false
	}
	if name.Kind == ast.KindIdentifier {
		return name.Text() == text
	}
	if name.Kind != ast.KindObjectBindingPattern && name.Kind != ast.KindArrayBindingPattern {
		return false
	}
	for _, element := range name.AsBindingPattern().Elements.Nodes {
		if element.Kind != ast.KindOmittedExpression && providerBindingContains(element.Name().AsNode(), text) {
			return true
		}
	}
	return false
}

// Match callable-requirements.ts: one preceding immutable lexical alias, no
// recursive value emulation or strengthening of authoring constructor origins.
func providerLexicalConst(identifier *ast.Node) *ast.Node {
	child := identifier
	for current := identifier.Parent; current != nil; current = current.Parent {
		if ast.IsFunctionLike(current) {
			for _, parameter := range current.Parameters() {
				if providerBindingContains(parameter.Name().AsNode(), identifier.Text()) {
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
		default:
			child = current
			continue
		}
		index := -1
		for i, statement := range statements {
			if statement.Pos() <= child.Pos() && statement.End() >= child.End() {
				index = i
				break
			}
		}
		if index >= 0 {
			statements = statements[:index]
		}
		for i := len(statements) - 1; i >= 0; i-- {
			statement := statements[i]
			if statement.Kind != ast.KindVariableStatement {
				continue
			}
			list := statement.AsVariableStatement().DeclarationList
			for _, declaration := range list.AsVariableDeclarationList().Declarations.Nodes {
				if declaration.Name().Kind == ast.KindIdentifier && declaration.Name().Text() == identifier.Text() {
					if list.Flags&ast.NodeFlagsConst != 0 {
						return declaration.AsVariableDeclaration().Initializer
					}
					return nil
				}
			}
		}
		child = current
	}
	return nil
}
func providerCallableReference(expression *ast.Node) providerReference {
	if expression.Kind != ast.KindIdentifier {
		return providerReference{expression, true}
	}
	initializer := providerLexicalConst(expression)
	if initializer == nil {
		return providerReference{expression, false}
	}
	return providerReference{authored.Unwrap(initializer), true}
}
func providerFunction(node *ast.Node) bool {
	return node != nil && (node.Kind == ast.KindArrowFunction || node.Kind == ast.KindFunctionExpression || node.Kind == ast.KindMethodDeclaration)
}
func providerOperation(project *Project, file *File, node *ast.Node) *ast.Node {
	current := node.Parent
	for current != nil && !providerFunction(current) {
		current = current.Parent
	}
	if current == nil {
		return nil
	}
	property := current
	if current.Kind != ast.KindMethodDeclaration {
		property = current.Parent
	}
	if property == nil {
		return nil
	}
	var object *ast.Node
	if property.Kind == ast.KindMethodDeclaration || property.Kind == ast.KindPropertyAssignment {
		object = property.Parent
	}
	if object == nil || object.Kind != ast.KindObjectLiteralExpression {
		return nil
	}
	call := object.Parent
	if call == nil || call.Kind != ast.KindCallExpression || authored.Argument(call, 1) != object {
		return nil
	}
	symbol := project.Authored(file).ResolveImportedSymbol(call.AsCallExpression().Expression)
	if symbol.Kind == "resolved" && symbol.Name == "defineProvider" && symbol.Module == "@astrale-os/sdk/integration" {
		return current
	}
	return nil
}
func providerExecutionInvoke(project *Project, file *File, call *ast.Node) bool {
	expression := authored.Unwrap(call.AsCallExpression().Expression)
	invoked := expression
	if expression.Kind == ast.KindIdentifier {
		initializer := providerLexicalConst(expression)
		if initializer != nil {
			invoked = authored.Unwrap(initializer)
		}
	}
	operation := providerOperation(project, file, call)
	if operation == nil || len(operation.Parameters()) < 2 {
		return false
	}
	execution := operation.Parameters()[1].Name().AsNode()
	if invoked.Kind == ast.KindPropertyAccessExpression && invoked.Name().Text() == "invoke" {
		receiver := invoked.AsPropertyAccessExpression().Expression
		return execution.Kind == ast.KindIdentifier && receiver.Kind == ast.KindIdentifier && receiver.Text() == execution.Text()
	}
	if invoked.Kind != ast.KindIdentifier || execution.Kind != ast.KindObjectBindingPattern {
		return false
	}
	for _, element := range execution.AsBindingPattern().Elements.Nodes {
		binding := element.AsBindingElement()
		if binding.Name().Kind != ast.KindIdentifier || binding.Name().Text() != invoked.Text() {
			continue
		}
		if binding.PropertyName == nil || (binding.PropertyName.Kind == ast.KindIdentifier && binding.PropertyName.Text() == "invoke") {
			return true
		}
	}
	return false
}
func providerEnclosingInvoke(project *Project, file *File, node *ast.Node) bool {
	for current := node.Parent; current != nil; current = current.Parent {
		if current.Kind >= ast.KindFirstStatement && current.Kind <= ast.KindLastStatement {
			return false
		}
		if current.Kind == ast.KindCallExpression && providerExecutionInvoke(project, file, current) {
			return true
		}
	}
	return false
}
func providerSelector(selector []string) bool {
	return len(selector) == 2 && selector[0] == "functions" || len(selector) == 4 && selector[0] == "classes" && selector[2] == "methods" || len(selector) == 5 && selector[0] == "classes" && selector[2] == "static" && selector[3] == "methods"
}
func providerExternal(module string) bool {
	return !strings.HasPrefix(module, ".") && !strings.HasPrefix(module, "#") && !strings.HasPrefix(module, "@astrale-os/sdk") && !strings.HasPrefix(module, "@astrale-os/kernel-")
}
func providerKey(module string, selector []string) string {
	return module + "\x00" + strings.Join(selector, "\x00")
}
func providerBindingTypeModule(project *Project, file *File, name string, node *ast.Node) string {
	for current := node.Parent; current != nil; current = current.Parent {
		if !ast.IsFunctionLike(current) {
			continue
		}
		for _, parameter := range current.Parameters() {
			if parameter.Name().Kind != ast.KindIdentifier || parameter.Name().Text() != name {
				continue
			}
			typ := parameter.AsParameterDeclaration().Type
			if typ != nil && typ.Kind == ast.KindTypeReference {
				typeName := typ.AsNode().AsTypeReferenceNode().TypeName
				if typeName.Kind == ast.KindIdentifier {
					symbol := project.Authored(file).ResolveImportedSymbol(typeName)
					if symbol.Kind == "resolved" {
						return symbol.Module
					}
				}
			}
			break
		}
	}
	return ""
}
func providerRemoteCallable(project *Project, file *File, invoke *ast.Node, out *Result) (providerRemote, bool) {
	emit := func(node *ast.Node, message string) (providerRemote, bool) {
		familyEmit(out, "PRV-XDOM-REQ", file, node, "ambiguity", message)
		return providerRemote{}, false
	}
	argument := authored.Argument(invoke, 0)
	if argument == nil {
		return emit(invoke, "Remote Domain invocation has no statically visible reference.")
	}
	admitted := providerCallableReference(authored.Unwrap(argument))
	if !admitted.resolved {
		return emit(argument, "Remote Domain Function requirement cannot be proven from an opaque reference.")
	}
	expression := admitted.expression
	if expression.Kind == ast.KindCallExpression && expression.AsCallExpression().Expression.Kind == ast.KindCallExpression {
		expression = expression.AsCallExpression().Expression
	}
	if expression.Kind != ast.KindCallExpression {
		return emit(expression, "Remote Domain Function requirement cannot be proven from a computed reference.")
	}
	constructor := project.Authored(file).ResolveImportedSymbol(expression.AsCallExpression().Expression)
	if constructor.Kind != "resolved" || constructor.Name != "reference" || constructor.Module != "@astrale-os/sdk/client/session" {
		return emit(expression, "Remote Domain Function requirement cannot be proven from a non-SDK reference.")
	}
	domain := authored.Argument(expression, 0)
	callable := authored.Argument(expression, 1)
	domainChain := familyPropertyChain(domain)
	callableChain := familyPropertyChain(callable)
	if len(domainChain) != 1 || len(callableChain) == 0 || callableChain[0] != domainChain[0] || !providerSelector(callableChain[1:]) {
		return emit(expression, "Remote Domain Function requirement cannot be proven from an opaque Domain or selector.")
	}
	module := providerBindingTypeModule(project, file, domainChain[0], expression)
	if module == "" || !providerExternal(module) {
		return emit(domain, "Remote Domain type cannot be mapped to one public package facade.")
	}
	return providerRemote{file, invoke, module, callableChain[1:]}, true
}

func providerDeclaredDependencies(project *Project, out *Result) map[string]string {
	aliases := map[string]string{}
	for _, file := range familyProduction(project, "schema") {
		for _, definition := range project.Authored(file).Definitions("defineSchema", "", authored.DSLModules, 1) {
			if definition.Origin != "resolved" || definition.Object == nil {
				continue
			}
			value := authored.PropertyExpression(definition.Object, "dependencies")
			if value == nil || value.Kind != ast.KindObjectLiteralExpression {
				continue
			}
			for _, property := range value.AsObjectLiteralExpression().Properties.Nodes {
				var input *ast.Node
				if property.Kind == ast.KindPropertyAssignment {
					input = property.AsPropertyAssignment().Initializer
				} else if property.Kind == ast.KindShorthandPropertyAssignment {
					input = property.Name().AsNode()
				}
				name := property.Name()
				if input == nil || name == nil || (name.Kind != ast.KindIdentifier && name.Kind != ast.KindStringLiteral) {
					continue
				}
				alias := name.Text()
				symbol := project.Authored(file).ResolveImportedSymbol(input)
				if symbol.Kind == "resolved" && symbol.Name == "KernelSchema" && (symbol.Module == "@astrale-os/sdk/schema" || symbol.Module == "@astrale-os/kernel-core") {
					continue
				}
				if symbol.Kind != "resolved" || !providerExternal(symbol.Module) {
					continue
				}
				if old, exists := aliases[alias]; exists && old != symbol.Module {
					delete(aliases, alias)
					continue
				}
				aliases[alias] = symbol.Module
			}
		}
	}
	return aliases
}
func providerRequiredCallable(project *Project, file *File, input *ast.Node, out *Result) (string, []string, bool) {
	admitted := providerCallableReference(authored.Unwrap(input))
	if !admitted.resolved {
		return "", nil, false
	}
	current := admitted.expression
	selector := []string{}
	for authored.Unwrap(current).Kind == ast.KindPropertyAccessExpression {
		property := authored.Unwrap(current).AsPropertyAccessExpression()
		selector = append([]string{property.Name().Text()}, selector...)
		current = authored.Unwrap(property.Expression)
	}
	if current.Kind == ast.KindIdentifier {
		current = providerCallableReference(current).expression
	}
	if current.Kind != ast.KindCallExpression {
		return "", nil, false
	}
	resolve := authored.Unwrap(current.AsCallExpression().Expression)
	if resolve.Kind != ast.KindPropertyAccessExpression || resolve.Name().Text() != "resolve" {
		return "", nil, false
	}
	schemaSymbol := project.Authored(file).ResolveImportedSymbol(resolve.AsPropertyAccessExpression().Expression)
	if schemaSymbol.Kind != "resolved" || schemaSymbol.Name != "schema" || schemaSymbol.Module != "@astrale-os/sdk/schema" {
		return "", nil, false
	}
	schemaValue := authored.Argument(current, 0)
	if schemaValue == nil {
		return "", nil, false
	}
	facade := project.Authored(file).ResolveImportedSymbol(schemaValue)
	if facade.Kind == "resolved" && providerExternal(facade.Module) {
		return facade.Module, selector, providerSelector(selector)
	}
	if facade.Kind == "local" {
		return "", nil, false
	}
	local, known := familyResolve(project, file, facade.Module, "PRV-XDOM-REQ", out)
	if !known || facade.Name != "schema" || local == nil || local.Layer != "schema" || len(selector) < 2 || selector[0] != "dependencies" {
		return "", nil, false
	}
	callable := selector[2:]
	if !providerSelector(callable) {
		return "", nil, false
	}
	module := providerDeclaredDependencies(project, out)[selector[1]]
	return module, callable, module != ""
}
func providerApplicationRequirements(project *Project, out *Result) (map[string]bool, bool) {
	keys := map[string]bool{}
	file := project.FilesByPath[project.ApplicationPath]
	if file == nil {
		return keys, true
	}
	applications := []*ast.Node{}
	authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind != ast.KindCallExpression {
			return
		}
		symbol := project.Authored(file).ResolveImportedSymbol(node.AsCallExpression().Expression)
		if symbol.Kind == "resolved" && symbol.Name == "defineApplication" && (symbol.Module == "@astrale-os/sdk" || symbol.Module == "@astrale-os/sdk/application") {
			applications = append(applications, node)
		}
	})
	if len(applications) != 1 {
		return keys, true
	}
	input := authored.Unwrap(authored.Argument(applications[0], 0))
	if input == nil || input.Kind != ast.KindObjectLiteralExpression {
		return keys, true
	}
	property := authored.ObjectProperty(input, "requirements")
	if property == nil {
		return keys, false
	}
	var requirementsInput *ast.Node
	if property.Kind == ast.KindPropertyAssignment {
		requirementsInput = property.AsPropertyAssignment().Initializer
	} else if property.Kind == ast.KindShorthandPropertyAssignment {
		requirementsInput = property.Name().AsNode()
	}
	if requirementsInput == nil {
		return keys, true
	}
	call := providerCallableReference(authored.Unwrap(requirementsInput)).expression
	if call.Kind != ast.KindCallExpression {
		return keys, true
	}
	symbol := project.Authored(file).ResolveImportedSymbol(call.AsCallExpression().Expression)
	if symbol.Kind != "resolved" || symbol.Name != "requirements" || (symbol.Module != "@astrale-os/sdk" && symbol.Module != "@astrale-os/sdk/application") {
		return keys, true
	}
	definition := authored.Unwrap(authored.Argument(call, 0))
	if definition == nil {
		return keys, false
	}
	if definition.Kind != ast.KindObjectLiteralExpression {
		return keys, true
	}
	functions := authored.ObjectProperty(definition, "functions")
	if functions == nil {
		return keys, false
	}
	if functions.Kind != ast.KindPropertyAssignment {
		return keys, true
	}
	values := authored.Unwrap(functions.AsPropertyAssignment().Initializer)
	if values.Kind != ast.KindArrayLiteralExpression {
		return keys, true
	}
	indeterminate := false
	for _, element := range values.AsArrayLiteralExpression().Elements.Nodes {
		if element.Kind == ast.KindSpreadElement {
			indeterminate = true
			continue
		}
		module, selector, ok := providerRequiredCallable(project, file, element, out)
		if !ok {
			indeterminate = true
		} else {
			keys[providerKey(module, selector)] = true
		}
	}
	return keys, indeterminate
}

func EvaluateProviders(project *Project) Result {
	out := familyResult()
	for _, file := range familyProduction(project, "providers") {
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind == ast.KindCallExpression && providerExecutionInvoke(project, file, node) {
				reference := authored.Argument(node, 0)
				var admitted providerReference
				var expression *ast.Node
				if reference != nil {
					admitted = providerCallableReference(authored.Unwrap(reference))
					expression = admitted.expression
					if expression.Kind == ast.KindCallExpression && expression.AsCallExpression().Expression.Kind == ast.KindCallExpression {
						expression = expression.AsCallExpression().Expression
					}
				}
				symbol := authored.Origin{}
				if expression != nil && expression.Kind == ast.KindCallExpression {
					symbol = project.Authored(file).ResolveImportedSymbol(expression.AsCallExpression().Expression)
				}
				if symbol.Kind != "resolved" || symbol.Name != "reference" || symbol.Module != "@astrale-os/sdk/client/session" {
					if reference != nil && !admitted.resolved {
						familyEmit(&out, "PRV-XDOM-TYPED", file, reference, "ambiguity", "Remote Domain callable reference cannot be proven from an opaque local value.")
					} else {
						familyEmit(&out, "PRV-XDOM-TYPED", file, node, "violation", "Remote Domain invocation does not construct one typed public callable reference.")
					}
				}
			}
			if node.Kind == ast.KindAsExpression && node.AsAsExpression().Type != nil && node.AsAsExpression().Type.Kind == ast.KindNeverKeyword && providerEnclosingInvoke(project, file, node) {
				familyEmit(&out, "PRV-XDOM-TYPED", file, node, "violation", "Remote Domain invocation fabricates a never cast instead of using the typed public facade.")
			}
		})
	}
	targets := []providerRemote{}
	for _, file := range familyProduction(project, "providers") {
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind == ast.KindCallExpression && providerExecutionInvoke(project, file, node) {
				target, ok := providerRemoteCallable(project, file, node, &out)
				if ok {
					targets = append(targets, target)
				}
			}
		})
	}
	if len(targets) > 0 {
		if project.ApplicationPath == "" {
			familyMissing(&out, "PRV-XDOM-REQ", nil, nil, "Captured Application root policy is unavailable.")
		} else {
			declared, indeterminate := providerApplicationRequirements(project, &out)
			for _, target := range targets {
				if declared[providerKey(target.module, target.selector)] {
					continue
				}
				kind := "violation"
				message := "Remote Domain callable " + target.module + " " + strings.Join(target.selector, ".") + " lacks one exact Application Function requirement."
				if indeterminate {
					kind = "ambiguity"
					message = "Application Function requirements are opaque for " + target.module + " " + strings.Join(target.selector, ".") + "."
				}
				familyEmit(&out, "PRV-XDOM-REQ", target.file, target.node, kind, message)
			}
		}
	}
	localLayers := map[string]bool{"functions": true, "mutations": true, "queries": true, "rules": true, "schema": true, "states": true, "ui": true, "views": true}
	operations := map[string]bool{"mutate": true, "query": true, "invoke": true, "defineAction": true, "defineWorkflow": true}
	for _, file := range familyProduction(project, "providers") {
		for _, imp := range file.Imports {
			target, known := familyResolve(project, file, imp.Specifier, "PRV-NO-DOMAIN", &out)
			if known && target != nil && localLayers[target.Layer] {
				familyEmit(&out, "PRV-NO-DOMAIN", file, imp.Node, "violation", "Provider imports local Domain layer "+target.Layer+".")
			}
		}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			chain := familyPropertyChain(node.AsCallExpression().Expression)
			if len(chain) > 0 && operations[chain[len(chain)-1]] && !providerExecutionInvoke(project, file, node) {
				familyEmit(&out, "PRV-NO-DOMAIN", file, node, "ambiguity", "Provider call "+strings.Join(chain, ".")+" resembles a local Domain operation but its instance is opaque.")
			}
		})
	}
	return out
}
