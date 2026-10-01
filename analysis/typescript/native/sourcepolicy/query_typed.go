package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

func qmClosedPlan(expression *ast.Node, builder *qmComposeBuilder) bool {
	value := authored.Unwrap(expression)
	if value == nil || value.Kind != ast.KindCallExpression {
		return false
	}
	method := builder.method(value.AsCallExpression().Expression)
	return method == "combine" || method == "union"
}
func (w *qmWriter) composeReturns(file *File, compose *ast.Node, builder *qmComposeBuilder) {
	const rule = "QRY-COMPOSE-TYPED"
	body := compose.Body()
	if body == nil {
		return
	}
	if body.Kind != ast.KindBlock {
		if !qmClosedPlan(body, builder) {
			w.violation(rule, file, body, "Composite Query compose does not return the closed plan from combine or union.")
		}
		return
	}
	returns := 0
	qmOwn(compose, func(n *ast.Node) {
		if n.Kind == ast.KindReturnStatement {
			returns++
			expression := n.AsReturnStatement().Expression
			if expression == nil || !qmClosedPlan(expression, builder) {
				w.violation(rule, file, n, "Composite Query compose return does not produce the closed plan from combine or union.")
			}
		} else if n.Kind == ast.KindThrowStatement {
			w.violation(rule, file, n, "Composite Query compose throws instead of constructing its plan.")
		}
	})
	if returns == 0 {
		w.violation(rule, file, compose, "Composite Query compose has no returned closed QueryPlan.")
	}
}
func qmResultCallbacks(combine, compose *ast.Node, builder *qmComposeBuilder) ([]*ast.Node, bool) {
	callbacks := []*ast.Node{}
	seenCallbacks := map[*ast.Node]bool{}
	active, completed := map[*ast.Node]bool{}, map[*ast.Node]bool{}
	remaining := 256
	incomplete := false
	var inspect func(*ast.Node)
	inspect = func(node *ast.Node) {
		remaining--
		if remaining < 0 {
			incomplete = true
			return
		}
		if qmResultCallback(node) {
			if !seenCallbacks[node] {
				seenCallbacks[node] = true
				callbacks = append(callbacks, node)
			}
			return
		}
		if node.Kind == ast.KindIdentifier {
			resolution := qmComposeBinding(node, compose)
			if resolution.kind == "ambiguous" {
				incomplete = true
				return
			}
			if resolution.kind != "value" {
				return
			}
			alias := resolution.node
			if active[alias] {
				incomplete = true
				return
			}
			if completed[alias] {
				return
			}
			active[alias] = true
			inspect(alias)
			delete(active, alias)
			completed[alias] = true
			return
		}
		if node.Kind == ast.KindPropertyAccessExpression || node.Kind == ast.KindElementAccessExpression {
			if qmSymbolicMember(node, compose, builder) {
				return
			}
			projection := qmStaticProjection(node, compose, builder)
			if projection.kind == "ambiguous" {
				incomplete = true
			}
			if projection.kind == "value" {
				inspect(projection.node)
			}
			return
		}
		qmComposeChildren(node, inspect, true)
	}
	for _, arg := range combine.AsCallExpression().Arguments.Nodes {
		if arg.Kind == ast.KindSpreadElement {
			arg = arg.AsSpreadElement().Expression
		}
		inspect(arg)
	}
	return callbacks, incomplete
}
func (w *qmWriter) composeReachability(file *File, compose *ast.Node, builder *qmComposeBuilder) {
	authoredCalls := []*ast.Node{}
	qmOwn(compose, func(n *ast.Node) {
		if n.Kind == ast.KindCallExpression && builder.method(n.AsCallExpression().Expression) != "" {
			authoredCalls = append(authoredCalls, n)
		}
	})
	if len(authoredCalls) == 0 || compose.Body() == nil {
		return
	}
	roots := []*ast.Node{}
	if compose.Body().Kind != ast.KindBlock {
		if qmClosedPlan(compose.Body(), builder) {
			roots = append(roots, authored.Unwrap(compose.Body()))
		}
	} else {
		qmOwn(compose, func(n *ast.Node) {
			if n.Kind == ast.KindReturnStatement && qmClosedPlan(n.AsReturnStatement().Expression, builder) {
				roots = append(roots, authored.Unwrap(n.AsReturnStatement().Expression))
			}
		})
	}
	if len(roots) == 0 {
		return
	}
	reachable, active, completed := map[*ast.Node]bool{}, map[*ast.Node]bool{}, map[*ast.Node]bool{}
	remaining := 256
	incomplete := false
	var trace func(*ast.Node)
	var symbolic func(*ast.Node, map[*ast.Node]bool) bool
	symbolic = func(node *ast.Node, seen map[*ast.Node]bool) bool {
		if seen[node] {
			incomplete = true
			return false
		}
		seen[node] = true
		value := authored.Unwrap(node)
		if value.Kind == ast.KindPropertyAccessExpression || value.Kind == ast.KindElementAccessExpression {
			base, key, known := qmMember(value)
			resolution := qmResolveComposeNode(base, compose, builder, map[*ast.Node]bool{})
			if resolution.kind == "value" && resolution.node.Kind == ast.KindCallExpression && builder.method(resolution.node.AsCallExpression().Expression) != "" && known && key == "value" {
				trace(resolution.node)
				return true
			}
			return symbolic(base, seen)
		}
		if value.Kind == ast.KindCallExpression {
			if builder.method(value.AsCallExpression().Expression) == "" {
				return false
			}
			trace(value)
			return true
		}
		if value.Kind != ast.KindIdentifier {
			return false
		}
		binding := qmComposeBinding(value, compose)
		if binding.kind == "ambiguous" {
			incomplete = true
		}
		return binding.kind == "value" && symbolic(binding.node, seen)
	}
	trace = func(node *ast.Node) {
		remaining--
		if remaining < 0 {
			incomplete = true
			return
		}
		if qmResultCallback(node) {
			return
		}
		if node.Kind == ast.KindCallExpression {
			method := builder.method(node.AsCallExpression().Expression)
			if method == "" {
				incomplete = true
				return
			}
			if reachable[node] {
				return
			}
			reachable[node] = true
			if method == "combine" {
				for _, arg := range node.AsCallExpression().Arguments.Nodes {
					if arg.Kind == ast.KindSpreadElement {
						arg = arg.AsSpreadElement().Expression
					}
					trace(arg)
				}
			} else if arg := authored.Argument(node, 2); arg != nil {
				trace(arg)
			}
			return
		}
		if node.Kind == ast.KindIdentifier {
			binding := qmComposeBinding(node, compose)
			if binding.kind == "ambiguous" {
				incomplete = true
				return
			}
			if binding.kind != "value" {
				return
			}
			if active[binding.node] {
				incomplete = true
				return
			}
			if completed[binding.node] {
				return
			}
			active[binding.node] = true
			trace(binding.node)
			delete(active, binding.node)
			completed[binding.node] = true
			return
		}
		if node.Kind == ast.KindPropertyAccessExpression || node.Kind == ast.KindElementAccessExpression {
			projection := qmStaticProjection(node, compose, builder)
			if projection.kind == "value" {
				trace(projection.node)
			} else if !symbolic(node, map[*ast.Node]bool{}) && projection.kind == "ambiguous" {
				incomplete = true
			}
			return
		}
		qmComposeChildren(node, trace, false)
	}
	for _, root := range roots {
		trace(root)
	}
	if incomplete {
		w.ambiguity("QRY-COMPOSE-TYPED", file, compose, "Composite Query plan reachability reached an unresolved edge, cycle, or node limit.")
		return
	}
	for _, node := range authoredCalls {
		if !reachable[node] {
			w.violation("QRY-COMPOSE-TYPED", file, node, "Composite Query builder node is unreachable from its returned plan.")
		}
	}
}
func qmAssignment(node *ast.Node) bool {
	return node.Kind == ast.KindBinaryExpression && node.AsBinaryExpression().OperatorToken.Kind >= ast.KindFirstAssignment && node.AsBinaryExpression().OperatorToken.Kind <= ast.KindLastAssignment
}
func qmWriteTarget(node *ast.Node) *ast.Node {
	if qmAssignment(node) {
		return node.AsBinaryExpression().Left
	}
	switch node.Kind {
	case ast.KindDeleteExpression:
		return node.AsDeleteExpression().Expression
	case ast.KindPrefixUnaryExpression:
		return node.AsPrefixUnaryExpression().Operand
	case ast.KindPostfixUnaryExpression:
		return node.AsPostfixUnaryExpression().Operand
	case ast.KindForInStatement, ast.KindForOfStatement:
		return node.AsForInOrOfStatement().Initializer
	case ast.KindVariableDeclaration, ast.KindFunctionDeclaration:
		return node.Name()
	}
	return nil
}
func qmEffectWrite(node *ast.Node) bool {
	if qmAssignment(node) || node.Kind == ast.KindDeleteExpression || node.Kind == ast.KindForInStatement || node.Kind == ast.KindForOfStatement {
		return true
	}
	if node.Kind == ast.KindPrefixUnaryExpression {
		operator := node.AsPrefixUnaryExpression().Operator
		return operator == ast.KindPlusPlusToken || operator == ast.KindMinusMinusToken
	}
	if node.Kind == ast.KindPostfixUnaryExpression {
		operator := node.AsPostfixUnaryExpression().Operator
		return operator == ast.KindPlusPlusToken || operator == ast.KindMinusMinusToken
	}
	return false
}
func qmBuilderReference(identifier *ast.Node, builder *qmComposeBuilder) bool {
	if qmComposeReference(identifier, builder.root, builder.owner) {
		return true
	}
	for _, binding := range builder.bindings {
		if qmComposeReference(identifier, binding, builder.owner) {
			return true
		}
	}
	return false
}
func qmWriteBuilderTarget(node *ast.Node, builder *qmComposeBuilder) bool {
	target := authored.Unwrap(node)
	if target.Kind == ast.KindIdentifier {
		return qmBuilderReference(target, builder)
	}
	if target.Kind == ast.KindBindingElement {
		return qmWriteBuilderTarget(target.Name(), builder)
	}
	if target.Kind == ast.KindArrayBindingPattern || target.Kind == ast.KindObjectBindingPattern {
		for _, e := range target.AsBindingPattern().Elements.Nodes {
			if qmWriteBuilderTarget(e, builder) {
				return true
			}
		}
		return false
	}
	if qmAssignment(target) {
		return qmWriteBuilderTarget(target.AsBinaryExpression().Left, builder)
	}
	if target.Kind == ast.KindPropertyAccessExpression || target.Kind == ast.KindElementAccessExpression {
		base, _, _ := qmMember(target)
		return qmWriteBuilderTarget(base, builder)
	}
	found := false
	qmComposeChildren(target, func(n *ast.Node) {
		if qmWriteBuilderTarget(n, builder) {
			found = true
		}
	}, false)
	return found
}
func qmOwnerVar(list, owner *ast.Node) bool {
	return list.Flags&ast.NodeFlagsBlockScoped == 0 && qmEnclosingFunction(list) == owner
}
func qmWritesBuilder(node *ast.Node, builder *qmComposeBuilder) bool {
	if qmAssignment(node) || node.Kind == ast.KindDeleteExpression {
		return qmWriteBuilderTarget(qmWriteTarget(node), builder)
	}
	if node.Kind == ast.KindVariableDeclaration && node.AsVariableDeclaration().Initializer != nil && node.Parent.Kind == ast.KindVariableDeclarationList && qmOwnerVar(node.Parent, builder.owner) {
		return qmWriteBuilderTarget(node.Name(), builder)
	}
	if node.Kind == ast.KindFunctionDeclaration && node.Name() != nil && node.Parent == builder.owner.Body() {
		return qmBuilderReference(node.Name(), builder)
	}
	if node.Kind == ast.KindForInStatement || node.Kind == ast.KindForOfStatement {
		initializer := node.AsForInOrOfStatement().Initializer
		if initializer.Kind == ast.KindVariableDeclarationList {
			if !qmOwnerVar(initializer, builder.owner) {
				return false
			}
			for _, d := range initializer.AsVariableDeclarationList().Declarations.Nodes {
				if qmWriteBuilderTarget(d.Name(), builder) {
					return true
				}
			}
			return false
		}
		return qmWriteBuilderTarget(initializer, builder)
	}
	if qmEffectWrite(node) && (node.Kind == ast.KindPrefixUnaryExpression || node.Kind == ast.KindPostfixUnaryExpression) {
		return qmWriteBuilderTarget(qmWriteTarget(node), builder)
	}
	return false
}
func qmCompositeLeaf(file *File, project *Project, expression *ast.Node) bool {
	if expression == nil {
		return false
	}
	value := authored.Unwrap(expression)
	if value.Kind != ast.KindIdentifier {
		return false
	}
	composite := false
	authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
		if n.Kind != ast.KindVariableDeclaration || n.Name().Kind != ast.KindIdentifier || n.Name().Text() != value.Text() || n.AsVariableDeclaration().Initializer == nil {
			return
		}
		application := authored.Unwrap(n.AsVariableDeclaration().Initializer)
		if application.Kind != ast.KindCallExpression {
			return
		}
		factory := authored.Unwrap(application.AsCallExpression().Expression)
		if factory.Kind == ast.KindCallExpression {
			composite = project.Authored(file).ResolveImportedSymbol(factory.AsCallExpression().Expression).Name == "defineCompositeQuery"
			return
		}
		if factory.Kind == ast.KindPropertyAccessExpression {
			p := factory.AsPropertyAccessExpression()
			composite = p.Name().Text() == "composite" && project.Authored(file).ResolveImportedSymbol(p.Expression).Name == "defineQuery"
		}
	})
	return composite
}
func (w *qmWriter) composeTyped(file *File, d authored.Definition) {
	const rule = "QRY-COMPOSE-TYPED"
	if w.origin(rule, "Composite Query definition", file, d) {
		return
	}
	if d.Object == nil {
		w.ambiguity(rule, file, d.Call, "Composite Query definition is not a static object literal.")
		return
	}
	compose := authored.Callback(d.Object, "compose")
	if compose == nil {
		w.violation(rule, file, d.Object, "Composite Query has no compose callback.")
		return
	}
	if compose.ModifierFlags()&ast.ModifierFlagsAsync != 0 {
		w.violation(rule, file, compose, "Composite Query compose callback is async.")
	}
	if qmGenerator(compose) {
		w.violation(rule, file, compose, "Composite Query compose callback is a generator.")
	}
	builder := qmCompose(compose)
	if builder == nil {
		w.ambiguity(rule, file, compose, "Composite Query builder bindings are not statically identifiable.")
		return
	}
	w.composeReturns(file, compose, builder)
	w.composeReachability(file, compose, builder)
	reported := []*ast.Node{}
	forbidden := map[string]bool{"fetch": true, "invoke": true, "mutate": true, "run": true, "step": true, "then": true}
	qmOwn(compose, func(node *ast.Node) {
		writesBuilder := qmWritesBuilder(node, builder)
		if writesBuilder || qmEffectWrite(node) {
			target := qmAnchor(qmWriteTarget(node), node)
			for _, owner := range reported {
				if owner.Pos() <= target.Pos() && owner.End() >= target.End() {
					return
				}
			}
			reported = append(reported, target)
			message := "Composite Query compose performs a state write outside plan construction."
			if writesBuilder {
				message = "Composite Query builder binding is reassigned or mutated."
			}
			w.violation(rule, file, node, message)
			return
		}
		var invoked *ast.Node
		kind := ""
		if node.Kind == ast.KindNewExpression {
			invoked = node.AsNewExpression().Expression
			kind = "constructor"
		}
		if node.Kind == ast.KindTaggedTemplateExpression {
			invoked = node.AsTaggedTemplateExpression().Tag
			kind = "tag"
		}
		if invoked != nil {
			origin := w.project.Authored(file).ResolveImportedSymbol(invoked)
			if origin.Kind != "local" {
				w.violation(rule, file, node, "Composite Query compose invokes imported "+kind+" "+origin.Name+" outside the closed plan builder.")
			} else {
				chain := qmChain(invoked)
				name := "<expression>"
				if chain != nil {
					name = strings.Join(chain, ".")
				}
				w.ambiguity(rule, file, node, "Composite Query compose "+kind+" "+name+" has an unresolved origin.")
			}
			return
		}
		if node.Kind != ast.KindCallExpression {
			return
		}
		call := node.AsCallExpression()
		chain := qmChain(call.Expression)
		method := builder.method(call.Expression)
		if method != "" {
			if method == "query" && qmCompositeLeaf(file, w.project, authored.Argument(node, 1)) {
				w.violation(rule, file, authored.Argument(node, 1), "Composite Query leaf is itself composite.")
			}
			if method == "combine" {
				callbacks, incomplete := qmResultCallbacks(node, compose, builder)
				for _, callback := range callbacks {
					w.violation(rule, file, callback, "Composite Query result embeds a result-time callback.")
				}
				if incomplete {
					w.ambiguity(rule, file, node, "Composite Query result callback analysis reached its cycle or node limit.")
				}
			}
			return
		}
		origin := w.project.Authored(file).ResolveImportedSymbol(call.Expression)
		name := origin.Name
		if name == "" && len(chain) > 0 {
			name = chain[len(chain)-1]
		}
		if forbidden[name] {
			w.violation(rule, file, node, "Composite Query compose invokes forbidden "+name+".")
		} else if origin.Kind != "local" {
			w.violation(rule, file, node, "Composite Query compose invokes imported "+origin.Name+" outside the closed plan builder.")
		} else {
			path := "<expression>"
			if chain != nil {
				path = strings.Join(chain, ".")
			}
			w.ambiguity(rule, file, node, "Composite Query compose call "+path+" has an unresolved origin.")
		}
	})
}
