package observabledecision

import (
	"crypto/sha256"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

// Effect authority is separate from source authoring and runtime value lookup.
// Known=true/empty key proves that an expression has no effect-root symbol.
// Symbols must use the native compiler's canonical unaliased identity; names
// and static callable types are not interchangeable with that identity.
type NativeEffectSymbol struct {
	Known bool
	Key   string
}
type NativeEffectBinding struct {
	Argument  *ast.Node
	Parameter string
	Rest      bool
}
type NativeEffectCall struct {
	Target                      *ast.Node
	TargetPath                  string
	CallableOwner               bool
	Known, BodyPresent, Dynamic bool
	Bindings                    []NativeEffectBinding
}
type NativeEffectAuthority struct {
	MembershipComplete bool
	MembershipReads    []SemanticRead
	// Match may certify a negative lexical/canonical binding comparison without
	// resolving unrelated candidates. Unknown comparisons remain residual.
	Match  func(CapturedFile, *ast.Node, string) (matches, known bool, reads []SemanticRead)
	Symbol func(CapturedFile, *ast.Node) NativeEffectSymbol
	Call   func(CapturedFile, *ast.Node) NativeEffectCall
	// Compiler membership alone cannot admit syntax omitted by legacy bodies.
	CandidateAdmitted func(CapturedFile, *ast.Node, string) (admitted, known bool)
	// Legacy delete nodes contribute only when admitted by an effect expression
	// (for example an actual call argument), not arbitrary standalone deletes.
	DeleteAdmitted func(CapturedFile, *ast.Node) (bool, bool)
}
type NativeEffectProof struct {
	Known        bool
	Effect       string
	VirtualSteps int
	Reads        []SemanticRead
	Reason       string
	ChargeKey    string
}
type effectCandidate struct {
	file             CapturedFile
	node, root, name *ast.Node
	kind             string
}
type NativeEffectCore struct {
	immutableProofOwner        bool
	proofCells                 map[nativeEffectProofKey]NativeEffectProof
	authority                  NativeEffectAuthority
	candidates                 []effectCandidate
	sources                    map[string]CapturedFile
	symbols                    map[*ast.Node]NativeEffectSymbol
	calls                      map[*ast.Node]NativeEffectCall
	invalidCapture             bool
	canonicalCandidates        map[string][]effectCandidate
	canonicalCandidatesKnown   bool
	canonicalCandidatesIndexed bool
}

// NewNativeEffectCore indexes native AST candidates only. It never reads a
// filesystem, creates a Program, resolves signatures eagerly, builds BodyIR,
// or assumes that the governed set is the compiler's complete effect universe.
func NewNativeEffectCore(files []CapturedFile, authority NativeEffectAuthority) *NativeEffectCore {
	return newNativeEffectCore(files, authority, NewSourceSyntaxOwner())
}
func newNativeEffectCore(files []CapturedFile, authority NativeEffectAuthority, syntax *SourceSyntaxOwner) *NativeEffectCore {
	core := &NativeEffectCore{authority: authority, sources: map[string]CapturedFile{}, symbols: map[*ast.Node]NativeEffectSymbol{}, calls: map[*ast.Node]NativeEffectCall{}}
	for _, file := range files {
		if file.Source == nil || file.Source.Text() != file.Text {
			core.invalidCapture = true
			continue
		}
		core.sources[file.Path] = file
		for _, candidate := range syntax.effectCandidates(file.Source) {
			candidate.file = file
			core.candidates = append(core.candidates, candidate)
		}
	}
	return core
}
func effectRoot(node *ast.Node) *ast.Node {
	for node != nil {
		switch node.Kind {
		case ast.KindIdentifier:
			return node
		case ast.KindPropertyAccessExpression:
			node = node.AsPropertyAccessExpression().Expression
		case ast.KindElementAccessExpression:
			node = node.AsElementAccessExpression().Expression
		case ast.KindParenthesizedExpression:
			node = node.AsParenthesizedExpression().Expression
		case ast.KindAsExpression:
			node = node.AsAsExpression().Expression
		case ast.KindSatisfiesExpression:
			node = node.AsSatisfiesExpression().Expression
		case ast.KindNonNullExpression:
			node = node.AsNonNullExpression().Expression
		case ast.KindTypeAssertionExpression:
			node = node.AsTypeAssertion().Expression
		default:
			return nil
		}
	}
	return nil
}
func (core *NativeEffectCore) symbol(file CapturedFile, node *ast.Node) NativeEffectSymbol {
	if cached, known := core.symbols[node]; known {
		return cached
	}
	result := NativeEffectSymbol{}
	if core.authority.Symbol != nil {
		result = core.authority.Symbol(file, node)
	}
	core.symbols[node] = result
	return result
}
func (core *NativeEffectCore) call(file CapturedFile, node *ast.Node) NativeEffectCall {
	if cached, known := core.calls[node]; known {
		return cached
	}
	result := NativeEffectCall{}
	if core.authority.Call != nil {
		result = core.authority.Call(file, node)
	}
	core.calls[node] = result
	return result
}
func (core *NativeEffectCore) computeProof(kind, symbol, localOwner string) NativeEffectProof {
	oldKind, oldSymbol, oldOwner := DiagnosticProofKind, DiagnosticProofSymbol, DiagnosticLocalOwner
	DiagnosticProofKind, DiagnosticProofSymbol, DiagnosticLocalOwner = kind, symbol, localOwner
	defer func() {
		DiagnosticProofKind, DiagnosticProofSymbol, DiagnosticLocalOwner = oldKind, oldSymbol, oldOwner
	}()
	result := NativeEffectProof{Known: true, Effect: "none", ChargeKey: kind + ":" + symbol + ":" + localOwner}
	result.Reads = append(result.Reads, core.authority.MembershipReads...)
	if !core.authority.MembershipComplete || core.invalidCapture || len(core.sources) == 0 {
		result.Known = false
		result.Reason = "Native compiler effect membership has not been certified."
		return result
	}
	if kind != "mutation" && kind != "escape" {
		result.Known = false
		result.Reason = "Unknown native effect demand."
		return result
	}
	indexed := core.authority.Match == nil
	if indexed {
		core.indexCanonicalCandidates()
	}
	pending := []string{symbol}
	seen := map[string]bool{}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[current] {
			continue
		}
		seen[current] = true
		aliases := []string{}
		mutationOwners := []string{}
		escaped := false
		known := true
		candidates := core.candidates
		if indexed {
			known = core.canonicalCandidatesKnown
			candidates = core.canonicalCandidates[current]
		}
		witnesses := []string{}
		for _, candidate := range candidates {
			if !indexed {
				if core.authority.CandidateAdmitted == nil {
					known = false
					continue
				}
				admitted, admissionKnown := core.authority.CandidateAdmitted(candidate.file, candidate.node, candidate.kind)
				if !admissionKnown {
					known = false
					continue
				}
				if !admitted {
					continue
				}
				matches, complete := false, false
				if core.authority.Match != nil {
					var reads []SemanticRead
					matches, complete, reads = core.authority.Match(candidate.file, candidate.root, current)
					result.Reads = append(result.Reads, reads...)
				} else {
					root := core.symbol(candidate.file, candidate.root)
					matches, complete = root.Key == current, root.Known
				}
				if !complete {
					known = false
					continue
				}
				if !matches {
					continue
				}
			}
			switch candidate.kind {
			case "alias":
				alias := core.symbol(candidate.file, candidate.name)
				if !alias.Known {
					known = false
					continue
				}
				if alias.Key != "" && alias.Key != current {
					aliases = effectUnique(aliases, alias.Key)
					witnesses = append(witnesses, effectWitness(candidate))
				}
			case "mutation":
				owner := effectFunctionOwner(candidate.node)
				key := "global"
				if owner != nil {
					value := core.symbol(candidate.file, owner)
					if !value.Known {
						known = false
						continue
					}
					key = value.Key
				}
				mutationOwners = effectUnique(mutationOwners, key)
				witnesses = append(witnesses, effectWitness(candidate))
			case "delete":
				if core.authority.DeleteAdmitted == nil {
					known = false
					continue
				}
				admitted, complete := core.authority.DeleteAdmitted(candidate.file, candidate.node)
				if !complete {
					known = false
					continue
				}
				if admitted {
					owner := effectFunctionOwner(candidate.node)
					key := "global"
					if owner != nil {
						value := core.symbol(candidate.file, owner)
						if !value.Known {
							known = false
							continue
						}
						key = value.Key
					}
					mutationOwners = effectUnique(mutationOwners, key)
					witnesses = append(witnesses, effectWitness(candidate))
				}
			case "call":
				call := core.call(candidate.file, candidate.node)
				if !call.Known {
					known = false
					continue
				}
				for _, binding := range call.Bindings {
					argumentRoot := effectRoot(binding.Argument)
					if argumentRoot == nil {
						continue
					}
					argument := core.symbol(candidate.file, argumentRoot)
					if !argument.Known {
						known = false
						continue
					}
					if argument.Key == current && binding.Parameter != "" && binding.Parameter != current {
						aliases = effectUnique(aliases, binding.Parameter)
					}
				}
				if !call.BodyPresent || call.Dynamic {
					escaped = true
				}
				witnesses = append(witnesses, effectWitness(candidate))
			}
		}
		// Presence and absence fingerprints are per symbol, including the alias set.
		digest := sha256.Sum256([]byte(fmt.Sprintf("%s|%v|%v|%t|%v", current, aliases, mutationOwners, escaped, witnesses)))
		result.Reads = append(result.Reads, SemanticRead{Kind: kind, Name: current, Fingerprint: fmt.Sprintf("%x", digest)}, SemanticRead{Kind: "aliases", Name: current, Fingerprint: fmt.Sprintf("%v", aliases)})
		if !known {
			result.Known = false
			result.Reason = "Native binding/call/delete authority is incomplete for this effect demand."
			return result
		}
		if (kind == "escape" && escaped) || (kind == "mutation" && len(mutationOwners) > 0) {
			other := current != symbol || localOwner == ""
			if kind == "mutation" {
				for _, owner := range mutationOwners {
					if owner != localOwner {
						other = true
					}
				}
			} else {
				other = true
			}
			if other {
				result.Effect = "other"
				return result
			}
			result.Effect = "local"
		}
		for _, alias := range aliases {
			result.VirtualSteps++
			pending = append(pending, alias)
		}
	}
	return result
}
func effectUnique(values []string, value string) []string {
	for _, v := range values {
		if v == value {
			return values
		}
	}
	return append(values, value)
}
func effectFunctionOwner(node *ast.Node) *ast.Node {
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if ast.IsFunctionLike(parent) {
			return parent
		}
	}
	return nil
}
func effectWitness(candidate effectCandidate) string {
	return fmt.Sprintf("%s:%d:%d:%s", candidate.file.Path, candidate.node.Pos(), candidate.node.End(), candidate.kind)
}

// DemandEffects adapts only binding effect operations. The caller supplies a
// separate captured authority for invocation and initializer observations;
// absence of that authority is residual, never an implicit purity witness.
func (core *NativeEffectCore) DemandEffects(other func(EffectRequest) EffectSummary) func(EffectRequest) EffectSummary {
	return func(request EffectRequest) EffectSummary {
		old := DiagnosticRequest
		DiagnosticRequest = request
		defer func() { DiagnosticRequest = old }()
		kind := ""
		if strings.HasPrefix(request.Operation, "binding-mutation:") {
			kind = "mutation"
		}
		if strings.HasPrefix(request.Operation, "binding-escape:") {
			kind = "escape"
		}
		if kind == "" {
			if other != nil {
				return other(request)
			}
			return EffectSummary{Unavailable: true, Reason: "Captured invocation/initializer authority is unavailable."}
		}
		file, ok := core.sources[request.Path]
		if !ok || request.Node == nil {
			return EffectSummary{Unavailable: true, Reason: "Captured binding effect anchor is unavailable."}
		}
		symbol := core.symbol(file, request.Node)
		if !symbol.Known {
			return EffectSummary{Unavailable: true, Reason: "Canonical native binding authority is unavailable."}
		}
		if symbol.Key == "" {
			return EffectSummary{Pure: true, ChargeKey: request.Path + ":" + request.Operation + ":no-symbol"}
		}
		ownerKey := ""
		if owner := effectFunctionOwner(request.Node); request.LocalAssignment && owner != nil {
			ownerSymbol := core.symbol(file, owner)
			if !ownerSymbol.Known {
				return EffectSummary{Unavailable: true, Reason: "Canonical function ownership is unavailable."}
			}
			ownerKey = ownerSymbol.Key
		}
		proof := core.Proof(kind, symbol.Key, ownerKey)
		summary := EffectSummary{Unavailable: !proof.Known, Pure: proof.Known && proof.Effect == "none", VirtualSteps: proof.VirtualSteps, Reads: proof.Reads, ChargeKey: proof.ChargeKey, Reason: proof.Reason, EffectKind: proof.Effect}
		if proof.Known && proof.Effect != "none" {
			if kind == "escape" {
				summary.Reason = "VALUE_ESCAPE_UNSUPPORTED"
			} else {
				summary.Reason = "VALUE_MUTATION_UNSUPPORTED"
			}
			// A local write requires definite-assignment refinement; until supplied it
			// cannot certify an initializer-only value even when ownership is local.
		}
		return summary
	}
}

// DemandCallTargets reuses the same captured call authority and canonical cache.
func (core *NativeEffectCore) DemandCallTargets() func(string, *ast.Node) NativeEffectCall {
	return func(path string, node *ast.Node) NativeEffectCall {
		file, ok := core.sources[path]
		if !ok || core.invalidCapture || node == nil {
			return NativeEffectCall{}
		}
		return core.call(file, node)
	}
}

// Partition immutable admitted effect occurrences by canonical binding ONCE.
// A missing admission or unknown root is still a global negative-closure gap;
// it is never erased by the partition. Detailed alias/call facts remain lazy,
// and each bucket preserves the original candidate sequence and virtual costs.
// Symbol-relative Match authorities retain the original demand scan path.
func (core *NativeEffectCore) indexCanonicalCandidates() {
	if core.canonicalCandidatesIndexed {
		return
	}
	core.canonicalCandidatesIndexed = true
	core.canonicalCandidatesKnown = true
	core.canonicalCandidates = map[string][]effectCandidate{}
	for _, candidate := range core.candidates {
		if core.authority.CandidateAdmitted == nil {
			core.canonicalCandidatesKnown = false
			continue
		}
		admitted, known := core.authority.CandidateAdmitted(candidate.file, candidate.node, candidate.kind)
		if !known {
			core.canonicalCandidatesKnown = false
			continue
		}
		if !admitted {
			continue
		}
		root := core.symbol(candidate.file, candidate.root)
		if !root.Known {
			core.canonicalCandidatesKnown = false
			continue
		}
		core.canonicalCandidates[root.Key] = append(core.canonicalCandidates[root.Key], candidate)
	}
	// Only the immutable owner transfers storage; exploratory authorities retain
	// their original scan pool if a later demand supplies a Match callback.
	if core.immutableProofOwner && core.authority.Match == nil {
		core.candidates = nil
	}
}
