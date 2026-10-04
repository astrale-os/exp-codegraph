package main

import (
	"path/filepath"
	"sort"
	"strings"
	"time"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
)

const bodyDemandNamespace = "typescript.body-demand"

type demandOwner struct {
	Owner        string          `json:"owner"`
	Scope        string          `json:"scope"`
	Span         sourceSpan      `json:"span"`
	Path         string          `json:"path"`
	Materialized bool            `json:"materialized"`
	Fact         string          `json:"fact,omitempty"`
	Header       *functionHeader `json:"header,omitempty"`
}

type demandEffect struct {
	Symbol     string `json:"symbol"`
	Occurrence string `json:"occurrence"`
	Owner      string `json:"owner"`
}

type demandAlias struct {
	Symbol     string `json:"symbol"`
	From       string `json:"from"`
	Occurrence string `json:"occurrence"`
	Owner      string `json:"owner"`
}

type demandCoverage struct {
	Path         string       `json:"path"`
	Completeness completeness `json:"completeness"`
}

type bodyDemandPayload struct {
	Observed     bool             `json:"observed,omitempty"`
	Paths        []string         `json:"paths"`
	Owners       []demandOwner    `json:"owners"`
	Witnesses    []bodyOccurrence `json:"witnesses"`
	Initializers []demandEffect   `json:"initializers"`
	Mutations    []demandEffect   `json:"mutations"`
	Escapes      []demandEffect   `json:"escapes"`
	Aliases      []demandAlias    `json:"aliases"`
	Coverage     []demandCoverage `json:"coverage"`
	Completeness completeness     `json:"completeness"`
}

type bodyDemandCache struct {
	extractor        *extractor
	files            []*shimast.SourceFile
	sources          []sourceRecord
	nonBodyShards    []factShard
	bodies           []*thinBody
	byOwner          map[string]*thinBody
	byFunction       map[*shimast.Node]*thinBody
	modules          map[*shimast.SourceFile]*thinBody
	snapshot         *sourceProjectionSnapshot
	fullBodies       map[string]factShard
	bodyReads        map[string][]callableRead
	bodyDependencies map[string][]string
	references       *compilerReferenceSnapshot
	reuse            *demandSourceReuse
	sparseCatalogue  bool
	ready            bool
}

type thinBody struct {
	x           *extractor
	file        *shimast.SourceFile
	owner       string
	scope       string
	body        *shimast.Node
	function    *shimast.Node
	span        sourceSpan
	path        string
	kinds       map[*shimast.Node]string
	symbols     map[*shimast.Node]*shimast.Symbol
	calls       []*shimast.Node
	identifiers []*shimast.Node
	effects     []*shimast.Node
	literals    []*shimast.Node
	retained    bool
	header      *functionHeader
}

func admitBodyDemand(value *bodyDemandRecipe) (*bodyDemandRecipe, error) {
	if value == nil {
		return nil, nil
	}
	paths := make([]string, 0, len(value.Paths))
	for _, path := range value.Paths {
		if path == "" || strings.ContainsAny(path, "\\\x00") || filepath.IsAbs(path) || path == "." || path == ".." || strings.HasPrefix(path, "../") || filepath.ToSlash(filepath.Clean(path)) != path {
			return nil, protocolError("DEMAND_PATH_INVALID", "Body demand requires canonical owned logical source paths.")
		}
		paths = append(paths, path)
	}
	var owners []string
	if value.Owners != nil {
		owners = []string{}
		for _, owner := range *value.Owners {
			if !strings.HasPrefix(owner, "symbol:") || strings.ContainsAny(owner, "\\\x00") {
				return nil, protocolError("DEMAND_OWNER_INVALID", "Body demand owner must be an admitted symbol identity.")
			}
			owners = append(owners, owner)
		}
		owners = sortedUnique(owners)
	}
	var ownerRecipe *[]string
	if value.Owners != nil {
		ownerRecipe = &owners
	}
	return &bodyDemandRecipe{Paths: sortedUnique(paths), Owners: ownerRecipe}, nil
}

func (b *thinBody) mark(node *shimast.Node, kind string) {
	if node != nil && b.kinds[node] == "" {
		b.kinds[node] = kind
	}
}

// Mirror walkOwned's admission order, without allocating body rows, values,
// control flow, definition-use indexes or canonical full-body preimages.
func (b *thinBody) walk(node *shimast.Node) {
	if node == nil || shimast.IsPartOfTypeNode(node) {
		return
	}
	switch node.Kind {
	case shimast.KindInterfaceDeclaration, shimast.KindTypeAliasDeclaration,
		shimast.KindImportDeclaration, shimast.KindExportDeclaration,
		shimast.KindClassDeclaration, shimast.KindClassExpression, shimast.KindModuleDeclaration:
		return
	}
	if shimast.IsFunctionLike(node) {
		if node.Body() != nil {
			b.mark(node, "expression")
			b.literals = append(b.literals, node)
		}
		return
	}
	kind := bodyKind(node)
	if kind != "" {
		b.mark(node, kind)
		if kind == "assignment" || node.Kind == shimast.KindVariableDeclaration {
			b.effects = append(b.effects, node)
		}
		if kind == "call" {
			b.calls = append(b.calls, node)
			call := node.AsCallExpression()
			if call.Expression.Kind == shimast.KindPropertyAccessExpression {
				b.mark(call.Expression.AsPropertyAccessExpression().Expression, "expression")
			}
			if call.Arguments != nil {
				for _, argument := range call.Arguments.Nodes {
					b.mark(argument, "expression")
				}
			}
		}
	}
	if node.Kind == shimast.KindIdentifier {
		// Identifier admission is resolved only when an effect root, witness or
		// selected body dependency actually needs it. Ordinary unrelated UI
		// expressions must not accidentally demand their complete inferred types.
		b.mark(node, "use")
		b.identifiers = append(b.identifiers, node)
	}
	// Delete has no ordinary bodyKind. Preserve exactly the baseline rows that
	// were admitted earlier as call arguments; do not invent extra mutations.
	if node.Kind == shimast.KindDeleteExpression && b.kinds[node] != "" {
		b.effects = append(b.effects, node)
	}
	node.ForEachChild(func(child *shimast.Node) bool {
		b.walk(child)
		return false
	})
}

func (b *thinBody) identifierSymbol(node *shimast.Node) *shimast.Symbol {
	b.x.beginProjection(b.file)
	if node == nil || node.Kind != shimast.KindIdentifier {
		return nil
	}
	if symbol, known := b.symbols[node]; known {
		return symbol
	}
	symbol := b.x.checker.GetSymbolAtLocation(node)
	if node.Parent != nil && node.Parent.Kind == shimast.KindShorthandPropertyAssignment && node.Parent.Name() == node {
		symbol = b.x.checker.GetShorthandAssignmentValueSymbol(node.Parent)
	}
	symbol = unalias(b.x.checker, symbol)
	if symbol != nil && b.x.symbolID(symbol) == "" {
		symbol = nil
	}
	b.symbols[node] = symbol
	if b.kinds[node] == "use" || b.kinds[node] == "definition" {
		if symbol == nil {
			b.kinds[node] = ""
		} else if isDeclarationName(node, symbol) || isAssignmentTarget(node) {
			b.kinds[node] = "definition"
		} else {
			b.kinds[node] = "use"
		}
	}
	return symbol
}

func (b *thinBody) rootSymbol(node *shimast.Node) string {
	for node != nil && b.kinds[node] != "" {
		switch node.Kind {
		case shimast.KindIdentifier:
			return b.x.symbolID(b.identifierSymbol(node))
		case shimast.KindPropertyAccessExpression:
			node = node.AsPropertyAccessExpression().Expression
		case shimast.KindElementAccessExpression:
			node = node.AsElementAccessExpression().Expression
		case shimast.KindParenthesizedExpression, shimast.KindAsExpression,
			shimast.KindSatisfiesExpression, shimast.KindNonNullExpression, shimast.KindTypeAssertionExpression:
			node = node.Expression()
		default:
			return ""
		}
	}
	return ""
}

func (b *thinBody) witness(node *shimast.Node, witnesses map[string]bodyOccurrence) string {
	if node.Kind == shimast.KindIdentifier {
		b.identifierSymbol(node)
	}
	kind := b.kinds[node]
	if kind == "" {
		return ""
	}
	span := b.x.span(b.file, node)
	id := b.x.occurrenceID(span, "body-"+kind)
	if _, exists := witnesses[id]; !exists {
		metadata := newBodyBuilder(b.x, b.file, b.owner, b.scope, b.body)
		metadata.addOccurrence(node, kind)
		if node.Kind == shimast.KindIdentifier {
			metadata.identifier(node)
		}
		if shimast.IsFunctionLike(node) {
			metadata.setOccurrenceSymbol(id, b.x.functionID(node))
		}
		witnesses[id] = metadata.occurrences[0]
	}
	return id
}

func (x *extractor) demandBodyShards(files []*shimast.SourceFile, recipe *bodyDemandRecipe, existing []factShard) ([]factShard, error) {
	if x.plan.demandCache.sparseCatalogue && (recipe == nil || recipe.Owners == nil) {
		return nil, sparseDemandFallback{"conservative-recipe-needs-full-catalogue"}
	}
	started := time.Now()
	if recipe == nil {
		// A client without a selection gets honest full coverage. Explicit empty
		// paths are distinct and deliberately request no body observations.
		recipe = &bodyDemandRecipe{Paths: []string{}}
		for _, record := range x.sources {
			recipe.Paths = append(recipe.Paths, record.Path)
		}
		recipe.Paths = sortedUnique(recipe.Paths)
	}
	existingBodies := map[string]factShard{}
	for _, shard := range existing {
		if shard.Namespace == bodyNamespace && len(shard.Facts) != 0 {
			existingBodies[shard.Facts[0].Subject] = shard
		}
	}
	cache := x.plan.demandCache
	bodies, byOwner, byFunction, modules := cache.bodies, cache.byOwner, cache.byFunction, cache.modules
	if bodies == nil {
		bodies = []*thinBody{}
		byOwner = map[string]*thinBody{}
		byFunction = map[*shimast.Node]*thinBody{}
		modules = map[*shimast.SourceFile]*thinBody{}
		register := func(file *shimast.SourceFile, owner, scope string, node, function *shimast.Node, span sourceSpan) {
			body := &thinBody{x: x, file: file, owner: owner, scope: scope, body: node, function: function,
				span: span, path: x.sources[file.FileName()].Path,
				kinds: map[*shimast.Node]string{}, symbols: map[*shimast.Node]*shimast.Symbol{}}

			body.walk(node)
			if scope == "module" && len(body.kinds) == 0 && (file.Statements == nil || len(file.Statements.Nodes) == 0) {
				return
			}
			bodies = append(bodies, body)
			byOwner[owner] = body
			if function != nil {
				byFunction[function] = body
			} else {
				modules[file] = body
			}
		}
		for _, file := range files {
			record, owned := x.sources[file.FileName()]
			if !owned {
				continue
			}
			x.beginProjection(file)
			if cache.reuse != nil && !cache.reuse.selected[file.FileName()] {
				for _, owner := range cache.reuse.sources[file.FileName()].rows.owners {
					body := &thinBody{x: x, file: file, owner: owner.Owner, scope: owner.Scope, span: owner.Span, path: owner.Path, retained: true, header: copyFunctionHeader(owner.Header)}
					bodies = append(bodies, body)
					byOwner[body.owner] = body
				}
				continue
			}
			if !file.IsDeclarationFile && len(file.Text()) != 0 {
				owner := deriveID("symbol", "typescript:"+x.universe, map[string]any{"source": record.Source, "scope": "module"})
				register(file, owner, "module", file.AsNode(), nil, x.span(file, file.AsNode()))
			}
			walkFile(file, func(node *shimast.Node) bool {
				if shimast.IsFunctionLike(node) && node.Body() != nil {
					if owner := x.functionID(node); owner != "" {
						register(file, owner, "function", node.Body(), node, x.span(file, node))
					}
				}
				return true
			})
		}
		cache.bodies, cache.byOwner, cache.byFunction, cache.modules = bodies, byOwner, byFunction, modules
	}
	sort.Slice(bodies, func(i, j int) bool { return bodies[i].owner < bodies[j].owner })
	if cache.reuse != nil {
		for index := 1; index < len(bodies); index++ {
			if bodies[index-1].owner == bodies[index].owner {
				return nil, sparseDemandFallback{"ambiguous-current-owner"}
			}
		}
	}
	selected := map[string]bool{}
	queue := []*thinBody{}
	selectBody := func(body *thinBody) {
		if body != nil && !selected[body.owner] {
			selected[body.owner] = true
			queue = append(queue, body)
		}
	}
	roots := map[string]bool{}
	for _, path := range recipe.Paths {
		roots[path] = true
	}
	for _, body := range bodies {
		if roots[body.path] || x.plan.bodies {
			selectBody(body)
		}
	}
	if recipe.Owners != nil {
		for _, owner := range *recipe.Owners {
			selectBody(byOwner[owner])
		}
	}
	declarationBody := func(node *shimast.Node) *thinBody {
		for current := node; current != nil; current = current.Parent {
			if owner := byFunction[current]; owner != nil {
				return owner
			}
			if current.Kind == shimast.KindClassDeclaration || current.Kind == shimast.KindClassExpression || current.Kind == shimast.KindModuleDeclaration {
				return nil // default module walk does not own these initializers
			}
		}
		return modules[shimast.GetSourceFileOfNode(node)]
	}
	neededSymbols := map[string]bool{}
	pendingSymbols := []string{}
	needSymbol := func(symbol string) {
		if symbol != "" && !neededSymbols[symbol] {
			neededSymbols[symbol] = true
			pendingSymbols = append(pendingSymbols, symbol)
		}
	}
	expandBodyDependencies := func() {
		for len(queue) != 0 {
			body := queue[0]
			queue = queue[1:]
			needSymbol(body.owner)
			if body.function != nil {
				for _, parameter := range body.function.Parameters() {
					node := parameter.AsNode()
					symbol := x.resolveSymbol(node.Name())
					if symbol == "" {
						symbol = x.resolveSymbol(node)
					}
					needSymbol(symbol)
				}
			}
			for _, function := range body.literals {
				selectBody(byFunction[function])
				needSymbol(x.functionID(function))
			}
			for _, identifier := range body.identifiers {
				symbol := body.identifierSymbol(identifier)
				if symbol == nil {
					continue
				}
				needSymbol(x.symbolID(symbol))
				for _, declaration := range symbol.Declarations {
					selectBody(declarationBody(declaration))
					if function := functionInitializer(declaration); function != nil {
						selectBody(byFunction[function])
					}
				}
			}
		}
	}
	if recipe.Owners == nil {
		expandBodyDependencies()
	} else {
		queue = nil
	}
	x.telemetry.record(x.requestID, "projection.demand-closure", started, map[string]any{"owners": len(bodies), "selectedOwners": len(selected), "paths": len(recipe.Paths)})

	var payload bodyDemandPayload
	witnesses := map[string]bodyOccurrence{}
	if cache.snapshot == nil {
		payload = bodyDemandPayload{Owners: []demandOwner{}, Witnesses: []bodyOccurrence{},
			Initializers: []demandEffect{}, Mutations: []demandEffect{}, Escapes: []demandEffect{}, Aliases: []demandAlias{}}
		for index, body := range bodies {
			// Getter/setter and malformed duplicate declarations can share the
			// legacy owner. Do not add positive header authority for that ambiguity.
			uniqueOwner := (index == 0 || bodies[index-1].owner != body.owner) && (index+1 == len(bodies) || bodies[index+1].owner != body.owner)
			if body.function != nil && uniqueOwner {
				x.beginProjection(body.file)
				body.header = x.functionHeader(body.owner, body.span, body.function)
			}
			payload.Owners = append(payload.Owners, demandOwner{Owner: body.owner, Scope: body.scope, Span: body.span, Path: body.path, Header: copyFunctionHeader(body.header)})
		}
		for _, body := range bodies {
			if body.retained {
				continue
			}
			x.beginProjection(body.file)
			sort.Slice(body.effects, func(i, j int) bool { return body.effects[i].Pos() < body.effects[j].Pos() })
			for _, node := range body.effects {
				if node.Kind == shimast.KindVariableDeclaration {
					declaration := node.AsVariableDeclaration()
					name, initializer := declaration.Name(), declaration.Initializer
					symbol := x.symbolID(body.identifierSymbol(name))
					if symbol != "" && initializer != nil {
						if witness := body.witness(initializer, witnesses); witness != "" {
							payload.Initializers = append(payload.Initializers, demandEffect{symbol, witness, body.owner})
							if target := body.rootSymbol(initializer); target != "" && target != symbol {
								payload.Aliases = append(payload.Aliases, demandAlias{target, symbol, witness, body.owner})
							}
						}
					}
				}
				var target *shimast.Node
				if node.Kind == shimast.KindBinaryExpression && bodyKind(node) == "assignment" {
					target = node.AsBinaryExpression().Left
				} else if node.Kind == shimast.KindDeleteExpression {
					// The baseline relation projector only exposes a target when the
					// authored child is labelled expression (not an ordinal child).
					position := 0
					node.ForEachChild(func(child *shimast.Node) bool {
						if childRole(node, child, position) == "expression" {
							target = child
						}
						position++
						return false
					})
				}
				if symbol := body.rootSymbol(target); symbol != "" {
					payload.Mutations = append(payload.Mutations, demandEffect{symbol, body.witness(node, witnesses), body.owner})
				}
			}
			projector := &bodyBuilder{x: x, file: body.file, owner: body.owner}
			sort.Slice(body.calls, func(i, j int) bool {
				return x.occurrenceID(x.span(body.file, body.calls[i]), "body-call") < x.occurrenceID(x.span(body.file, body.calls[j]), "body-call")
			})
			for _, node := range body.calls {
				call := node.AsCallExpression()
				if call.Arguments == nil {
					continue
				}
				argumentSymbols := make([]string, len(call.Arguments.Nodes))
				needed := false
				for index, argument := range call.Arguments.Nodes {
					argumentSymbols[index] = body.rootSymbol(argument)
					needed = needed || argumentSymbols[index] != ""
				}
				if !needed {
					continue
				}
				// Alias bindings and escape classification are the only global reads
				// of an unselected call. Data-only arguments contribute neither.
				target := projector.projectCallable(call.Expression, false).target
				signature := x.checker.GetResolvedSignature(node)
				if signature != nil {
					x.observeProjectionNode(signature.Declaration())
				}
				parameters := shimchecker.Signature_parameters(signature)
				rest := shimchecker.Signature_hasRestParameter(signature)
				for index, symbol := range argumentSymbols {
					if symbol == "" {
						continue
					}
					witness := body.witness(node, witnesses)
					x.rawDemandCalls = append(x.rawDemandCalls, demandEffectCall{symbol, target, witness, body.owner})
					parameterIndex := index
					if len(parameters) != 0 && parameterIndex >= len(parameters) && rest {
						parameterIndex = len(parameters) - 1
					}
					if parameterIndex < len(parameters) {
						if parameter := x.symbolID(parameters[parameterIndex]); parameter != "" && parameter != symbol {
							payload.Aliases = append(payload.Aliases, demandAlias{symbol, parameter, witness, body.owner})
						}
					}
					if target == "" || byOwner[target] == nil {
						payload.Escapes = append(payload.Escapes, demandEffect{symbol, witness, body.owner})
					}
				}
			}
		}
		for _, witness := range witnesses {
			payload.Witnesses = append(payload.Witnesses, witness)
		}
		sort.Slice(payload.Witnesses, func(i, j int) bool { return payload.Witnesses[i].ID < payload.Witnesses[j].ID })
		cache.snapshot = sealSourceProjection(x.sources, payload, x.callableReads, x)
		if cache.reuse != nil {
			cache.snapshot = cache.snapshot.mergeRetained(cache.reuse)
		}
	}
	payload = cache.snapshot.payload(recipe, selected)
	// Full-body contribution order is part of bounded symbolic evaluation.
	// Materialize every initializer/alias contributor reachable from a selected
	// value so its real logical fact identity can retain that exact order.
	aliasesBySymbol := map[string][]demandAlias{}
	initializersBySymbol := map[string][]demandEffect{}
	for _, alias := range payload.Aliases {
		aliasesBySymbol[alias.Symbol] = append(aliasesBySymbol[alias.Symbol], alias)
	}
	for _, initializer := range payload.Initializers {
		initializersBySymbol[initializer.Symbol] = append(initializersBySymbol[initializer.Symbol], initializer)
	}
	for recipe.Owners == nil && (len(queue) != 0 || len(pendingSymbols) != 0) {
		expandBodyDependencies()
		if len(pendingSymbols) == 0 {
			continue
		}
		symbol := pendingSymbols[0]
		pendingSymbols = pendingSymbols[1:]
		for _, initializer := range initializersBySymbol[symbol] {
			selectBody(byOwner[initializer.Owner])
		}
		for _, alias := range aliasesBySymbol[symbol] {
			selectBody(byOwner[alias.Owner])
			needSymbol(alias.From)
		}
	}
	for index := range payload.Owners {
		payload.Owners[index].Materialized = selected[payload.Owners[index].Owner]
	}
	shards := []factShard{}
	coverage := map[string]completeness{}
	for _, path := range recipe.Paths {
		coverage[path] = complete()
	}
	for _, file := range files {
		if record, owned := x.sources[file.FileName()]; owned {
			delete(roots, record.Path)
		}
	}
	for path := range roots {
		coverage[path] = completeness{Kind: "unavailable", Reasons: []any{map[string]any{"code": "DEMAND_SOURCE_ABSENT", "message": "Demanded source is absent from the owned compiler universe: " + path, "retryable": false}}}
	}
	factsByOwner := map[string]string{}
	if !x.plan.bodies {
		x.callableReads = cache.snapshot.callableReads()
	}
	var identity bodyIdentityWorkspace
	for _, body := range bodies {
		if !selected[body.owner] {
			continue
		}
		completion := complete()
		if cached, exists := cache.fullBodies[body.owner]; exists && !x.plan.bodies {
			existingBodies[body.owner] = cached
		}
		if existing, alreadyFull := existingBodies[body.owner]; alreadyFull {
			completion = existing.Completion
			factsByOwner[body.owner] = existing.Facts[0].ID
			if !x.plan.bodies {
				shards = append(shards, existing)
				x.retainSemanticShard(existing)
				x.retainBodyReads(body.file.FileName(), cache.bodyReads[body.owner])
			}
		} else {
			if body.retained {
				if err := body.hydrateCurrent(); err != nil {
					return nil, err
				}
			}
			readStart := len(x.callableReads[body.file.FileName()])
			builder := newBodyBuilder(x, body.file, body.owner, body.scope, body.body)
			full := builder.build(body.function)
			kind := "function-body"
			if body.scope == "module" {
				kind = "module-body"
			}
			shard, err := x.bodyShard(builder, full, kind, body.span, &identity)
			if err != nil {
				return nil, err
			}
			shards = append(shards, shard)
			cache.fullBodies[body.owner] = shard
			if cache.bodyReads == nil {
				cache.bodyReads = map[string][]callableRead{}
			}
			cache.bodyReads[body.owner] = copyProjectionReads(x.callableReads[body.file.FileName()][readStart:])
			if cache.bodyDependencies == nil {
				cache.bodyDependencies = map[string][]string{}
			}
			if !x.incompleteProjection[body.file.FileName()] {
				cache.bodyDependencies[body.owner] = x.sourceProjectionDependencies(body.file.FileName())
			} else {
				delete(cache.bodyDependencies, body.owner)
			}
			factsByOwner[body.owner] = shard.Facts[0].ID
			completion = full.Completeness
		}
		if current, requested := coverage[body.path]; requested && current.Kind != "unavailable" && completion.Kind != "complete" {
			current.Kind = completion.Kind
			current.Reasons = append(current.Reasons, completion.Reasons...)
			coverage[body.path] = current
		}
	}
	for index := range payload.Owners {
		payload.Owners[index].Fact = factsByOwner[payload.Owners[index].Owner]
	}
	for _, path := range recipe.Paths {
		payload.Coverage = append(payload.Coverage, demandCoverage{Path: path, Completeness: coverage[path]})
	}
	if len(selected) != len(bodies) {
		omission := completeness{Kind: "partial", Reasons: []any{map[string]any{
			"code": "BODY_DEMAND_OWNER_OMITTED", "message": "Full body IR is materialized only for the certified source demand and dependency closure.",
			"effective": map[string]any{"owners": len(bodies), "materializedOwners": len(selected)},
		}}}
		shards = append(shards, finishShard(bodyNamespace, bodyDemandNamespace+":"+x.universe, omission, []preparedFact{}))
	}
	certificate := x.admitPreparedFact(prepareFact(x.factWithProvenance(bodyDemandNamespace, "body-demand", x.universe, payload, []sourceSpan{}, complete(), 1)))
	shards = append(shards, finishShard(bodyDemandNamespace, x.universe, complete(), []preparedFact{certificate}))
	x.telemetry.record(x.requestID, "projection.demand-bodies", started, map[string]any{"owners": len(bodies), "selectedOwners": len(selected), "shards": len(shards), "effectWitnesses": len(witnesses)})
	return shards, nil
}
