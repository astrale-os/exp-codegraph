package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

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
	runtimeProducts := observabledecision.ObserveRuntime(context)
	queries := runtimeProducts.Queries
	definitions := runtimeProducts.Definitions
	calls := 0
	for _, kind := range authority.Admitted {
		if kind == "call" {
			calls++
		}
	}
	shared := governanceSharedProject(project)
	queryResult := sourcepolicy.EvaluateRuntimeQueries(shared, sourcepolicy.RuntimeQueryInput{Product: queries, CompleteInventory: queries.InventoryKnown, CallIdentity: func(file *sourcepolicy.File, node *ast.Node) (string, bool) {
		captured, ok := authority.ByPath[file.Path]
		if !ok {
			return "", false
		}
		input := captured
		input.Source = file.Source
		matched, known := authority.node(input, node)
		if !known || authority.Admitted[matched] != "call" {
			return "", false
		}
		return identity.CallIdentity(file, node)
	}})
	migration, known := governanceRuntimeMigrationIDs(project)
	definitionResult := sourcepolicy.EvaluateRuntimeDefinitionIDs(shared, sourcepolicy.RuntimeDefinitionInput{Product: definitions, Migration: migration, MigrationKnown: known, CompleteInventory: definitions.InventoryKnown, FormatLocation: func(file *sourcepolicy.File, node *ast.Node) (string, bool) {
		captured := project.FilesByPath[file.Path]
		if captured == nil || node == nil {
			return "", false
		}
		loc := governanceLocation(captured, node)
		return fmt.Sprintf("%s:%d:%d", loc.Path, loc.Line, loc.Column), true
	}})
	return map[string]any{"complete": false, "decisions": governanceRuntimeProbeDecisions(project, queryResult, definitionResult), "universe": identity.Universe, "ownedProgramFiles": len(identity.OwnedProgramFiles), "admittedBodyCalls": calls, "queries": queries, "definitions": definitions}
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
