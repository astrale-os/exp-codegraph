package sourcepolicy

import (
	"encoding/json"
	"sort"
	"strings"

	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

var StateRevisions = map[string]string{
	"SCH-STATE-RELATION": "5dd255417705fa49bda9c79a65032408e2817616c03e8d761ed8c6d089a733d3",
	"SCH-STATE-PURE":     "8bc69ef2aea37f568d34953c81cad55b1a91ab021e5d6e9b98c6aee3db6f4dd5",
}

type machineObservation struct {
	File   *File
	Call   *ast.Node
	Origin string
}

func machineCalls(project *Project, file *File) []machineObservation {
	out := []machineObservation{}
	authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindCallExpression {
			origin := StateMachineConstructorOrigin(project, file, node.AsCallExpression().Expression)
			if origin != "absent" {
				out = append(out, machineObservation{file, node, origin})
			}
		}
	})
	return out
}

// This is deliberately narrower than schemaPropertyName: the SDK State
// relation verifier excludes numeric property names but Schema vocabulary does
// not. Merging those observations would change existing decisions.
func stateStaticPropertyName(property *ast.Node) (string, bool) {
	name := property.Name()
	if name == nil {
		return "", false
	}
	if name.Kind == ast.KindIdentifier {
		return name.Text(), true
	}
	if name.Kind == ast.KindStringLiteral {
		return authored.StaticText(name)
	}
	if name.Kind == ast.KindComputedPropertyName {
		return authored.StaticText(name.AsComputedPropertyName().Expression)
	}
	return "", false
}
func stateAssignedValue(object *ast.Node, name string) *ast.Node {
	for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
		if actual, ok := stateStaticPropertyName(property); ok && actual == name {
			if property.Kind == ast.KindPropertyAssignment {
				return property.AsPropertyAssignment().Initializer
			}
			return nil
		}
	}
	return nil
}
func admitStaticRelation(result *Result, file *File, call *ast.Node) {
	rule := "SCH-STATE-RELATION"
	input := authored.Unwrap(authored.Argument(call, 0))
	if input == nil || input.Kind != ast.KindObjectLiteralExpression {
		result.emit(rule, file, call, "ambiguity", "State machine relation is not one static object literal.")
		return
	}
	names := map[string]bool{}
	valid := len(input.AsObjectLiteralExpression().Properties.Nodes) == 2
	for _, property := range input.AsObjectLiteralExpression().Properties.Nodes {
		name, ok := stateStaticPropertyName(property)
		valid = valid && ok
		names[name] = true
	}
	if !valid || !names["initial"] || !names["transitions"] {
		result.emit(rule, file, input, "violation", "State machine relation must contain exactly initial and transitions.")
		return
	}
	initial, transitionsValue := stateAssignedValue(input, "initial"), stateAssignedValue(input, "transitions")
	if _, ok := authored.StaticText(initial); !ok {
		node := initial
		if node == nil {
			node = input
		}
		result.emit(rule, file, node, "ambiguity", "State machine initial state is not static text.")
		return
	}
	transitions := authored.Unwrap(transitionsValue)
	if transitions == nil || transitions.Kind != ast.KindObjectLiteralExpression {
		node := transitionsValue
		if node == nil {
			node = input
		}
		result.emit(rule, file, node, "ambiguity", "State machine transitions are not one static object literal.")
		return
	}
	for _, state := range transitions.AsObjectLiteralExpression().Properties.Nodes {
		name, ok := stateStaticPropertyName(state)
		var outgoing *ast.Node
		if state.Kind == ast.KindPropertyAssignment {
			outgoing = authored.Unwrap(state.AsPropertyAssignment().Initializer)
		}
		if !ok || outgoing == nil || outgoing.Kind != ast.KindObjectLiteralExpression {
			result.emit(rule, file, state, "ambiguity", "State machine state transitions are not statically enumerable.")
			return
		}
		for _, transition := range outgoing.AsObjectLiteralExpression().Properties.Nodes {
			_, known := stateStaticPropertyName(transition)
			if transition.Kind != ast.KindPropertyAssignment {
				known = false
			} else {
				_, literal := authored.StaticText(transition.AsPropertyAssignment().Initializer)
				known = known && literal
			}
			if !known {
				result.emit(rule, file, transition, "ambiguity", "State machine transitions from "+name+" are not statically enumerable.")
				return
			}
		}
	}
}

type relationVocabulary struct {
	States, Events, Terminal map[string]bool
	Key                      string
}
type relationRow struct {
	name     string
	outgoing []relationEdge
}
type relationEdge struct{ name, target string }

func localePermutation(project *Project, values []string) ([]int, bool) {
	indices := make([]int, len(values))
	for i := range indices {
		indices[i] = i
	}
	if len(values) < 2 {
		return indices, true
	}
	if project.LocaleOrder != nil {
		observation := project.LocaleOrder(values)
		if !observation.Known {
			return nil, false
		}
		indices = indices[:0]
		seen := make([]bool, len(values))
		for _, group := range observation.Groups {
			if len(group) == 0 {
				return nil, false
			}
			previous := -1
			for _, index := range group {
				if index < 0 || index >= len(values) || seen[index] || index <= previous {
					return nil, false
				}
				previous = index
				seen[index] = true
				indices = append(indices, index)
			}
		}
		return indices, len(indices) == len(values)
	}
	if project.LocaleCompare == nil {
		return nil, false
	}
	sort.SliceStable(indices, func(i, j int) bool { return project.LocaleCompare(values[indices[i]], values[indices[j]]) < 0 })
	return indices, true
}

func staticRelationKey(project *Project, object *ast.Node) (string, bool, bool) {
	rows := []relationRow{}
	for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
		name, ok := stateStaticPropertyName(property)
		var outgoing *ast.Node
		if property.Kind == ast.KindPropertyAssignment {
			outgoing = authored.Unwrap(property.AsPropertyAssignment().Initializer)
		}
		if !ok || outgoing == nil || outgoing.Kind != ast.KindObjectLiteralExpression {
			return "", false, true
		}
		edges := []relationEdge{}
		for _, transition := range outgoing.AsObjectLiteralExpression().Properties.Nodes {
			event, ok := stateStaticPropertyName(transition)
			if !ok || transition.Kind != ast.KindPropertyAssignment {
				return "", false, true
			}
			target, ok := authored.StaticText(transition.AsPropertyAssignment().Initializer)
			if !ok {
				return "", false, true
			}
			edges = append(edges, relationEdge{event, target})
		}
		if len(edges) > 1 {
			names := make([]string, len(edges))
			for i, edge := range edges {
				names[i] = edge.name
			}
			indices, known := localePermutation(project, names)
			if !known {
				return "", false, false
			}
			ordered := make([]relationEdge, len(edges))
			for i, index := range indices {
				ordered[i] = edges[index]
			}
			edges = ordered
		}
		rows = append(rows, relationRow{name, edges})
	}
	if len(rows) > 1 {
		names := make([]string, len(rows))
		for i, row := range rows {
			names[i] = row.name
		}
		indices, known := localePermutation(project, names)
		if !known {
			return "", false, false
		}
		ordered := make([]relationRow, len(rows))
		for i, index := range indices {
			ordered[i] = rows[index]
		}
		rows = ordered
	}
	serialized := [][2]any{}
	for _, row := range rows {
		edges := [][2]jsstring.JSONText{}
		for _, edge := range row.outgoing {
			edges = append(edges, [2]jsstring.JSONText{jsstring.JSONText(edge.name), jsstring.JSONText(edge.target)})
		}
		serialized = append(serialized, [2]any{jsstring.JSONText(row.name), edges})
	}
	data, err := json.Marshal(serialized)
	if err != nil {
		panic(err)
	}
	return string(data), true, true
}
func observeRelationVocabulary(project *Project, call *ast.Node) (*relationVocabulary, bool) {
	input := authored.Unwrap(authored.Argument(call, 0))
	if input == nil || input.Kind != ast.KindObjectLiteralExpression {
		return nil, true
	}
	transitions := authored.Unwrap(stateAssignedValue(input, "transitions"))
	if transitions == nil || transitions.Kind != ast.KindObjectLiteralExpression {
		return nil, true
	}
	key, valid, known := staticRelationKey(project, transitions)
	if !known || !valid {
		return nil, known
	}
	v := &relationVocabulary{map[string]bool{}, map[string]bool{}, map[string]bool{}, key}
	for _, property := range transitions.AsObjectLiteralExpression().Properties.Nodes {
		name, _ := stateStaticPropertyName(property)
		v.States[name] = true
		outgoing := authored.Unwrap(property.AsPropertyAssignment().Initializer)
		if len(outgoing.AsObjectLiteralExpression().Properties.Nodes) == 0 {
			v.Terminal[name] = true
		}
		for _, transition := range outgoing.AsObjectLiteralExpression().Properties.Nodes {
			event, _ := stateStaticPropertyName(transition)
			v.Events[event] = true
		}
	}
	return v, true
}
func setsEqual(left, right map[string]bool) bool {
	if len(left) != len(right) {
		return false
	}
	for key := range left {
		if !right[key] {
			return false
		}
	}
	return true
}
func duplicatedProjection(project *Project, expression *ast.Node, vocabulary *relationVocabulary) (string, bool) {
	value := authored.Unwrap(expression)
	if value.Kind == ast.KindPropertyAccessExpression {
		name := value.Name().Text()
		if name == "initial" || name == "states" || name == "terminalStates" || name == "transitions" {
			return name + " StateMachine projection", true
		}
	}
	if value.Kind == ast.KindStringLiteral {
		if text, known := authored.StaticText(value); known && vocabulary.States[text] {
			return "initial-state constant", true
		}
	}
	if value.Kind == ast.KindObjectLiteralExpression {
		key, valid, known := staticRelationKey(project, value)
		if !known {
			return "", false
		}
		if valid && key == vocabulary.Key {
			return "transition relation", true
		}
	}
	if value.Kind != ast.KindArrayLiteralExpression || len(value.AsArrayLiteralExpression().Elements.Nodes) == 0 {
		return "", true
	}
	actual := map[string]bool{}
	for _, element := range value.AsArrayLiteralExpression().Elements.Nodes {
		if element.Kind == ast.KindSpreadElement {
			return "", true
		}
		text, ok := authored.StaticText(element)
		if !ok {
			return "", true
		}
		actual[text] = true
	}
	if setsEqual(actual, vocabulary.States) {
		return "state list", true
	}
	if setsEqual(actual, vocabulary.Terminal) {
		return "terminal-state list", true
	}
	if setsEqual(actual, vocabulary.Events) {
		return "event list", true
	}
	return "", true
}
func duplicatesClosedVocabulary(typ *ast.Node, vocabulary *relationVocabulary) bool {
	members := []*ast.Node{typ}
	if typ.Kind == ast.KindUnionType {
		members = typ.AsUnionTypeNode().Types.Nodes
	}
	actual := map[string]bool{}
	for _, member := range members {
		if member.Kind != ast.KindLiteralType || member.AsLiteralTypeNode().Literal.Kind != ast.KindStringLiteral {
			return false
		}
		text, known := authored.StaticText(member.AsLiteralTypeNode().Literal)
		if !known {
			return false
		}
		actual[text] = true
	}
	return setsEqual(actual, vocabulary.States) || setsEqual(actual, vocabulary.Events)
}
func parallelAuthorityEvidence(result *Result, project *Project, files []*File, machine machineObservation) {
	rule := "SCH-STATE-RELATION"
	vocabulary, known := observeRelationVocabulary(project, machine.Call)
	if !known {
		result.residual(rule, machine.File, machine.Call, "canonical locale relation ordering authority unavailable")
		return
	}
	if vocabulary == nil {
		return
	}
	for _, file := range files {
		for _, statement := range file.Source.Statements.Nodes {
			if statement.Kind == ast.KindVariableStatement {
				exported := statement.ModifierFlags()&ast.ModifierFlagsExport != 0
				for _, decl := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
					if decl.Name().Kind != ast.KindIdentifier || decl.AsVariableDeclaration().Initializer == nil || file == machine.File && authored.Unwrap(decl.AsVariableDeclaration().Initializer) == machine.Call || !exported && !locallyExported(file, decl.Name().Text()) {
						continue
					}
					projection, known := duplicatedProjection(project, decl.AsVariableDeclaration().Initializer, vocabulary)
					if !known {
						result.residual(rule, file, decl, "canonical locale projection ordering authority unavailable")
					} else if projection != "" {
						result.emit(rule, file, decl, "violation", "Schema module exports a separate "+projection+"; derive it from the StateMachine at the use site.")
					}
				}
			}
			if statement.Kind == ast.KindTypeAliasDeclaration && (statement.ModifierFlags()&ast.ModifierFlagsExport != 0 || locallyExported(file, statement.Name().Text())) && duplicatesClosedVocabulary(statement.Type(), vocabulary) {
				result.emit(rule, file, statement, "violation", "Schema module exports a separate state or event union; derive it with StateOf or EventOf.")
			}
		}
	}
}
func EvaluateStates(project *Project) Result {
	result := Result{Evidence: []Evidence{}, Residual: []Residual{}}
	files := []*File{}
	groups := map[string][]*File{}
	keys := []string{}
	for _, file := range project.Files {
		if file.Role == "production" && file.Layer == "schema" && file.Submodule != "" {
			files = append(files, file)
			if _, exists := groups[file.Submodule]; !exists {
				keys = append(keys, file.Submodule)
			}
			groups[file.Submodule] = append(groups[file.Submodule], file)
		}
	}
	if len(keys) > 1 {
		indices, known := localePermutation(project, keys)
		if !known {
			result.residual("SCH-STATE-RELATION", files[0], files[0].Source.AsNode(), "canonical locale module ordering authority unavailable")
		} else {
			ordered := make([]string, len(keys))
			for i, index := range indices {
				ordered[i] = keys[index]
			}
			keys = ordered
		}
	}
	for _, key := range keys {
		owned := groups[key]
		machines := []machineObservation{}
		for _, file := range owned {
			machines = append(machines, machineCalls(project, file)...)
		}
		for _, machine := range machines {
			if machine.Origin == "ambiguous" {
				result.emit("SCH-STATE-RELATION", machine.File, machine.Call, "ambiguity", "State machine constructor is reached through a local facade; its SDK origin is unresolved.")
				continue
			}
			status := MachineExportStatus(machine.File, machine.Call)
			if status != "exported" {
				message := "State machine relation must be assigned to one exported top-level binding."
				if status == "private" {
					message = "State machine relation must be exported as its Schema module StateMachine authority."
				}
				if status == "mutable" {
					message = "State machine relation must be declared const as its stable Schema module authority."
				}
				result.emit("SCH-STATE-RELATION", machine.File, machine.Call, "violation", message)
			}
			admitStaticRelation(&result, machine.File, machine.Call)
		}
		for _, machine := range machines {
			if machine.Origin == "resolved" {
				parallelAuthorityEvidence(&result, project, owned, machine)
			}
		}
	}
	for _, file := range files {
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			symbol := project.Authored(file).ResolveImportedSymbol(node.AsCallExpression().Expression)
			if symbol.Kind != "local" && symbol.Name == "defineStateMachine" && symbol.Module == "@astrale-os/sdk/state" {
				result.emit("SCH-STATE-RELATION", file, node, "violation", "StateMachine uses unsupported defineStateMachine; use stateMachine.")
			}
		})
	}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" {
			continue
		}
		machines := machineCalls(project, file)
		if len(machines) == 0 {
			continue
		}
		rule := "SCH-STATE-PURE"
		for _, statement := range file.Source.Statements.Nodes {
			exported := statement.ModifierFlags()&ast.ModifierFlagsExport != 0
			if (statement.Kind == ast.KindClassDeclaration || statement.Kind == ast.KindFunctionDeclaration && statement.Name() != nil) && (exported || statement.Name() != nil && locallyExported(file, statement.Name().Text())) {
				result.emit(rule, file, statement, "violation", "StateMachine declaration file exports executable behavior; move guards and callbacks to Rules or an effect-owning layer.")
			}
			if statement.Kind != ast.KindVariableStatement {
				continue
			}
			for _, decl := range statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
				if decl.Name().Kind != ast.KindIdentifier || decl.AsVariableDeclaration().Initializer == nil || !exported && !locallyExported(file, decl.Name().Text()) {
					continue
				}
				var behavior *ast.Node
				authored.Walk(authored.Unwrap(decl.AsVariableDeclaration().Initializer), func(node *ast.Node) {
					if behavior == nil && (ast.IsFunctionLike(node) || node.Kind == ast.KindNewExpression) {
						behavior = node
					}
				})
				if behavior != nil {
					result.emit(rule, file, behavior, "violation", "StateMachine declaration file exports executable behavior; move guards and callbacks to Rules or an effect-owning layer.")
				}
			}
		}
		for _, imp := range file.Imports {
			resolution := projectImport(project, file, imp)
			if !resolution.Known {
				result.residual(rule, file, imp.Node, "contextual source import authority unavailable")
			}
			forbidden := map[string]bool{"functions": true, "integrations": true, "mutations": true, "providers": true, "queries": true, "rules": true, "scripts": true, "views": true}
			if resolution.Target != nil && forbidden[resolution.Target.Layer] || effectBoundary.MatchString(imp.Specifier) || strings.HasPrefix(imp.Specifier, "@astrale-os/adapter-") {
				result.emit(rule, file, imp.Node, "violation", "StateMachine declaration imports behavioral boundary "+imp.Specifier+".")
			}
		}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			expression := authored.Unwrap(node.AsCallExpression().Expression)
			name := ""
			if expression.Kind == ast.KindIdentifier && forbiddenGlobal[expression.Text()] && !authored.LocallyOwned(expression, true) {
				name = expression.Text()
			}
			chain := namedPropertyChain(expression)
			if len(chain) == 2 && chain[0] == "globalThis" && forbiddenGlobal[chain[1]] {
				name = chain[1]
			}
			if name != "" {
				result.emit(rule, file, node, "violation", "StateMachine declaration calls effectful global "+name+".")
			}
		})
		for _, machine := range machines {
			input := authored.Argument(machine.Call, 0)
			if input == nil {
				continue
			}
			authored.Walk(authored.Unwrap(input), func(node *ast.Node) {
				if node == input || node.Kind == ast.KindObjectLiteralExpression {
					return
				}
				if ast.IsFunctionLike(node) || node.Kind == ast.KindAwaitExpression || node.Kind == ast.KindNewExpression || node.Kind == ast.KindCallExpression && node != machine.Call {
					result.emit(rule, file, node, "violation", "State machine relation contains executable behavior instead of finite topology.")
				}
			})
		}
	}
	return result
}
