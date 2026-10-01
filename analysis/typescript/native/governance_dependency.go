package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"encoding/json"
	"fmt"
	"strings"
)

type governanceDependencyEdge struct{ Source, Target, Kind, Condition string }

func governanceDependencyAllowlist(project *governedProject) governanceOutcome {
	rule := "DEP-ALLOWLIST"
	out := governanceOutcome{Rule: rule, Revision: governanceRevisions[rule], Status: "pass", Findings: []governanceEvidence{}}
	shared := governanceSharedProject(project)
	edges := []governanceDependencyEdge{}
	if err := json.Unmarshal(project.Policy.Dependencies, &edges); err != nil {
		out.Status = "residual"
		project.familyResidual = append(project.familyResidual, rule+": canonical dependency policy is unavailable")
		return out
	}
	appendFinding := func(e governanceEvidence) {
		out.Findings = append(out.Findings, e)
		if e.Kind == "violation" {
			out.Status = "fail"
		} else if out.Status == "pass" {
			out.Status = "indeterminate"
		}
	}
	for _, file := range project.Files {
		if file.Role != "production" {
			continue
		}
		out.SubjectCount++
		owner := shared.FilesByPath[file.Path]
		for _, imp := range file.Imports {
			boundary, known := sourcepolicy.DependencyBoundary(shared, owner, sourcepolicy.Import{Specifier: imp.Specifier, TypeOnly: imp.TypeOnly, Node: imp.Node})
			if !known {
				out.Status = "residual"
				project.familyResidual = append(project.familyResidual, rule+": unresolved capture authority")
				continue
			}
			if boundary == "erased" || boundary == "pure-schema" {
				continue
			}
			target := project.resolveProjectImport(file, imp.Specifier)
			if file.Layer == "" || target == nil || target.Layer == "" || file.Layer == target.Layer {
				continue
			}
			if boundary == "ambiguous" {
				e := governanceViolation(rule, file, imp.Node, fmt.Sprintf("Import %s has an unproved Schema initialization boundary.", imp.Specifier))
				e.Kind = "ambiguity"
				appendFinding(e)
				continue
			}
			kind := "runtime"
			if file.Path == "implementation.ts" {
				kind = "composition"
			}
			admitted := false
			for _, edge := range edges {
				if edge.Source == file.Layer && edge.Target == target.Layer && edge.Kind == kind {
					admitted = true
					break
				}
			}
			if admitted {
				continue
			}
			appendFinding(governanceViolation(rule, file, imp.Node, fmt.Sprintf("Import %s creates absent %s -> %s (%s) edge. %s", imp.Specifier, file.Layer, target.Layer, kind, governanceAdmittedDependencies(edges, file.Layer, target.Layer))))
		}
	}
	return out
}
func governanceAdmittedDependencies(edges []governanceDependencyEdge, source, target string) string {
	admitted := []governanceDependencyEdge{}
	kinds := []string{}
	for _, edge := range edges {
		if edge.Source != source {
			continue
		}
		admitted = append(admitted, edge)
		if edge.Target == target {
			kinds = append(kinds, fmt.Sprintf("%s (%s)", edge.Kind, edge.Condition))
		}
	}
	if len(kinds) > 0 {
		return fmt.Sprintf("Admitted %s -> %s kinds: %s.", source, target, strings.Join(kinds, ", "))
	}
	if len(admitted) == 0 {
		return fmt.Sprintf("No %s dependency is admitted.", source)
	}
	targets := []string{}
	for _, edge := range admitted {
		targets = append(targets, fmt.Sprintf("%s (%s)", edge.Target, edge.Kind))
	}
	return fmt.Sprintf("Admitted %s targets: %s.", source, strings.Join(targets, ", "))
}
func governanceFunctionDependencies(project *governedProject, rule string) governanceOutcome {
	shared := governanceSharedProject(project)
	result := sourcepolicy.EvaluateDependencies(shared, rule)
	out := governanceOutcome{Rule: rule, Revision: governanceRevisions[rule], Status: "pass", Findings: []governanceEvidence{}}
	for _, file := range project.Files {
		if file.Role == "production" && file.Layer == "functions" {
			out.SubjectCount++
		}
	}
	for _, evidence := range result.Evidence {
		e := governanceViolation(rule, project.FilesByPath[evidence.File.Path], evidence.Node, evidence.Evidence)
		e.Kind = evidence.Kind
		out.Findings = append(out.Findings, e)
		if e.Kind == "violation" {
			out.Status = "fail"
		} else if out.Status == "pass" {
			out.Status = "indeterminate"
		}
	}
	for _, residual := range result.Residual {
		out.Status = "residual"
		project.familyResidual = append(project.familyResidual, rule+": "+residual.Reason)
	}
	return out
}
