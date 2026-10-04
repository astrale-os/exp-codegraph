// Package authoredsource owns the exact SDK source-authoring interpretation.
// It intentionally does not follow local callable aliases or strengthen
// relative-facade origins with runtime provenance. No filesystem or Program.
package authoredsource

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

var SDKModules = []string{"@astrale-os/sdk", "@astrale-os/sdk/action", "@astrale-os/sdk/integration", "@astrale-os/sdk/query", "@astrale-os/sdk/mutation", "@astrale-os/sdk/state", "@astrale-os/sdk/workflow"}
var DSLModules = []string{"@astrale-os/sdk/schema", "@astrale-os/kernel-dsl", "@astrale-os/kernel-dsl/v1", "@astrale-os/kernel-core"}

type Origin struct{ Kind, Module, Name, Reason string }
type Call struct {
	Call   *ast.Node
	Origin string
	Module string
}
type Definition struct {
	Call, Object, Projector *ast.Node
	Origin                  string
}
type File struct {
	Source          *ast.SourceFile
	LocallyDeclared func(*ast.Node) bool
	named           map[string]Origin
	namespaces      map[string]string
	direct, curried map[string][]Call
	members         map[string]map[string][]Call
	resolutions     map[*ast.Node]Origin
}

func New(source *ast.SourceFile, ownership ...func(*ast.Node) bool) *File {
	f := &File{Source: source, LocallyDeclared: func(n *ast.Node) bool { return LocallyOwned(n, false) }, named: map[string]Origin{}, namespaces: map[string]string{}, direct: map[string][]Call{}, curried: map[string][]Call{}, members: map[string]map[string][]Call{}, resolutions: map[*ast.Node]Origin{}}
	if len(ownership) > 0 && ownership[0] != nil {
		f.LocallyDeclared = ownership[0]
	}
	if source == nil {
		return f
	}
	for _, statement := range source.Statements.Nodes {
		if statement.Kind != ast.KindImportDeclaration {
			continue
		}
		d := statement.AsImportDeclaration()
		if d.ModuleSpecifier == nil || d.ModuleSpecifier.Kind != ast.KindStringLiteral || d.ImportClause == nil {
			continue
		}
		bindings, namespace := CollectImportBindings(statement)
		if namespace != "" {
			if _, ok := f.namespaces[namespace]; !ok {
				f.namespaces[namespace] = d.ModuleSpecifier.Text()
			}
		}
		for _, binding := range bindings {
			if _, ok := f.named[binding.Local]; !ok {
				f.named[binding.Local] = symbol(d.ModuleSpecifier.Text(), binding.Imported)
			}
		}
	}
	add := func(index map[string][]Call, call, expression *ast.Node) {
		origin := f.ResolveImportedSymbol(expression)
		if origin.Kind == "resolved" || origin.Kind == "ambiguous" {
			index[origin.Name] = append(index[origin.Name], Call{call, origin.Kind, origin.Module})
		}
	}
	Walk(source.AsNode(), func(node *ast.Node) {
		if node.Kind != ast.KindCallExpression {
			return
		}
		expression := node.AsCallExpression().Expression
		add(f.direct, node, expression)
		value := Unwrap(expression)
		if value.Kind == ast.KindCallExpression {
			add(f.curried, node, value.AsCallExpression().Expression)
		}
		if value.Kind == ast.KindPropertyAccessExpression {
			p := value.AsPropertyAccessExpression()
			name := p.Name().Text()
			if f.members[name] == nil {
				f.members[name] = map[string][]Call{}
			}
			add(f.members[name], node, p.Expression)
		}
	})
	return f
}
func symbol(module, name string) Origin {
	if strings.HasPrefix(module, ".") || strings.HasPrefix(module, "#") {
		return Origin{"ambiguous", module, name, "reexport-origin"}
	}
	return Origin{"resolved", module, name, ""}
}
func (f *File) ResolveImportedSymbol(expression *ast.Node) Origin {
	if expression == nil {
		return Origin{Kind: "local"}
	}
	if cached, ok := f.resolutions[expression]; ok {
		return cached
	}
	target := Unwrap(expression)
	result := Origin{Kind: "local"}
	if target.Kind == ast.KindIdentifier && !f.LocallyDeclared(target) {
		if binding, ok := f.named[target.Text()]; ok {
			result = binding
		}
	} else if target.Kind == ast.KindPropertyAccessExpression {
		property := target.AsPropertyAccessExpression()
		if property.Expression.Kind == ast.KindIdentifier && !f.LocallyDeclared(property.Expression) {
			if module, ok := f.namespaces[property.Expression.Text()]; ok {
				result = symbol(module, property.Name().Text())
			}
		}
	}
	f.resolutions[expression] = result
	return result
}
func match(candidates []Call, modules []string) []Call {
	out := []Call{}
	for _, candidate := range candidates {
		if candidate.Origin == "ambiguous" || Contains(modules, candidate.Module) {
			out = append(out, candidate)
		}
	}
	return out
}
func (f *File) Calls(name string, modules []string) []Call {
	if modules == nil {
		modules = SDKModules
	}
	return match(f.direct[name], modules)
}
func (f *File) MemberCalls(name, member string, modules []string) []Call {
	if modules == nil {
		modules = SDKModules
	}
	return match(f.members[member][name], modules)
}
func (f *File) Definitions(name, member string, modules []string, argumentIndex int) []Definition {
	if modules == nil {
		modules = SDKModules
	}
	calls := f.Calls(name, modules)
	curried := member == "" && Contains([]string{"defineCollectionQuery", "defineCompositeQuery", "defineMutation", "defineQuery"}, name)
	if curried {
		calls = match(f.curried[name], modules)
	} else if member != "" {
		calls = f.MemberCalls(name, member, modules)
	}
	out := []Definition{}
	for _, call := range calls {
		definition := Definition{Call: call.Call, Origin: call.Origin}
		argument := Argument(call.Call, argumentIndex)
		if curried {
			if argument != nil {
				value := Unwrap(argument)
				if value.Kind == ast.KindArrowFunction || value.Kind == ast.KindFunctionExpression {
					definition.Projector = value
					returns := ReturnedExpressions(value)
					if len(returns) == 1 && Unwrap(returns[0]).Kind == ast.KindObjectLiteralExpression {
						definition.Object = Unwrap(returns[0])
					}
				}
			}
		} else if argument != nil && Unwrap(argument).Kind == ast.KindObjectLiteralExpression {
			definition.Object = Unwrap(argument)
		}
		out = append(out, definition)
	}
	return out
}
func Contains(values []string, s string) bool {
	for _, v := range values {
		if v == s {
			return true
		}
	}
	return false
}
func Walk(node *ast.Node, callback func(*ast.Node)) {
	if node == nil {
		return
	}
	callback(node)
	node.ForEachChild(func(child *ast.Node) bool { Walk(child, callback); return false })
}
func Unwrap(node *ast.Node) *ast.Node {
	for node != nil {
		switch node.Kind {
		case ast.KindParenthesizedExpression:
			node = node.AsParenthesizedExpression().Expression
		case ast.KindAsExpression:
			node = node.AsAsExpression().Expression
		case ast.KindSatisfiesExpression:
			node = node.AsSatisfiesExpression().Expression
		case ast.KindNonNullExpression:
			node = node.AsNonNullExpression().Expression
		default:
			return node
		}
	}
	return nil
}
func Argument(call *ast.Node, index int) *ast.Node {
	if call == nil || call.Kind != ast.KindCallExpression {
		return nil
	}
	args := call.AsCallExpression().Arguments
	if args == nil || index < 0 || index >= len(args.Nodes) {
		return nil
	}
	return args.Nodes[index]
}
func ReturnedExpressions(fn *ast.Node) []*ast.Node {
	out := []*ast.Node{}
	if fn == nil || fn.Body() == nil {
		return out
	}
	body := fn.Body()
	if body.Kind != ast.KindBlock {
		return []*ast.Node{Unwrap(body)}
	}
	var walk func(*ast.Node)
	walk = func(node *ast.Node) {
		if node != fn && ast.IsFunctionLike(node) {
			return
		}
		if node.Kind == ast.KindReturnStatement && node.AsReturnStatement().Expression != nil {
			out = append(out, Unwrap(node.AsReturnStatement().Expression))
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	body.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	return out
}
func StaticText(node *ast.Node) (string, bool) {
	node = Unwrap(node)
	if node != nil && (node.Kind == ast.KindStringLiteral || node.Kind == ast.KindNoSubstitutionTemplateLiteral) {
		value, err := jsstring.FromNode(node)
		if err != nil {
			return "", false
		}
		return value.WTF8(), true
	}
	return "", false
}
func PropertyName(node *ast.Node) (string, bool) {
	if node == nil {
		return "", false
	}
	switch node.Kind {
	case ast.KindStringLiteral:
		return StaticText(node)
	case ast.KindIdentifier, ast.KindNumericLiteral:
		return node.Text(), true
	case ast.KindComputedPropertyName:
		return StaticText(node.AsComputedPropertyName().Expression)
	}
	return "", false
}
func ObjectProperty(object *ast.Node, name string) *ast.Node {
	if object == nil || object.Kind != ast.KindObjectLiteralExpression {
		return nil
	}
	for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
		if n, ok := PropertyName(property.Name()); ok && n == name {
			return property
		}
	}
	return nil
}
func PropertyExpression(object *ast.Node, name string) *ast.Node {
	property := ObjectProperty(object, name)
	if property != nil && property.Kind == ast.KindPropertyAssignment {
		return Unwrap(property.AsPropertyAssignment().Initializer)
	}
	return nil
}
func Callback(object *ast.Node, name string) *ast.Node {
	property := ObjectProperty(object, name)
	if property == nil {
		return nil
	}
	if property.Kind == ast.KindMethodDeclaration {
		return property
	}
	if property.Kind == ast.KindPropertyAssignment {
		value := Unwrap(property.AsPropertyAssignment().Initializer)
		if value.Kind == ast.KindArrowFunction || value.Kind == ast.KindFunctionExpression {
			return value
		}
	}
	return nil
}
func (f *File) ImportedSymbol(expression *ast.Node) (Origin, bool) {
	origin := f.ResolveImportedSymbol(expression)
	return origin, origin.Kind == "resolved" || origin.Kind == "ambiguous"
}
func PropertyChain(expression *ast.Node) []string {
	value := Unwrap(expression)
	if value == nil {
		return nil
	}
	if value.Kind == ast.KindIdentifier {
		return []string{value.Text()}
	}
	if value.Kind != ast.KindPropertyAccessExpression {
		return nil
	}
	property := value.AsPropertyAccessExpression()
	root := PropertyChain(property.Expression)
	if root == nil {
		return nil
	}
	return append(root, property.Name().Text())
}
func CallChain(expression *ast.Node) []string {
	value := Unwrap(expression)
	if value != nil && value.Kind == ast.KindCallExpression {
		return PropertyChain(value.AsCallExpression().Expression)
	}
	if value != nil && value.Kind == ast.KindPropertyAccessExpression {
		return PropertyChain(value)
	}
	return nil
}
func IsTopLevelDefinition(node *ast.Node) bool {
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if ast.IsFunctionLike(parent) {
			return false
		}
		if parent.Kind == ast.KindSourceFile {
			return true
		}
	}
	return false
}
func ObjectArgument(call *ast.Node, index int) *ast.Node {
	value := Unwrap(Argument(call, index))
	if value != nil && value.Kind == ast.KindObjectLiteralExpression {
		return value
	}
	return nil
}
func (f *File) NamespaceModule(name string) (string, bool) {
	module, ok := f.namespaces[name]
	return module, ok
}

// CollectImportBindings preserves JS Map insertion order and last value for a
// repeated imported key. Per-file ownership then preserves first visible local.
type Binding struct{ Imported, Local string }

func CollectImportBindings(statement *ast.Node) ([]Binding, string) {
	out := []Binding{}
	namespace := ""
	if statement == nil || statement.Kind != ast.KindImportDeclaration {
		return out, namespace
	}
	d := statement.AsImportDeclaration()
	if d.ImportClause == nil {
		return out, namespace
	}
	clause := d.ImportClause.AsImportClause()
	positions := map[string]int{}
	put := func(imported, local string) {
		if index, ok := positions[imported]; ok {
			out[index].Local = local
		} else {
			positions[imported] = len(out)
			out = append(out, Binding{imported, local})
		}
	}
	if clause.Name() != nil {
		put("default", clause.Name().Text())
	}
	if clause.NamedBindings != nil {
		if clause.NamedBindings.Kind == ast.KindNamespaceImport {
			namespace = clause.NamedBindings.Name().Text()
		} else if clause.NamedBindings.Kind == ast.KindNamedImports {
			for _, element := range clause.NamedBindings.AsNamedImports().Elements.Nodes {
				e := element.AsImportSpecifier()
				name := e.Name().Text()
				if e.PropertyName != nil {
					name = e.PropertyName.Text()
				}
				put(name, e.Name().Text())
			}
		}
	}
	return out, namespace
}
