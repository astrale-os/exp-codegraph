package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

// Frozen original adapter/evaluator: an independent per-rule oracle.
func governanceSourceFamilyOriginal(project *governedProject, rule string) governanceOutcome {
	files := []*sourcepolicy.File{}
	sourceOwner := map[*sourcepolicy.File]*governedFile{}
	familyOwner := map[*governedFile]*sourcepolicy.File{}
	for _, file := range project.Files {
		f := &sourcepolicy.File{Path: file.Path, Role: file.Role, Layer: file.Layer, Source: file.Source, Submodule: file.Submodule}
		for _, imp := range file.Imports {
			row := sourcepolicy.Import{Specifier: imp.Specifier, TypeOnly: imp.TypeOnly, Node: imp.Node, Namespace: imp.Namespace, Dynamic: imp.Dynamic}
			for _, binding := range imp.Bindings {
				row.Bindings = append(row.Bindings, sourcepolicy.Binding{Imported: binding.Imported, Local: binding.Local})
			}
			f.Imports = append(f.Imports, row)
		}
		files = append(files, f)
		sourceOwner[f] = file
		familyOwner[file] = f
	}
	result := sourcepolicy.Evaluate(files, sourcepolicy.Authority{Resolve: func(file *sourcepolicy.File, imp sourcepolicy.Import) sourcepolicy.Resolution {
		return sourcepolicy.Resolution{Known: true, Target: familyOwner[project.resolveProjectImport(sourceOwner[file], imp.Specifier)]}
	}, LocallyBound: func(identifier *ast.Node) bool { return governanceLocallyOwned(identifier, true) }})
	out := governanceOutcome{Rule: rule, Revision: sourcepolicy.Revisions[rule], Status: "pass", Findings: []governanceEvidence{}}
	for _, file := range project.Files {
		scope := ""
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
		if file.Role == "production" && file.Layer == scope {
			out.SubjectCount++
		}
	}
	for _, evidence := range result.Evidence {
		if evidence.Rule != rule {
			continue
		}
		e := governanceViolation(rule, sourceOwner[evidence.File], evidence.Node, evidence.Evidence)
		e.Kind = evidence.Kind
		out.Findings = append(out.Findings, e)
		if e.Kind == "violation" {
			out.Status = "fail"
		} else if out.Status == "pass" {
			out.Status = "indeterminate"
		}
	}
	for _, residual := range result.Residual {
		if residual.Rule == rule {
			out.Status = "residual"
			project.familyResidual = append(project.familyResidual, fmt.Sprintf("%s: %s", rule, residual.Reason))
		}
	}
	return out
}
