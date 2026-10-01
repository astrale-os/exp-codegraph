package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

type workflowDefinition struct {
	call, run *ast.Node
	origin    string
}

func workflowDefinitions(project *Project, file *File) []workflowDefinition {
	out := []workflowDefinition{}
	for _, definition := range project.Authored(file).Calls("defineWorkflow", nil) {
		call := definition.Call
		if call.Parent != nil && call.Parent.Kind == ast.KindCallExpression && call.Parent.AsCallExpression().Expression == call {
			call = call.Parent
		}
		args := call.AsCallExpression().Arguments
		var run *ast.Node
		if args != nil {
			if len(args.Nodes) == 2 {
				run = authored.Unwrap(args.Nodes[1])
			} else if len(args.Nodes) == 3 {
				run = authored.Unwrap(args.Nodes[2])
			}
		}
		if !familyFunction(run) {
			run = nil
		}
		out = append(out, workflowDefinition{call, run, definition.Origin})
	}
	return out
}
func workflowRoots(run *ast.Node) [][]string {
	if run == nil || len(run.Parameters()) == 0 {
		return nil
	}
	name := run.Parameters()[0].Name()
	if name == nil {
		return nil
	}
	if name.Kind == ast.KindIdentifier {
		return [][]string{{name.Text(), "step"}}
	}
	if name.Kind != ast.KindObjectBindingPattern {
		return nil
	}
	out := [][]string{}
	for _, element := range name.AsNode().AsBindingPattern().Elements.Nodes {
		binding := element.AsBindingElement()
		source := ""
		if binding.PropertyName != nil && binding.PropertyName.Kind == ast.KindIdentifier {
			source = binding.PropertyName.Text()
		} else if binding.Name().Kind == ast.KindIdentifier {
			source = binding.Name().Text()
		}
		if source == "step" && binding.Name().Kind == ast.KindIdentifier {
			out = append(out, []string{binding.Name().Text()})
		}
	}
	return out
}
func workflowStepMethod(call *ast.Node, roots [][]string) string {
	if call.Kind != ast.KindCallExpression {
		return ""
	}
	chain := familyPropertyChain(call.AsCallExpression().Expression)
	if len(chain) == 0 || chain[len(chain)-1] != "run" {
		return ""
	}
	for _, root := range roots {
		if len(chain) == len(root)+1 && familySameChain(root, chain[:len(root)]) {
			return "run"
		}
	}
	return ""
}
func workflowLocals(source *ast.SourceFile) map[string][]*ast.Node {
	out := map[string][]*ast.Node{}
	authored.Walk(source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindFunctionDeclaration && node.Name() != nil {
			out[node.Name().Text()] = append(out[node.Name().Text()], node)
		}
		if node.Kind == ast.KindVariableDeclaration && node.Name().Kind == ast.KindIdentifier {
			value := authored.Unwrap(node.AsVariableDeclaration().Initializer)
			if familyFunction(value) {
				out[node.Name().Text()] = append(out[node.Name().Text()], value)
			}
		}
	})
	return out
}
func workflowMapped(arguments []*ast.Node, parameters []*ast.Node, roots [][]string) [][]string {
	out := [][]string{}
	for index, argument := range arguments {
		chain := familyPropertyChain(argument)
		if chain == nil {
			continue
		}
		matches := false
		for _, root := range roots {
			if familySameChain(root, chain) {
				matches = true
				break
			}
		}
		if !matches || index >= len(parameters) {
			continue
		}
		name := parameters[index].Name()
		if name != nil && name.Kind == ast.KindIdentifier {
			out = append(out, []string{name.Text()})
		}
	}
	return out
}
func workflowTrace(file *File, fn, owner *ast.Node, roots [][]string, helpers map[string][]*ast.Node, out *Result, active map[*ast.Node]bool) {
	if fn == nil || fn.Body() == nil || active[fn] {
		return
	}
	active[fn] = true
	defer delete(active, fn)
	body := fn.Body()
	var walk func(*ast.Node)
	walk = func(node *ast.Node) {
		if node != body && ast.IsFunctionLike(node) {
			return
		}
		if node.Kind == ast.KindCallExpression {
			if workflowStepMethod(node, roots) == "run" {
				familyEmit(out, "FNC-NO-NEST", file, node, "violation", "step.run callback reaches nested step.run.")
				return
			}
			target := authored.Unwrap(node.AsCallExpression().Expression)
			if target.Kind == ast.KindIdentifier {
				candidates := helpers[target.Text()]
				var parameters []*ast.Node
				if len(candidates) > 0 {
					parameters = candidates[0].Parameters()
				}
				var args []*ast.Node
				if node.AsCallExpression().Arguments != nil {
					args = node.AsCallExpression().Arguments.Nodes
				}
				mapped := workflowMapped(args, parameters, roots)
				if len(candidates) == 1 {
					next := [][]string{}
					if familyNestedInside(candidates[0], owner) {
						next = append(next, roots...)
					}
					next = append(next, mapped...)
					workflowTrace(file, candidates[0], owner, next, helpers, out, active)
				} else if len(mapped) > 0 {
					familyEmit(out, "FNC-NO-NEST", file, node, "ambiguity", "Helper "+target.Text()+" receives the step binding but does not resolve to one local function.")
				}
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(body)
}
func EvaluateWorkflows(project *Project) Result {
	out := familyResult()
	for _, file := range familyProduction(project, "functions") {
		if len(workflowDefinitions(project, file)) == 0 {
			continue
		}
		for _, statement := range file.Source.Statements.Nodes {
			if statement.Kind == ast.KindInterfaceDeclaration && (strings.HasSuffix(statement.Name().Text(), "Integrations") || strings.HasSuffix(statement.Name().Text(), "Clients")) {
				familyEmit(&out, "FNC-INT-TYPES", file, statement, "violation", "Workflow "+statement.Name().Text()+" manually redeclares Integration clients; reference declared Integration definitions.")
			}
		}
	}
	for _, file := range familyProduction(project, "functions") {
		for _, definition := range workflowDefinitions(project, file) {
			if definition.origin == "ambiguous" {
				familyEmit(&out, "FNC-STEP-IDS", file, definition.call, "ambiguity", "Workflow definition resolves through a local facade whose ultimate public constructor origin is unknown.")
				continue
			}
			if definition.run == nil {
				familyEmit(&out, "FNC-STEP-IDS", file, definition.call, "ambiguity", "Workflow run is not a static function.")
				continue
			}
			roots := workflowRoots(definition.run)
			if len(roots) == 0 {
				familyEmit(&out, "FNC-STEP-IDS", file, definition.run, "ambiguity", "Workflow step binding cannot be identified from its context parameter.")
				continue
			}
			ids := map[string]bool{}
			familyOwnBody(definition.run, func(node *ast.Node) {
				method := workflowStepMethod(node, roots)
				if method == "" {
					return
				}
				argument := authored.Argument(node, 0)
				location := argument
				if location == nil {
					location = node
				}
				value, static, textError := familyStaticText(argument)
				if textError != nil {
					familyMissing(&out, "FNC-STEP-IDS", file, location, "Captured step literal text is unavailable.")
					return
				}
				id := value.WTF8()
				if !static || id == "" {
					familyEmit(&out, "FNC-STEP-IDS", file, location, "violation", "Workflow "+method+" step ID is not a non-empty literal.")
					return
				}
				if project.AcceptStepIDUnits == nil && (project.AcceptStepID == nil || !value.ValidUnicode()) {
					familyMissing(&out, "FNC-STEP-IDS", file, location, "Canonical captured SDK acceptStepId authority is unavailable.")
					return
				}
				var accepted bool
				var err error
				if project.AcceptStepIDUnits != nil {
					accepted, err = project.AcceptStepIDUnits(value.Units())
				} else {
					accepted, err = project.AcceptStepID(id)
				}
				if err != nil {
					familyMissing(&out, "FNC-STEP-IDS", file, location, "Canonical captured SDK acceptStepId authority failed.")
					return
				}
				if !accepted {
					familyEmit(&out, "FNC-STEP-IDS", file, location, "violation", fmt.Sprintf("Workflow %s step ID is not an SDK-admitted literal (1-128 characters, without surrounding whitespace).", method))
				} else if ids[value.Key()] {
					familyEmit(&out, "FNC-STEP-IDS", file, argument, "violation", "Workflow duplicates step ID "+id+".")
				} else {
					ids[value.Key()] = true
				}
			})
		}
	}
	for _, file := range familyProduction(project, "functions") {
		helpers := workflowLocals(file.Source)
		for _, definition := range workflowDefinitions(project, file) {
			if definition.origin == "ambiguous" {
				familyEmit(&out, "FNC-NO-NEST", file, definition.call, "ambiguity", "Workflow definition resolves through a local facade whose ultimate public constructor origin is unknown.")
				continue
			}
			if definition.run == nil {
				continue
			}
			roots := workflowRoots(definition.run)
			familyOwnBody(definition.run, func(node *ast.Node) {
				if workflowStepMethod(node, roots) != "run" {
					return
				}
				value := authored.Unwrap(authored.Argument(node, 1))
				if value == nil {
					familyEmit(&out, "FNC-NO-NEST", file, node, "ambiguity", "step.run callback is absent.")
					return
				}
				if familyFunction(value) {
					workflowTrace(file, value, definition.run, roots, helpers, &out, map[*ast.Node]bool{})
					return
				}
				if value.Kind == ast.KindIdentifier {
					candidates := helpers[value.Text()]
					if len(candidates) != 1 {
						familyEmit(&out, "FNC-NO-NEST", file, value, "ambiguity", "step.run callback "+value.Text()+" does not resolve to one local function.")
						return
					}
					workflowTrace(file, candidates[0], definition.run, nil, helpers, &out, map[*ast.Node]bool{})
					return
				}
				familyEmit(&out, "FNC-NO-NEST", file, value, "ambiguity", "step.run callback is not statically callable.")
			})
		}
	}
	return out
}
