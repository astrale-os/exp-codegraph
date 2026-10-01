package sourcepolicy

import (
	"sort"
	"strings"

	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

const SchemaStateRevision = "153bb37fbc7ddcf164dea299d6874251b6b2aeffa707e809044c5390f25b3fe6"

// ECMAScript default Array.sort compares UTF16 code units. Locale sorting is
// a separate authority and must not accidentally replace vocabulary sorting.
func utf16Less(left, right string) bool {
	leftString, leftError := jsstring.FromCompilerText(left)
	rightString, rightError := jsstring.FromCompilerText(right)
	if leftError != nil || rightError != nil {
		panic("Invalid owned JavaScript string identity")
	}
	a, b := leftString.Units(), rightString.Units()
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return len(a) < len(b)
}
func vocabularyKey(values []string) string {
	set := map[string]bool{}
	for _, value := range values {
		set[value] = true
	}
	keys := make([]string, 0, len(set))
	for value := range set {
		keys = append(keys, value)
	}
	sort.Slice(keys, func(i, j int) bool { return utf16Less(keys[i], keys[j]) })
	return strings.Join(keys, "\x00")
}
func schemaPropertyName(node *ast.Node) string {
	if node == nil {
		return "<dynamic>"
	}
	switch node.Kind {
	case ast.KindIdentifier, ast.KindNumericLiteral:
		return node.Text()
	case ast.KindStringLiteral:
		if text, known := authored.StaticText(node); known {
			return text
		}
	case ast.KindComputedPropertyName:
		if text, ok := authored.StaticText(node.AsComputedPropertyName().Expression); ok {
			return text
		}
	}
	return "<dynamic>"
}
func stateVocabularies(project *Project) map[string]map[string]bool {
	out := map[string]map[string]bool{}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" || file.Submodule == "" {
			continue
		}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression || StateMachineConstructorOrigin(project, file, node.AsCallExpression().Expression) != "resolved" {
				return
			}
			input := authored.Unwrap(authored.Argument(node, 0))
			if input == nil || input.Kind != ast.KindObjectLiteralExpression {
				return
			}
			transitions := authored.ObjectProperty(input, "transitions")
			if transitions == nil || transitions.Kind != ast.KindPropertyAssignment {
				return
			}
			relation := authored.Unwrap(transitions.AsPropertyAssignment().Initializer)
			if relation.Kind != ast.KindObjectLiteralExpression {
				return
			}
			states, events := []string{}, []string{}
			for _, state := range relation.AsObjectLiteralExpression().Properties.Nodes {
				if state.Name() == nil || state.Kind != ast.KindPropertyAssignment {
					return
				}
				name := schemaPropertyName(state.Name())
				if name == "<dynamic>" {
					return
				}
				states = append(states, name)
				outgoing := authored.Unwrap(state.AsPropertyAssignment().Initializer)
				if outgoing.Kind != ast.KindObjectLiteralExpression {
					return
				}
				for _, event := range outgoing.AsObjectLiteralExpression().Properties.Nodes {
					if event.Name() == nil {
						return
					}
					name := schemaPropertyName(event.Name())
					if name == "<dynamic>" {
						return
					}
					events = append(events, name)
				}
			}
			if out[file.Submodule] == nil {
				out[file.Submodule] = map[string]bool{}
			}
			out[file.Submodule][vocabularyKey(states)] = true
			out[file.Submodule][vocabularyKey(events)] = true
		})
	}
	return out
}
func isZodCall(file *File, expression *ast.Node) bool {
	chain := namedPropertyChain(expression)
	if len(chain) == 0 {
		return false
	}
	for _, imp := range file.Imports {
		if imp.Specifier != "zod" {
			continue
		}
		if imp.Namespace == chain[0] {
			return true
		}
		for _, binding := range imp.Bindings {
			if binding.Local == chain[0] {
				return true
			}
		}
	}
	return false
}
func enumValues(project *Project, file *File, call *ast.Node) ([]string, bool) {
	callee := call.AsCallExpression().Expression
	if !isZodCall(file, callee) {
		return nil, false
	}
	chain := namedPropertyChain(callee)
	symbol := project.Authored(file).ResolveImportedSymbol(callee)
	last := ""
	if len(chain) > 0 {
		last = chain[len(chain)-1]
	}
	union := symbol.Kind != "local" && symbol.Name == "union" || last == "union"
	if !union && !(symbol.Kind != "local" && symbol.Name == "enum" || last == "enum") {
		return nil, false
	}
	array := authored.Unwrap(authored.Argument(call, 0))
	if array == nil || array.Kind != ast.KindArrayLiteralExpression || union && len(array.AsArrayLiteralExpression().Elements.Nodes) == 0 {
		return nil, false
	}
	values := []string{}
	for _, element := range array.AsArrayLiteralExpression().Elements.Nodes {
		value := element
		if union {
			if element.Kind == ast.KindSpreadElement {
				return nil, false
			}
			literal := authored.Unwrap(element)
			if literal.Kind != ast.KindCallExpression {
				return nil, false
			}
			chain := namedPropertyChain(literal.AsCallExpression().Expression)
			origin := project.Authored(file).ResolveImportedSymbol(literal.AsCallExpression().Expression)
			if !(origin.Kind != "local" && origin.Name == "literal") && !(len(chain) > 0 && chain[len(chain)-1] == "literal") {
				return nil, false
			}
			value = authored.Argument(literal, 0)
		}
		text, known := authored.StaticText(value)
		if !known {
			return nil, false
		}
		values = append(values, text)
	}
	return values, true
}
func isEdgePropertyPlacement(project *Project, file *File, placement *ast.Node) bool {
	for current := placement; current != nil && current.Kind != ast.KindSourceFile; current = current.Parent {
		if current.Kind != ast.KindCallExpression {
			continue
		}
		callee := authored.Unwrap(current.AsCallExpression().Expression)
		var receiver *ast.Node
		member := ""
		if callee.Kind == ast.KindPropertyAccessExpression {
			receiver = callee.AsPropertyAccessExpression().Expression
			member = callee.Name().Text()
		}
		if callee.Kind == ast.KindElementAccessExpression {
			receiver = callee.AsElementAccessExpression().Expression
			member, _ = authored.StaticText(callee.AsElementAccessExpression().ArgumentExpression)
		}
		if receiver == nil || member != "directed" && member != "undirected" {
			continue
		}
		owner := project.Authored(file).ResolveImportedSymbol(receiver)
		if owner.Kind != "local" && owner.Name == "edgeClass" && authored.Contains(authored.DSLModules, owner.Module) {
			return true
		}
	}
	return false
}
func persistedStatePropertyEvidence(result *Result, project *Project, file *File, value, placement *ast.Node) {
	rule := "SCH-STATE-SOURCE"
	origin := StatePropertyOrigin(project, file, value)
	association := StatePropertyIdentity(project, file, value)
	if origin == "resolved" && isEdgePropertyPlacement(project, file, placement) {
		result.emit(rule, file, value, "violation", "Schema StateProperty is supported only on Node Classes.")
		return
	}
	if !association.Known {
		result.residual(rule, file, value, "StateMachine identity authority unavailable")
		return
	}
	if origin == "resolved" && association.Kind == "absent" {
		result.emit(rule, file, value, "violation", "Schema stateProperty does not reference an exported StateMachine authority.")
		return
	}
	if origin == "resolved" && association.Kind == "resolved" {
		path := association.Identity
		if i := strings.LastIndex(path, "#"); i >= 0 {
			path = path[:i]
		}
		machine := project.FilesByPath[path]
		if machine == nil || machine.Layer != "schema" || machine.Submodule == "" || machine.Submodule != file.Submodule {
			result.emit(rule, file, value, "violation", "Schema stateProperty must reference an exported StateMachine authority in the same business module.")
			return
		}
	}
	if origin == "ambiguous" || association.Kind == "ambiguous" {
		result.emit(rule, file, value, "ambiguity", "Schema StateProperty has no exact StateMachine source.")
		return
	}
	if origin != "absent" {
		return
	}
	codec := StateSchemaIdentity(project, file, value)
	if !codec.Known {
		result.residual(rule, file, value, "StateMachine codec identity authority unavailable")
		return
	}
	if codec.Kind == "resolved" {
		result.emit(rule, file, value, "violation", "Schema persists a StateMachine codec without retaining its authority; use stateProperty(machine).")
	}
	if codec.Kind == "ambiguous" {
		result.emit(rule, file, value, "ambiguity", "Schema machine-backed Property has no exact stateProperty source.")
	}
}
func staticSchemaObject(file *File, expression *ast.Node, seen map[string]bool) *ast.Node {
	value := authored.Unwrap(expression)
	if value == nil {
		return nil
	}
	if value.Kind == ast.KindObjectLiteralExpression {
		return value
	}
	if value.Kind != ast.KindIdentifier || seen[value.Text()] {
		return nil
	}
	for _, statement := range file.Source.Statements.Nodes {
		if statement.Kind != ast.KindVariableStatement {
			continue
		}
		list := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
		if list.Flags&ast.NodeFlagsConst == 0 {
			continue
		}
		for _, decl := range list.Declarations.Nodes {
			if decl.Name().Kind == ast.KindIdentifier && decl.Name().Text() == value.Text() && decl.AsVariableDeclaration().Initializer != nil {
				return staticSchemaObject(file, decl.AsVariableDeclaration().Initializer, copySeen(seen, value.Text()))
			}
		}
	}
	return nil
}
func isPropertiesObject(node *ast.Node) bool {
	return node != nil && node.Parent != nil && node.Parent.Kind == ast.KindPropertyAssignment && schemaPropertyName(node.Parent.Name()) == "properties"
}
func EvaluateSchemaState(project *Project) Result {
	result := Result{Evidence: []Evidence{}, Residual: []Residual{}}
	vocabularies := stateVocabularies(project)
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" {
			continue
		}
		owned := vocabularies[file.Submodule]
		reported := map[int]bool{}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if (node.Kind == ast.KindPropertyAssignment || node.Kind == ast.KindShorthandPropertyAssignment) && node.Parent != nil && isPropertiesObject(node.Parent) {
				value := node.Name()
				if node.Kind == ast.KindPropertyAssignment {
					value = node.AsPropertyAssignment().Initializer
				}
				persistedStatePropertyEvidence(&result, project, file, value, node)
			}
			if node.Kind == ast.KindSpreadAssignment && isPropertiesObject(node.Parent) {
				spread := staticSchemaObject(file, node.AsSpreadAssignment().Expression, map[string]bool{})
				if spread != nil {
					for _, entry := range spread.AsObjectLiteralExpression().Properties.Nodes {
						if entry.Kind != ast.KindPropertyAssignment && entry.Kind != ast.KindShorthandPropertyAssignment {
							continue
						}
						value := entry.Name()
						if entry.Kind == ast.KindPropertyAssignment {
							value = entry.AsPropertyAssignment().Initializer
						}
						persistedStatePropertyEvidence(&result, project, file, value, node)
					}
				}
			}
			if node.Kind == ast.KindCallExpression {
				if StateMachineConstructorOrigin(project, file, node.AsCallExpression().Expression) == "ambiguous" {
					result.emit("SCH-STATE-SOURCE", file, node, "ambiguity", "Schema call resembles stateMachine through a local facade, but its SDK origin is unresolved.")
				}
				if values, ok := enumValues(project, file, node); ok && owned[vocabularyKey(values)] && !reported[node.Pos()] {
					reported[node.Pos()] = true
					result.emit("SCH-STATE-SOURCE", file, node, "ambiguity", "Schema declares an enum equal to its module StateMachine vocabulary, but copied semantic ownership cannot be proven from literals alone.")
				}
			}
			var owner *ast.Node
			name := ""
			if node.Kind == ast.KindPropertyAccessExpression {
				name = node.Name().Text()
				owner = node.AsPropertyAccessExpression().Expression
			}
			if node.Kind == ast.KindElementAccessExpression {
				name, _ = authored.StaticText(node.AsElementAccessExpression().ArgumentExpression)
				owner = node.AsElementAccessExpression().Expression
			}
			if owner == nil || name != "stateSchema" && name != "eventSchema" {
				return
			}
			identity := StateMachineIdentity(project, file, owner)
			if !identity.Known {
				result.residual("SCH-STATE-SOURCE", file, node, "StateMachine export authority unavailable")
				return
			}
			if identity.Kind == "ambiguous" {
				result.emit("SCH-STATE-SOURCE", file, node, "ambiguity", "Schema StateMachine codec "+name+" has an unresolved Schema module export origin.")
			}
			if identity.Kind == "absent" {
				result.emit("SCH-STATE-SOURCE", file, node, "violation", "Schema StateMachine codec "+name+" does not originate from an exported stateMachine.")
			}
		})
	}
	return result
}
