package main

import (
	"sort"

	shimast "github.com/microsoft/typescript-go/shim/ast"
)

type flowExit struct {
	block    string
	kind     string
	evidence string
}

type flowFragment struct {
	entry  string
	exits  []flowExit
	breaks []flowExit
}

type flowContext struct {
	continueTarget string
}

type controlFlowResult struct {
	blocks     []controlFlowBlock
	edges      []controlFlowEdge
	completion completeness
}

type controlFlowBuilder struct {
	body        *bodyBuilder
	blocks      map[string]controlFlowBlock
	blockOrder  []string
	edges       []controlFlowEdge
	edgeSeen    map[string]bool
	nodeBlocks  map[*shimast.Node]string
	limitations map[string]any
}

func buildControlFlow(body *bodyBuilder) controlFlowResult {
	builder := &controlFlowBuilder{
		body: body, blocks: map[string]controlFlowBlock{}, edgeSeen: map[string]bool{},
		nodeBlocks:  map[*shimast.Node]string{},
		limitations: map[string]any{},
	}
	builder.addBlock(controlFlowBlock{ID: "entry", Occurrences: []string{}})
	fragment := builder.statement(body.body, flowContext{})
	builder.addBlock(controlFlowBlock{ID: "exit", Occurrences: []string{}})
	if fragment.entry == "" {
		builder.addEdge("entry", "exit", "fallthrough", "")
	} else {
		builder.addEdge("entry", fragment.entry, "fallthrough", "")
		for _, exit := range fragment.exits {
			builder.addEdge(exit.block, "exit", exit.kind, exit.evidence)
		}
		for _, unresolved := range fragment.breaks {
			builder.addEdge(unresolved.block, "exit", "fallthrough", unresolved.evidence)
			builder.limitations["unresolvedBreak"] = true
		}
	}
	builder.findExpressionLimitations(body.body)
	builder.assignOccurrences()
	blocks := make([]controlFlowBlock, 0, len(builder.blockOrder))
	for _, id := range builder.blockOrder {
		blocks = append(blocks, builder.blocks[id])
	}
	completion := complete()
	if len(builder.limitations) != 0 {
		codes := make([]string, 0, len(builder.limitations))
		for code := range builder.limitations {
			codes = append(codes, code)
		}
		sort.Strings(codes)
		reasons := make([]any, 0, len(codes))
		for _, code := range codes {
			reasons = append(reasons, map[string]any{
				"code":      code,
				"message":   cfgLimitMessage(code),
				"effective": map[string]any{"conservative": true},
			})
		}
		completion = completeness{Kind: "partial", Reasons: reasons}
	}
	return controlFlowResult{blocks: blocks, edges: builder.edges, completion: completion}
}

func (b *controlFlowBuilder) statement(node *shimast.Node, context flowContext) flowFragment {
	if node == nil {
		return flowFragment{}
	}
	switch node.Kind {
	case shimast.KindBlock:
		block := node.AsBlock()
		if block.Statements == nil {
			return flowFragment{}
		}
		return b.sequence(block.Statements.Nodes, context)
	case shimast.KindReturnStatement:
		id := b.block(node)
		b.addEdge(id, "exit", "return", b.body.occurrence[node])
		return flowFragment{entry: id, exits: []flowExit{}, breaks: []flowExit{}}
	case shimast.KindThrowStatement:
		id := b.block(node)
		b.addEdge(id, "exit", "exception", b.body.occurrence[node])
		return flowFragment{entry: id, exits: []flowExit{}, breaks: []flowExit{}}
	case shimast.KindIfStatement:
		return b.ifStatement(node, context)
	case shimast.KindWhileStatement, shimast.KindForStatement,
		shimast.KindForInStatement, shimast.KindForOfStatement:
		return b.preTestLoop(node, context)
	case shimast.KindDoStatement:
		return b.doLoop(node, context)
	case shimast.KindBreakStatement:
		id := b.block(node)
		return flowFragment{
			entry: id, exits: []flowExit{},
			breaks: []flowExit{{block: id, kind: "fallthrough", evidence: b.body.occurrence[node]}},
		}
	case shimast.KindContinueStatement:
		id := b.block(node)
		if context.continueTarget == "" {
			b.limitations["CFG_UNRESOLVED_CONTINUE"] = true
			return flowFragment{entry: id, exits: []flowExit{{block: id, kind: "fallthrough"}}}
		}
		b.addEdge(id, context.continueTarget, "loop", b.body.occurrence[node])
		return flowFragment{entry: id, exits: []flowExit{}, breaks: []flowExit{}}
	case shimast.KindLabeledStatement:
		b.limitations["CFG_LABEL_PARTIAL"] = true
		return b.statement(node.AsLabeledStatement().Statement, context)
	case shimast.KindSwitchStatement:
		b.limitations["CFG_SWITCH_PARTIAL"] = true
	case shimast.KindTryStatement:
		b.limitations["CFG_TRY_PARTIAL"] = true
	case shimast.KindWithStatement:
		b.limitations["CFG_WITH_UNSUPPORTED"] = true
	}
	id := b.block(node)
	return flowFragment{
		entry:  id,
		exits:  []flowExit{{block: id, kind: "fallthrough", evidence: b.body.occurrence[node]}},
		breaks: []flowExit{},
	}
}

func (b *controlFlowBuilder) sequence(nodes []*shimast.Node, context flowContext) flowFragment {
	result := flowFragment{exits: []flowExit{}, breaks: []flowExit{}}
	reachable := true
	for _, node := range nodes {
		fragment := b.statement(node, context)
		result.breaks = append(result.breaks, fragment.breaks...)
		if fragment.entry == "" {
			continue
		}
		if result.entry == "" {
			result.entry = fragment.entry
			result.exits = fragment.exits
			reachable = len(fragment.exits) != 0
			continue
		}
		if !reachable {
			continue
		}
		for _, exit := range result.exits {
			b.addEdge(exit.block, fragment.entry, exit.kind, exit.evidence)
		}
		result.exits = fragment.exits
		reachable = len(fragment.exits) != 0
	}
	return result
}

func (b *controlFlowBuilder) ifStatement(node *shimast.Node, context flowContext) flowFragment {
	statement := node.AsIfStatement()
	condition := b.block(node)
	thenFlow := b.statement(statement.ThenStatement, context)
	elseFlow := b.statement(statement.ElseStatement, context)
	exits := []flowExit{}
	breaks := append([]flowExit{}, thenFlow.breaks...)
	breaks = append(breaks, elseFlow.breaks...)
	evidence := b.body.occurrence[node]
	if thenFlow.entry == "" {
		exits = append(exits, flowExit{block: condition, kind: "true", evidence: evidence})
	} else {
		b.addEdge(condition, thenFlow.entry, "true", evidence)
		exits = append(exits, thenFlow.exits...)
	}
	if elseFlow.entry == "" {
		exits = append(exits, flowExit{block: condition, kind: "false", evidence: evidence})
	} else {
		b.addEdge(condition, elseFlow.entry, "false", evidence)
		exits = append(exits, elseFlow.exits...)
	}
	return flowFragment{entry: condition, exits: exits, breaks: breaks}
}

func (b *controlFlowBuilder) preTestLoop(node *shimast.Node, context flowContext) flowFragment {
	condition := b.block(node)
	var statement *shimast.Node
	switch node.Kind {
	case shimast.KindWhileStatement:
		statement = node.AsWhileStatement().Statement
	case shimast.KindForStatement:
		statement = node.AsForStatement().Statement
	case shimast.KindForInStatement, shimast.KindForOfStatement:
		statement = node.AsForInOrOfStatement().Statement
	}
	body := b.statement(statement, flowContext{continueTarget: condition})
	evidence := b.body.occurrence[node]
	if body.entry == "" {
		b.addEdge(condition, condition, "loop", evidence)
	} else {
		b.addEdge(condition, body.entry, "true", evidence)
		for _, exit := range body.exits {
			b.addEdge(exit.block, condition, "loop", exit.evidence)
		}
	}
	exits := []flowExit{{block: condition, kind: "false", evidence: evidence}}
	exits = append(exits, body.breaks...)
	_ = context
	return flowFragment{entry: condition, exits: exits, breaks: []flowExit{}}
}

func (b *controlFlowBuilder) doLoop(node *shimast.Node, context flowContext) flowFragment {
	condition := b.block(node)
	statement := node.AsDoStatement().Statement
	body := b.statement(statement, flowContext{continueTarget: condition})
	evidence := b.body.occurrence[node]
	entry := condition
	if body.entry != "" {
		entry = body.entry
		for _, exit := range body.exits {
			b.addEdge(exit.block, condition, "fallthrough", exit.evidence)
		}
		b.addEdge(condition, body.entry, "loop", evidence)
	} else {
		b.addEdge(condition, condition, "loop", evidence)
	}
	exits := []flowExit{{block: condition, kind: "false", evidence: evidence}}
	exits = append(exits, body.breaks...)
	_ = context
	return flowFragment{entry: entry, exits: exits, breaks: []flowExit{}}
}

func (b *controlFlowBuilder) block(node *shimast.Node) string {
	occurrence := b.body.occurrence[node]
	if occurrence == "" {
		occurrence = b.body.addOccurrence(node, "statement")
	}
	id := "block:" + occurrence
	b.addBlock(controlFlowBlock{ID: id, Occurrences: []string{occurrence}})
	b.nodeBlocks[node] = id
	return id
}

func (b *controlFlowBuilder) assignOccurrences() {
	assigned := map[string][]bodyOccurrence{}
	for node, occurrence := range b.body.occurrence {
		block := ""
		for candidate := node; candidate != nil; candidate = candidate.Parent {
			if id := b.nodeBlocks[candidate]; id != "" {
				block = id
				break
			}
			if candidate == b.body.body {
				break
			}
		}
		if block == "" {
			block = "entry"
		}
		for _, value := range b.body.occurrences {
			if value.ID == occurrence {
				assigned[block] = append(assigned[block], value)
				break
			}
		}
	}
	for id, block := range b.blocks {
		values := assigned[id]
		sort.Slice(values, func(i, j int) bool {
			if values[i].Span.Start == values[j].Span.Start {
				return values[i].ID < values[j].ID
			}
			return values[i].Span.Start < values[j].Span.Start
		})
		occurrences := make([]string, 0, len(values))
		for _, value := range values {
			occurrences = append(occurrences, value.ID)
		}
		block.Occurrences = occurrences
		b.blocks[id] = block
	}
}

func (b *controlFlowBuilder) addBlock(block controlFlowBlock) {
	if _, exists := b.blocks[block.ID]; exists {
		return
	}
	b.blocks[block.ID] = block
	b.blockOrder = append(b.blockOrder, block.ID)
}

func (b *controlFlowBuilder) addEdge(from, to, kind, evidence string) {
	key := from + "\x00" + to + "\x00" + kind + "\x00" + evidence
	if b.edgeSeen[key] {
		return
	}
	b.edgeSeen[key] = true
	b.edges = append(b.edges, controlFlowEdge{From: from, To: to, Kind: kind, Evidence: evidence})
}

func (b *controlFlowBuilder) findExpressionLimitations(node *shimast.Node) {
	if node == nil {
		return
	}
	if shimast.IsFunctionLike(node) {
		return
	}
	if node.Kind == shimast.KindConditionalExpression {
		b.limitations["CFG_EXPRESSION_BRANCH_PARTIAL"] = true
	}
	node.ForEachChild(func(child *shimast.Node) bool {
		b.findExpressionLimitations(child)
		return false
	})
}

func cfgLimitMessage(code string) string {
	switch code {
	case "CFG_EXPRESSION_BRANCH_PARTIAL":
		return "Conditional and short-circuit expression branches remain occurrence relations but are not separate control-flow blocks."
	case "CFG_SWITCH_PARTIAL":
		return "Switch clause and fallthrough topology is conservatively represented as one statement block."
	case "CFG_TRY_PARTIAL":
		return "Try, catch, and finally topology is conservatively represented as one statement block."
	case "CFG_LABEL_PARTIAL":
		return "Labeled break and continue targets are not yet distinguished."
	case "CFG_WITH_UNSUPPORTED":
		return "With-statement dynamic scope is unsupported."
	case "CFG_UNRESOLVED_CONTINUE":
		return "A continue statement had no statically owned loop target."
	case "unresolvedBreak":
		return "A break statement escaped without a statically owned loop target."
	default:
		return "Control flow is conservatively incomplete for this construct."
	}
}
