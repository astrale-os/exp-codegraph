package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

type qmCollectionMember struct {
	name, value, id, classKey string
	selected                  *ast.Node
}

func qmCollection(file *File, project *Project, selected, call *ast.Node) *qmCollectionMember {
	value := authored.Unwrap(selected)
	if value.Kind != ast.KindIdentifier {
		return nil
	}
	property := call.Parent
	if property == nil || property.Kind != ast.KindPropertyAssignment || authored.Unwrap(property.AsPropertyAssignment().Initializer) != call {
		return nil
	}
	name := property.Name()
	if name.Kind != ast.KindIdentifier && name.Kind != ast.KindStringLiteral {
		return nil
	}
	declarations := []*ast.Node{}
	authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
		if n.Kind == ast.KindVariableDeclaration && n.Name().Kind == ast.KindIdentifier && n.Name().Text() == value.Text() {
			declarations = append(declarations, n)
		}
	})
	if len(declarations) != 1 {
		return nil
	}
	application := declarations[0].AsVariableDeclaration().Initializer
	if application == nil {
		return nil
	}
	application = authored.Unwrap(application)
	if application.Kind != ast.KindCallExpression {
		return nil
	}
	factory := authored.Unwrap(application.AsCallExpression().Expression)
	if factory.Kind != ast.KindCallExpression {
		return nil
	}
	origin := project.Authored(file).ResolveImportedSymbol(factory.AsCallExpression().Expression)
	if origin.Name != "defineCollectionQuery" || (origin.Module != "@astrale-os/sdk" && origin.Module != "@astrale-os/sdk/query") {
		return nil
	}
	projector := authored.Argument(application, 0)
	if projector == nil {
		return nil
	}
	projector = authored.Unwrap(projector)
	if (projector.Kind != ast.KindArrowFunction && projector.Kind != ast.KindFunctionExpression) || len(projector.Parameters()) == 0 || projector.Parameters()[0].Name().Kind != ast.KindIdentifier {
		return nil
	}
	returns := authored.ReturnedExpressions(projector)
	if len(returns) != 1 {
		return nil
	}
	object := authored.Unwrap(returns[0])
	if object.Kind != ast.KindObjectLiteralExpression {
		return nil
	}
	id, known := qmText(authored.PropertyExpression(object, "id"))
	chain := qmChain(authored.PropertyExpression(object, "class"))
	if !known || id == "" || len(chain) != 3 || chain[0] != projector.Parameters()[0].Name().Text() || chain[1] != "classes" {
		return nil
	}
	return &qmCollectionMember{name: name.Text(), value: value.Text(), id: id, classKey: strings.Join(chain[1:], "."), selected: selected}
}
func (w *qmWriter) collectionFanout(file *File, d authored.Definition) {
	if d.Origin != "resolved" || d.Object == nil {
		return
	}
	compose := authored.Callback(d.Object, "compose")
	if compose == nil {
		return
	}
	builder := qmCompose(compose)
	if builder == nil {
		return
	}
	returns := authored.ReturnedExpressions(compose)
	if len(returns) != 1 {
		return
	}
	logical, physical := 0, 0
	eligible := []*qmCollectionMember{}
	authored.Walk(returns[0], func(node *ast.Node) {
		if node.Kind != ast.KindCallExpression {
			return
		}
		method := builder.method(node.AsCallExpression().Expression)
		if method == "query" {
			logical++
			physical++
			input := authored.Argument(node, 2)
			if input != nil {
				input = authored.Unwrap(input)
				if !(input.Kind == ast.KindIdentifier && input.Text() == "undefined") {
					if input.Kind != ast.KindVoidExpression || authored.Unwrap(input.AsVoidExpression().Expression).Kind != ast.KindNumericLiteral {
						return
					}
				}
			}
			selected := authored.Argument(node, 1)
			if selected != nil {
				if member := qmCollection(file, w.project, selected, node); member != nil {
					eligible = append(eligible, member)
				}
			}
			return
		}
		if method != "union" {
			return
		}
		members := authored.Argument(node, 0)
		if members == nil {
			return
		}
		members = authored.Unwrap(members)
		if members.Kind != ast.KindObjectLiteralExpression {
			return
		}
		for _, p := range members.AsObjectLiteralExpression().Properties.Nodes {
			if p.Kind == ast.KindSpreadAssignment || (p.Name() != nil && p.Name().Kind == ast.KindComputedPropertyName) {
				return
			}
		}
		logical += len(members.AsObjectLiteralExpression().Properties.Nodes)
		physical++
	})
	if len(eligible) < 3 {
		return
	}
	groups := map[string][]*qmCollectionMember{"node": {}, "edge": {}}
	for _, member := range eligible {
		if w.project.QueryCollectionKind == nil {
			w.residual("QRY-COLL-FANOUT", file, member.selected, "Native demanded Query collection kind authority unavailable.")
			continue
		}
		kind := w.project.QueryCollectionKind(file, member.selected)
		if !kind.Known {
			w.residual("QRY-COLL-FANOUT", file, member.selected, "Native demanded Query collection kind authority unavailable.")
			continue
		}
		if kind.Kind == "node" || kind.Kind == "edge" {
			groups[kind.Kind] = append(groups[kind.Kind], member)
		}
	}
	scaffold := []string{}
	optimized := physical
	for _, kind := range []string{"node", "edge"} {
		members := groups[kind]
		if len(members) < 3 {
			continue
		}
		ids, classes := map[string]bool{}, map[string]bool{}
		for _, m := range members {
			ids[m.id] = true
			classes[m.classKey] = true
		}
		if len(ids) != len(members) || len(classes) != len(members) {
			continue
		}
		optimized -= len(members) - 1
		outer := "nodes"
		if kind == "edge" {
			outer = "relations"
		}
		entries := []string{}
		for _, m := range members {
			entry := m.name
			if m.name != m.value {
				entry += ": " + m.value
			}
			entries = append(entries, entry)
		}
		scaffold = append(scaffold, outer+": query.union({ "+strings.Join(entries, ", ")+" })")
	}
	if len(scaffold) > 0 {
		w.violation("QRY-COLL-FANOUT", file, compose, fmt.Sprintf("Compatible collection fan-out has a direct replacement:\n%s\nPlan estimate: %d logical → %d physical cursor chains (currently %d physical).", strings.Join(scaffold, "\n"), logical, optimized, physical))
	}
}
