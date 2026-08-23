package main

import (
	"crypto/sha256"
	"encoding/hex"
	"hash"

	shimast "github.com/microsoft/typescript-go/shim/ast"
)

type moduleDeclarationObservation struct {
	declaration observedDeclarationPayload
	references  map[string]*shimast.Symbol
	canonical   string
	partial     bool
}

func (x *extractor) observeModuleDeclaration(symbol *shimast.Symbol, exportPaths [][]string) (observedDeclarationPayload, map[string]*shimast.Symbol, bool, error) {
	observation, ok := x.moduleDeclarations[symbol]
	if ok {
		x.moduleDeclarationCacheHits++
	} else {
		declaration, references := x.observePublicDeclaration(symbol, nil)
		canonical := stableJSON(declaration)
		observation = moduleDeclarationObservation{
			declaration: declaration,
			references:  references,
			canonical:   canonical,
			partial:     containsUnsupportedEncoding(canonical),
		}
		x.moduleDeclarations[symbol] = observation
		if existing, exists := x.moduleDeclarationsByIdentity[declaration.Identity]; exists {
			if existing.canonical != canonical {
				return observedDeclarationPayload{}, nil, false, protocolError(
					"NATIVE_DECLARATION_IDENTITY_CONFLICT",
					"Normalized declaration "+declaration.Identity+" has conflicting semantic payloads.",
				)
			}
		} else {
			x.moduleDeclarationsByIdentity[declaration.Identity] = observation
			x.moduleDeclarationBytes += len(canonical)
		}
		x.moduleDeclarationCacheMisses++
	}
	declaration := observation.declaration
	declaration.ExportPaths = clonePaths(exportPaths)
	return declaration, observation.references, observation.partial, nil
}

// logicalModuleFactID preserves the schema-v1 logical module-fact identity
// without reconstructing or canonically encoding one repeated transitive
// declaration monolith. Each canonical declaration is encoded independently
// into the same byte stream and can be released or reused immediately.
func logicalModuleFactID(
	subject string,
	payload moduleFactPayload,
	declarations []moduleDeclarationProjection,
	declarationsByIdentity map[string]moduleDeclarationObservation,
	evidence []sourceSpan,
) (string, error) {
	if evidence == nil {
		evidence = []sourceSpan{}
	}
	digest := sha256.New()
	digest.Write([]byte("astrale.analysis.identity\x00fact\x00" + moduleNamespace + "\x00"))
	writeCanonicalPart(digest, `{"evidence":`)
	writeCanonicalValue(digest, evidence)
	writeCanonicalPart(digest, `,"kind":"module","payload":{`)
	writeCanonicalPart(digest, `"declarations":[`)
	for index, projection := range declarations {
		observation, ok := declarationsByIdentity[projection.Identity]
		if !ok {
			return "", protocolError(
				"NATIVE_DECLARATION_SUPPORT_MISSING",
				"Normalized declaration "+projection.Identity+" has no canonical support payload.",
			)
		}
		if index != 0 {
			writeCanonicalPart(digest, `,`)
		}
		if len(projection.ExportPaths) == 0 {
			writeCanonicalPart(digest, observation.canonical)
		} else {
			declaration := observation.declaration
			declaration.ExportPaths = projection.ExportPaths
			writeCanonicalValue(digest, declaration)
		}
	}
	writeCanonicalPart(digest, `],"declaredPackages":`)
	writeCanonicalValue(digest, payload.DeclaredPackages)
	writeCanonicalPart(digest, `,"dependencies":`)
	writeCanonicalValue(digest, payload.Dependencies)
	writeCanonicalPart(digest, `,"developmentPackages":`)
	writeCanonicalValue(digest, payload.DevelopmentPackages)
	writeCanonicalPart(digest, `,"errorCodes":`)
	writeCanonicalValue(digest, payload.ErrorCodes)
	writeCanonicalPart(digest, `,"exports":`)
	writeCanonicalValue(digest, payload.Exports)
	writeCanonicalPart(digest, `,"files":`)
	writeCanonicalValue(digest, payload.Files)
	writeCanonicalPart(digest, `,"inboundDependencies":`)
	writeCanonicalValue(digest, payload.InboundDependencies)
	writeCanonicalPart(digest, `,"issues":`)
	writeCanonicalValue(digest, payload.Issues)
	writeCanonicalPart(digest, `,"target":`)
	writeCanonicalValue(digest, payload.Target)
	writeCanonicalPart(digest, `,"workspacePackages":`)
	writeCanonicalValue(digest, payload.WorkspacePackages)
	writeCanonicalPart(digest, `},"subject":`)
	writeCanonicalValue(digest, subject)
	writeCanonicalPart(digest, `}`)
	return "fact:" + hex.EncodeToString(digest.Sum(nil)), nil
}

func writeCanonicalValue(destination hash.Hash, value any) {
	writeCanonicalPart(destination, stableJSON(value))
}

func writeCanonicalPart(destination hash.Hash, value string) {
	_, _ = destination.Write([]byte(value))
}

// Retain only the normalized cross-owner evidence required to compose an
// incremental module projection from one acknowledged generation.
func mergeModuleDependencies(
	base []dependencyPayload,
	shards []factShard,
	full bool,
) []dependencyPayload {
	replaced := map[string]bool{}
	for _, shard := range shards {
		if shard.Namespace == moduleNamespace && len(shard.Facts) == 1 {
			replaced[shard.Facts[0].Subject] = true
		}
	}
	edges := []dependencyPayload{}
	if !full {
		for _, edge := range base {
			if !replaced[edge.SourceModule] {
				edges = append(edges, edge)
			}
		}
	}
	for _, shard := range shards {
		if shard.Namespace != moduleNamespace || len(shard.Facts) != 1 {
			continue
		}
		payload, ok := shard.Facts[0].Payload.(normalizedModuleFactPayload)
		if !ok {
			continue
		}
		edges = append(edges, payload.Dependencies...)
	}
	return deduplicateDependencies(edges)
}

func mergeModuleDeclarationReferences(
	base map[string][]string,
	shards []factShard,
	full bool,
) map[string][]string {
	values := map[string][]string{}
	if !full {
		for module, declarations := range base {
			values[module] = append([]string{}, declarations...)
		}
	}
	for _, shard := range shards {
		if shard.Namespace != moduleNamespace || len(shard.Facts) != 1 {
			continue
		}
		payload, ok := shard.Facts[0].Payload.(normalizedModuleFactPayload)
		if !ok {
			continue
		}
		facts := make([]string, 0, len(payload.Declarations))
		for _, declaration := range payload.Declarations {
			facts = append(facts, declaration.Fact)
		}
		values[shard.Facts[0].Subject] = sortedUnique(facts)
	}
	return values
}

func declarationReferenceSet(values map[string][]string) map[string]bool {
	result := map[string]bool{}
	for _, declarations := range values {
		for _, declaration := range declarations {
			result[declaration] = true
		}
	}
	return result
}

func moduleProjectionCounts(shards []factShard) (moduleOwners int, declarationShards int, declarationReferences int) {
	for _, shard := range shards {
		if shard.Namespace != moduleNamespace || len(shard.Facts) != 1 {
			continue
		}
		switch shard.Facts[0].Kind {
		case "module":
			moduleOwners++
			if payload, ok := shard.Facts[0].Payload.(normalizedModuleFactPayload); ok {
				declarationReferences += len(payload.Declarations)
			}
		case "declaration":
			declarationShards++
		}
	}
	return moduleOwners, declarationShards, declarationReferences
}
