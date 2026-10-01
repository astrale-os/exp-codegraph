package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

type qmRequirements struct {
	functions, classes map[string]bool
	indeterminate      bool
}

func qmEmptyRequirements(unknown bool) qmRequirements {
	return qmRequirements{functions: map[string]bool{}, classes: map[string]bool{}, indeterminate: unknown}
}
func qmClassRequirementKey(dependency, class, operation string) string {
	return dependency + "\x00" + class + "\x00" + operation
}
func qmStaticCall(expression *ast.Node, seen map[string]bool) *ast.Node {
	if expression == nil {
		return nil
	}
	value := authored.Unwrap(expression)
	if value.Kind == ast.KindIdentifier {
		if seen[value.Text()] {
			return nil
		}
		if init := qmVisibleConst(value); init != nil {
			next := map[string]bool{}
			for k, v := range seen {
				next[k] = v
			}
			next[value.Text()] = true
			return qmStaticCall(init, next)
		}
	}
	if value.Kind == ast.KindCallExpression {
		return value
	}
	return nil
}
func qmArray(expression *ast.Node) *ast.Node {
	if expression == nil {
		return nil
	}
	value := authored.Unwrap(expression)
	if value.Kind == ast.KindArrayLiteralExpression {
		return value
	}
	return nil
}
func qmResolvedDependency(file *File, project *Project, expression *ast.Node) (string, string, bool) {
	current := authored.Unwrap(expression)
	selector := []string{}
	for current.Kind == ast.KindPropertyAccessExpression {
		property := current.AsPropertyAccessExpression()
		selector = append([]string{property.Name().Text()}, selector...)
		current = authored.Unwrap(property.Expression)
	}
	if len(selector) != 4 || selector[0] != "dependencies" || selector[2] != "classes" || current.Kind != ast.KindCallExpression {
		return "", "", false
	}
	resolve := authored.Unwrap(current.AsCallExpression().Expression)
	if resolve.Kind != ast.KindPropertyAccessExpression || resolve.AsPropertyAccessExpression().Name().Text() != "resolve" {
		return "", "", false
	}
	schema := project.Authored(file).ResolveImportedSymbol(resolve.AsPropertyAccessExpression().Expression)
	if schema.Name != "schema" || schema.Module != "@astrale-os/sdk/schema" {
		return "", "", false
	}
	return selector[1], selector[3], true
}
func qmApplicationRequirements(project *Project) qmRequirements {
	file := project.FilesByPath[project.ApplicationPath]
	if file == nil {
		return qmEmptyRequirements(true)
	}
	applications := []*ast.Node{}
	authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
		if n.Kind != ast.KindCallExpression {
			return
		}
		origin := project.Authored(file).ResolveImportedSymbol(n.AsCallExpression().Expression)
		if origin.Name == "defineApplication" && (origin.Module == "@astrale-os/sdk" || origin.Module == "@astrale-os/sdk/application") {
			applications = append(applications, n)
		}
	})
	if len(applications) != 1 {
		return qmEmptyRequirements(true)
	}
	input := qmStaticObject(authored.Argument(applications[0], 0), nil)
	value := qmAssigned(input, "requirements")
	if value == nil {
		return qmEmptyRequirements(false)
	}
	call := qmStaticCall(value, nil)
	if call == nil {
		return qmEmptyRequirements(true)
	}
	symbol := project.Authored(file).ResolveImportedSymbol(call.AsCallExpression().Expression)
	if symbol.Name != "requirements" || (symbol.Module != "@astrale-os/sdk" && symbol.Module != "@astrale-os/sdk/application") {
		return qmEmptyRequirements(true)
	}
	definition := qmStaticObject(authored.Argument(call, 0), nil)
	if definition == nil {
		return qmEmptyRequirements(authored.Argument(call, 0) != nil)
	}
	out := qmEmptyRequirements(false)
	functionsValue := qmAssigned(definition, "functions")
	functions := qmArray(functionsValue)
	if functionsValue != nil && functions == nil {
		out.indeterminate = true
	}
	if functions != nil {
		for _, value := range functions.AsArrayLiteralExpression().Elements.Nodes {
			chain := qmStaticChain(value, nil)
			if len(chain) < 2 || chain[len(chain)-2] != "functions" {
				out.indeterminate = true
			} else {
				out.functions[chain[len(chain)-1]] = true
			}
		}
	}
	classesValue := qmAssigned(definition, "classes")
	classes := qmArray(classesValue)
	if classesValue != nil && classes == nil {
		out.indeterminate = true
	}
	if classes != nil {
		for _, value := range classes.AsArrayLiteralExpression().Elements.Nodes {
			object := qmStaticObject(value, nil)
			selected := qmAssigned(object, "class")
			dependency, class, known := "", "", false
			if selected != nil {
				dependency, class, known = qmResolvedDependency(file, project, selected)
			}
			operations := qmArray(qmAssigned(object, "operations"))
			texts := []string{}
			if operations != nil {
				for _, element := range operations.AsArrayLiteralExpression().Elements.Nodes {
					text, literal := qmText(element)
					if element.Kind == ast.KindSpreadElement || !literal {
						operations = nil
						break
					}
					texts = append(texts, text)
				}
			}
			if !known || operations == nil || len(texts) == 0 {
				out.indeterminate = true
				continue
			}
			for _, operation := range texts {
				switch operation {
				case "create", "read", "update", "delete":
					out.classes[qmClassRequirementKey(dependency, class, operation)] = true
				case "traverse":
				default:
					out.indeterminate = true
				}
			}
		}
	}
	return out
}
func qmFirstIdentifier(expression *ast.Node) *ast.Node {
	current := authored.Unwrap(expression)
	for current.Kind == ast.KindPropertyAccessExpression || current.Kind == ast.KindElementAccessExpression {
		if current.Kind == ast.KindPropertyAccessExpression {
			current = authored.Unwrap(current.AsPropertyAccessExpression().Expression)
		} else {
			current = authored.Unwrap(current.AsElementAccessExpression().Expression)
		}
	}
	if current.Kind == ast.KindIdentifier {
		return current
	}
	return nil
}
func qmBuilderOperation(call *ast.Node, scopes qmBuilderScopes) string {
	builders := scopes[qmEnclosingFunction(call)]
	if builders == nil {
		return ""
	}
	chain := qmChain(call.AsCallExpression().Expression)
	if len(chain) < 2 {
		return qmBuilderMember(call, scopes)
	}
	root := qmFirstIdentifier(call.AsCallExpression().Expression)
	if root == nil || !builders[qmDeclaration(root)] {
		return ""
	}
	return strings.Join(chain[1:], ".")
}
func qmClassOperation(operation string) string {
	switch operation {
	case "createNode", "createEdge":
		return "create"
	case "expect.node", "expect.edge":
		return "read"
	case "updateNode", "updateEdge", "transition":
		return "update"
	case "deleteNode", "deleteEdge":
		return "delete"
	}
	return ""
}
func qmDependencyTarget(expression *ast.Node) (string, string, bool) {
	chain := qmStaticChain(expression, nil)
	dependency := -1
	for index, name := range chain {
		if name == "dependencies" {
			dependency = index
			break
		}
	}
	if len(chain) > 0 && chain[len(chain)-1] == "key" {
		chain = chain[:len(chain)-1]
	}
	if dependency < 0 || len(chain) != dependency+4 || chain[dependency+2] != "classes" {
		return "", "", false
	}
	return chain[dependency+1], chain[dependency+3], true
}
func qmParameterProperty(use *ast.Node, name string) bool {
	binding := qmDeclaration(use)
	if binding == nil {
		return false
	}
	if binding.Parent.Kind == ast.KindParameter && binding.Parent.Name() == binding {
		return binding.Text() == name
	}
	if binding.Parent.Kind != ast.KindBindingElement {
		return false
	}
	element := binding.Parent.AsBindingElement()
	if element.Name() != binding || binding.Parent.Parent.Kind != ast.KindObjectBindingPattern || binding.Parent.Parent.Parent.Kind != ast.KindParameter {
		return false
	}
	property := element.PropertyName
	if property == nil {
		property = element.Name()
	}
	return (property.Kind == ast.KindIdentifier || property.Kind == ast.KindStringLiteral) && property.Text() == name
}
func qmKernelRegisterCalls(project *Project, file *File) []*ast.Node {
	result := []*ast.Node{}
	for _, name := range []string{"defineAction", "defineWorkflow"} {
		for _, factory := range project.Authored(file).Calls(name, nil) {
			if factory.Origin != "resolved" {
				continue
			}
			definition := factory.Call
			if definition.Parent != nil && definition.Parent.Kind == ast.KindCallExpression && definition.Parent.AsCallExpression().Expression == definition {
				definition = definition.Parent
			}
			args := definition.AsCallExpression().Arguments.Nodes
			if len(args) == 0 {
				continue
			}
			handler := authored.Unwrap(args[len(args)-1])
			if handler.Kind != ast.KindArrowFunction && handler.Kind != ast.KindFunctionExpression {
				continue
			}
			if len(handler.Parameters()) == 0 {
				continue
			}
			parameter := handler.Parameters()[0].Name()
			type root struct {
				declaration *ast.Node
				prefix      string
			}
			roots := []root{}
			if parameter.Kind == ast.KindIdentifier {
				roots = append(roots, root{parameter, parameter.Text() + ".client"})
			} else if parameter.Kind == ast.KindObjectBindingPattern {
				for _, node := range parameter.AsBindingPattern().Elements.Nodes {
					if node.Kind != ast.KindBindingElement {
						continue
					}
					element := node.AsBindingElement()
					property := element.PropertyName
					if property == nil {
						property = element.Name()
					}
					if element.Name().Kind == ast.KindIdentifier && property.Kind == ast.KindIdentifier && property.Text() == "client" {
						roots = append(roots, root{element.Name(), element.Name().Text()})
					}
				}
			}
			authored.Walk(handler, func(node *ast.Node) {
				if node.Kind != ast.KindCallExpression {
					return
				}
				chain := qmChain(node.AsCallExpression().Expression)
				identifier := qmFirstIdentifier(node.AsCallExpression().Expression)
				if chain == nil || identifier == nil {
					return
				}
				for _, r := range roots {
					if qmDeclaration(identifier) == r.declaration && strings.Join(chain, ".") == r.prefix+".auth.register" {
						result = append(result, node)
						break
					}
				}
			})
		}
	}
	return result
}
func (w *qmWriter) planRequirements() {
	type target struct {
		file                         *File
		node                         *ast.Node
		dependency, class, operation string
	}
	targets := []target{}
	type invocation struct {
		file    *File
		node    *ast.Node
		syscall string
	}
	invocations := []invocation{}
	for _, file := range w.project.Files {
		if file.Role != "production" || file.Layer != "mutations" {
			continue
		}
		scopes := qmMutationScopes(w.project, file)
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			operation := qmClassOperation(qmBuilderOperation(node, scopes))
			if operation == "" {
				return
			}
			input := qmStaticObject(authored.Argument(node, 0), nil)
			selected := qmAssigned(input, "class")
			if selected == nil {
				return
			}
			dependency, class, known := qmDependencyTarget(selected)
			if known {
				targets = append(targets, target{file: file, node: selected, dependency: dependency, class: class, operation: operation})
			} else if authored.Contains(qmStaticChain(selected, nil), "dependencies") {
				w.ambiguity("MUT-PLAN-REQ", file, selected, "Mutation plan selects a foreign Class dynamically, so its Application requirement cannot be proven.")
			}
		})
	}
	for _, file := range w.project.Files {
		if file.Role != "production" || file.Layer != "functions" {
			continue
		}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			chain := qmChain(node.AsCallExpression().Expression)
			if strings.Join(chain, ".") == "kernel.self.auth.provision" {
				root := qmFirstIdentifier(node.AsCallExpression().Expression)
				if root != nil && qmParameterProperty(root, "kernel") {
					invocations = append(invocations, invocation{file, node, "provision"})
				}
			}
		})
		for _, node := range qmKernelRegisterCalls(w.project, file) {
			invocations = append(invocations, invocation{file, node, "register"})
		}
	}
	if len(targets) == 0 && len(invocations) == 0 {
		return
	}
	requirements := qmApplicationRequirements(w.project)
	for _, target := range targets {
		if requirements.classes[qmClassRequirementKey(target.dependency, target.class, target.operation)] {
			continue
		}
		if requirements.indeterminate {
			w.ambiguity("MUT-PLAN-REQ", target.file, target.node, "Application Class requirements are opaque for dependency "+target.dependency+" Class "+target.class+".")
		} else {
			w.violation("MUT-PLAN-REQ", target.file, target.node, "Mutation plan dependency "+target.dependency+" Class "+target.class+" lacks Application "+target.operation+" authority.")
		}
	}
	for _, invocation := range invocations {
		if requirements.functions[invocation.syscall] {
			continue
		}
		name := "Provision"
		if invocation.syscall == "register" {
			name = "Register"
		}
		if requirements.indeterminate {
			w.ambiguity("MUT-PLAN-REQ", invocation.file, invocation.node, "Application Function requirements are opaque for Kernel "+name+".")
		} else {
			w.violation("MUT-PLAN-REQ", invocation.file, invocation.node, "Kernel "+name+" invocation lacks the exact Application Function requirement.")
		}
	}
}
