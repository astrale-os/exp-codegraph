package main

import (
	"astrale-typespec-v2-native-analysis/authoredsource"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
)

func init() {
	for id, revision := range sourcepolicy.Revisions {
		governanceRevisions[id] = revision
	}
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
