package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

type InvocationTarget struct {
	CallableTarget
	File *File
	Node *ast.Node
}

func EvaluateDependencies(project *Project, rule string) Result {
	out := Result{Evidence: []Evidence{}, Residual: []Residual{}}
	emit := func(file *File, node *ast.Node, kind, message string) {
		out.Evidence = append(out.Evidence, Evidence{Rule:rule,Kind:kind,Evidence:message,File:file,Node:node})
	}
	if rule == "FNC-XDOM-DECLARED" {
		for _, file := range project.Files {
			if file.Role == "production" && file.Layer == "functions" {
				for _, imp := range file.Imports {
					if foreignDomain(imp.Specifier) {
						emit(file, imp.Node, "violation", fmt.Sprintf("Handler imports foreign Domain %s; use declared dependencies or an Integration.", imp.Specifier))
					}
				}
			}
		}
	}
	targets, evidence := observeInvocations(project, rule)
	if rule == "FNC-XDOM-DECLARED" {
		out.Evidence = append(out.Evidence, evidence...)
		return out
	}
	declared := ApplicationFunctionRequirements(project)
	if !declared.Known {
		out.Residual = append(out.Residual, Residual{Rule: rule, Reason: "Application Function requirement capture authority unavailable"})
	}
	for _, item := range evidence {
		if item.Kind == "ambiguity" {
			out.Evidence = append(out.Evidence, item)
		}
	}
	for _, target := range targets {
		if declared.Keys[RemoteCallableKey(target.CallableTarget)] {
			continue
		}
		kind := "violation"
		if declared.Indeterminate {
			kind = "ambiguity"
		}
		emit(target.File, target.Node, kind, fmt.Sprintf("Remote Domain callable %s %s lacks one provable exact Application Function requirement.", target.Module, strings.Join(target.Selector, ".")))
	}
	return out
}
func observeInvocations(project *Project, rule string) ([]InvocationTarget, []Evidence) {
	dependencies := DeclaredDomainDependencies(project)
	targets := []InvocationTarget{}
	evidence := []Evidence{}
	emit := func(file *File, node *ast.Node, kind, message string) {
		evidence = append(evidence, Evidence{Rule:rule,Kind:kind,Evidence:message,File:file,Node:node})
	}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "functions" {
			continue
		}
		definitions := append(project.Authored(file).Calls("defineAction", nil), project.Authored(file).Calls("defineWorkflow", nil)...)
		for _, definition := range definitions {
			if definition.Origin == "ambiguous" {
				emit(file, definition.Call, "ambiguity", "Handler definition resolves through a local facade whose ultimate public constructor origin is unknown.")
				continue
			}
			call := definition.Call
			if call.Parent != nil && call.Parent.Kind == ast.KindCallExpression && call.Parent.AsCallExpression().Expression == call {
				call = call.Parent
			}
			var candidate *ast.Node
			if call.AsCallExpression().Arguments != nil {
				args := call.AsCallExpression().Arguments.Nodes
				if len(args) == 2 {
					candidate = args[1]
				} else if len(args) == 3 {
					candidate = args[2]
				}
			}
			run := authored.Unwrap(candidate)
			if run == nil || !(run.Kind == ast.KindArrowFunction || run.Kind == ast.KindFunctionExpression) {
				emit(file, call, "ambiguity", "Handler run is not a static function.")
				continue
			}
			authored.Walk(run.Body(), func(node *ast.Node) {
				if node.Kind != ast.KindCallExpression {
					return
				}
				path, ok := contextPath(node.AsCallExpression().Expression, run, 1)
				if !ok || len(path) == 0 || path[len(path)-1] != "invoke" {
					return
				}
				if authored.Contains(path, "[computed]") {
					emit(file, node, "ambiguity", "Computed dependency invocation cannot be proven statically.")
					return
				}
				alias := ""
				var selector []string
				if path[0] == "dependencies" {
					if len(path) != 4 || !authored.Contains([]string{"caller", "self", "union"}, path[2]) {
						emit(file, node, "violation", "Dependency invocation requires one direct alias and one explicit caller, self, or union authority.")
						return
					}
					alias = path[1]
					selector = selectedCallable(authored.Argument(node, 0))
				} else if path[0] == "kernel" && (len(path) == 2 || len(path) == 3 && authored.Contains([]string{"caller", "self", "union"}, path[1])) {
					argument := authored.Argument(node, 0)
					if argument == nil {
						emit(file, node, "violation", "Kernel invocation requires one canonical typed reference.")
						return
					}
					reference, resolved := CallableReference(authored.Unwrap(argument))
					if reference != nil && reference.Kind == ast.KindCallExpression && reference.AsCallExpression().Expression.Kind == ast.KindCallExpression {
						reference = reference.AsCallExpression().Expression
					}
					if !resolved {
						emit(file, node, "ambiguity", "Kernel invocation reference is opaque.")
						return
					}
					symbol := authored.Origin{}
					if reference != nil && reference.Kind == ast.KindCallExpression {
						symbol = project.Authored(file).ResolveImportedSymbol(reference.AsCallExpression().Expression)
					}
					if symbol.Kind != "resolved" || symbol.Module != "@astrale-os/sdk/client/session" || symbol.Name != "reference" || reference.Kind != ast.KindCallExpression {
						emit(file, node, "violation", "Kernel invocation requires one canonical typed reference.")
						return
					}
					domain, dok := contextPath(authored.Argument(reference, 0), run, 1)
					callable, cok := contextPath(authored.Argument(reference, 1), run, 1)
					if dok && len(domain) == 1 && domain[0] == "domain" {
						return
					}
					prefix := dok && cok && len(domain) == 3 && domain[0] == "domain" && domain[1] == "dependencies" && len(callable) >= len(domain)
					if prefix {
						for i, part := range domain {
							prefix = prefix && part == callable[i]
						}
					}
					if prefix {
						alias = domain[2]
						selector = callable[3:]
					}
				} else {
					return
				}
				if alias == "" || !CallableSelector(selector) {
					emit(file, node, "ambiguity", "Remote callable selector cannot be proven from one static selector or typed reference.")
					return
				}
				module, ok := dependencies.Aliases[alias]
				if !ok {
					kind := "violation"
					if dependencies.Indeterminate {
						kind = "ambiguity"
					}
					emit(file, node, kind, fmt.Sprintf("Dependency alias %s is not one declared public Domain dependency.", alias))
					return
				}
				targets = append(targets, InvocationTarget{CallableTarget{module, selector}, file, node})
			})
		}
	}
	return targets, evidence
}
func selectedCallable(input *ast.Node) []string {
	selector, resolved := CallableReference(authored.Unwrap(input))
	if !resolved || selector == nil || !(selector.Kind == ast.KindArrowFunction || selector.Kind == ast.KindFunctionExpression) || selector.ModifierFlags()&ast.ModifierFlagsAsync != 0 {
		return nil
	}
	params := selector.Parameters()
	if len(params) == 0 || params[0].AsParameterDeclaration().Name().Kind != ast.KindIdentifier {
		return nil
	}
	parameter := params[0].AsParameterDeclaration().Name().Text()
	expression := selector.Body()
	if expression.Kind == ast.KindBlock {
		statements := expression.AsBlock().Statements.Nodes
		if len(statements) != 1 || statements[0].Kind != ast.KindReturnStatement {
			return nil
		}
		expression = statements[0].AsReturnStatement().Expression
	}
	chain := authored.PropertyChain(expression)
	if len(chain) > 0 && chain[0] == parameter {
		return chain[1:]
	}
	return nil
}
func contextPath(input, run *ast.Node, aliases int) ([]string, bool) {
	expression := authored.Unwrap(input)
	if expression == nil {
		return nil, false
	}
	if expression.Kind == ast.KindPropertyAccessExpression {
		base, ok := contextPath(expression.AsPropertyAccessExpression().Expression, run, aliases)
		return append(base, expression.AsPropertyAccessExpression().Name().Text()), ok
	}
	if expression.Kind == ast.KindElementAccessExpression {
		base, ok := contextPath(expression.AsElementAccessExpression().Expression, run, aliases)
		return append(base, "[computed]"), ok
	}
	if expression.Kind != ast.KindIdentifier {
		return nil, false
	}
	for current := expression.Parent; current != nil; current = current.Parent {
		if ast.IsFunctionLike(current) {
			for i, parameter := range current.Parameters() {
				path, ok := bindingPath(parameter.AsParameterDeclaration().Name(), expression.Text())
				if ok {
					return path, current == run && i == 0
				}
			}
		}
		var statements []*ast.Node
		switch current.Kind {
		case ast.KindBlock:
			statements = current.AsBlock().Statements.Nodes
		case ast.KindSourceFile:
			statements = current.AsSourceFile().Statements.Nodes
		}
		for _, statement := range statements {
			if statement.Kind == ast.KindFunctionDeclaration && statement.Name() != nil && statement.Name().Text() == expression.Text() {
				return nil, false
			}
			if statement.Kind != ast.KindVariableStatement {
				continue
			}
			list := statement.AsVariableStatement().DeclarationList
			for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
				decl := d.AsVariableDeclaration()
				path, ok := bindingPath(decl.Name(), expression.Text())
				if !ok {
					continue
				}
				if aliases == 0 || decl.Initializer == nil || d.End() > expression.Pos() || list.Flags&ast.NodeFlagsConst == 0 {
					return nil, false
				}
				base, ok := contextPath(decl.Initializer, run, aliases-1)
				return append(base, path...), ok
			}
		}
	}
	return nil, false
}
func bindingPath(name *ast.Node, identifier string) ([]string, bool) {
	if name.Kind == ast.KindIdentifier {
		return []string{}, name.Text() == identifier
	}
	if name.Kind != ast.KindObjectBindingPattern {
		return nil, false
	}
	for _, e := range name.AsBindingPattern().Elements.Nodes {
		element := e.AsBindingElement()
		if element.DotDotDotToken != nil {
			continue
		}
		nested, ok := bindingPath(element.Name(), identifier)
		property := element.PropertyName
		if property == nil && element.Name().Kind == ast.KindIdentifier {
			property = element.Name()
		}
		if ok && property != nil && (property.Kind == ast.KindIdentifier || property.Kind == ast.KindStringLiteral) {
			return append([]string{property.Text()}, nested...), true
		}
	}
	return nil, false
}
