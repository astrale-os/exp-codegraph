package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
	"time"
)

// Family evaluators share one captured AST/import/resolver project. A missing
// narrow authority is a migration residual; it cannot become an empty pass.
func governanceCombinedFamily(project *governedProject, rule string) (governanceOutcome, bool) {
	group := ""
	scope := ""
	var evaluate func(*sourcepolicy.Project) sourcepolicy.Result
	if _, ok := sourcepolicy.Revisions[rule]; ok {
		group = "basic"
		switch rule {
		case "RUL-SYNC", "RUL-PURE":
			scope = "rules"
		case "INT-PURE":
			scope = "integrations"
		case "UI-NO-DOMAIN":
			scope = "ui"
		case "UTL-PUBLIC-DEPS":
			scope = "utils"
		}
		evaluate = func(shared *sourcepolicy.Project) sourcepolicy.Result {
			return sourcepolicy.Evaluate(shared.Files, sourcepolicy.Authority{Resolve: shared.Resolve,
				LocallyBound: func(identifier *ast.Node) bool { return governanceLocallyOwned(identifier, true) }})
		}
	} else if _, ok := sourcepolicy.SchemaRevisions[rule]; ok {
		group = "schema"
		scope = "schema"
		evaluate = sourcepolicy.EvaluateSchema
	} else if rule == "SCH-STATE-SOURCE" {
		group = "schema-state"
		scope = "schema"
		evaluate = sourcepolicy.EvaluateSchemaState
	} else if _, ok := sourcepolicy.StateRevisions[rule]; ok {
		group = "states"
		scope = "schema"
		evaluate = sourcepolicy.EvaluateStates
	} else if _, ok := sourcepolicy.QueryMutationRevisions[rule]; ok {
		if strings.HasPrefix(rule, "QRY-") {
			group = "queries"
			scope = "queries"
			evaluate = sourcepolicy.EvaluateQuerySource
		} else {
			group = "mutations"
			scope = "mutations"
			evaluate = sourcepolicy.EvaluateMutationSource
		}
	} else if _, ok := sourcepolicy.FamilyRevisions[rule]; ok {
		switch {
		case rule == "FNC-INT-TYPES" || rule == "FNC-STEP-IDS" || rule == "FNC-NO-NEST":
			group = "workflows"
			scope = "functions"
			evaluate = sourcepolicy.EvaluateWorkflows
		case rule == "FNC-ONE-IMPL":
			group = "actions"
			scope = "functions"
			evaluate = sourcepolicy.EvaluateActions
		case strings.HasPrefix(rule, "PRV-"):
			group = "providers"
			scope = "providers"
			evaluate = sourcepolicy.EvaluateProviders
		case strings.HasPrefix(rule, "MIG-"):
			group = "migrations"
			scope = "migrations"
			evaluate = sourcepolicy.EvaluateMigrations
		case strings.HasPrefix(rule, "VIW-"):
			group = "views"
			scope = "ui"
			evaluate = sourcepolicy.EvaluateViews
		}
	}
	if evaluate == nil {
		return governanceOutcome{}, false
	}
	if project.familyProducts == nil {
		project.familyProducts = map[string]sourcepolicy.Result{}
	}
	result, ok := project.familyProducts[group]
	if !ok {
		started := time.Now()
		if state := project.sourceProofState; state != nil {
			prior := state.ActiveFamily
			state.ActiveFamily = group
			result = evaluate(governanceSharedProject(project))
			state.ActiveFamily = prior
		} else {
			result = evaluate(governanceSharedProject(project))
		}
		project.stats.FamilyEvaluations++
		project.stats.phase("family:"+group+":inclusive", started)
		project.familyProducts[group] = result
	}
	if state := project.sourceProofState; state != nil && len(state.FamilyMissing[group]) > 0 {
		state.RulePending = true
	}
	revision := governanceRevisions[rule]
	if group == "basic" {
		revision = sourcepolicy.Revisions[rule]
	}
	out := governanceOutcome{Rule: rule, Revision: revision, Status: "pass", Findings: []governanceEvidence{}}
	for _, file := range project.Files {
		if file.Role == "production" && file.Layer == scope {
			out.SubjectCount++
		}
	}
	for _, item := range result.Evidence {
		if item.Rule != rule {
			continue
		}
		var file *governedFile
		if group == "basic" {
			file = project.sharedFileOwners[item.File]
		} else if item.File != nil {
			file = project.FilesByPath[item.File.Path]
		}
		e := governanceViolation(rule, file, item.Node, item.Evidence)
		e.Kind = item.Kind
		if group != "basic" {
			e.AmbiguityReason = item.AmbiguityReason
		}
		out.Findings = append(out.Findings, e)
		if e.Kind == "violation" {
			out.Status = "fail"
		} else if out.Status == "pass" {
			out.Status = "indeterminate"
		}
	}
	for _, item := range result.Residual {
		if item.Rule == rule {
			out.Status = "residual"
			project.familyResidual = append(project.familyResidual, fmt.Sprintf("%s: %s", rule, item.Reason))
		}
	}
	return out, true
}
func init() {
	for _, revisions := range []map[string]string{sourcepolicy.SchemaRevisions, sourcepolicy.StateRevisions, sourcepolicy.QueryMutationRevisions, sourcepolicy.FamilyRevisions} {
		for id, revision := range revisions {
			governanceRevisions[id] = revision
		}
	}
	governanceRevisions["SCH-STATE-SOURCE"] = sourcepolicy.SchemaStateRevision
}
