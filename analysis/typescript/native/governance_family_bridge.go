package main

import (
	"astrale-typespec-v2-native-analysis/authoredsource"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

func init() {
	for id, revision := range sourcepolicy.Revisions {
		governanceRevisions[id] = revision
	}
}
func governanceSourceFamily(project *governedProject, rule string) governanceOutcome {
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

// Shared captured project adapter for all source families. Narrow canonical
// Kernel/checker predicates remain unavailable until their authority is supplied.
func governanceSharedProject(project *governedProject) *sourcepolicy.Project {
	if project.sharedProject != nil {
		return project.sharedProject
	}
	out := &sourcepolicy.Project{FilesByPath: map[string]*sourcepolicy.File{}, LayerSourcePaths: map[string]string{}, CompositionPaths: map[string]bool{}}
	owners := map[*sourcepolicy.File]*governedFile{}
	families := map[*governedFile]*sourcepolicy.File{}
	for _, file := range project.Files {
		f := &sourcepolicy.File{Path: file.Path, Role: file.Role, Layer: file.Layer, Submodule: file.Submodule, Source: file.Source}
		for _, imp := range file.Imports {
			row := sourcepolicy.Import{Specifier: imp.Specifier, TypeOnly: imp.TypeOnly, Dynamic: imp.Dynamic, Namespace: imp.Namespace, Node: imp.Node}
			for _, binding := range imp.Bindings {
				row.Bindings = append(row.Bindings, sourcepolicy.Binding{Imported: binding.Imported, Local: binding.Local})
			}
			f.Imports = append(f.Imports, row)
		}
		out.Files = append(out.Files, f)
		out.FilesByPath[f.Path] = f
		owners[f] = file
		families[file] = f
	}
	for _, layer := range project.Policy.Layers {
		out.LayerSourcePaths[layer.ID] = layer.SourcePath
	}
	for _, root := range project.Policy.RootFiles {
		if root.Role == "composition" {
			out.CompositionPaths[root.SourcePath] = true
		}
		if root.ID == "application" {
			out.ApplicationPath = root.SourcePath
		}
	}
	out.Resolve = func(file *sourcepolicy.File, imp sourcepolicy.Import) sourcepolicy.Resolution {
		return sourcepolicy.Resolution{Known: true, Target: families[project.resolveProjectImport(owners[file], imp.Specifier)]}
	}
	out.Authoring = func(file *sourcepolicy.File) *authoredsource.File { return owners[file].authoring() }
	governanceInstallTypeAuthority(project, out)
	project.sharedProject = out
	return out
}
