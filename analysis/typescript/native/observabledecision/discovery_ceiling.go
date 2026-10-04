package observabledecision

import "time"
import ast "github.com/microsoft/typescript-go/shim/ast"

// This consumer product does not replace any full reader/effect proof. Unknown
// certificates fall back to original discovery, including error and budget order.
type ConstructorExclusion struct {
	Known, Excluded bool
	MaximumSteps    int
}

// Parameter classification must overapproximate every canonical selected
// signature parameter that has a bucket in this captured effect universe.
// Empty/synthetic and outside-universe parameters are terminal vertices.
// This factory owns one immutable callback scope; cells cannot be shared across
// captures or a different parameter classifier. Base closure is built once.
func (core *NativeEffectCore) NewDiscoveryAliasCeiling(parameterRoot func(CapturedFile, *ast.Node) (bool, bool), certify func(CapturedFile, *ast.Node, string) bool) func(string) (int, bool) {
	ready, known := false, false
	base := map[string]bool{}
	baseCeiling := 0
	cache := map[string]int{}
	walk := func(pending []string, seen map[string]bool, isBase bool) (int, bool) {
		ceiling := 0
		for len(pending) > 0 {
			key := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			if seen[key] || (!isBase && base[key]) {
				continue
			}
			seen[key] = true
			for _, candidate := range core.canonicalCandidates[key] {
				if !certify(candidate.file, candidate.node, candidate.kind) {
					return 0, false
				}
				switch candidate.kind {
				case "alias":
					alias := core.symbol(candidate.file, candidate.name)
					if !alias.Known {
						return 0, false
					}
					if alias.Key != "" {
						ceiling++
						pending = append(pending, alias.Key)
					}
				case "call":
					ceiling++
				case "mutation", "delete":
					if owner := effectFunctionOwner(candidate.node); owner != nil && !core.symbol(candidate.file, owner).Known {
						return 0, false
					}
					if candidate.kind == "delete" {
						if core.authority.DeleteAdmitted == nil {
							return 0, false
						}
						_, complete := core.authority.DeleteAdmitted(candidate.file, candidate.node)
						if !complete {
							return 0, false
						}
					}
				}
			}
		}
		return ceiling, true
	}
	return func(symbol string) (int, bool) {
		if !ready {
			started := time.Now()
			defer func() {
				DiagnosticEvent("ceiling-base-init", "", nil, map[string]any{"elapsedNanoseconds": time.Since(started).Nanoseconds(), "baseEdges": baseCeiling, "known": known})
			}()
			ready = true
			if core.invalidCapture || !core.authority.MembershipComplete || core.authority.Match != nil || parameterRoot == nil || certify == nil {
				return 0, false
			}
			core.indexCanonicalCandidates()
			if !core.canonicalCandidatesKnown {
				return 0, false
			}
			pending := []string{}
			for key, candidates := range core.canonicalCandidates {
				for _, candidate := range candidates {
					possible, complete := parameterRoot(candidate.file, candidate.root)
					if !complete {
						return 0, false
					}
					if possible {
						pending = append(pending, key)
						break
					}
				}
			}
			baseCeiling, known = walk(pending, base, true)
		}
		if !known {
			return 0, false
		}
		if ceiling, exists := cache[symbol]; exists {
			return ceiling, true
		}
		extra, complete := walk([]string{symbol}, map[string]bool{}, false)
		if !complete {
			return 0, false
		}
		ceiling := baseCeiling + extra
		cache[symbol] = ceiling
		return ceiling, true
	}
}
