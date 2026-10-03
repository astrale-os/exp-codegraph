package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	runtime "astrale-typespec-v2-native-analysis/observabledecision"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
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

// EvaluateQuerySource retains legacy fanout observations for partial prepares.
// Their compiler receipts and residuals remain owned by the current native session.
func EvaluateQuerySource(project *Project) Result {
	w := qmWriter{project: project}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "queries" {
			continue
		}
		for _, definition := range project.Authored(file).Definitions("defineCompositeQuery", "", nil, 0) {
			w.collectionFanout(file, definition)
		}
	}
	return w.out
}
