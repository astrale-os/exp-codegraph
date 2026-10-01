package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"sort"
	"strings"
)

// This owner exposes narrow native compiler observations. It reuses the legacy
// thin AST admission algorithm, never allocates BodyIR or a generic fact store.
type governanceRuntimeAuthority struct {
	ScopedProofs   map[*ast.Node]observabledecision.EffectSummary
	FunctionOwners map[string][]*ast.Node

	Identity       *governanceRuntimeIdentity
	Files          []observabledecision.CapturedFile
	ByPath         map[string]observabledecision.CapturedFile
	Admitted       map[*ast.Node]string
	FunctionBodies map[*ast.Node]bool
	Symbols        map[*ast.Symbol]string
	NodeLookup     map[string]map[string]*ast.Node
}

func governanceNewRuntimeAuthority(identity *governanceRuntimeIdentity) *governanceRuntimeAuthority {
	out := &governanceRuntimeAuthority{Identity: identity, ScopedProofs: map[*ast.Node]observabledecision.EffectSummary{}, FunctionOwners: map[string][]*ast.Node{}, ByPath: map[string]observabledecision.CapturedFile{}, Admitted: map[*ast.Node]string{}, FunctionBodies: map[*ast.Node]bool{}, Symbols: map[*ast.Symbol]string{}, NodeLookup: map[string]map[string]*ast.Node{}}
	if !identity.Complete {
		return out
	}
	paths := []string{}
	for path := range identity.OwnedProgramFiles {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		source := identity.OwnedProgramFiles[path]
		file := observabledecision.CapturedFile{Path: path, AbsolutePath: source.FileName(), Text: source.Text(), Source: source}
		if authored := identity.Project.FilesByPath[path]; authored != nil {
			if authored.Text != source.Text() {
				identity.Complete = false
				identity.Reason = "runtime captured Program source mismatch"
				return out
			}
			file.Role = authored.Role
			file.Layer = authored.Layer
			file.Submodule = authored.Submodule
		}
		out.Files = append(out.Files, file)
		out.ByPath[path] = file
		nodes := map[string]*ast.Node{}
		walk(source.AsNode(), func(node *ast.Node) bool { nodes[governanceRuntimeNodeKey(source, node)] = node; return true })
		out.NodeLookup[path] = nodes
		admit := func(body *ast.Node) {
			thin := &thinBody{kinds: map[*ast.Node]string{}}
			thin.walk(body)
			for node, kind := range thin.kinds {
				out.Admitted[node] = kind
			}
		}
		if !source.IsDeclarationFile && source.Text() != "" {
			admit(source.AsNode())
		}
		walkFile(source, func(node *ast.Node) bool {
			if ast.IsFunctionLike(node) && node.Body() != nil {
				out.FunctionBodies[node] = true
				key := out.functionKey(node)
				out.FunctionOwners[key] = append(out.FunctionOwners[key], node)
				admit(node.Body())
			}
			return true
		})
	}
	// Governed sources outside the actual Program remain visible to discovery;
	// their compiler-dependent observations cannot be forged from parsed syntax.
	for _, file := range identity.Project.Files {
		if _, ok := out.ByPath[file.Path]; ok {
			continue
		}
		captured := observabledecision.CapturedFile{Path: file.Path, AbsolutePath: file.AbsolutePath, Role: file.Role, Layer: file.Layer, Submodule: file.Submodule, Text: file.Text, Source: file.Source}
		out.Files = append(out.Files, captured)
		out.ByPath[file.Path] = captured
	}
	return out
}
func governanceRuntimeNodeKey(source *ast.SourceFile, node *ast.Node) string {
	return fmt.Sprintf("%d:%d:%d", scanner.GetTokenPosOfNode(node, source, false), node.End(), node.Kind)
}
func (owner *governanceRuntimeAuthority) node(file observabledecision.CapturedFile, node *ast.Node) (*ast.Node, bool) {
	if !owner.Identity.Complete || node == nil {
		return nil, false
	}
	source := owner.Identity.OwnedProgramFiles[file.Path]
	if source == nil || source.Text() != file.Text || file.Source == nil || file.Source.Text() != file.Text {
		return nil, false
	}
	if ast.GetSourceFileOfNode(node) != file.Source {
		return nil, false
	}
	matched := owner.NodeLookup[file.Path][governanceRuntimeNodeKey(file.Source, node)]
	return matched, matched != nil
}
func (owner *governanceRuntimeAuthority) symbolKey(symbol *ast.Symbol) string {
	symbol = unalias(owner.Identity.TypeOwner.program.Checker, symbol)
	if symbol == nil {
		return ""
	}
	if key, ok := owner.Symbols[symbol]; ok {
		return key
	}
	rows := []string{}
	for _, declaration := range symbol.Declarations {
		source := ast.GetSourceFileOfNode(declaration)
		if source == nil {
			continue
		}
		rows = append(rows, fmt.Sprintf("%s:%s", source.FileName(), governanceRuntimeNodeKey(source, declaration)))
	}
	sort.Strings(rows)
	if len(rows) == 0 {
		return ""
	}
	key := governanceHash([]byte(strings.Join(rows, "\x00")))
	owner.Symbols[symbol] = key
	return key
}
func (owner *governanceRuntimeAuthority) functionKey(node *ast.Node) string {
	check := owner.Identity.TypeOwner.program.Checker
	if symbol := unalias(check, node.Symbol()); symbol != nil {
		return owner.symbolKey(symbol)
	}
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if symbol := unalias(check, parent.Symbol()); symbol != nil {
			return owner.symbolKey(symbol)
		}
		if ast.IsFunctionLike(parent) {
			break
		}
	}
	source := ast.GetSourceFileOfNode(node)
	if source == nil {
		return ""
	}
	return governanceHash([]byte("function:" + source.FileName() + ":" + governanceRuntimeNodeKey(source, node)))
}
func (owner *governanceRuntimeAuthority) Symbol(file observabledecision.CapturedFile, node *ast.Node) observabledecision.NativeEffectSymbol {
	matched, known := owner.node(file, node)
	if !known {
		return observabledecision.NativeEffectSymbol{}
	}
	if ast.IsFunctionLike(matched) {
		return observabledecision.NativeEffectSymbol{Known: true, Key: owner.functionKey(matched)}
	}
	check := owner.Identity.TypeOwner.program.Checker
	symbol := check.GetSymbolAtLocation(matched)
	if matched.Parent != nil && matched.Parent.Kind == ast.KindShorthandPropertyAssignment && matched.Parent.Name() == matched {
		symbol = check.GetShorthandAssignmentValueSymbol(matched.Parent)
	}
	return observabledecision.NativeEffectSymbol{Known: true, Key: owner.symbolKey(symbol)}
}
func (owner *governanceRuntimeAuthority) CandidateAdmitted(file observabledecision.CapturedFile, node *ast.Node, kind string) (bool, bool) {
	matched, known := owner.node(file, node)
	if !known {
		return false, false
	}
	admission := owner.Admitted[matched]
	switch kind {
	case "alias":
		return matched.Kind == ast.KindVariableDeclaration && admission != "", true
	case "mutation":
		return admission == "assignment", true
	case "call":
		return admission == "call", true
	case "delete":
		return matched.Kind == ast.KindDeleteExpression && admission != "", true
	}
	return false, false
}
func (owner *governanceRuntimeAuthority) Call(file observabledecision.CapturedFile, node *ast.Node) observabledecision.NativeEffectCall {
	matched, known := owner.node(file, node)
	if !known || matched.Kind != ast.KindCallExpression {
		return observabledecision.NativeEffectCall{}
	}
	check := owner.Identity.TypeOwner.program.Checker
	call := matched.AsCallExpression()
	x := &extractor{checker: check}
	symbol := x.canonicalCallSymbol(call.Expression, func(*ast.Symbol) {})
	declaration := declarationNode(symbol)
	function := functionInitializer(declaration)
	if declaration != nil && ast.IsFunctionLike(declaration) {
		function = declaration
	}
	callback := call.Expression
	for callback.Kind == ast.KindParenthesizedExpression {
		callback = callback.Expression()
	}
	if ast.IsFunctionLike(callback) {
		function = callback
	}
	target := owner.symbolKey(symbol)
	if function != nil {
		target = owner.functionKey(function)
	}
	out := observabledecision.NativeEffectCall{Known: true, BodyPresent: function != nil && owner.FunctionBodies[function], Dynamic: target == ""}
	signature := check.GetResolvedSignature(matched)
	parameters := checker.Signature_parameters(signature)
	rest := checker.Signature_hasRestParameter(signature)
	if call.Arguments != nil {
		for index, argument := range call.Arguments.Nodes {
			parameterIndex := index
			if len(parameters) != 0 && parameterIndex >= len(parameters) && rest {
				parameterIndex = len(parameters) - 1
			}
			parameter := ""
			if parameterIndex >= 0 && parameterIndex < len(parameters) {
				parameter = owner.symbolKey(parameters[parameterIndex])
			} // Arguments are returned in the supplied capture's AST identity.
			capturedArgument := argument
			if file.Source != owner.Identity.OwnedProgramFiles[file.Path] {
				if node.AsCallExpression().Arguments == nil || index >= len(node.AsCallExpression().Arguments.Nodes) {
					return observabledecision.NativeEffectCall{}
				}
				capturedArgument = node.AsCallExpression().Arguments.Nodes[index]
			}
			out.Bindings = append(out.Bindings, observabledecision.NativeEffectBinding{Argument: capturedArgument, Parameter: parameter})
		}
	}
	return out
}
func (owner *governanceRuntimeAuthority) EffectAuthority() observabledecision.NativeEffectAuthority {
	return observabledecision.NativeEffectAuthority{MembershipComplete: owner.Identity.Complete, MembershipReads: []observabledecision.SemanticRead{{Kind: "compiler-owned-effect-membership", Fingerprint: owner.Identity.Project.capture.certificate()}}, Symbol: owner.Symbol, Call: owner.Call, CandidateAdmitted: owner.CandidateAdmitted, DeleteAdmitted: func(file observabledecision.CapturedFile, node *ast.Node) (bool, bool) {
		return owner.CandidateAdmitted(file, node, "delete")
	}}
}

// The legacy reader has no blanket module/function/object purity rule. Object
// properties remain lazy; invocation demands only owned unique body/header,
// execution, recursion and CFG completeness for the selected function.
func (owner *governanceRuntimeAuthority) ScopedEffects(request observabledecision.EffectRequest) observabledecision.EffectSummary {
	file, exists := owner.ByPath[request.Path]
	if !exists {
		return observabledecision.EffectSummary{Reason: "captured scoped owner unavailable"}
	}
	node, known := owner.node(file, request.Node)
	if !known {
		return observabledecision.EffectSummary{Reason: "captured scoped AST authority unavailable"}
	}
	read := observabledecision.SemanticRead{Kind: "scoped-runtime-admission", Path: request.Path, Name: request.Operation, Fingerprint: governanceHash([]byte(file.Text + governanceRuntimeNodeKey(file.Source, node)))}
	if request.Operation == "object-initializer-effects" {
		if node.Kind != ast.KindObjectLiteralExpression {
			return observabledecision.EffectSummary{Reason: "captured object initializer shape unavailable", Reads: []observabledecision.SemanticRead{read}}
		}
		return observabledecision.EffectSummary{Pure: true, EffectKind: "none", Reads: []observabledecision.SemanticRead{read}}
	}
	if request.Operation != "invoke-function" {
		return observabledecision.EffectSummary{Reason: "captured scoped operation unavailable", Reads: []observabledecision.SemanticRead{read}}
	}
	if cached, ok := owner.ScopedProofs[node]; ok {
		return cached
	}
	out := observabledecision.EffectSummary{Reads: []observabledecision.SemanticRead{read}, ChargeKey: "invoke:" + request.Path + ":" + governanceRuntimeNodeKey(file.Source, node)}
	if !ast.IsFunctionLike(node) || node.Body() == nil || !owner.FunctionBodies[node] {
		out.Reason = "captured owned function body/header unavailable"
		return out
	}
	key := owner.functionKey(node)
	if len(owner.FunctionOwners[key]) != 1 {
		out.Reason = "captured function body ownership is not unique"
		return out
	}
	if functionExecution(node) != "sync" {
		out.Reason = "VALUE_EXECUTION_UNSUPPORTED"
		owner.ScopedProofs[node] = out
		return out
	}
	thin := &thinBody{kinds: map[*ast.Node]string{}}
	thin.walk(node.Body())
	check := owner.Identity.TypeOwner.program.Checker
	x := &extractor{checker: check}
	for _, callNode := range thin.calls {
		expression := callNode.AsCallExpression().Expression
		symbol := x.canonicalCallSymbol(expression, func(*ast.Symbol) {})
		target := owner.symbolKey(symbol)
		declaration := declarationNode(symbol)
		function := functionInitializer(declaration)
		if declaration != nil && ast.IsFunctionLike(declaration) {
			function = declaration
		}
		callback := expression
		for callback.Kind == ast.KindParenthesizedExpression {
			callback = callback.Expression()
		}
		if ast.IsFunctionLike(callback) {
			function = callback
		}
		if function != nil {
			target = owner.functionKey(function)
		}
		if target == key {
			out.Reason = "VALUE_RECURSION"
			owner.ScopedProofs[node] = out
			return out
		}
	}
	// This is one demanded legacy CFG proof, not generic whole-body IR. Private
	// anchors let the original CFG owner calculate completeness without values,
	// symbols, resolved-call rows, definition-use indexes or published body facts.
	builder := &bodyBuilder{file: file.Source, body: node.Body(), occurrence: map[*ast.Node]string{}, occurrenceIndex: map[string]int{}}
	walk(node.Body(), func(child *ast.Node) bool {
		builder.occurrence[child] = governanceRuntimeNodeKey(file.Source, child)
		return true
	})
	flow := buildControlFlow(builder)
	if flow.completion.Kind != "complete" {
		for _, raw := range flow.completion.Reasons {
			reason, ok := raw.(map[string]any)
			if !ok || reason["code"] != "CFG_EXPRESSION_BRANCH_PARTIAL" {
				out.Reason = "VALUE_CONTROL_FLOW_INCOMPLETE"
				owner.ScopedProofs[node] = out
				return out
			}
		}
	}
	out.Pure = true
	out.EffectKind = "none"
	owner.ScopedProofs[node] = out
	return out
}
func (owner *governanceRuntimeAuthority) DemandContext(limits observabledecision.Limits) observabledecision.DemandContext {
	core := observabledecision.NewNativeEffectCore(owner.Files, owner.EffectAuthority())
	return observabledecision.DemandContext{Files: owner.Files, Resolve: owner.Resolve, Effect: core.DemandEffects(owner.ScopedEffects), Limits: limits}
}
