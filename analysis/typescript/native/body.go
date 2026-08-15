package main

import (
	"regexp"
	"sort"
	"strconv"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
)

var signatureImportPattern = regexp.MustCompile(`import\("([^"]+)"\)`)

type bodyBuilder struct {
	x           *extractor
	file        *shimast.SourceFile
	owner       string
	body        *shimast.Node
	occurrences []bodyOccurrence
	occurrence  map[*shimast.Node]string
	relations   []bodyRelation
	definitions []definitionUse
	defs        map[string][]string
	uses        map[string][]string
	calls       []resolvedCall
	values      map[string]any
	returns     []string
	throws      []string
	captures    map[string]bool
	escapes     []string
	recursion   bool
}

func (x *extractor) bodyShards(file *shimast.SourceFile, record sourceRecord) ([]factShard, error) {
	var shards []factShard
	walkFile(file, func(node *shimast.Node) bool {
		if !shimast.IsFunctionLike(node) || node.Body() == nil {
			return true
		}
		owner := x.functionID(node)
		if owner == "" {
			return true
		}
		builder := &bodyBuilder{
			x: x, file: file, owner: owner, body: node.Body(),
			occurrences: []bodyOccurrence{}, relations: []bodyRelation{},
			occurrence: map[*shimast.Node]string{}, definitions: []definitionUse{},
			defs: map[string][]string{}, uses: map[string][]string{}, calls: []resolvedCall{},
			values: map[string]any{}, captures: map[string]bool{},
			returns: []string{}, throws: []string{}, escapes: []string{},
		}
		payload := builder.build(node)
		completion := payload.Completeness
		span := x.span(file, node)
		entry := x.newFact(bodyNamespace, "function-body", owner, payload, []sourceSpan{span}, completion)
		shard := finishShard(bodyNamespace, owner, completion, []fact{entry})
		if x.payloadCodecs[typescriptBodyPayloadCodec] {
			packed, err := packBodyPayload(payload, span)
			if err != nil {
				// The walker cannot return an error directly; retain it for the
				// enclosing source projection to report after traversal.
				x.bodyPackingError = err
				return false
			}
			shard.Facts[0].Payload = nil
			shard.Facts[0].PhysicalPayload = &packed
		}
		shards = append(shards, shard)
		// A nested function owns its body and will be visited by the outer file
		// walk independently. Continuing here discovers it without attributing
		// its occurrences to the outer function.
		return true
	})
	if x.bodyPackingError != nil {
		return nil, x.bodyPackingError
	}
	sort.Slice(shards, func(i, j int) bool { return shards[i].Key < shards[j].Key })
	return shards, nil
}

func (x *extractor) functionID(node *shimast.Node) string {
	if symbol := unalias(x.checker, node.Symbol()); symbol != nil {
		return x.symbolID(symbol)
	}
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if symbol := unalias(x.checker, parent.Symbol()); symbol != nil {
			return x.symbolID(symbol)
		}
		if shimast.IsFunctionLike(parent) {
			break
		}
	}
	file := shimast.GetSourceFileOfNode(node)
	if file == nil {
		return ""
	}
	span := x.span(file, node)
	return deriveID("symbol", "typescript:"+x.universe, map[string]any{
		"source": span.Source, "revision": span.Revision,
		"start": span.Start, "end": span.End, "syntax": node.KindString(),
	})
}

func (b *bodyBuilder) build(function *shimast.Node) bodyFactPayload {
	parameters := []string{}
	for _, parameter := range function.Parameters() {
		parameterNode := parameter.AsNode()
		id := b.x.resolveSymbol(parameterNode.Name())
		if id == "" {
			id = b.x.resolveSymbol(parameterNode)
		}
		if id != "" {
			parameters = append(parameters, id)
			occurrence := b.addOccurrence(parameterNode, "definition")
			b.setOccurrenceSymbol(occurrence, id)
			b.defs[id] = append(b.defs[id], occurrence)
		}
	}

	b.walkOwned(b.body)
	// An expression-bodied arrow semantically returns its root expression. A
	// nested function literal is opaque to the outer body: retain one value
	// occurrence for the literal, never its independently owned occurrences.
	if function.Kind == shimast.KindArrowFunction && b.body.Kind != shimast.KindBlock {
		returned := b.occurrence[b.body]
		if returned == "" {
			returned = b.addOccurrence(b.body, "expression")
			b.values[returned] = b.value(b.body)
		}
		b.returns = append(b.returns, returned)
	}
	controlFlow := buildControlFlow(b)
	b.buildRelations(b.body)
	b.finishDefinitionUses()
	sort.Slice(b.occurrences, func(i, j int) bool {
		if b.occurrences[i].Span.Start == b.occurrences[j].Span.Start {
			return b.occurrences[i].ID < b.occurrences[j].ID
		}
		return b.occurrences[i].Span.Start < b.occurrences[j].Span.Start
	})
	captures := make([]string, 0, len(b.captures))
	for id := range b.captures {
		captures = append(captures, id)
	}
	sort.Strings(captures)
	sort.Slice(b.definitions, func(i, j int) bool {
		if b.definitions[i].Use == b.definitions[j].Use {
			return b.definitions[i].Definition < b.definitions[j].Definition
		}
		return b.definitions[i].Use < b.definitions[j].Use
	})
	sort.Slice(b.calls, func(i, j int) bool { return b.calls[i].Occurrence < b.calls[j].Occurrence })
	sort.Slice(b.relations, func(i, j int) bool {
		left := b.relations[i].Parent + "\x00" + b.relations[i].Role + "\x00" + b.relations[i].Child
		right := b.relations[j].Parent + "\x00" + b.relations[j].Role + "\x00" + b.relations[j].Child
		return left < right
	})

	ir := functionBodyIR{
		Function: b.owner, Parameters: uniqueInOrder(parameters), Occurrences: b.occurrences,
		Relations: b.relations, Blocks: controlFlow.blocks,
		Edges: controlFlow.edges, Definitions: b.definitions, Calls: b.calls,
		Summary: functionSummary{
			Function: b.owner, Returns: b.returns, Throws: b.throws, Captures: captures,
			Calls: callOccurrences(b.calls), Escapes: b.escapes, Recursion: b.recursion,
		},
	}
	return bodyFactPayload{
		Body: ir, Values: b.values, Completeness: controlFlow.completion,
	}
}

func (b *bodyBuilder) buildRelations(node *shimast.Node) {
	if node == nil {
		return
	}
	if shimast.IsFunctionLike(node) {
		return
	}
	parent := b.occurrence[node]
	index := 0
	node.ForEachChild(func(child *shimast.Node) bool {
		if parent != "" {
			if childID := b.occurrence[child]; childID != "" {
				b.relations = append(b.relations, bodyRelation{
					Parent: parent, Child: childID, Role: childRole(node, child, index),
				})
			}
		}
		index++
		b.buildRelations(child)
		return false
	})
}

func (b *bodyBuilder) walkOwned(node *shimast.Node) {
	if node == nil {
		return
	}
	if shimast.IsFunctionLike(node) {
		return
	}
	kind := bodyKind(node)
	if kind != "" {
		id := b.addOccurrence(node, kind)
		if valueCandidate(node) {
			b.values[id] = b.value(node)
		}
		switch kind {
		case "return":
			b.returns = append(b.returns, id)
		case "throw":
			b.throws = append(b.throws, id)
		case "call":
			b.calls = append(b.calls, b.call(node, id))
		}
	}
	if node.Kind == shimast.KindIdentifier {
		b.identifier(node)
	}
	node.ForEachChild(func(child *shimast.Node) bool {
		b.walkOwned(child)
		return false
	})
}

func (b *bodyBuilder) addOccurrence(node *shimast.Node, kind string) string {
	if id := b.occurrence[node]; id != "" {
		return id
	}
	span := b.x.span(b.file, node)
	id := b.x.occurrenceID(span, "body-"+kind)
	b.occurrence[node] = id
	b.occurrences = append(b.occurrences, bodyOccurrence{
		ID: id, Kind: kind, Span: span, Owner: b.owner, Syntax: strings.TrimPrefix(node.KindString(), "Kind"),
	})
	return id
}

func (b *bodyBuilder) identifier(node *shimast.Node) {
	symbol := unalias(b.x.checker, b.x.checker.GetSymbolAtLocation(node))
	if symbol == nil {
		return
	}
	symbolID := b.x.symbolID(symbol)
	if symbolID == "" {
		return
	}
	declaration := isDeclarationName(node, symbol) || isAssignmentTarget(node)
	kind := "use"
	if declaration {
		kind = "definition"
	}
	id := b.addOccurrence(node, kind)
	b.setOccurrenceSymbol(id, symbolID)
	if declaration {
		b.defs[symbolID] = append(b.defs[symbolID], id)
		return
	}
	b.uses[symbolID] = append(b.uses[symbolID], id)
}

func (b *bodyBuilder) finishDefinitionUses() {
	for symbol, uses := range b.uses {
		definitions := b.defs[symbol]
		if len(definitions) == 0 {
			b.captures[symbol] = true
			continue
		}
		for _, use := range uses {
			for _, definition := range definitions {
				b.definitions = append(b.definitions, definitionUse{
					Definition: definition, Use: use, Symbol: symbol, Reaching: "possible",
				})
			}
		}
	}
}

func (b *bodyBuilder) setOccurrenceSymbol(id, symbol string) {
	for index := range b.occurrences {
		if b.occurrences[index].ID == id {
			b.occurrences[index].Symbol = symbol
			return
		}
	}
}

func (b *bodyBuilder) call(node *shimast.Node, occurrence string) resolvedCall {
	call := node.AsCallExpression()
	result := resolvedCall{
		Occurrence: occurrence, TypeArguments: []string{}, Arguments: []string{},
		Bindings: []parameterBinding{}, Callbacks: []string{}, Dynamic: true,
	}
	if call == nil {
		return result
	}
	result.Target = b.x.resolveSymbol(call.Expression)
	result.Dynamic = result.Target == ""
	if result.Target == b.owner {
		b.recursion = true
	}
	if call.Expression.Kind == shimast.KindPropertyAccessExpression {
		property := call.Expression.AsPropertyAccessExpression()
		result.Receiver = b.addOccurrence(property.Expression, "expression")
	}
	if call.TypeArguments != nil {
		for _, argument := range call.TypeArguments.Nodes {
			result.TypeArguments = append(result.TypeArguments, nodeText(b.file, argument))
		}
	}
	signature := b.x.checker.GetResolvedSignature(node)
	if signature != nil {
		result.Signature = portableSignature(
			b.x.checker.SignatureToStringEx(signature, node, 0, nil),
		)
	}
	parameters := shimchecker.Signature_parameters(signature)
	rest := shimchecker.Signature_hasRestParameter(signature)
	if call.Arguments != nil {
		for index, argument := range call.Arguments.Nodes {
			argumentID := b.addOccurrence(argument, "expression")
			result.Arguments = append(result.Arguments, argumentID)
			parameterIndex := index
			if len(parameters) != 0 && parameterIndex >= len(parameters) && rest {
				parameterIndex = len(parameters) - 1
			}
			binding := parameterBinding{Argument: argumentID, Index: index, Rest: rest && parameterIndex == len(parameters)-1}
			if parameterIndex >= 0 && parameterIndex < len(parameters) {
				binding.Parameter = b.x.symbolID(parameters[parameterIndex])
			}
			result.Bindings = append(result.Bindings, binding)
			if callback := b.callbackTarget(argument); callback != "" {
				result.Callbacks = append(result.Callbacks, callback)
			}
			b.values[argumentID] = b.value(argument)
		}
	}
	result.Callbacks = sortedUnique(result.Callbacks)
	return result
}

// portableSignature removes package-manager and checkout coordinates that the
// checker may spell inside import types. Those paths describe the same public
// package type but otherwise make body facts depend on whether node_modules is
// physical, symlinked, or relocated with the repository.
func portableSignature(display string) string {
	return signatureImportPattern.ReplaceAllStringFunc(display, func(input string) string {
		matches := signatureImportPattern.FindStringSubmatch(input)
		if len(matches) != 2 {
			return input
		}
		if specifier, ok := installedPackageSpecifier(matches[1]); ok {
			return `import("` + specifier + `")`
		}
		return input
	})
}

func installedPackageSpecifier(input string) (string, bool) {
	value := strings.ReplaceAll(input, `\`, "/")
	marker := "node_modules/"
	index := strings.LastIndex(value, "/"+marker)
	if index >= 0 {
		value = value[index+len(marker)+1:]
	} else if index = strings.LastIndex(value, marker); index >= 0 {
		value = value[index+len(marker):]
	} else {
		return "", false
	}
	parts := strings.Split(value, "/")
	packageParts := 1
	if len(parts) != 0 && strings.HasPrefix(parts[0], "@") {
		packageParts = 2
	}
	if len(parts) < packageParts || strings.Join(parts[:packageParts], "/") == "" {
		return "", false
	}
	remainder := parts[packageParts:]
	if len(remainder) != 0 {
		last := remainder[len(remainder)-1]
		if last == "index.js" || last == "index.ts" || last == "index.d.ts" {
			remainder = remainder[:len(remainder)-1]
		}
	}
	return strings.Join(append(parts[:packageParts], remainder...), "/"), true
}

func (b *bodyBuilder) callbackTarget(node *shimast.Node) string {
	for node != nil && node.Kind == shimast.KindParenthesizedExpression {
		node = node.AsParenthesizedExpression().Expression
	}
	if node == nil {
		return ""
	}
	if shimast.IsFunctionLike(node) {
		return b.x.functionID(node)
	}
	symbol := unalias(b.x.checker, b.x.checker.GetSymbolAtLocation(node))
	declaration := declarationNode(symbol)
	if declaration == nil {
		return ""
	}
	if shimast.IsFunctionLike(declaration) || findFunctionBody(declaration) != nil {
		return b.x.symbolID(symbol)
	}
	return ""
}

func (b *bodyBuilder) value(node *shimast.Node) any {
	for node != nil && node.Kind == shimast.KindParenthesizedExpression {
		node = node.AsParenthesizedExpression().Expression
	}
	if node == nil {
		return unknownValue("VALUE_ABSENT", "The argument has no expression.")
	}
	if shimast.IsFunctionLike(node) {
		return map[string]any{
			"kind": "unsupported", "construct": node.KindString(), "evidence": []string{},
		}
	}
	switch node.Kind {
	case shimast.KindStringLiteral, shimast.KindNoSubstitutionTemplateLiteral:
		return map[string]any{"kind": "known", "value": node.Text(), "evidence": []string{}}
	case shimast.KindNumericLiteral:
		value, err := strconv.ParseFloat(node.Text(), 64)
		if err == nil {
			return map[string]any{"kind": "known", "value": value, "evidence": []string{}}
		}
	case shimast.KindTrueKeyword:
		return map[string]any{"kind": "known", "value": true, "evidence": []string{}}
	case shimast.KindFalseKeyword:
		return map[string]any{"kind": "known", "value": false, "evidence": []string{}}
	case shimast.KindConditionalExpression:
		conditional := node.AsConditionalExpression()
		left, leftOK := knownValue(b.value(conditional.WhenTrue))
		right, rightOK := knownValue(b.value(conditional.WhenFalse))
		if leftOK && rightOK {
			if stableJSON(left) == stableJSON(right) {
				return map[string]any{"kind": "known", "value": left, "evidence": []string{}}
			}
			return map[string]any{
				"kind": "ambiguous", "values": []any{left, right}, "evidence": []string{},
				"reasons": []any{map[string]any{
					"code": "CONDITIONAL_BRANCH", "message": "Both conditional values are statically possible.",
					"effective": map[string]any{"branches": 2},
				}},
			}
		}
	case shimast.KindCallExpression, shimast.KindNewExpression, shimast.KindTaggedTemplateExpression:
		return map[string]any{"kind": "unsupported", "construct": node.KindString(), "evidence": []string{}}
	}
	return unknownValue("DYNAMIC_EXPRESSION", "The bounded evaluator cannot prove one value for this expression.")
}

func unknownValue(code, message string) any {
	return map[string]any{
		"kind": "unknown", "evidence": []string{},
		"reasons": []any{map[string]any{"code": code, "message": message, "retryable": false}},
	}
}

func knownValue(value any) (any, bool) {
	record, ok := value.(map[string]any)
	if !ok || record["kind"] != "known" {
		return nil, false
	}
	return record["value"], true
}

func isDeclarationName(node *shimast.Node, symbol *shimast.Symbol) bool {
	for _, declaration := range symbol.Declarations {
		if declaration.Name() == node {
			return true
		}
	}
	return false
}

func isAssignmentTarget(node *shimast.Node) bool {
	parent := node.Parent
	if parent == nil || parent.Kind != shimast.KindBinaryExpression {
		return false
	}
	binary := parent.AsBinaryExpression()
	return binary.Left == node && binary.OperatorToken != nil &&
		binary.OperatorToken.Kind >= shimast.KindFirstAssignment &&
		binary.OperatorToken.Kind <= shimast.KindLastAssignment
}

func findFunctionBody(declaration *shimast.Node) *shimast.Node {
	if declaration == nil {
		return nil
	}
	if body := declaration.Body(); body != nil {
		return body
	}
	var found *shimast.Node
	walk(declaration, func(node *shimast.Node) bool {
		if found != nil {
			return false
		}
		if node != declaration && shimast.IsFunctionLike(node) {
			found = node.Body()
			return false
		}
		return true
	})
	return found
}

func bodyKind(node *shimast.Node) string {
	switch node.Kind {
	case shimast.KindBlock, shimast.KindEmptyStatement, shimast.KindVariableStatement,
		shimast.KindExpressionStatement, shimast.KindBreakStatement,
		shimast.KindContinueStatement, shimast.KindLabeledStatement,
		shimast.KindTryStatement, shimast.KindWithStatement,
		shimast.KindDebuggerStatement:
		return "statement"
	case shimast.KindVariableDeclaration:
		return "declaration"
	case shimast.KindPropertyAssignment, shimast.KindShorthandPropertyAssignment:
		return "assignment"
	case shimast.KindObjectLiteralExpression, shimast.KindArrayLiteralExpression,
		shimast.KindPropertyAccessExpression, shimast.KindElementAccessExpression,
		shimast.KindStringLiteral, shimast.KindNoSubstitutionTemplateLiteral,
		shimast.KindNumericLiteral, shimast.KindTrueKeyword, shimast.KindFalseKeyword:
		return "expression"
	case shimast.KindBinaryExpression:
		binary := node.AsBinaryExpression()
		if binary != nil && binary.OperatorToken != nil && binary.OperatorToken.Kind >= shimast.KindFirstAssignment && binary.OperatorToken.Kind <= shimast.KindLastAssignment {
			return "assignment"
		}
		return "expression"
	case shimast.KindCallExpression:
		return "call"
	case shimast.KindReturnStatement:
		return "return"
	case shimast.KindThrowStatement:
		return "throw"
	case shimast.KindIfStatement, shimast.KindConditionalExpression, shimast.KindSwitchStatement,
		shimast.KindForStatement, shimast.KindForInStatement, shimast.KindForOfStatement,
		shimast.KindWhileStatement, shimast.KindDoStatement:
		return "branch"
	}
	return ""
}

func valueCandidate(node *shimast.Node) bool {
	switch node.Kind {
	case shimast.KindStringLiteral, shimast.KindNoSubstitutionTemplateLiteral,
		shimast.KindNumericLiteral, shimast.KindTrueKeyword, shimast.KindFalseKeyword,
		shimast.KindConditionalExpression, shimast.KindCallExpression,
		shimast.KindNewExpression, shimast.KindTaggedTemplateExpression:
		return true
	}
	return false
}

func childRole(parent, child *shimast.Node, index int) string {
	switch parent.Kind {
	case shimast.KindCallExpression:
		call := parent.AsCallExpression()
		if call.Expression == child {
			return "callee"
		}
		if call.TypeArguments != nil {
			for position, candidate := range call.TypeArguments.Nodes {
				if candidate == child {
					return "type-argument:" + strconv.Itoa(position)
				}
			}
		}
		if call.Arguments != nil {
			for position, candidate := range call.Arguments.Nodes {
				if candidate == child {
					return "argument:" + strconv.Itoa(position)
				}
			}
		}
	case shimast.KindObjectLiteralExpression:
		object := parent.AsObjectLiteralExpression()
		if object.Properties != nil {
			for position, candidate := range object.Properties.Nodes {
				if candidate == child {
					return "property:" + strconv.Itoa(position)
				}
			}
		}
	case shimast.KindPropertyAssignment:
		property := parent.AsPropertyAssignment()
		if property.Name() == child {
			return "name"
		}
		if property.Initializer == child {
			return "initializer"
		}
	case shimast.KindVariableDeclaration:
		declaration := parent.AsVariableDeclaration()
		if declaration.Name() == child {
			return "name"
		}
		if declaration.Initializer == child {
			return "initializer"
		}
	case shimast.KindReturnStatement:
		if parent.AsReturnStatement().Expression == child {
			return "expression"
		}
	case shimast.KindThrowStatement:
		if parent.AsThrowStatement().Expression == child {
			return "expression"
		}
	case shimast.KindConditionalExpression:
		conditional := parent.AsConditionalExpression()
		if conditional.Condition == child {
			return "condition"
		}
		if conditional.WhenTrue == child {
			return "when-true"
		}
		if conditional.WhenFalse == child {
			return "when-false"
		}
	case shimast.KindBinaryExpression:
		binary := parent.AsBinaryExpression()
		if binary.Left == child {
			return "left"
		}
		if binary.Right == child {
			return "right"
		}
	case shimast.KindIfStatement:
		statement := parent.AsIfStatement()
		if statement.Expression == child {
			return "condition"
		}
		if statement.ThenStatement == child {
			return "then"
		}
		if statement.ElseStatement == child {
			return "else"
		}
	}
	return "child:" + strconv.Itoa(index)
}

func callOccurrences(calls []resolvedCall) []string {
	values := make([]string, 0, len(calls))
	for _, call := range calls {
		values = append(values, call.Occurrence)
	}
	return values
}

func uniqueInOrder(values []string) []string {
	seen := map[string]bool{}
	output := make([]string, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			output = append(output, value)
		}
	}
	return output
}
