package main

import (
	"maps"
	"slices"
	"time"

	shimast "github.com/microsoft/typescript-go/shim/ast"
)

// Callable projection reads runtime const initializers which declaration emit
// intentionally omits. Keep those reads with the generation that owns the facts,
// not with a Checker (whose symbols and caches belong to just one Program).
type callableRead struct {
	start, end   int
	kind         shimast.Kind
	callbackOnly bool
	observation  callableObservation
	dependencies []string
}

type callableObservation struct {
	target, callback string
	origin           *callTargetOrigin
}

type callableExpression struct {
	start, end int
	kind       shimast.Kind
}

type callableReadIndex struct {
	owners      map[string][]callableRead
	dependents  map[string]map[string]bool
	expressions int
}

func (b *bodyBuilder) projectCallable(node *shimast.Node, callbackOnly bool) callableObservation {
	read := b.x.observeCallable(b.file.FileName(), node, callbackOnly)
	if len(read.dependencies) != 0 {
		b.x.callableReads[b.file.FileName()] = append(b.x.callableReads[b.file.FileName()], read)
	}
	return read.observation
}

func (x *extractor) observeCallable(owner string, node *shimast.Node, callbackOnly bool) callableRead {
	read := callableRead{start: node.Pos(), end: node.End(), kind: node.Kind, callbackOnly: callbackOnly}
	dependencies := map[string]bool{}
	observe := func(symbol *shimast.Symbol) {
		for _, declaration := range symbol.Declarations {
			if file := shimast.GetSourceFileOfNode(declaration); file != nil && file.FileName() != owner {
				dependencies[file.FileName()] = true
			}
		}
	}
	// Match callbackTarget's original parenthesis/function handling exactly.
	callbackNode := node
	for callbackNode.Kind == shimast.KindParenthesizedExpression {
		callbackNode = callbackNode.AsParenthesizedExpression().Expression
	}
	var symbol *shimast.Symbol
	if !callbackOnly || !shimast.IsFunctionLike(callbackNode) {
		symbol = x.canonicalCallSymbol(callbackNode, observe)
	}
	if !callbackOnly {
		target := symbol
		if callbackNode != node {
			target = x.canonicalCallSymbol(node, observe)
		}
		read.observation.target = x.symbolID(target)
		read.observation.origin = x.callTargetOrigin(target)
	}
	if shimast.IsFunctionLike(callbackNode) {
		read.observation.callback = x.functionID(callbackNode)
	} else if declaration := declarationNode(symbol); declaration != nil {
		if shimast.IsFunctionLike(declaration) {
			read.observation.callback = x.functionID(declaration)
		} else if function := functionInitializer(declaration); function != nil {
			read.observation.callback = x.functionID(function)
		}
	}
	if !callbackOnly && read.observation.callback != "" {
		read.observation.target = read.observation.callback
	}
	for dependency := range dependencies {
		read.dependencies = append(read.dependencies, dependency)
	}
	slices.Sort(read.dependencies)
	return read
}

func sameCallableObservation(left, right callableObservation) bool {
	if left.target != right.target || left.callback != right.callback {
		return false
	}
	if left.origin == nil || right.origin == nil {
		return left.origin == right.origin
	}
	return left.origin.Package == right.origin.Package && left.origin.File == right.origin.File && slices.Equal(left.origin.Path, right.origin.Path)
}

// Re-execute only the recorded expressions whose foreign reads changed. The
// expression's owning source is unchanged, so its exact syntax/span is a valid
// locator. Failure to recover it conservatively selects that whole owner.
func (a *analyzer) revalidateCallableReads(changed, selected []string, requestID int) (map[string][]callableRead, []string) {
	started := time.Now()
	index := a.acknowledged.callableReads
	updates := map[string][]callableRead{}
	changedSet, selectedSet, owners := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, owner := range selected {
		selectedSet[owner] = true
	}
	for _, file := range changed {
		changedSet[file] = true
		for owner := range index.dependents[file] {
			if !selectedSet[owner] {
				owners[owner] = true
			}
		}
	}
	if len(owners) == 0 {
		return updates, nil
	}
	x := &extractor{
		root: a.root, universe: a.universe, checker: a.session.Program().Checker,
		sources: maps.Clone(a.acknowledged.sources), symbolIDs: map[*shimast.Symbol]string{}, symbolSeen: map[string]symbolFactPayload{},
	}
	for _, path := range changed {
		if previous, exists := x.sources[path]; exists {
			file := a.session.Program().SourceFile(path)
			previous.TextDigest = hashText(file.Text())
			previous.Revision = deriveID("source-revision", previous.Source, map[string]any{"digest": previous.TextDigest})
			x.sources[path] = previous
		}
	}
	invalidated := []string{}
	checked := 0
	for owner := range owners {
		file := a.session.Program().SourceFile(owner)
		reads := slices.Clone(index.owners[owner])
		positions := []int{}
		expressions := map[callableExpression]*shimast.Node{}
		start, end := 0, 0
		for position, previous := range reads {
			if !slices.ContainsFunc(previous.dependencies, func(path string) bool { return changedSet[path] }) {
				continue
			}
			if len(positions) == 0 || previous.start < start {
				start = previous.start
			}
			if previous.end > end {
				end = previous.end
			}
			positions = append(positions, position)
			expressions[callableExpression{previous.start, previous.end, previous.kind}] = nil
		}
		// Recover all relevant expressions in one syntax walk. A shared helper
		// can be read thousands of times by one owner; walking once per read
		// would make that owner's invalidation quadratic in its syntax size.
		walkFile(file, func(node *shimast.Node) bool {
			if node.Pos() > end || node.End() < start {
				return false
			}
			key := callableExpression{node.Pos(), node.End(), node.Kind}
			if current, needed := expressions[key]; needed {
				if current != nil && current != node {
					// An ambiguous locator is no proof of the old expression.
					delete(expressions, key)
				} else {
					expressions[key] = node
				}
			}
			return true
		})
		invalid := false
		for _, position := range positions {
			previous := reads[position]
			checked++
			expression := expressions[callableExpression{previous.start, previous.end, previous.kind}]
			if expression == nil {
				invalid = true
				break
			}
			current := x.observeCallable(owner, expression, previous.callbackOnly)
			if !sameCallableObservation(previous.observation, current.observation) {
				invalid = true
				break
			}
			reads[position] = current
		}
		if invalid {
			invalidated = append(invalidated, owner)
		} else {
			// A retargeted alias chain can end at the same callable today. Its
			// newly read sources must still invalidate that observation tomorrow.
			updates[owner] = reads
		}
	}
	slices.Sort(invalidated)
	a.telemetry.record(requestID, "compiler.callable-reads", started, map[string]any{"candidateOwners": len(owners), "checkedExpressions": checked, "invalidatedOwners": len(invalidated)})
	return updates, invalidated
}

// Share untouched owner/read slices and copy only affected reverse-index rows.
// The acknowledged base and pending candidate retain independent dependency proofs.
func mergeCallableReads(base callableReadIndex, updates map[string][]callableRead) callableReadIndex {
	result := callableReadIndex{owners: maps.Clone(base.owners), dependents: maps.Clone(base.dependents), expressions: base.expressions}
	if result.owners == nil {
		result.owners = map[string][]callableRead{}
		result.dependents = map[string]map[string]bool{}
	}
	touched := map[string]bool{}
	row := func(dependency string) map[string]bool {
		if !touched[dependency] {
			result.dependents[dependency] = maps.Clone(result.dependents[dependency])
			if result.dependents[dependency] == nil {
				result.dependents[dependency] = map[string]bool{}
			}
			touched[dependency] = true
		}
		return result.dependents[dependency]
	}
	for owner, reads := range updates {
		result.expressions += len(reads) - len(base.owners[owner])
		for _, previous := range base.owners[owner] {
			for _, dependency := range previous.dependencies {
				delete(row(dependency), owner)
			}
		}
		delete(result.owners, owner)
		if len(reads) != 0 {
			result.owners[owner] = reads
		}
		for _, read := range reads {
			for _, dependency := range read.dependencies {
				row(dependency)[owner] = true
			}
		}
	}
	for dependency := range touched {
		if len(result.dependents[dependency]) == 0 {
			delete(result.dependents, dependency)
		}
	}
	return result
}
