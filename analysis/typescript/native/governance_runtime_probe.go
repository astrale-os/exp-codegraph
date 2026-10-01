package main

import "astrale-typespec-v2-native-analysis/observabledecision"

// Developer authority probe. Complete remains false until exact legacy call
// discovery/error inventory and final report products are qualified together.
func governanceProbeRuntime(project *governedProject) any {
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		return map[string]any{"complete": false, "reason": identity.Reason}
	}
	authority := governanceNewRuntimeAuthority(identity)
	context := authority.DemandContext(observabledecision.Limits{})
	queries := observabledecision.ObserveQueries(context)
	definitions := observabledecision.ObserveDefinitionIDs(context)
	calls := 0
	for _, kind := range authority.Admitted {
		if kind == "call" {
			calls++
		}
	}
	return map[string]any{"complete": false, "universe": identity.Universe, "ownedProgramFiles": len(identity.OwnedProgramFiles), "admittedBodyCalls": calls, "queries": queries, "definitions": definitions}
}
