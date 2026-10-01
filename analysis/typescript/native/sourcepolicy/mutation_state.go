package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

func qmClassNames(expression *ast.Node, seen map[string]bool) []string {
	if expression == nil {
		return nil
	}
	value := authored.Unwrap(expression)
	if value.Kind == ast.KindConditionalExpression {
		c := value.AsConditionalExpression()
		left, right := qmClassNames(c.WhenTrue, seen), qmClassNames(c.WhenFalse, seen)
		if left == nil || right == nil {
			return nil
		}
		for _, name := range right {
			left = qmPush(left, name)
		}
		return left
	}
	if value.Kind == ast.KindIdentifier {
		if seen[value.Text()] {
			return nil
		}
		if init := qmVisibleConst(value); init != nil {
			copy := map[string]bool{}
			for k, v := range seen {
				copy[k] = v
			}
			copy[value.Text()] = true
			return qmClassNames(init, copy)
		}
	}
	chain := qmStaticChain(value, nil)
	if len(chain) < 2 {
		return nil
	}
	index := len(chain) - 1
	if chain[index] == "key" {
		index--
	}
	return []string{chain[index]}
}
func qmAncestors(name string, t MachineTopology) map[string]bool {
	out := map[string]bool{}
	pending := append([]string{}, t.Parents[name]...)
	for len(pending) > 0 {
		parent := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if out[parent] {
			continue
		}
		out[parent] = true
		pending = append(pending, t.Parents[parent]...)
	}
	return out
}
func qmClosedClasses(selection []string, t MachineTopology) bool {
	if len(selection) == 0 {
		return false
	}
	if len(selection) == 1 {
		return true
	}
	selected := map[string]bool{}
	for _, name := range selection {
		if !t.Classes[name] || t.Abstract[name] {
			return false
		}
		selected[name] = true
	}
	for _, ancestor := range t.AbstractNames {
		all := true
		for _, name := range selection {
			if !qmAncestors(name, t)[ancestor] {
				all = false
			}
		}
		if !all {
			continue
		}
		count := 0
		closed := true
		for _, name := range t.ClassNames {
			if !t.Abstract[name] && qmAncestors(name, t)[ancestor] {
				count++
				if !selected[name] {
					closed = false
				}
			}
		}
		if closed && count == len(selection) {
			return true
		}
	}
	return false
}

type qmSelectedClass struct {
	kind       string
	order      []string
	properties map[string]string
}

func qmSelectClass(input *ast.Node, t MachineTopology) qmSelectedClass {
	selection := qmClassNames(qmAssigned(input, "class"), nil)
	if !qmClosedClasses(selection, t) {
		return qmSelectedClass{kind: "ambiguous"}
	}
	out := qmSelectedClass{kind: "absent", properties: map[string]string{}}
	for _, class := range selection {
		if len(t.Ambiguous[class]) > 0 {
			return qmSelectedClass{kind: "ambiguous"}
		}
		properties := t.ByClass[class]
		if properties == nil {
			continue
		}
		out.kind = "resolved"
		for _, name := range t.PropertyOrder[class] {
			identity := properties[name]
			if prior, exists := out.properties[name]; exists && prior != identity {
				return qmSelectedClass{kind: "ambiguous"}
			}
			out.properties[name] = identity
			out.order = qmPush(out.order, name)
		}
	}
	return out
}
func qmSpread(object *ast.Node) bool {
	if object == nil {
		return false
	}
	for _, p := range object.AsObjectLiteralExpression().Properties.Nodes {
		if p.Kind == ast.KindSpreadAssignment {
			return true
		}
	}
	return false
}
func qmSpreadMaySet(object *ast.Node, name string) bool {
	explicit := -1
	properties := object.AsObjectLiteralExpression().Properties.Nodes
	for index, p := range properties {
		if key, known := qmPropertyName(p); known && key == name {
			explicit = index
		}
	}
	for index, p := range properties {
		if p.Kind == ast.KindSpreadAssignment && index > explicit {
			return true
		}
	}
	return false
}
func qmInitialIdentity(project *Project, file *File, expression *ast.Node, seen map[string]bool) StateIdentity {
	value := authored.Unwrap(expression)
	if value.Kind == ast.KindPropertyAccessExpression && value.AsPropertyAccessExpression().Name().Text() == "initial" {
		return StateMachineIdentity(project, file, value.AsPropertyAccessExpression().Expression)
	}
	if value.Kind == ast.KindElementAccessExpression {
		e := value.AsElementAccessExpression()
		if name, known := qmText(e.ArgumentExpression); known && name == "initial" {
			return StateMachineIdentity(project, file, e.Expression)
		}
	}
	if value.Kind == ast.KindIdentifier {
		if seen[value.Text()] {
			return StateIdentity{Known: true, Kind: "ambiguous"}
		}
		if init := qmVisibleConst(value); init != nil {
			copy := map[string]bool{}
			for k, v := range seen {
				copy[k] = v
			}
			copy[value.Text()] = true
			return qmInitialIdentity(project, file, init, copy)
		}
	}
	return StateIdentity{Known: true, Kind: "absent"}
}
func qmStaticTextValue(expression *ast.Node, seen map[string]bool) (string, bool) {
	if expression == nil {
		return "", false
	}
	if text, known := qmText(expression); known {
		return text, true
	}
	value := authored.Unwrap(expression)
	if value.Kind != ast.KindIdentifier || seen[value.Text()] {
		return "", false
	}
	init := qmVisibleConst(value)
	if init == nil {
		return "", false
	}
	copy := map[string]bool{}
	for k, v := range seen {
		copy[k] = v
	}
	copy[value.Text()] = true
	return qmStaticTextValue(init, copy)
}
func qmAnchor(node, fallback *ast.Node) *ast.Node {
	if node != nil {
		return node
	}
	return fallback
}
func (w *qmWriter) mutationStates(topology MachineTopology, file *File) {
	if !topology.Known {
		for _, rule := range []string{"MUT-STATE-INITIAL", "MUT-STATE-ATOMIC"} {
			w.residual(rule, file, file.Source.AsNode(), "Captured StateProperty identity authority is unavailable for schema topology.")
		}
		return
	}
	candidates := len(topology.All) > 0 || len(topology.Ambiguous) > 0
	scopes := qmMutationScopes(w.project, file)
	authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind != ast.KindCallExpression {
			return
		}
		member := qmBuilderMember(node, scopes)
		if member != "createNode" && member != "updateNode" && member != "transition" {
			return
		}
		rule := "MUT-STATE-ATOMIC"
		if member == "createNode" {
			rule = "MUT-STATE-INITIAL"
		}
		if member != "createNode" && !candidates {
			return
		}
		input := qmStaticObject(authored.Argument(node, 0), nil)
		if input == nil {
			if candidates {
				message := "Mutation createNode input is dynamic, so machine-state initialization cannot be proven."
				if member == "updateNode" {
					message = "Mutation updateNode input is dynamic and may bypass a StateMachine transition."
				}
				if member == "transition" {
					message = "StateMachine transition input is not one static object."
				}
				w.ambiguity(rule, file, node, message)
			}
			return
		}
		if member == "transition" {
			removed := []string{}
			for _, name := range []string{"machine", "lifecycle", "decision", "to", "transition", "witness", "step"} {
				if qmAssigned(input, name) != nil {
					removed = append(removed, name)
				}
			}
			if len(removed) > 0 {
				w.violation(rule, file, input, "StateMachine transition derives authority and target from StateProperty; remove "+strings.Join(removed, ", ")+".")
			}
			if qmSpread(input) {
				w.ambiguity(rule, file, input, "StateMachine transition input contains a spread that may override or add governed fields.")
			} else {
				for _, required := range []string{"from", "event"} {
					if qmAssigned(input, required) == nil {
						w.violation(rule, file, input, "StateMachine transition has no "+required+" intent.")
					}
				}
			}
		}
		selected := qmSelectClass(input, topology)
		if selected.kind == "ambiguous" {
			prefix := "Mutation " + member
			if member == "transition" {
				prefix = "StateMachine transition"
			}
			w.ambiguity(rule, file, qmAnchor(qmAssigned(input, "class"), input), prefix+" Class has no statically resolvable Schema owner.")
			if member != "transition" {
				return
			}
		}
		if member == "transition" {
			property, known := qmStaticTextValue(qmAssigned(input, "property"), nil)
			if !known {
				w.ambiguity(rule, file, qmAnchor(qmAssigned(input, "property"), input), "StateMachine transition property is not static text.")
			} else if selected.kind == "absent" || (selected.kind == "resolved" && selected.properties[property] == "") {
				w.violation(rule, file, qmAnchor(qmAssigned(input, "property"), input), "StateMachine transition property "+property+" is not a machine-backed Property of the selected Class.")
			}
			return
		}
		if selected.kind == "absent" {
			return
		}
		propsValue := qmAssigned(input, "props")
		props := qmStaticObject(propsValue, nil)
		if props == nil {
			if member == "createNode" && propsValue == nil {
				w.violation(rule, file, input, "Mutation creates a StateMachine-backed node without its initial state.")
			} else {
				message := "Mutation createNode properties are dynamic, so machine-state initialization cannot be proven."
				if member == "updateNode" {
					message = "Mutation updateNode properties are dynamic and may bypass a StateMachine transition."
				}
				w.ambiguity(rule, file, qmAnchor(propsValue, input), message)
			}
			return
		}
		if member == "createNode" {
			uncertain := map[string]bool{}
			ordered := []string{}
			for _, name := range selected.order {
				if qmSpreadMaySet(props, name) {
					uncertain[name] = true
					ordered = append(ordered, name)
				}
			}
			if len(ordered) > 0 {
				w.ambiguity(rule, file, props, "Mutation createNode properties contain a spread that may determine machine-backed "+strings.Join(ordered, ", ")+".")
			}
			assigned := map[string]bool{}
			for _, p := range props.AsObjectLiteralExpression().Properties.Nodes {
				if p.Kind != ast.KindPropertyAssignment && p.Kind != ast.KindShorthandPropertyAssignment {
					continue
				}
				if name, known := qmPropertyName(p); known {
					assigned[name] = true
				}
			}
			for _, name := range selected.order {
				if !assigned[name] && !uncertain[name] {
					w.violation(rule, file, props, "Mutation creates a StateMachine-backed node without initial property "+name+".")
				}
			}
			for _, p := range props.AsObjectLiteralExpression().Properties.Nodes {
				if p.Kind != ast.KindPropertyAssignment && p.Kind != ast.KindShorthandPropertyAssignment {
					continue
				}
				name, known := qmPropertyName(p)
				if !known || selected.properties[name] == "" || uncertain[name] {
					continue
				}
				value := p.Name()
				if p.Kind == ast.KindPropertyAssignment {
					value = p.AsPropertyAssignment().Initializer
				}
				initial := qmInitialIdentity(w.project, file, value, nil)
				if !initial.Known {
					w.residual(rule, file, value, "Captured StateMachine initializer identity authority unavailable.")
					continue
				}
				if initial.Kind == "resolved" {
					if initial.Identity != selected.properties[name] {
						w.violation(rule, file, value, "Mutation initializes machine-backed property "+name+" from a different StateMachine authority.")
					}
					continue
				}
				if _, literal := qmText(value); literal {
					w.violation(rule, file, value, "Mutation initializes machine-backed property "+name+" with a copied state instead of machine.initial.")
				} else {
					w.ambiguity(rule, file, value, "Mutation StateMachine initializer for "+name+" has no resolvable machine.initial source.")
				}
			}
			return
		}
		if qmSpread(props) {
			w.ambiguity(rule, file, props, "Mutation updateNode properties contain a spread that may bypass a StateMachine transition.")
		}
		setValue := qmAssigned(props, "set")
		set := qmStaticObject(setValue, nil)
		if setValue != nil && set == nil {
			if w.project.ExpressionPropertyNames == nil {
				w.residual(rule, file, setValue, "Native demanded expression property names authority unavailable.")
			} else {
				typed := w.project.ExpressionPropertyNames(file, setValue)
				if !typed.Known {
					w.residual(rule, file, setValue, "Native demanded expression property names authority unavailable.")
				} else if typed.Names == nil {
					w.ambiguity(rule, file, setValue, "Mutation updateNode set patch is dynamic and may bypass a StateMachine transition.")
				} else {
					allowed := map[string]bool{}
					for _, name := range typed.Names {
						allowed[name] = true
					}
					for _, name := range selected.order {
						if allowed[name] {
							w.violation(rule, file, setValue, "Mutation updateNode patch type permits machine-backed property "+name+"; use transition for one atomic compare-and-set.")
						}
					}
				}
			}
		}
		if set != nil {
			if qmSpread(set) {
				w.ambiguity(rule, file, set, "Mutation updateNode set patch contains a spread that may bypass a StateMachine transition.")
			}
			for _, p := range set.AsObjectLiteralExpression().Properties.Nodes {
				if p.Kind != ast.KindPropertyAssignment && p.Kind != ast.KindShorthandPropertyAssignment {
					continue
				}
				if name, known := qmPropertyName(p); known && selected.properties[name] != "" {
					w.violation(rule, file, p, "Mutation writes machine-backed property "+name+" through updateNode; use transition for one atomic compare-and-set.")
				}
			}
		}
		unsetValue := qmAssigned(props, "unset")
		if unsetValue == nil {
			return
		}
		unset := authored.Unwrap(unsetValue)
		type item struct {
			text string
			node *ast.Node
		}
		items := []item{}
		known := unset.Kind == ast.KindArrayLiteralExpression
		if known {
			for _, element := range unset.AsArrayLiteralExpression().Elements.Nodes {
				text, ok := qmText(element)
				if element.Kind == ast.KindSpreadElement || !ok {
					known = false
					break
				}
				items = append(items, item{text, element})
			}
		}
		if !known {
			w.ambiguity(rule, file, unsetValue, "Mutation updateNode unset patch is dynamic and may bypass a StateMachine transition.")
		} else {
			for _, item := range items {
				if selected.properties[item.text] != "" {
					w.violation(rule, file, item.node, "Mutation unsets machine-backed property "+item.text+" through updateNode; StateMachine changes require transition.")
				}
			}
		}
	})
}
