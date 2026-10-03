package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

func governanceProjectRuntimeProductsExceptReady(project *governedProject, identity *governanceRuntimeIdentity, runtimeProducts observabledecision.RuntimeProducts, ready map[string]governanceOutcome) any {
	queries := runtimeProducts.Queries
	definitions := runtimeProducts.Definitions
	shared := governanceSharedProject(project)
	queryResult := sourcepolicy.Result{}
	_, canonReady := ready["QRY-CANON"]
	_, singleReady := ready["QRY-SINGLE"]
	if !canonReady || !singleReady {
		queryResult = sourcepolicy.EvaluateRuntimeQueries(shared, sourcepolicy.RuntimeQueryInput{Product: queries, CompleteInventory: queries.InventoryKnown, CallIdentity: identity.CallIdentity})
	}
	definitionResult := sourcepolicy.Result{}
	if _, definitionReady := ready["QLT-DEF-IDS"]; !definitionReady {
		migration, known := governanceRuntimeMigrationIDs(project)
		definitionResult = sourcepolicy.EvaluateRuntimeDefinitionIDs(shared, sourcepolicy.RuntimeDefinitionInput{Product: definitions, Migration: migration, MigrationKnown: known, CompleteInventory: definitions.InventoryKnown, FormatLocation: func(file *sourcepolicy.File, node *ast.Node) (string, bool) {
			captured := project.FilesByPath[file.Path]
			if captured == nil || node == nil {
				return "", false
			}
			loc := governanceLocation(captured, node)
			return fmt.Sprintf("%s:%d:%d", loc.Path, loc.Line, loc.Column), true
		}})
	}
	return map[string]any{"complete": false, "decisions": governanceRuntimeProbeDecisions(project, queryResult, definitionResult), "universe": identity.Universe, "ownedProgramFiles": len(identity.OwnedProgramFiles), "queries": queries, "definitions": definitions}
}

func governanceRuntimeMigrationIDs(project *governedProject) (sourcepolicy.Result, bool) {
	narrowed := *project
	narrowed.Files = nil
	for _, file := range project.Files {
		if file.Layer == "migrations" {
			narrowed.Files = append(narrowed.Files, file)
		}
	}
	observed := governanceDefinitionIDs(&narrowed)
	out := sourcepolicy.Result{}
	shared := governanceSharedProject(project)
	for _, finding := range observed.Findings {
		if finding.Location == nil {
			return out, false
		}
		file := project.FilesByPath[finding.Location.Path]
		if file == nil {
			return out, false
		}
		var anchor *ast.Node
		walk(file.Source.AsNode(), func(node *ast.Node) bool {
			loc := governanceLocation(file, node)
			if loc.Offset == finding.Location.Offset && loc.Length == finding.Location.Length {
				anchor = node
			}
			return true
		})
		if anchor == nil {
			return out, false
		}
		out.Evidence = append(out.Evidence, sourcepolicy.Evidence{Rule: finding.Rule, Kind: finding.Kind, Evidence: finding.Evidence, File: shared.FilesByPath[file.Path], Node: anchor, AmbiguityReason: finding.AmbiguityReason})
	}
	return out, true
}
func governanceRuntimeProbeDecisions(project *governedProject, results ...sourcepolicy.Result) []governanceOutcome {
	out := []governanceOutcome{}
	for _, rule := range []string{"QRY-CANON", "QRY-SINGLE", "QLT-DEF-IDS"} {
		decision := governanceOutcome{Rule: rule, Status: "pass", Findings: []governanceEvidence{}}
		for _, result := range results {
			for _, item := range result.Evidence {
				if item.Rule == rule {
					var file *governedFile
					if item.File != nil {
						file = project.FilesByPath[item.File.Path]
					}
					evidence := governanceViolation(rule, file, item.Node, item.Evidence)
					evidence.Kind = item.Kind
					evidence.AmbiguityReason = item.AmbiguityReason
					decision.Findings = append(decision.Findings, evidence)
					if item.Kind == "violation" {
						decision.Status = "fail"
					} else if decision.Status == "pass" {
						decision.Status = "indeterminate"
					}
				}
			}
			for _, item := range result.Residual {
				if item.Rule == rule {
					decision.Status = "residual"
				}
			}
		}
		out = append(out, decision)
	}
	return out
}

// Resume semantic cells under the same private capture; ready public rule joins
// are also retained. Only joins waiting on canonical leaves are recomputed.
func (state *governanceProductsSession) resumeRuntimeProducts() (map[string]any, error) {
	if len(state.RuntimeReady) == 3 {
		return map[string]any{"decisions": []governanceOutcome{state.RuntimeReady["QRY-CANON"], state.RuntimeReady["QRY-SINGLE"], state.RuntimeReady["QLT-DEF-IDS"]}}, nil
	}
	if state.RuntimeGraph == nil {
		governanceSharedProject(state.Project)
		identity := governanceBuildRuntimeIdentity(state.Project)
		if !identity.Complete {
			return map[string]any{"reason": identity.Reason}, nil
		}
		state.RuntimeIdentity = identity
		authority := governanceNewRuntimeAuthority(identity)
		limits, err := state.runtimeProofLimits()
		if err != nil {
			return nil, err
		}
		state.RuntimeGraph = observabledecision.NewRuntimeDecisionGraph(authority.DemandContext(limits))
		state.RuntimeReady = map[string]governanceOutcome{}
	}
	if len(state.RuntimeReady) == 3 {
		return map[string]any{"decisions": []governanceOutcome{state.RuntimeReady["QRY-CANON"], state.RuntimeReady["QRY-SINGLE"], state.RuntimeReady["QLT-DEF-IDS"]}}, nil
	}
	result := governanceProjectRuntimeProductsExceptReady(state.Project, state.RuntimeIdentity, state.RuntimeGraph.Resume(), state.RuntimeReady).(map[string]any)
	outcomes := result["decisions"].([]governanceOutcome)
	for i, outcome := range outcomes {
		if ready, ok := state.RuntimeReady[outcome.Rule]; ok {
			outcomes[i] = ready
		} else if outcome.Status != "residual" {
			state.RuntimeReady[outcome.Rule] = outcome
		}
	}
	return result, nil
}
