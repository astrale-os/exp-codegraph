package main

import "fmt"

// Plain expected compiler assertions cannot hold cache keys or invalidate a
// cache. Producers hand over owned maps; expected snapshots deep-copy them.
type governanceCompilerReadAssertions struct {
	barrierReads        map[string]compilerRawRead
	barrierObservations map[compilerInputKey]string
	certificateRows     []governanceObservation
	frozen              *governanceCompilerExpectationPlan
}

func (assertions *governanceCompilerReadAssertions) clone() *governanceCompilerReadAssertions {
	out := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
	for key, value := range assertions.barrierReads {
		out.barrierReads[key] = value
	}
	for key, value := range assertions.barrierObservations {
		out.barrierObservations[key] = value
	}
	return out
}
func compilerAssertionCertificateRows(reads map[string]compilerRawRead, observations map[compilerInputKey]string) []governanceObservation {
	rows := make([]governanceObservation, 0, len(reads)+len(observations))
	for path, value := range reads {
		rows = append(rows, governanceObservation{path, "expected-type-read", inputText(value.text, value.present)})
	}
	for key, value := range observations {
		rows = append(rows, governanceObservation{key.path, fmt.Sprintf("expected-type-guard:%d", key.kind), value})
	}
	return rows
}
func (assertions *governanceCompilerReadAssertions) certificateObservations() []governanceObservation {
	if assertions.certificateRows == nil {
		assertions.certificateRows = compilerAssertionCertificateRows(assertions.barrierReads, assertions.barrierObservations)
	}
	return assertions.certificateRows
}

// Only this disjoint form has a cache owner and a mutable current key set.
// A current capture may merge same-owner replay assertions into its lease.
// Once sealed, an expected snapshot extracts only immutable copied assertions.
type governanceTypeCacheLease struct {
	cache               *governanceTypeDemandCache
	cacheKeys           map[governanceTypeDemandKey]bool
	barrierReads        map[string]compilerRawRead
	barrierObservations map[compilerInputKey]string
	certificateRows     []governanceObservation
	snapshot            *governanceCompilerReadAssertions
}

func newGovernanceTypeCacheLease(owner *governanceTypeDemandCache, key governanceTypeDemandKey, assertions *governanceCompilerReadAssertions) *governanceTypeCacheLease {
	if owner == nil {
		panic("type cache lease requires a current cache owner")
	}
	copy := assertions.clone()
	return &governanceTypeCacheLease{cache: owner, cacheKeys: map[governanceTypeDemandKey]bool{key: true}, barrierReads: copy.barrierReads, barrierObservations: copy.barrierObservations}
}

// Replay additions are privately owned and transferred exactly once. Find the
// current owner before merging; never clone a whole map only to discard it.
func (capture *governanceCapture) acceptTypeReplay(cache *governanceTypeDemandCache, key governanceTypeDemandKey, additions *governanceCompilerReadAssertions) {
	var target *governanceTypeCacheLease
	for _, candidate := range capture.typeCacheLeases {
		if candidate.cache == cache && candidate.cacheKeys != nil {
			target = candidate
			break
		}
	}
	if target == nil {
		capture.typeCacheLeases = append(capture.typeCacheLeases, &governanceTypeCacheLease{cache: cache, cacheKeys: map[governanceTypeDemandKey]bool{key: true}, barrierReads: additions.barrierReads, barrierObservations: additions.barrierObservations})
		return
	}
	target.cacheKeys[key] = true
	for path, value := range additions.barrierReads {
		if before, seen := target.barrierReads[path]; !seen || before != value {
			if seen {
				capture.probeInconsistent = true
			}
			target.certificateRows, target.snapshot = nil, nil
		}
		target.barrierReads[path] = value
	}
	for input, value := range additions.barrierObservations {
		if before, seen := target.barrierObservations[input]; !seen || before != value {
			if seen {
				capture.probeInconsistent = true
			}
			target.certificateRows, target.snapshot = nil, nil
		}
		target.barrierObservations[input] = value
	}
}
func (lease *governanceTypeCacheLease) assertions() *governanceCompilerReadAssertions {
	if lease.snapshot == nil {
		lease.snapshot = (&governanceCompilerReadAssertions{barrierReads: lease.barrierReads, barrierObservations: lease.barrierObservations}).immutableSnapshot()
	}
	return lease.snapshot
}
func (lease *governanceTypeCacheLease) certificateObservations() []governanceObservation {
	if lease.certificateRows == nil {
		lease.certificateRows = compilerAssertionCertificateRows(lease.barrierReads, lease.barrierObservations)
	}
	return lease.certificateRows
}

func governanceUnionCompilerAssertions(parts []*governanceCompilerReadAssertions) (*governanceCompilerReadAssertions, bool) {
	merged := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
	for _, part := range parts {
		for key, value := range part.barrierReads {
			if before, exists := merged.barrierReads[key]; exists && before != value {
				return nil, false
			}
			merged.barrierReads[key] = value
		}
		for key, value := range part.barrierObservations {
			if before, exists := merged.barrierObservations[key]; exists && before != value {
				return nil, false
			}
			merged.barrierObservations[key] = value
		}
	}
	return merged, true
}
