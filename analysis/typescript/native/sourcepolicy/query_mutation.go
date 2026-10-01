package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	runtime "astrale-typespec-v2-native-analysis/observabledecision"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"strings"
	"unicode/utf16"
)

var QueryMutationRevisions = map[string]string{
	"QRY-CANON":          "17dc62dc0413f93c9d9cfd4787ee729caf187eeffe83e38f8036c1cece1b3639",
	"QRY-SINGLE":         "a0b90940e0e980f1536b8bfd4288ba3b07689ddf4bf0e72a0ad4f39a83d01f84",
	"QRY-COMPOSE-TYPED":  "4ab1566f88e42f6105ef99038f78fb03e2f95c6836458425aecfdecfc6ff3720",
	"QRY-COMPOSE-STABLE": "7e028a5408a958e7e5bd6ccf04a9262c33be1152c2248896ef3cf038c125ff1e",
	"QRY-COLL-FANOUT":    "50279cef3618d44cc1c3212a0d72213eca26a78c540f7a2998df244c38fc54ca",
	"MUT-PLAN-REQ":       "9201a4e5799f62cc8df37d281d1f02516132632e33b4a82187c399780bdfe340",
	"MUT-LOCAL-ALIAS":    "9c2a55b932a3f63428701b0d613c4f8c8015a2444bd42f922bdc4921850c37cb",
	"MUT-STATE-INITIAL":  "d88f178994e9ad56d14f50ad5ffdff398413e42a690985c5ddc669c0f293d9bb",
	"MUT-STATE-ATOMIC":   "c734069c35bab09f47b4fcd6b3f207fccceb69a9da4f1fb1c50d9fd2711bf6dd",
	"MUT-CANON":          "238b94e9c936fc7c8cd2e1b1d5b61e59f32069ff9974dc366de6633717f38756",
	"MUT-FRAGMENTS":      "6102ea4dbe2e461ef38b98afcfbe28639f4f472ee6a83e44ce6aad7de3c3c7ef",
	"MUT-PURE":           "0101d7edd7d34e69338aaec7129a14df40d3395b6a58b40265ccb5448e739170",
}

func init() {
	for id, revision := range QueryMutationRevisions {
		Revisions[id] = revision
	}
}

// All fields are supplied by the single captured native authority. Missing
// runtime/type/state authority is a migration residual, not a public ambiguity.
type QueryMutationInput struct {
	Runtime             *runtime.DemandContext
	CallIdentity        func(*File, *ast.Node) (string, bool)
	CollectionKind      func(*File, *ast.Node) (string, bool)
	ClosedPropertyNames func(*File, *ast.Node) (map[string]bool, bool)
}
type qmWriter struct {
	out     Result
	project *Project
}

func (w *qmWriter) emit(rule, kind string, file *File, node *ast.Node, text string) {
	w.out.Evidence = append(w.out.Evidence, Evidence{Rule: rule, Kind: kind, File: file, Node: node, Evidence: text})
}
func (w *qmWriter) violation(rule string, file *File, node *ast.Node, text string) {
	w.emit(rule, "violation", file, node, text)
}
func (w *qmWriter) ambiguity(rule string, file *File, node *ast.Node, text string) {
	w.emit(rule, "ambiguity", file, node, text)
}
func (w *qmWriter) residual(rule string, file *File, node *ast.Node, text string) {
	w.out.Residual = append(w.out.Residual, Residual{Rule: rule, File: file, Node: node, Reason: text})
}
func (w *qmWriter) origin(rule, label string, file *File, definition authored.Definition) bool {
	if definition.Origin != "ambiguous" {
		return false
	}
	w.ambiguity(rule, file, definition.Call, label+" resolves through a local facade whose ultimate public constructor origin is unknown.")
	return true
}
func qmFunction(node *ast.Node) bool {
	return node != nil && (node.Kind == ast.KindArrowFunction || node.Kind == ast.KindFunctionExpression || node.Kind == ast.KindMethodDeclaration)
}
func qmGenerator(node *ast.Node) bool {
	if node == nil {
		return false
	}
	switch node.Kind {
	case ast.KindFunctionExpression:
		return node.AsFunctionExpression().AsteriskToken != nil
	case ast.KindFunctionDeclaration:
		return node.AsFunctionDeclaration().AsteriskToken != nil
	case ast.KindMethodDeclaration:
		return node.AsMethodDeclaration().AsteriskToken != nil
	}
	return false
}
func qmOwn(fn *ast.Node, callback func(*ast.Node)) {
	if fn == nil || fn.Body() == nil {
		return
	}
	body := fn.Body()
	var walk func(*ast.Node)
	walk = func(n *ast.Node) {
		if n == nil {
			return
		}
		callback(n)
		if n != body && ast.IsFunctionLike(n) {
			return
		}
		n.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(body)
}
func qmChain(n *ast.Node) []string {
	n = authored.Unwrap(n)
	if n == nil {
		return nil
	}
	if n.Kind == ast.KindIdentifier {
		return []string{n.Text()}
	}
	if n.Kind == ast.KindPropertyAccessExpression {
		p := n.AsPropertyAccessExpression()
		head := qmChain(p.Expression)
		if head != nil {
			return append(head, p.Name().Text())
		}
	}
	return nil
}
func qmNamedProperties(object *ast.Node, name string) []*ast.Node {
	out := []*ast.Node{}
	if object == nil || object.Kind != ast.KindObjectLiteralExpression {
		return out
	}
	for _, p := range object.AsObjectLiteralExpression().Properties.Nodes {
		n := p.Name()
		if n != nil && (n.Kind == ast.KindIdentifier || n.Kind == ast.KindStringLiteral) && n.Text() == name {
			out = append(out, p)
		}
	}
	return out
}
func qmCallback(property *ast.Node) *ast.Node {
	if property == nil {
		return nil
	}
	if property.Kind == ast.KindMethodDeclaration {
		return property
	}
	if property.Kind == ast.KindPropertyAssignment {
		value := authored.Unwrap(property.AsPropertyAssignment().Initializer)
		if qmFunction(value) {
			return value
		}
	}
	return nil
}
func qmStart(file *File, node *ast.Node) int {
	return len(utf16.Encode([]rune(file.Source.Text()[:scanner.GetTokenPosOfNode(node, file.Source, false)])))
}
func (w *qmWriter) projector(rule string, file *File, name, label string) {
	a := w.project.Authored(file)
	for _, candidate := range a.Calls(name, nil) {
		if candidate.Origin == "ambiguous" {
			continue
		}
		call := candidate.Call
		parent := call.Parent
		if len(call.AsCallExpression().Arguments.Nodes) != 0 || parent == nil || parent.Kind != ast.KindCallExpression || authored.Unwrap(parent.AsCallExpression().Expression) != call {
			w.violation(rule, file, call, label+" must use "+name+"<typeof Schema>()((Domain) => ({ ... })).")
		}
	}
	for _, d := range a.Definitions(name, "", nil, 0) {
		if d.Origin == "ambiguous" {
			continue
		}
		p := d.Projector
		if p == nil {
			w.ambiguity(rule, file, d.Call, label+" Domain projector is not statically visible.")
			continue
		}
		parameters := p.Parameters()
		if len(parameters) > 1 {
			w.violation(rule, file, p, label+" Domain projector accepts more than one value.")
		}
		if len(parameters) > 0 && parameters[0].Name().Kind != ast.KindIdentifier {
			w.ambiguity(rule, file, parameters[0].Name(), label+" Domain projector does not bind one identifiable Domain.")
		}
		if p.ModifierFlags()&ast.ModifierFlagsAsync != 0 {
			w.violation(rule, file, p, label+" Domain projector is async.")
		}
		if qmGenerator(p) {
			w.violation(rule, file, p, label+" Domain projector is a generator.")
		}
	}
}

type qmEpistemic struct {
	state, reason string
	count         int
}
type qmObservation struct {
	file                    *File
	node                    *ast.Node
	subject, identity       string
	shape                   *runtime.DemandShape
	shapeProof              qmEpistemic
	build, project, request qmEpistemic
}

func qmKnown(count int) qmEpistemic                { return qmEpistemic{state: "known", count: count} }
func qmUncertain(state, reason string) qmEpistemic { return qmEpistemic{state: state, reason: reason} }
func (w *qmWriter) sourceObservations() []qmObservation {
	out := []qmObservation{}
	for _, file := range w.project.Files {
		if file.Role != "production" || file.Layer != "queries" {
			continue
		}
		a := w.project.Authored(file)
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			factory := authored.Unwrap(node.AsCallExpression().Expression)
			if factory == nil || factory.Kind != ast.KindCallExpression {
				return
			}
			origin := a.ResolveImportedSymbol(factory.AsCallExpression().Expression)
			if (origin.Kind != "resolved" && origin.Kind != "ambiguous") || (origin.Name != "defineQuery" && origin.Name != "defineCollectionQuery") || (origin.Kind == "resolved" && !authored.Contains([]string{"@astrale-os/sdk", "@astrale-os/sdk/query"}, origin.Module)) {
				return
			}
			o := qmObservation{file: file, node: node, subject: fmt.Sprintf("%s#%d", file.Path, qmStart(file, node)), identity: "known"}
			if origin.Kind == "ambiguous" {
				o.identity = "ambiguous"
				o.request = qmUncertain("ambiguous", "definition resolves through a local facade whose ultimate public constructor origin is unknown")
				o.build = o.request
				o.project = o.request
				out = append(out, o)
				return
			}
			if origin.Name == "defineCollectionQuery" {
				o.request = qmKnown(1)
				o.build = qmKnown(1)
				o.project = qmKnown(0)
				out = append(out, o)
				return
			}
			projector := authored.Unwrap(authored.Argument(node, 0))
			var object *ast.Node
			if qmFunction(projector) {
				returns := authored.ReturnedExpressions(projector)
				if len(returns) == 1 && returns[0].Kind == ast.KindObjectLiteralExpression {
					object = returns[0]
				}
			}
			if object == nil {
				o.request = qmUncertain("unknown", "definition input is not a static object literal")
				o.build = o.request
				o.project = o.request
				out = append(out, o)
				return
			}
			builds := qmNamedProperties(object, "build")
			projects := qmNamedProperties(object, "project")
			var build *ast.Node
			if len(builds) > 0 {
				build = qmCallback(builds[0])
			}
			o.build = qmKnown(len(builds))
			if len(builds) == 1 && build == nil {
				o.build = qmUncertain("unknown", "build callback is forwarded through an opaque authored value")
			}
			o.project = qmKnown(len(projects))
			if build == nil {
				if len(builds) > 0 {
					o.request = qmUncertain("unknown", "build callback origin is not statically visible")
				} else {
					o.request = qmKnown(0)
				}
			} else {
				returns := authored.ReturnedExpressions(build)
				if len(returns) != 1 {
					o.request = qmUncertain("ambiguous", fmt.Sprintf("build exposes %d statically visible return values", len(returns)))
				} else {
					roots := qmCanonicalRoots(a, build, returns[0])
					o.request = qmKnown(roots)
					returned := returns[0]
					if roots == 0 && returned.Kind == ast.KindCallExpression && authored.Unwrap(returned.AsCallExpression().Expression).Kind == ast.KindIdentifier {
						o.request = qmUncertain("unknown", "build delegates to a helper whose QueryAST origin is not visible")
					}
				}
			}
			out = append(out, o)
		})
	}
	return out
}
func qmCanonicalRoots(a *authored.File, build, returned *ast.Node) int {
	canonical := func(node *ast.Node) bool {
		if node == nil || node.Kind != ast.KindCallExpression {
			return false
		}
		expression := authored.Unwrap(node.AsCallExpression().Expression)
		if expression.Kind != ast.KindPropertyAccessExpression {
			return false
		}
		receiver := expression.AsPropertyAccessExpression().Expression
		if receiver.Kind != ast.KindIdentifier {
			return false
		}
		origin := a.ResolveImportedSymbol(receiver)
		return origin.Kind == "resolved" && origin.Name == "Query" && authored.Contains([]string{"@astrale-os/sdk/query", "@astrale-os/kernel-core", "@astrale-os/kernel-core/graph/query"}, origin.Module)
	}
	declarations := map[string]*ast.Node{}
	if build.Body() != nil && build.Body().Kind == ast.KindBlock {
		for _, statement := range build.Body().AsBlock().Statements.Nodes {
			if statement.Kind != ast.KindVariableStatement {
				continue
			}
			d := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
			if d.Flags&ast.NodeFlagsConst == 0 {
				continue
			}
			for _, v := range d.Declarations.Nodes {
				if v.Name().Kind == ast.KindIdentifier && v.AsVariableDeclaration().Initializer != nil {
					declarations[v.Name().Text()] = v
				}
			}
		}
	}
	seen := map[*ast.Node]bool{}
	var count func(*ast.Node) int
	count = func(node *ast.Node) int {
		total := 0
		authored.Walk(node, func(n *ast.Node) {
			if canonical(n) {
				ancestor := false
				for p := n.Parent; p != nil && !ast.IsFunctionLike(p); p = p.Parent {
					if canonical(p) {
						ancestor = true
						break
					}
				}
				if !ancestor {
					total++
				}
			}
		})
		authored.Walk(node, func(n *ast.Node) {
			if n.Kind != ast.KindIdentifier {
				return
			}
			d := declarations[n.Text()]
			if d != nil && !seen[d] {
				seen[d] = true
				total += count(d.AsVariableDeclaration().Initializer)
			}
		})
		return total
	}
	return count(returned)
}
func (w *qmWriter) decideQueries(rule string, observations []qmObservation) {
	for _, o := range observations {
		if o.identity != "known" {
			w.out.Evidence = append(w.out.Evidence, Evidence{Rule: rule, Kind: "ambiguity", File: o.file, Node: o.node, Evidence: "Query constructor identity for Query " + o.subject + " is " + o.identity + ": " + o.request.reason, AmbiguityReason: "insufficient-evidence"})
			continue
		}
		finding := func(subject string, value qmEpistemic) {
			w.out.Evidence = append(w.out.Evidence, Evidence{Rule: rule, Kind: "ambiguity", File: o.file, Node: o.node, Evidence: subject + " for Query " + o.subject + " is " + value.state + ": " + value.reason, AmbiguityReason: "insufficient-evidence"})
		}
		if rule == "QRY-CANON" {
			if o.shape != nil {
				if o.shapeProof.state != "known" {
					finding("Domain projector shape", o.shapeProof)
					continue
				}
				shape := o.shape
				if !shape.Curried || !shape.Callable || shape.Async || shape.Generator || shape.ParameterCount > 1 {
					w.violation(rule, o.file, o.node, "Query "+o.subject+" must use a curried constructor with one synchronous, non-generator Domain projector accepting at most one parameter.")
					continue
				}
			}
			if o.request.state != "known" {
				finding("canonical QueryAST origin", o.request)
			} else if o.request.count != 1 {
				message := "Query " + o.subject + " returns a non-canonical graph request."
				if o.request.count != 0 {
					message = fmt.Sprintf("Query %s produces %d canonical QueryAST roots; expected exactly one.", o.subject, o.request.count)
				}
				w.violation(rule, o.file, o.node, message)
			}
		} else {
			for _, item := range []struct {
				name    string
				value   qmEpistemic
				maximum bool
			}{{"build", o.build, false}, {"project", o.project, true}} {
				if item.value.state != "known" {
					finding(item.name+" callback cardinality", item.value)
					continue
				}
				invalid := item.value.count != 1
				if item.maximum {
					invalid = item.value.count > 1
				}
				if invalid {
					expected := "exactly"
					if item.maximum {
						expected = "at most"
					}
					w.violation(rule, o.file, o.node, fmt.Sprintf("Query %s declares %d %s callbacks; expected %s 1.", o.subject, item.value.count, item.name, expected))
				}
			}
		}
	}
}

// EvaluateQuerySource uses the authored-origin policy, deliberately independent
// of runtime callee provenance. Unsupported families remain migration residuals.
func EvaluateQuerySource(project *Project) Result {
	w := qmWriter{project: project}
	observations := w.sourceObservations()
	w.decideQueries("QRY-CANON", observations)
	w.decideQueries("QRY-SINGLE", observations)
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "queries" {
			continue
		}
		for _, item := range []struct{ name, label string }{{"defineCollectionQuery", "Collection Query"}, {"defineQuery", "Query"}, {"defineCompositeQuery", "Composite Query"}} {
			w.projector("QRY-CANON", file, item.name, item.label)
		}
		for _, definition := range project.Authored(file).Definitions("defineCompositeQuery", "", nil, 0) {
			w.composeStable(file, definition)
			w.collectionFanout(file, definition)
			w.composeTyped(file, definition)
		}
	}
	return w.out
}

func EvaluateMutationSource(project *Project) Result {
	w := qmWriter{project: project}
	topology := BuildMachineTopology(project)
	w.planRequirements()
	forbidden := map[string]bool{"invoke": true, "query": true, "retry": true, "run": true, "submit": true}
	globals := map[string]bool{"fetch": true, "setTimeout": true, "setInterval": true, "queueMicrotask": true}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "mutations" {
			continue
		}
		source := project.Authored(file)
		w.projector("MUT-CANON", file, "defineMutation", "Mutation")
		w.localAliases(file)
		w.mutationStates(topology, file)
		for _, imp := range file.Imports {
			if imp.TypeOnly {
				continue
			}
			spec := imp.Specifier
			layer := ""
			if strings.HasPrefix(spec, "#") && strings.Contains(spec, "/") {
				layer = strings.SplitN(spec[1:], "/", 2)[0]
			}
			if layer == "integrations" || layer == "functions" || layer == "providers" || layer == "queries" || (strings.HasPrefix(spec, "node:") && !strings.HasPrefix(spec, "node:assert") && !strings.HasPrefix(spec, "node:util/types")) || strings.HasPrefix(spec, "@astrale-os/adapter-") {
				w.violation("MUT-PURE", file, imp.Node, "Mutation imports effect boundary "+spec+".")
			}
		}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			callee := authored.Unwrap(node.AsCallExpression().Expression)
			chain := qmChain(callee)
			if len(chain) == 1 && globals[chain[0]] && source.ResolveImportedSymbol(callee).Kind == "local" && !authored.LocallyOwned(callee, true) {
				w.violation("MUT-PURE", file, node, "Mutation definition calls effectful global "+chain[0]+".")
			}
			if len(chain) == 2 && chain[0] == "globalThis" && globals[chain[1]] {
				w.violation("MUT-PURE", file, node, "Mutation definition calls effectful global "+chain[1]+".")
			}
		})
		for _, d := range source.Definitions("defineMutation", "", nil, 0) {
			uncertain := map[string]bool{}
			for _, rule := range []string{"MUT-CANON", "MUT-FRAGMENTS", "MUT-PURE"} {
				uncertain[rule] = w.origin(rule, "Mutation definition", file, d)
			}
			if d.Object == nil {
				if !uncertain["MUT-CANON"] {
					w.ambiguity("MUT-CANON", file, d.Call, "Mutation definition is not a static object literal.")
				}
				continue
			}
			build := authored.Callback(d.Object, "build")
			if build == nil {
				if !uncertain["MUT-CANON"] {
					w.violation("MUT-CANON", file, d.Object, "Mutation definition has no build callback.")
				}
				continue
			}
			parameters := build.Parameters()
			builder := ""
			if len(parameters) > 1 && parameters[1].Name().Kind == ast.KindIdentifier {
				builder = parameters[1].Name().Text()
			}
			if !uncertain["MUT-CANON"] {
				if len(parameters) < 2 {
					w.violation("MUT-CANON", file, build, "Mutation build has no callback-scoped builder as its second parameter.")
				}
				if len(authored.ReturnedExpressions(build)) > 0 {
					w.violation("MUT-CANON", file, build, "Mutation build returns a value.")
				}
				if build.ModifierFlags()&ast.ModifierFlagsAsync != 0 {
					w.violation("MUT-CANON", file, build, "Mutation build callback is async.")
				}
				nested := false
				authored.Walk(build.Body(), func(n *ast.Node) {
					if n.Kind != ast.KindCallExpression {
						return
					}
					c := n.AsCallExpression().Expression
					o := source.ResolveImportedSymbol(c)
					chain := qmChain(c)
					if o.Name == "MutationAST" || (len(chain) > 0 && chain[len(chain)-1] == "build" && authored.Contains(chain, "MutationAST")) {
						nested = true
					}
				})
				if nested {
					w.violation("MUT-CANON", file, build, "Mutation definition constructs a nested MutationAST.")
				}
			}
			if !uncertain["MUT-FRAGMENTS"] && builder == "" {
				w.ambiguity("MUT-FRAGMENTS", file, build, "Mutation build builder parameter is not an identifier.")
			}
			qmOwn(build, func(n *ast.Node) {
				if !uncertain["MUT-FRAGMENTS"] && builder != "" && n.Kind == ast.KindReturnStatement && n.AsReturnStatement().Expression != nil {
					w.violation("MUT-FRAGMENTS", file, n, "Mutation build returns a value or escaped builder.")
				}
				if n.Kind != ast.KindCallExpression {
					return
				}
				call := n.AsCallExpression()
				chain := qmChain(call.Expression)
				if len(chain) > 0 && chain[0] == builder && builder != "" {
					return
				}
				if !uncertain["MUT-FRAGMENTS"] && builder != "" {
					references := false
					for _, argument := range call.Arguments.Nodes {
						authored.Walk(argument, func(x *ast.Node) {
							if x.Kind == ast.KindIdentifier && x.Text() == builder {
								references = true
							}
						})
					}
					if references {
						first := authored.Argument(n, 0)
						if first == nil || authored.Unwrap(first).Kind != ast.KindIdentifier || authored.Unwrap(first).Text() != builder {
							w.violation("MUT-FRAGMENTS", file, n, "Mutation fragment must receive "+builder+" as its first argument.")
						}
					}
				}
				if !uncertain["MUT-PURE"] {
					origin := source.ResolveImportedSymbol(call.Expression)
					if forbidden[origin.Name] {
						w.violation("MUT-PURE", file, n, "Mutation definition invokes "+origin.Name+".")
					} else if origin.Kind == "local" && len(chain) > 1 && forbidden[chain[len(chain)-1]] {
						w.ambiguity("MUT-PURE", file, n, "Mutation call "+strings.Join(chain, ".")+" resembles an excluded operation but its receiver is opaque.")
					}
				}
			})
		}
	}
	return w.out
}
