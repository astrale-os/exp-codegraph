package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"regexp"
	"strings"
)

var SchemaRevisions = map[string]string{
	"SCH-ONE-DECL":      "efaecd2e6978d1ec6d61559536246505c746b53f5968caf2560e811a970f2d04",
	"SCH-ICON-REQUIRED": "f4055b93066289f9b7d9cfceb5ef236420f88311a357ea11161b6fda0922ab9f",
	"SCH-ICON-NEUTRAL":  "061939249964440ceba92dcb86f166553d56cc0196dff15785616423963d4d5b",
	"SCH-EXACT-TYPES":   "952b22e447d155ca168ac900eede803085cf6326ae73df3c588f6dc8caa3f116",
	"SCH-DECL-ONLY":     "3243da10715f3fbb500444cc562195ae10eb61dad84646ab8ef1d1a73b94c99a",
}

func (result *Result) emit(rule string, file *File, node *ast.Node, kind, message string) {
	result.Evidence = append(result.Evidence, Evidence{Rule: rule, Kind: kind, Evidence: message, File: file, Node: node})
}
func (result *Result) residual(rule string, file *File, node *ast.Node, message string) {
	result.Residual = append(result.Residual, Residual{rule, message, file, node})
}

type schemaConstructor struct{ Module, Name, Member string }
type declarationContract struct {
	Label        string
	Constructors []schemaConstructor
}

var declarationContracts = map[string]declarationContract{
	"classes":   {"Class", []schemaConstructor{{"@astrale-os/sdk/schema", "nodeClass", ""}, {"@astrale-os/sdk/schema", "defineClass", ""}, {"@astrale-os/sdk/schema", "edgeClass", "directed"}, {"@astrale-os/sdk/schema", "edgeClass", "undirected"}}},
	"functions": {"Function or Method", []schemaConstructor{{"@astrale-os/sdk/schema", "func", ""}, {"@astrale-os/sdk/schema", "method", ""}}},
	"policies":  {"Policy", []schemaConstructor{{"@astrale-os/sdk/schema", "policy", ""}, {"@astrale-os/sdk/schema", "policy", "allOf"}, {"@astrale-os/sdk/schema", "policy", "anyOf"}}},
	"states":    {"StateMachine", []schemaConstructor{{"@astrale-os/sdk/state", "stateMachine", ""}}},
	"views":     {"View", []schemaConstructor{{"@astrale-os/sdk/schema", "view", ""}}},
}

func declarationKind(project *Project, file *File) string {
	if file.Role != "production" || file.Layer != "schema" {
		return ""
	}
	prefix, ok := project.LayerSourcePaths["schema"]
	if !ok || len(file.Path) < len(prefix) {
		return ""
	}
	segments := strings.Split(file.Path[len(prefix):], "/")
	index := 0
	if segments[0] == "modules" {
		index = 2
	}
	if len(segments) <= index {
		return ""
	}
	if _, ok := declarationContracts[segments[index]]; ok {
		return segments[index]
	}
	return ""
}
func declarationConstructor(project *Project, file *File, expression *ast.Node) (schemaConstructor, bool) {
	call := authored.Unwrap(expression)
	if call == nil || call.Kind != ast.KindCallExpression {
		return schemaConstructor{}, false
	}
	callee := authored.Unwrap(call.AsCallExpression().Expression)
	direct := project.Authored(file).ResolveImportedSymbol(callee)
	if direct.Kind == "resolved" {
		for _, contract := range declarationContracts {
			for _, constructor := range contract.Constructors {
				if constructor.Member == "" && constructor.Module == direct.Module && constructor.Name == direct.Name {
					return constructor, true
				}
			}
		}
	}
	if callee.Kind != ast.KindPropertyAccessExpression {
		return schemaConstructor{}, false
	}
	origin := project.Authored(file).ResolveImportedSymbol(callee.AsPropertyAccessExpression().Expression)
	if origin.Kind != "resolved" {
		return schemaConstructor{}, false
	}
	for _, contract := range declarationContracts {
		for _, constructor := range contract.Constructors {
			if constructor.Member == callee.Name().Text() && constructor.Module == origin.Module && constructor.Name == origin.Name {
				return constructor, true
			}
		}
	}
	return schemaConstructor{}, false
}

type iconObservation struct {
	State  string
	Node   *ast.Node
	Detail string
	Known  bool
}

func undefinedExpression(expression *ast.Node) bool {
	value := authored.Unwrap(expression)
	return value != nil && ((value.Kind == ast.KindIdentifier && value.Text() == "undefined") || value.Kind == ast.KindVoidExpression)
}
func unknownProperty(property *ast.Node) bool {
	if property.Kind == ast.KindSpreadAssignment {
		return true
	}
	if property.Name() != nil && property.Name().Kind == ast.KindComputedPropertyName {
		_, known := authored.StaticText(property.Name().AsComputedPropertyName().Expression)
		return !known
	}
	return false
}
func neutralIcon(project *Project, file *File, expression *ast.Node) (string, bool) {
	if text, ok := authored.StaticText(expression); ok {
		if project.NeutralClassIconSVG == nil {
			return "", false
		}
		if text == *project.NeutralClassIconSVG {
			return "neutral", true
		}
	}
	value := authored.Unwrap(expression)
	if value.Kind == ast.KindCallExpression {
		callee := authored.Unwrap(value.AsCallExpression().Expression)
		if callee.Kind != ast.KindPropertyAccessExpression || callee.Name().Text() != "svg" {
			return "meaningful", true
		}
		origin := project.Authored(file).ResolveImportedSymbol(callee.AsPropertyAccessExpression().Expression)
		if origin.Kind == "local" || origin.Name != "classIcon" {
			return "meaningful", true
		}
		if origin.Kind == "ambiguous" {
			return "value-ambiguous", true
		}
		if origin.Module != "@astrale-os/sdk/schema" {
			return "meaningful", true
		}
		if text, ok := authored.StaticText(authored.Argument(value, 0)); ok {
			if project.NeutralClassIconSVG == nil {
				return "", false
			}
			if text == *project.NeutralClassIconSVG {
				return "neutral", true
			}
		}
		return "meaningful", true
	}
	if value.Kind != ast.KindPropertyAccessExpression || value.Name().Text() != "neutral" {
		return "meaningful", true
	}
	origin := project.Authored(file).ResolveImportedSymbol(value.AsPropertyAccessExpression().Expression)
	if origin.Kind == "local" || origin.Name != "classIcon" {
		return "meaningful", true
	}
	if origin.Kind == "ambiguous" {
		return "value-ambiguous", true
	}
	if origin.Module == "@astrale-os/sdk/schema" {
		return "neutral", true
	}
	return "meaningful", true
}
func classIconObservation(project *Project, file *File, definition authored.Definition, inspectNeutral bool) iconObservation {
	if definition.Object == nil {
		argument := authored.Argument(definition.Call, 0)
		if argument == nil || undefinedExpression(argument) {
			return iconObservation{State: "missing", Node: definition.Call, Known: true}
		}
		return iconObservation{State: "presence-ambiguous", Node: definition.Call, Detail: "Node Class icon is hidden inside an opaque configuration.", Known: true}
	}
	property := authored.ObjectProperty(definition.Object, "icon")
	if property == nil {
		for _, candidate := range definition.Object.AsObjectLiteralExpression().Properties.Nodes {
			if unknownProperty(candidate) {
				return iconObservation{State: "presence-ambiguous", Node: definition.Object, Detail: "Node Class icon may be supplied by an object spread or computed property.", Known: true}
			}
		}
		return iconObservation{State: "missing", Node: definition.Object, Known: true}
	}
	for _, candidate := range definition.Object.AsObjectLiteralExpression().Properties.Nodes {
		if candidate.Pos() > property.Pos() && unknownProperty(candidate) {
			return iconObservation{State: "presence-ambiguous", Node: property, Detail: "Node Class icon may be overridden by a later object spread or computed property.", Known: true}
		}
	}
	if property.Kind != ast.KindPropertyAssignment {
		return iconObservation{State: "value-ambiguous", Node: property, Detail: "Node Class icon value is not statically visible.", Known: true}
	}
	if undefinedExpression(property.AsPropertyAssignment().Initializer) {
		return iconObservation{State: "missing", Node: property, Known: true}
	}
	if !inspectNeutral {
		return iconObservation{State: "present", Node: property, Known: true}
	}
	state, known := neutralIcon(project, file, property.AsPropertyAssignment().Initializer)
	observation := iconObservation{State: state, Node: property, Known: known}
	if state == "value-ambiguous" {
		observation.Detail = "Node Class icon origin is not statically resolvable."
	}
	return observation
}
func classIconEvidence(result *Result, project *Project, mode string) {
	rule := "SCH-ICON-REQUIRED"
	if mode == "neutral" {
		rule = "SCH-ICON-NEUTRAL"
	}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" {
			continue
		}
		for _, name := range []string{"nodeClass", "defineClass"} {
			for _, definition := range project.Authored(file).Definitions(name, "", authored.DSLModules, 0) {
				if name == "defineClass" {
					if definition.Object == nil {
						continue
					}
					kind, ok := authored.StaticText(authored.PropertyExpression(definition.Object, "kind"))
					if !ok || kind != "node" {
						continue
					}
				}
				if definition.Origin == "ambiguous" {
					if mode == "required" {
						result.emit(rule, file, definition.Call, "ambiguity", name+" declaration resolves through a local facade whose ultimate public constructor origin is unknown.")
					}
					continue
				}
				observation := classIconObservation(project, file, definition, mode == "neutral")
				if !observation.Known {
					result.residual(rule, file, observation.Node, "canonical SDK neutral SVG authority unavailable")
					continue
				}
				if mode == "required" && observation.State == "missing" {
					result.emit(rule, file, observation.Node, "violation", "Node Class must declare icon explicitly; use classIcon.neutral only for an intentional neutral choice.")
				}
				if mode == "required" && observation.State == "presence-ambiguous" {
					result.emit(rule, file, observation.Node, "ambiguity", observation.Detail)
				}
				if mode == "neutral" && observation.State == "neutral" {
					result.emit(rule, file, observation.Node, "violation", "Node Class uses classIcon.neutral; choose a meaningful Lucide or custom SVG icon.")
				}
			}
		}
	}
}

// Five parser-only Schema verifiers. SCH-STATE-SOURCE is supplied by the state
// identity lane and remains outside this function until that port is qualified.
func EvaluateSchema(project *Project) Result {
	result := Result{Evidence: []Evidence{}, Residual: []Residual{}}
	for _, file := range project.Files {
		kind := declarationKind(project, file)
		if kind == "" {
			continue
		}
		contract := declarationContracts[kind]
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			var initializer *ast.Node
			if node.Kind == ast.KindExportAssignment && node.Parent != nil && node.Parent.Kind == ast.KindSourceFile {
				initializer = node.AsExportAssignment().Expression
			}
			if node.Kind == ast.KindVariableDeclaration && node.Parent != nil && node.Parent.Kind == ast.KindVariableDeclarationList && node.Parent.Parent != nil && node.Parent.Parent.Kind == ast.KindVariableStatement && node.Parent.Parent.Parent != nil && node.Parent.Parent.Parent.Kind == ast.KindSourceFile {
				initializer = node.AsVariableDeclaration().Initializer
			}
			if initializer == nil {
				return
			}
			constructor, known := declarationConstructor(project, file, initializer)
			if !known {
				return
			}
			compatible := false
			for _, candidate := range contract.Constructors {
				if candidate == constructor {
					compatible = true
				}
			}
			if !compatible {
				result.emit("SCH-ONE-DECL", file, node, "violation", "Schema "+kind+" source constructs a canonical declaration of another kind; expected "+contract.Label+".")
			}
		})
	}
	classIconEvidence(&result, project, "required")
	classIconEvidence(&result, project, "neutral")
	erased := map[string]bool{"ClassDefinition": true, "FunctionDefinition": true, "MethodDefinition": true, "PolicyDefinition": true, "ViewDefinition": true}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" {
			continue
		}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			var typ *ast.Node
			switch node.Kind {
			case ast.KindVariableDeclaration, ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindMethodDeclaration:
				typ = node.Type()
			}
			if typ == nil || typ.Kind != ast.KindTypeReference {
				return
			}
			name := typ.AsTypeReferenceNode().TypeName
			root := name
			if name.Kind == ast.KindQualifiedName {
				root = name.AsQualifiedName().Left
				name = name.AsQualifiedName().Right
			}
			if root.Kind != ast.KindIdentifier || !erased[name.Text()] {
				return
			}
			origin := project.Authored(file).ResolveImportedSymbol(root)
			if origin.Kind == "local" || (origin.Module != "@astrale-os/sdk/schema" && !strings.HasPrefix(origin.Module, "@astrale-os/kernel-dsl")) {
				return
			}
			result.emit("SCH-EXACT-TYPES", file, typ, "violation", "Schema authoring value is widened to "+name.Text()+"; preserve its exact inferred type.")
		})
	}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" {
			continue
		}
		for _, imp := range file.Imports {
			path := schemaAlias.ReplaceAllString(imp.Specifier, "$1/")
			if strings.HasSuffix(path, ".js") {
				path = strings.TrimSuffix(path, ".js") + ".ts"
			}
			layer := ""
			if target := project.FilesByPath[path]; target != nil {
				layer = target.Layer
			}
			if layer == "" {
				if groups := schemaAlias.FindStringSubmatch(imp.Specifier); len(groups) > 1 {
					layer = groups[1]
				}
			}
			if schemaForbidden[layer] {
				result.emit("SCH-DECL-ONLY", file, imp.Node, "violation", "Schema imports execution layer "+layer+" through "+imp.Specifier+".")
			} else if forbiddenIO(imp.Specifier) {
				result.emit("SCH-DECL-ONLY", file, imp.Node, "violation", "Schema imports I/O boundary "+imp.Specifier+".")
			}
		}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			expression := node.AsCallExpression().Expression
			origin := project.Authored(file).ResolveImportedSymbol(expression)
			chain := namedPropertyChain(expression)
			if origin.Kind != "local" && schemaExecutionNames[origin.Name] {
				result.emit("SCH-DECL-ONLY", file, node, "violation", "Schema executes "+origin.Name+" instead of declaring a contract.")
			} else if origin.Kind == "local" && len(chain) > 1 && schemaExecutionNames[chain[len(chain)-1]] {
				result.emit("SCH-DECL-ONLY", file, node, "ambiguity", "Schema call "+strings.Join(chain, ".")+" resembles an excluded operation but its receiver is opaque.")
			}
		})
	}
	return result
}
func forbiddenIO(specifier string) bool {
	return strings.HasPrefix(specifier, "node:") && !strings.HasPrefix(specifier, "node:assert") && !strings.HasPrefix(specifier, "node:util/types")
}

var schemaAlias = regexp.MustCompile(`^#([^/]+)/`)
var schemaForbidden = map[string]bool{"integrations": true, "functions": true, "providers": true, "mutations": true, "queries": true, "ui": true, "views": true}
var schemaExecutionNames = map[string]bool{"defineAction": true, "defineMutation": true, "defineQuery": true, "defineWorkflow": true, "invoke": true, "mutate": true, "query": true}
