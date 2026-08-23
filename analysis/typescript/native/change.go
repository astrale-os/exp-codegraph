package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimcompiler "github.com/microsoft/typescript-go/shim/compiler"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

func (a *analyzer) apply(changed []sourceChange) (refreshSelection, bool, error) {
	byPath := map[string]string{}
	for _, change := range changed {
		if existing, present := byPath[change.Path]; present && existing != change.Kind {
			return refreshSelection{}, false, protocolError("CHANGE_CONFLICT", "A changed path has conflicting transition kinds.")
		}
		byPath[change.Path] = change.Kind
	}
	paths := make([]string, 0, len(byPath))
	for path := range byPath {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		return refreshSelection{}, false, nil
	}
	if a.session.Program().HasLinkedProgramPlugins() {
		if err := a.rebuild(); err != nil {
			return refreshSelection{}, false, err
		}
		return refreshSelection{full: true}, true, nil
	}
	absolutePaths := make([]string, 0, len(paths))
	previousFiles := make([]*shimast.SourceFile, 0, len(paths))
	oldShapes := make(map[string]string, len(paths))
	full := false
	for _, path := range paths {
		absolute, err := a.absoluteChangedPath(path)
		if err != nil {
			return refreshSelection{}, false, err
		}
		if _, resident := a.session.SourceText(absolute); !resident {
			if byPath[path] == "change" {
				continue
			}
			if err := a.rebuild(); err != nil {
				return refreshSelection{}, false, err
			}
			return refreshSelection{full: true}, true, nil
		}
		source := a.session.Program().SourceFile(absolute)
		if source == nil || source.IsDeclarationFile || shimcompiler.FileAffectsGlobalScope(source) {
			full = true
		} else {
			shape, err := a.session.Program().DeclarationShapeDigest(source)
			if err != nil {
				return refreshSelection{}, false, err
			}
			oldShapes[absolute] = shape
		}
		absolutePaths = append(absolutePaths, absolute)
		previousFiles = append(previousFiles, source)
	}
	trackDiagnostics := a.projection.diagnostics || a.projection.modules
	previousDiagnostics := diagnosticProjectionFingerprint{}
	if trackDiagnostics && !full {
		previousDiagnostics = diagnosticFingerprint(a.session.Program(), previousFiles)
	}
	previousDependencies := ""
	if a.projection.modules && !full {
		previousDependencies = a.moduleDependencyFingerprint(a.session.Program(), previousFiles)
	}
	selected := make([]string, 0, len(absolutePaths))
	public := []string{}
	for _, absolute := range absolutePaths {
		content, err := os.ReadFile(absolute)
		if err != nil {
			if os.IsNotExist(err) {
				if err := a.rebuild(); err != nil {
					return refreshSelection{}, false, err
				}
				return refreshSelection{full: true}, true, nil
			}
			return refreshSelection{}, false, err
		}
		if reused := a.session.Apply(absolute, string(content)); !reused {
			full = true
		}
		updated := a.session.Program().SourceFile(absolute)
		if updated == nil {
			full = true
			continue
		}
		selected = append(selected, updated.FileName())
	}
	if full {
		return refreshSelection{full: true}, true, nil
	}
	updatedFiles := make([]*shimast.SourceFile, 0, len(absolutePaths))
	for _, absolute := range absolutePaths {
		updated := a.session.Program().SourceFile(absolute)
		if updated == nil || updated.IsDeclarationFile || shimcompiler.FileAffectsGlobalScope(updated) {
			return refreshSelection{full: true}, true, nil
		}
		shape, err := a.session.Program().DeclarationShapeDigest(updated)
		if err != nil {
			return refreshSelection{}, false, err
		}
		if shape != oldShapes[absolute] {
			public = append(public, updated.FileName())
		}
		updatedFiles = append(updatedFiles, updated)
	}
	if len(public) != 0 {
		selected = affectedSourceClosure(a.session.Program(), selected, public)
	}
	selection := refreshSelection{
		files:              sortedUnique(selected),
		allModules:         len(public) != 0,
		diagnosticsChanged: len(public) != 0,
	}
	if trackDiagnostics {
		current := diagnosticFingerprint(a.session.Program(), updatedFiles)
		selection.diagnosticsChanged = selection.diagnosticsChanged || current.all != previousDiagnostics.all
		if current.global != previousDiagnostics.global {
			selection.allModules = true
		}
	}
	if a.projection.modules && a.moduleDependencyFingerprint(a.session.Program(), updatedFiles) != previousDependencies {
		selection.allModules = true
	}
	return selection, len(absolutePaths) != 0, nil
}

func admittedSourceChanges(input request) ([]sourceChange, error) {
	changes := append([]sourceChange{}, input.Changes...)
	if len(changes) == 0 {
		for _, path := range input.Changed {
			changes = append(changes, sourceChange{Path: path, Kind: "unknown"})
		}
	}
	for _, change := range changes {
		if change.Path == "" {
			return nil, protocolError("PATH_INVALID", "A changed path is empty.")
		}
		switch change.Kind {
		case "change", "add", "unlink", "unknown":
		default:
			return nil, protocolError("CHANGE_KIND_INVALID", "A changed path has an unsupported transition kind.")
		}
	}
	return changes, nil
}

func affectedSourceClosure(program *driver.Program, changed, public []string) []string {
	reverse := map[string][]string{}
	physicalByCanonical := map[string]string{}
	for _, source := range program.SourceFiles() {
		physicalByCanonical[string(source.Path())] = filepath.Clean(source.FileName())
	}
	for _, source := range program.SourceFiles() {
		owner := filepath.Clean(source.FileName())
		for _, referenced := range shimcompiler.GetReferencedFilePaths(program.TSProgram, source) {
			if target := physicalByCanonical[referenced]; target != "" {
				reverse[target] = append(reverse[target], owner)
			}
		}
	}
	selected := map[string]bool{}
	for _, path := range changed {
		selected[filepath.Clean(path)] = true
	}
	queue := sortedUnique(append([]string{}, public...))
	for len(queue) != 0 {
		path := filepath.Clean(queue[0])
		queue = queue[1:]
		selected[path] = true
		for _, dependent := range reverse[path] {
			if !selected[dependent] {
				selected[dependent] = true
				queue = append(queue, dependent)
			}
		}
	}
	result := make([]string, 0, len(selected))
	for path := range selected {
		result = append(result, path)
	}
	sort.Strings(result)
	return result
}

func (a *analyzer) absoluteChangedPath(path string) (string, error) {
	if strings.IndexByte(path, 0) >= 0 {
		return "", protocolError("PATH_INVALID", "A changed path contains NUL.")
	}
	absolute := path
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Join(a.root, filepath.FromSlash(path))
	}
	absolute = filepath.Clean(absolute)
	relative, err := filepath.Rel(a.root, absolute)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", protocolError("PATH_OUTSIDE_ROOT", "A changed path escapes the project root.")
	}
	return absolute, nil
}
