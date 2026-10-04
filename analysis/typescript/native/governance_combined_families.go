package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	"strings"
	"time"
)

// Family evaluators share one captured AST/import/resolver project. A missing
// narrow authority is a migration residual; it cannot become an empty pass.
func governanceCombinedFamily(project *governedProject, rule string) (governanceOutcome, bool) {
	group := ""
	scope := ""
	var evaluate func(*sourcepolicy.Project) sourcepolicy.Result
	if _, ok := sourcepolicy.QueryMutationRevisions[rule]; ok && strings.HasPrefix(rule, "QRY-") {
		group = "queries"
		scope = "queries"
		evaluate = sourcepolicy.EvaluateQuerySource
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
		if item.File != nil {
			file = project.FilesByPath[item.File.Path]
		}
		e := governanceViolation(rule, file, item.Node, item.Evidence)
		e.Kind = item.Kind
		e.AmbiguityReason = item.AmbiguityReason
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
