package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"regexp"
)

type qmBuilderScopes map[*ast.Node]map[*ast.Node]bool

func qmBinding(binding *ast.Node, name string) *ast.Node {
	if binding == nil {
		return nil
	}
	if binding.Kind == ast.KindIdentifier {
		if binding.Text() == name {
			return binding
		}
		return nil
	}
	if binding.Kind != ast.KindObjectBindingPattern && binding.Kind != ast.KindArrayBindingPattern {
		return nil
	}
	for _, e := range binding.AsBindingPattern().Elements.Nodes {
		if e.Kind == ast.KindBindingElement {
			if found := qmBinding(e.Name(), name); found != nil {
				return found
			}
		}
	}
	return nil
}
func qmDeclaration(use *ast.Node) *ast.Node {
	if use == nil || use.Kind != ast.KindIdentifier {
		return nil
	}
	name := use.Text()
	for scope := use.Parent; scope != nil; scope = scope.Parent {
		if scope.Kind == ast.KindBlock || scope.Kind == ast.KindSourceFile {
			for _, s := range scope.StatementList().Nodes {
				if s.Kind == ast.KindFunctionDeclaration && s.Name() != nil && s.Name().Text() == name {
					return s.Name()
				}
				if s.Kind == ast.KindVariableStatement {
					for _, d := range s.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
						if b := qmBinding(d.Name(), name); b != nil {
							return b
						}
					}
				}
			}
		}
		if ast.IsFunctionLike(scope) {
			for _, p := range scope.Parameters() {
				if b := qmBinding(p.Name(), name); b != nil {
					return b
				}
			}
		}
		if scope.Kind == ast.KindCatchClause {
			d := scope.AsCatchClause().VariableDeclaration
			if d != nil {
				if b := qmBinding(d.Name(), name); b != nil {
					return b
				}
			}
		}
	}
	return nil
}
func qmMutationScopes(project *Project, file *File) qmBuilderScopes {
	scopes := qmBuilderScopes{}
	type entry struct{ owner, binding *ast.Node }
	pending := []entry{}
	add := func(owner, binding *ast.Node) {
		if scopes[owner] == nil {
			scopes[owner] = map[*ast.Node]bool{}
		}
		if !scopes[owner][binding] {
			scopes[owner][binding] = true
			pending = append(pending, entry{owner, binding})
		}
	}
	source := project.Authored(file)
	for _, d := range source.Definitions("defineMutation", "", nil, 0) {
		if d.Origin != "resolved" {
			continue
		}
		build := authored.Callback(d.Object, "build")
		if build != nil && len(build.Parameters()) > 1 {
			name := build.Parameters()[1].Name()
			if name.Kind == ast.KindIdentifier {
				add(build, name)
			}
		}
	}
	types := map[string]bool{}
	for _, s := range file.Source.Statements.Nodes {
		if s.Kind != ast.KindImportDeclaration {
			continue
		}
		d := s.AsImportDeclaration()
		if d.ModuleSpecifier == nil || (d.ModuleSpecifier.Text() != "@astrale-os/sdk" && d.ModuleSpecifier.Text() != "@astrale-os/sdk/mutation") || d.ImportClause == nil {
			continue
		}
		bindings := d.ImportClause.AsImportClause().NamedBindings
		if bindings == nil || bindings.Kind != ast.KindNamedImports {
			continue
		}
		for _, e := range bindings.AsNamedImports().Elements.Nodes {
			imp := e.AsImportSpecifier()
			name := imp.Name().Text()
			if imp.PropertyName != nil {
				name = imp.PropertyName.Text()
			}
			if name == "RichMutationBuilder" {
				types[imp.Name().Text()] = true
			}
		}
	}
	functions := map[*ast.Node]*ast.Node{}
	authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
		if n.Kind == ast.KindCallExpression {
			callee := authored.Unwrap(n.AsCallExpression().Expression)
			if callee.Kind == ast.KindPropertyAccessExpression {
				p := callee.AsPropertyAccessExpression()
				origin := source.ResolveImportedSymbol(authored.Unwrap(p.Expression))
				if p.Name().Text() == "build" && origin.Name == "MutationAST" && (origin.Module == "@astrale-os/sdk" || origin.Module == "@astrale-os/sdk/mutation") {
					build := authored.Argument(n, 0)
					if build != nil {
						build = authored.Unwrap(build)
						if (build.Kind == ast.KindArrowFunction || build.Kind == ast.KindFunctionExpression) && len(build.Parameters()) > 0 && build.Parameters()[0].Name().Kind == ast.KindIdentifier {
							add(build, build.Parameters()[0].Name())
						}
					}
				}
			}
		}
		if ast.IsFunctionLike(n) && n.Body() != nil {
			for _, p := range n.Parameters() {
				typ := p.AsParameterDeclaration().Type
				if p.Name().Kind == ast.KindIdentifier && typ != nil && typ.Kind == ast.KindTypeReference {
					name := typ.AsTypeReferenceNode().TypeName
					if name.Kind == ast.KindIdentifier && types[name.Text()] {
						add(n, p.Name())
					}
				}
			}
		}
		if n.Kind == ast.KindFunctionDeclaration && n.Name() != nil {
			functions[n.Name()] = n
		}
		if n.Kind == ast.KindVariableDeclaration && n.Name().Kind == ast.KindIdentifier && n.AsVariableDeclaration().Initializer != nil {
			value := authored.Unwrap(n.AsVariableDeclaration().Initializer)
			if value.Kind == ast.KindArrowFunction || value.Kind == ast.KindFunctionExpression {
				functions[n.Name()] = value
			}
		}
	})
	for index := 0; index < len(pending); index++ {
		item := pending[index]
		qmOwn(item.owner, func(n *ast.Node) {
			if n.Kind == ast.KindVariableDeclaration && n.Name().Kind == ast.KindIdentifier && n.AsVariableDeclaration().Initializer != nil && n.Parent.Flags&ast.NodeFlagsConst != 0 {
				init := authored.Unwrap(n.AsVariableDeclaration().Initializer)
				if qmDeclaration(init) == item.binding {
					add(item.owner, n.Name())
				}
			}
			if n.Kind != ast.KindCallExpression {
				return
			}
			call := n.AsCallExpression()
			callee := authored.Unwrap(call.Expression)
			target := functions[qmDeclaration(callee)]
			if target == nil {
				return
			}
			for index, arg := range call.Arguments.Nodes {
				arg = authored.Unwrap(arg)
				if index < len(target.Parameters()) && qmDeclaration(arg) == item.binding && target.Parameters()[index].Name().Kind == ast.KindIdentifier {
					add(target, target.Parameters()[index].Name())
				}
			}
		})
	}
	return scopes
}
func qmBuilderMember(call *ast.Node, scopes qmBuilderScopes) string {
	builders := scopes[qmEnclosingFunction(call)]
	if builders == nil {
		return ""
	}
	expression := authored.Unwrap(call.AsCallExpression().Expression)
	if expression.Kind == ast.KindPropertyAccessExpression {
		p := expression.AsPropertyAccessExpression()
		if builders[qmDeclaration(authored.Unwrap(p.Expression))] {
			return p.Name().Text()
		}
	}
	if expression.Kind == ast.KindElementAccessExpression {
		e := expression.AsElementAccessExpression()
		if builders[qmDeclaration(authored.Unwrap(e.Expression))] {
			if text, ok := qmText(e.ArgumentExpression); ok {
				return text
			}
		}
	}
	if expression.Kind != ast.KindIdentifier {
		return ""
	}
	binding := qmDeclaration(expression)
	if binding == nil || binding.Parent == nil || binding.Parent.Kind != ast.KindBindingElement {
		return ""
	}
	element := binding.Parent.AsBindingElement()
	if element.DotDotDotToken != nil || element.Name() != binding || binding.Parent.Parent.Kind != ast.KindObjectBindingPattern {
		return ""
	}
	declaration := binding.Parent.Parent.Parent
	if declaration.Kind != ast.KindVariableDeclaration {
		return ""
	}
	init := declaration.AsVariableDeclaration().Initializer
	if init == nil || !builders[qmDeclaration(authored.Unwrap(init))] {
		return ""
	}
	name := element.PropertyName
	if name == nil {
		name = element.Name()
	}
	if name.Kind == ast.KindIdentifier || name.Kind == ast.KindStringLiteral {
		return name.Text()
	}
	return ""
}

var qmLocalAlias = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

func qmJSON(value string) string { return qmQuoteJSON(value) }

func (w *qmWriter) localAliases(file *File) {
	scopes := qmMutationScopes(w.project, file)
	authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
		if n.Kind != ast.KindCallExpression || qmBuilderMember(n, scopes) != "createNode" {
			return
		}
		input := authored.Argument(n, 0)
		if input == nil {
			return
		}
		input = authored.Unwrap(input)
		value := authored.PropertyExpression(input, "as")
		if value == nil {
			property := authored.ObjectProperty(input, "as")
			if property != nil && property.Kind == ast.KindShorthandPropertyAssignment {
				value = property.Name()
			}
		}
		if value == nil {
			return
		}
		literal, known := qmText(value)
		if !known || qmLocalAlias.MatchString(literal) {
			return
		}
		w.violation("MUT-LOCAL-ALIAS", file, value, "Mutation createNode local alias "+qmJSON(literal)+" is invalid; use 1-64 ASCII letters, digits, or underscores and start with a letter.")
	})
}
