// The TypeSpec V2 body qualification plugin proves that a downstream native
// analyzer can use ttsc's supported driver boundary while keeping compiler
// objects behind a portable, occurrence-oriented fact contract.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	shimscanner "github.com/microsoft/typescript-go/shim/scanner"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

const artifactFile = ".ttsc-body-facts.json"

type span struct {
	File  string `json:"file"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

type target struct {
	Symbol string `json:"symbol"`
	Origin string `json:"origin"`
	Span   span   `json:"span"`
}

type argumentFact struct {
	Index int    `json:"index"`
	Kind  int    `json:"kind"`
	Text  string `json:"text"`
}

type valueResult struct {
	State  string   `json:"state"`
	Values []string `json:"values,omitempty"`
	Reason string   `json:"reason,omitempty"`
}

type callbackFact struct {
	Form           string  `json:"form"`
	Target         *target `json:"target,omitempty"`
	Body           *span   `json:"body,omitempty"`
	ResolvedTarget *target `json:"resolvedTarget,omitempty"`
	ResolvedBody   *span   `json:"resolvedBody,omitempty"`
}

type callFact struct {
	ID              string         `json:"id"`
	Span            span           `json:"span"`
	Callee          string         `json:"callee"`
	Target          *target        `json:"target,omitempty"`
	Arguments       []argumentFact `json:"arguments"`
	NameValue       *valueResult   `json:"nameValue,omitempty"`
	Callback        *callbackFact  `json:"callback,omitempty"`
	ForwardedTarget *target        `json:"forwardedTarget,omitempty"`
	ForwardedValue  *valueResult   `json:"forwardedValue,omitempty"`
}

type sourceFact struct {
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
}

type artifact struct {
	Format       string       `json:"format"`
	Version      int          `json:"version"`
	Capabilities []string     `json:"capabilities"`
	Sources      []sourceFact `json:"sources"`
	Calls        []callFact   `json:"calls"`
}

type extractor struct {
	root    string
	checker *shimchecker.Checker
}

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "astrale-typespec-v2-body-qualification: command required")
		return 2
	}
	switch args[0] {
	case "version", "-v", "--version":
		fmt.Fprintln(os.Stdout, "astrale-typespec-v2-body-qualification 1.0.0")
		return 0
	case "check":
		return runBuild(args[1:])
	case "build":
		return runBuild(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "astrale-typespec-v2-body-qualification: unknown command %q\n", args[0])
		return 2
	}
}

func runBuild(args []string) int {
	fs := flag.NewFlagSet("build", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	cwd := fs.String("cwd", "", "")
	tsconfig := fs.String("tsconfig", "", "")
	_ = fs.String("plugins-json", "", "")
	_ = fs.Bool("emit", false, "")
	_ = fs.Bool("noEmit", false, "")
	_ = fs.Bool("quiet", false, "")
	_ = fs.Bool("verbose", false, "")
	_ = fs.String("outDir", "", "")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	root := *cwd
	if root == "" {
		var err error
		root, err = os.Getwd()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
	}
	config := *tsconfig
	if config == "" {
		config = filepath.Join(root, "tsconfig.json")
	}

	prog, parseDiags, err := driver.LoadProgram(root, config, driver.LoadProgramOptions{ForceNoEmit: true})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if len(parseDiags) != 0 {
		driver.WritePrettyDiagnostics(os.Stderr, parseDiags, root)
		prog.Close()
		return 2
	}
	defer prog.Close()

	x := extractor{root: root, checker: prog.Checker}
	result := artifact{
		Format:  "astrale.typespec.v2.body-facts",
		Version: 1,
		Capabilities: []string{
			"argument-source",
			"bounded-value-state",
			"callback-body",
			"one-hop-parameter-binding",
			"occurrence-calls",
			"resolved-symbol-target",
			"source-digest",
		},
	}
	for _, file := range prog.SourceFiles() {
		relative, owned := x.ownedPath(file.FileName())
		if !owned {
			continue
		}
		text := file.Text()
		digest := sha256.Sum256([]byte(text))
		result.Sources = append(result.Sources, sourceFact{File: relative, SHA256: hex.EncodeToString(digest[:])})
		walkFile(file, func(node *shimast.Node) {
			if node.Kind != shimast.KindCallExpression {
				return
			}
			if fact := x.call(file, node); fact != nil {
				result.Calls = append(result.Calls, *fact)
			}
		})
	}
	sort.Slice(result.Sources, func(i, j int) bool { return result.Sources[i].File < result.Sources[j].File })
	sort.Slice(result.Calls, func(i, j int) bool {
		if result.Calls[i].Span.File == result.Calls[j].Span.File {
			return result.Calls[i].Span.Start < result.Calls[j].Span.Start
		}
		return result.Calls[i].Span.File < result.Calls[j].Span.File
	})

	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(filepath.Join(root, artifactFile), encoded, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	return 0
}

func (x extractor) call(file *shimast.SourceFile, node *shimast.Node) *callFact {
	call := node.AsCallExpression()
	if call == nil {
		return nil
	}
	callSpan := x.nodeSpan(file, node)
	fact := &callFact{
		ID:        fmt.Sprintf("%s:%d:%d", callSpan.File, callSpan.Start, callSpan.End),
		Span:      callSpan,
		Callee:    nodeText(file, call.Expression),
		Target:    x.resolve(call.Expression),
		Arguments: []argumentFact{},
	}
	if call.Arguments != nil {
		for index, argument := range call.Arguments.Nodes {
			fact.Arguments = append(fact.Arguments, argumentFact{
				Index: index,
				Kind:  int(argument.Kind),
				Text:  nodeText(file, argument),
			})
		}
	}
	if isSDKBuilder(fact.Target) && call.Arguments != nil && len(call.Arguments.Nodes) != 0 {
		fact.NameValue, fact.Callback = x.options(call.Arguments.Nodes[0])
	}
	if fact.Target != nil && fact.Target.Symbol == "forward" && call.Arguments != nil && len(call.Arguments.Nodes) >= 2 {
		fact.ForwardedTarget = x.resolve(stripParens(call.Arguments.Nodes[0]))
		fact.ForwardedValue, _ = x.options(call.Arguments.Nodes[1])
	}
	return fact
}

func (x extractor) options(node *shimast.Node) (*valueResult, *callbackFact) {
	node = stripParens(node)
	if node == nil || node.Kind != shimast.KindObjectLiteralExpression {
		return &valueResult{State: "unknown", Reason: "options-not-object-literal"}, nil
	}
	object := node.AsObjectLiteralExpression()
	if object == nil || object.Properties == nil {
		return &valueResult{State: "unknown", Reason: "options-properties-unavailable"}, nil
	}
	var value *valueResult
	var callback *callbackFact
	for _, property := range object.Properties.Nodes {
		if property == nil || property.Kind != shimast.KindPropertyAssignment {
			continue
		}
		assignment := property.AsPropertyAssignment()
		if assignment == nil {
			continue
		}
		switch propertyName(assignment.Name()) {
		case "name":
			value = classifyValue(assignment.Initializer)
		case "run":
			callback = x.callback(assignment.Initializer)
		}
	}
	if value == nil {
		value = &valueResult{State: "unknown", Reason: "name-property-absent"}
	}
	return value, callback
}

func (x extractor) callback(node *shimast.Node) *callbackFact {
	node = stripParens(node)
	if node == nil {
		return nil
	}
	result := &callbackFact{}
	switch node.Kind {
	case shimast.KindIdentifier:
		result.Form = "reference"
		result.Target = x.resolve(node)
	case shimast.KindCallExpression:
		result.Form = "returned"
		call := node.AsCallExpression()
		if call != nil {
			result.Target = x.resolve(call.Expression)
		}
	case shimast.KindArrowFunction, shimast.KindFunctionExpression:
		result.Form = "inline"
		if file := shimast.GetSourceFileOfNode(node); file != nil {
			if body := node.Body(); body != nil {
				bodySpan := x.nodeSpan(file, body)
				result.Body = &bodySpan
			}
		}
		return result
	default:
		result.Form = "unsupported"
		return result
	}
	if result.Target != nil {
		if declaration := x.resolveDeclaration(node, result.Form == "returned"); declaration != nil {
			if body := findFunctionBody(declaration); body != nil {
				if file := shimast.GetSourceFileOfNode(body); file != nil {
					bodySpan := x.nodeSpan(file, body)
					result.Body = &bodySpan
				}
			}
			if result.Form == "returned" {
				if returned := returnedExpression(declaration); returned != nil {
					result.ResolvedTarget = x.resolve(returned)
					if resolvedDeclaration := x.resolveDeclaration(returned, false); resolvedDeclaration != nil {
						if resolvedBody := findFunctionBody(resolvedDeclaration); resolvedBody != nil {
							if file := shimast.GetSourceFileOfNode(resolvedBody); file != nil {
								bodySpan := x.nodeSpan(file, resolvedBody)
								result.ResolvedBody = &bodySpan
							}
						}
					}
				}
			}
		}
	}
	return result
}

func (x extractor) resolveDeclaration(node *shimast.Node, callExpression bool) *shimast.Node {
	reference := node
	if callExpression {
		if call := node.AsCallExpression(); call != nil {
			reference = call.Expression
		}
	}
	symbol := x.checker.GetSymbolAtLocation(reference)
	symbol = unalias(x.checker, symbol)
	return declarationNode(symbol)
}

func (x extractor) resolve(node *shimast.Node) *target {
	if node == nil {
		return nil
	}
	symbol := unalias(x.checker, x.checker.GetSymbolAtLocation(node))
	declaration := declarationNode(symbol)
	if symbol == nil || declaration == nil {
		return nil
	}
	file := shimast.GetSourceFileOfNode(declaration)
	if file == nil {
		return nil
	}
	_, owned := x.ownedPath(file.FileName())
	origin := "external"
	if owned {
		origin = "workspace"
	}
	return &target{Symbol: symbol.Name, Origin: origin, Span: x.nodeSpan(file, declaration)}
}

func unalias(checker *shimchecker.Checker, symbol *shimast.Symbol) *shimast.Symbol {
	if symbol != nil && symbol.Flags&shimast.SymbolFlagsAlias != 0 {
		if aliased := shimchecker.Checker_getAliasedSymbol(checker, symbol); aliased != nil {
			return aliased
		}
	}
	return symbol
}

func declarationNode(symbol *shimast.Symbol) *shimast.Node {
	if symbol == nil {
		return nil
	}
	for _, declaration := range symbol.Declarations {
		if file := shimast.GetSourceFileOfNode(declaration); file != nil && !file.IsDeclarationFile && declaration.Body() != nil {
			return declaration
		}
	}
	for _, declaration := range symbol.Declarations {
		if file := shimast.GetSourceFileOfNode(declaration); file != nil && !file.IsDeclarationFile {
			return declaration
		}
	}
	if len(symbol.Declarations) != 0 {
		return symbol.Declarations[0]
	}
	return nil
}

func findFunctionBody(declaration *shimast.Node) *shimast.Node {
	if declaration == nil {
		return nil
	}
	if body := declaration.Body(); body != nil {
		return body
	}
	var found *shimast.Node
	walk(declaration, func(node *shimast.Node) {
		if found != nil || node == declaration {
			return
		}
		if node.Kind == shimast.KindArrowFunction || node.Kind == shimast.KindFunctionExpression {
			found = node.Body()
		}
	})
	return found
}

func returnedExpression(declaration *shimast.Node) *shimast.Node {
	body := findFunctionBody(declaration)
	if body == nil {
		return nil
	}
	var expression *shimast.Node
	walk(body, func(node *shimast.Node) {
		if expression != nil || node == nil || node.Kind != shimast.KindReturnStatement {
			return
		}
		if statement := node.AsReturnStatement(); statement != nil {
			expression = stripParens(statement.Expression)
		}
	})
	return expression
}

func classifyValue(node *shimast.Node) *valueResult {
	node = stripParens(node)
	if node == nil {
		return &valueResult{State: "unknown", Reason: "value-absent"}
	}
	switch node.Kind {
	case shimast.KindStringLiteral, shimast.KindNoSubstitutionTemplateLiteral:
		return &valueResult{State: "known", Values: []string{node.Text()}}
	case shimast.KindConditionalExpression:
		conditional := node.AsConditionalExpression()
		if conditional == nil {
			return &valueResult{State: "unknown", Reason: "conditional-shape-unavailable"}
		}
		left := classifyValue(conditional.WhenTrue)
		right := classifyValue(conditional.WhenFalse)
		if left.State != "known" || right.State != "known" {
			return &valueResult{State: "unknown", Reason: "conditional-branch-not-known"}
		}
		values := append(append([]string{}, left.Values...), right.Values...)
		sort.Strings(values)
		values = compact(values)
		if len(values) == 1 {
			return &valueResult{State: "known", Values: values}
		}
		return &valueResult{State: "ambiguous", Values: values}
	case shimast.KindIdentifier:
		return &valueResult{State: "unknown", Reason: "runtime-symbol"}
	case shimast.KindCallExpression:
		call := node.AsCallExpression()
		callee := ""
		if call != nil {
			if file := shimast.GetSourceFileOfNode(call.Expression); file != nil {
				callee = nodeText(file, call.Expression)
			}
		}
		return &valueResult{State: "unsupported", Reason: "call-expression:" + callee}
	default:
		return &valueResult{State: "unknown", Reason: "non-constant-expression"}
	}
}

func isSDKBuilder(value *target) bool {
	return value != nil && value.Symbol == "defineMutation" && value.Span.File == "src/sdk/builder.ts"
}

func propertyName(node *shimast.Node) string {
	if node == nil {
		return ""
	}
	switch node.Kind {
	case shimast.KindIdentifier, shimast.KindStringLiteral:
		return node.Text()
	default:
		return ""
	}
}

func (x extractor) ownedPath(path string) (string, bool) {
	relative, err := filepath.Rel(x.root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	relative = filepath.ToSlash(relative)
	return relative, !strings.Contains(relative, "/node_modules/") && !strings.HasSuffix(relative, ".d.ts")
}

func (x extractor) nodeSpan(file *shimast.SourceFile, node *shimast.Node) span {
	relative, owned := x.ownedPath(file.FileName())
	if !owned {
		relative = "external:" + filepath.Base(file.FileName())
	}
	start := shimscanner.SkipTrivia(file.Text(), node.Pos())
	end := node.End()
	return span{File: relative, Start: start, End: end}
}

func nodeText(file *shimast.SourceFile, node *shimast.Node) string {
	if file == nil || node == nil {
		return ""
	}
	text := file.Text()
	start := shimscanner.SkipTrivia(text, node.Pos())
	end := node.End()
	if start < 0 || end > len(text) || start >= end {
		return ""
	}
	return strings.TrimSpace(text[start:end])
}

func stripParens(node *shimast.Node) *shimast.Node {
	for node != nil && node.Kind == shimast.KindParenthesizedExpression {
		expression := node.AsParenthesizedExpression()
		if expression == nil || expression.Expression == nil {
			return node
		}
		node = expression.Expression
	}
	return node
}

func walkFile(file *shimast.SourceFile, visit func(*shimast.Node)) {
	if file == nil || file.Statements == nil {
		return
	}
	for _, statement := range file.Statements.Nodes {
		walk(statement, visit)
	}
}

func walk(node *shimast.Node, visit func(*shimast.Node)) {
	if node == nil {
		return
	}
	visit(node)
	node.ForEachChild(func(child *shimast.Node) bool {
		walk(child, visit)
		return false
	})
}

func compact(values []string) []string {
	if len(values) < 2 {
		return values
	}
	output := values[:1]
	for _, value := range values[1:] {
		if value != output[len(output)-1] {
			output = append(output, value)
		}
	}
	return output
}
