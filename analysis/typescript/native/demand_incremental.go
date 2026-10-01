package main

import (
	"sort"
	"time"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimcompiler "github.com/microsoft/typescript-go/shim/compiler"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

// References and retained projections outlive an Apply only as plain values.
// driver.Program itself is a mutable wrapper, not an old-capture lease.
type compilerReferenceSnapshot struct {
	files         map[string]bool
	reverse       map[string][]string
	complete      bool
	sensitive     map[string]bool
	augmentations map[string]compilerAugmentationCapture
}

func captureCompilerReferences(program *driver.Program) *compilerReferenceSnapshot {
	graph := &compilerReferenceSnapshot{files: map[string]bool{}, reverse: map[string][]string{}, sensitive: map[string]bool{}, augmentations: map[string]compilerAugmentationCapture{}, complete: true}
	physical := map[string]string{}
	// The driver excludes declarations; dependency provenance includes every
	// captured library/ambient input, even when it is not a projectable source.
	for _, file := range program.TSProgram.SourceFiles() {
		graph.files[file.FileName()] = true
		physical[string(file.Path())] = file.FileName()
		if len(file.ModuleAugmentations) != 0 || sourceHasAmbientModule(file) || shimcompiler.FileAffectsGlobalScope(file) {
			graph.sensitive[file.FileName()] = true
		}
	}
	for _, file := range program.TSProgram.SourceFiles() {
		for _, canonical := range shimcompiler.GetReferencedFilePaths(program.TSProgram, file) {
			target, exists := physical[canonical]
			if !exists {
				graph.complete = false
				continue
			}
			graph.reverse[target] = append(graph.reverse[target], file.FileName())
		}
		if graph.sensitive[file.FileName()] {
			graph.augmentations[file.FileName()] = captureExternalAugmentation(program, file, graph.files)
		}
	}
	return graph
}

func sourceHasAmbientModule(file *shimast.SourceFile) bool {
	found := false
	walkFile(file, func(node *shimast.Node) bool {
		if node.Kind == shimast.KindModuleDeclaration && node.Name() != nil && node.Name().Kind == shimast.KindStringLiteral {
			found = true
		}
		return !found
	})
	return found
}

type retainedSourceProjection struct {
	rows             sourceProjectionRows
	shards           []factShard
	bodies           map[string]factShard
	bodyReads        map[string][]callableRead
	bodyDependencies map[string][]string
}

type demandSourceReuse struct {
	snapshot       *sourceProjectionSnapshot
	sources        map[string]retainedSourceProjection
	references     *compilerReferenceSnapshot
	selected       map[string]bool
	fallbackReason string
}

// Called after actual byte changes are established, but before the first Apply.
// Retire every old AST/checker cache even when this narrower path is ineligible.
func (a *analyzer) detachDemandForApply(changed []string, requestID int) *demandSourceReuse {
	cache := a.demandCache
	a.demandCache = nil
	if cache == nil || !cache.ready || !a.projection.bodyDemand || a.projection.bodies || a.projection.modules || a.projection.diagnostics || a.acknowledged.generation.ID == "" || cache.snapshot == nil || cache.references == nil {
		return nil
	}
	started := time.Now()
	fallback := func(reason string) *demandSourceReuse {
		a.telemetry.record(requestID, "projection.incremental-eligibility", started, map[string]any{"eligible": false, "reason": reason})
		return nil
	}
	if a.acknowledged.bodyDemand == nil || a.acknowledged.bodyDemand.Owners == nil {
		return fallback("conservative-recipe")
	}
	if !cache.references.complete || !cache.snapshot.dependenciesCaptured {
		return fallback("incomplete-or-ambient-provenance")
	}
	for _, path := range changed {
		file := a.session.Program().SourceFile(path)
		if file == nil || file.IsDeclarationFile || (file.ExternalModuleIndicator == nil && file.CommonJSModuleIndicator == nil) || shimcompiler.FileAffectsGlobalScope(file) {
			return fallback("nonordinary-module")
		}
	}
	reuse := &demandSourceReuse{snapshot: cache.snapshot, sources: map[string]retainedSourceProjection{}, references: cache.references}
	ownerSource := map[string]string{}
	for _, rows := range cache.snapshot.sources {
		base, exists := a.acknowledged.sources[rows.record.Physical]
		if !exists || base.Revision != rows.record.Revision || base.TextDigest != rows.record.TextDigest || !rows.dependenciesComplete {
			return fallback("uncertified-source-capture")
		}
		for _, owner := range rows.owners {
			if _, duplicate := ownerSource[owner.Owner]; duplicate {
				return fallback("ambiguous-owner-identity")
			}
			ownerSource[owner.Owner] = rows.record.Physical
		}
		reuse.sources[rows.record.Physical] = retainedSourceProjection{rows: rows, bodies: map[string]factShard{}, bodyReads: map[string][]callableRead{}, bodyDependencies: map[string][]string{}}
	}
	if len(reuse.sources) != len(a.acknowledged.sources) {
		return fallback("source-membership-mismatch")
	}
	for _, shard := range cache.nonBodyShards {
		if source := shardSourceOwner(shard); source != "" {
			rows, exists := cache.snapshot.sources[source]
			if !exists {
				return fallback("unmapped-shard-owner")
			}
			retained := reuse.sources[rows.record.Physical]
			retained.shards = append(retained.shards, shard)
			reuse.sources[rows.record.Physical] = retained
		} else if shard.Namespace == projectNamespace {
			// Project facts are assembled again for the current capture.
		} else {
			return fallback("unmapped-global-shard")
		}
	}
	for owner, shard := range cache.fullBodies {
		physical, exists := ownerSource[owner]
		if !exists {
			return fallback("unmapped-body-owner")
		}
		retained := reuse.sources[physical]
		retained.bodies[owner] = shard
		retained.bodyReads[owner] = copyProjectionReads(cache.bodyReads[owner])
		dependencies, certified := cache.bodyDependencies[owner]
		if !certified {
			return fallback("uncertified-body-reads")
		}
		retained.bodyDependencies[owner] = append([]string{}, dependencies...)
	}
	a.telemetry.record(requestID, "projection.incremental-eligibility", started, map[string]any{"eligible": true, "sources": len(reuse.sources)})
	return reuse
}

func (reuse *demandSourceReuse) closure(next *compilerReferenceSnapshot, changed []string) []string {
	reverse := map[string][]string{}
	for _, graph := range []*compilerReferenceSnapshot{reuse.references, next} {
		for target, owners := range graph.reverse {
			reverse[target] = append(reverse[target], owners...)
		}
		for augmenter, capture := range graph.augmentations {
			if !capture.complete {
				continue
			}
			// A merge may affect the declaration owner behind a forwarding
			// module, including users which import that owner directly. Keep
			// the old AND new contributions, not only the package entry file.
			for _, owner := range capture.owners {
				reverse[augmenter] = append(reverse[augmenter], owner)
				reverse[owner] = append(reverse[owner], augmenter)
			}
		}
	}
	for physical, retained := range reuse.sources {
		for _, dependency := range retained.rows.dependencies {
			reverse[dependency] = append(reverse[dependency], physical)
		}
		for _, read := range retained.rows.thinReads {
			for _, dependency := range read.dependencies {
				reverse[dependency] = append(reverse[dependency], physical)
			}
		}
		for _, reads := range retained.bodyReads {
			for _, read := range reads {
				for _, dependency := range read.dependencies {
					reverse[dependency] = append(reverse[dependency], physical)
				}
			}
		}
		for _, dependencies := range retained.bodyDependencies {
			for _, dependency := range dependencies {
				reverse[dependency] = append(reverse[dependency], physical)
			}
		}
		// Symbol facts belong to the first declaration source. A contributing
		// declaration can be observed while walking a different source.
		for _, shard := range retained.shards {
			if shard.Namespace == symbolNamespace {
				for _, entry := range shard.Facts {
					for _, span := range entry.Provenance.Evidence {
						if rows, exists := reuse.snapshot.sources[span.Source]; exists {
							reverse[rows.record.Physical] = append(reverse[rows.record.Physical], physical)
						}
					}
				}
			}
		}
	}
	for target := range reverse {
		if !reuse.references.files[target] {
			reuse.selected = nil
			reuse.fallbackReason = "unmapped-projection-dependency:" + target
			return nil
		}
	}
	seen := map[string]bool{}
	queue := append([]string{}, changed...)
	for len(queue) != 0 {
		path := queue[0]
		queue = queue[1:]
		if seen[path] {
			continue
		}
		seen[path] = true
		queue = append(queue, reverse[path]...)
	}
	selected := []string{}
	reuse.selected = map[string]bool{}
	for path := range seen {
		if (reuse.references.sensitive[path] || next.sensitive[path]) && !unchangedExternalAugmentation(reuse.references, next, path) {
			reuse.selected = nil
			reuse.fallbackReason = "sensitive-dependent-source:" + path
			return nil
		}
		if _, owned := reuse.sources[path]; owned {
			selected = append(selected, path)
			reuse.selected[path] = true
		}
	}
	sort.Strings(selected)
	return selected
}

func sameSourceMembership(a, b map[string]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for key := range a {
		if !b[key] {
			return false
		}
	}
	return true
}

func newSparseDemandCache(reuse *demandSourceReuse) *bodyDemandCache {
	cache := &bodyDemandCache{reuse: reuse, references: reuse.references, sparseCatalogue: true,
		fullBodies: map[string]factShard{}, bodyReads: map[string][]callableRead{}, bodyDependencies: map[string][]string{}}
	for physical, source := range reuse.sources {
		if reuse.selected[physical] {
			continue
		}
		for owner, shard := range source.bodies {
			cache.fullBodies[owner] = shard
			cache.bodyReads[owner] = copyProjectionReads(source.bodyReads[owner])
			cache.bodyDependencies[owner] = append([]string{}, source.bodyDependencies[owner]...)
		}
	}
	return cache
}

func (body *thinBody) hydrateCurrent() error {
	if body.body != nil {
		return nil
	}
	x := body.x
	x.beginProjection(body.file)
	if body.scope == "module" {
		body.body = body.file.AsNode()
		return nil
	}
	var found *shimast.Node
	ambiguous := false
	walkFile(body.file, func(node *shimast.Node) bool {
		if shimast.IsFunctionLike(node) && node.Body() != nil && node.End() == body.span.End && x.span(body.file, node) == body.span {
			if x.functionID(node) == body.owner {
				if found != nil {
					ambiguous = true
				}
				found = node
			}
		}
		return true
	})
	if found == nil || ambiguous {
		return sparseDemandFallback{"retained-body-locator-changed"}
	}
	body.function, body.body = found, found.Body()
	return nil
}

func (x *extractor) beginProjection(file *shimast.SourceFile) {
	if !x.plan.bodyDemand {
		return
	}
	x.projectionSource = file.FileName()
	if x.projectionDependencies == nil {
		x.projectionDependencies = map[string]map[string]bool{}
	}
	if x.projectionDependencies[x.projectionSource] == nil {
		x.projectionDependencies[x.projectionSource] = map[string]bool{}
	}
}

func (x *extractor) observeProjectionNode(node *shimast.Node) {
	if node == nil || x.projectionSource == "" {
		return
	}
	file := shimast.GetSourceFileOfNode(node)
	if file == nil {
		if x.incompleteProjection == nil {
			x.incompleteProjection = map[string]bool{}
		}
		x.incompleteProjection[x.projectionSource] = true
		return
	}
	if file.FileName() != x.projectionSource {
		x.projectionDependencies[x.projectionSource][file.FileName()] = true
	}
}

func (x *extractor) observeProjectionSymbol(symbol *shimast.Symbol) {
	if x.projectionSource == "" {
		return
	}
	if symbol != nil {
		for _, declaration := range symbol.Declarations {
			x.observeProjectionNode(declaration)
		}
	}
}

func (x *extractor) sourceProjectionDependencies(physical string) []string {
	dependencies := []string{}
	for path := range x.projectionDependencies[physical] {
		dependencies = append(dependencies, path)
	}
	sort.Strings(dependencies)
	return dependencies
}

// A failed sparse attempt is internal recovery, not a public abstention. It
// discards its candidate and rebuilds the exact full current projection.
type sparseDemandFallback struct{ reason string }

func (e sparseDemandFallback) Error() string { return e.reason }
