package main

import (
	"path/filepath"
	"sort"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

type diagnosticProjectionFingerprint struct {
	all    string
	global string
}

// diagnosticFingerprint uses the exact portable diagnostic fields affected by
// a source closure. DiagnosticsForFiles also includes program/global findings,
// allowing the caller to distinguish an owner-local module update from a
// diagnostic that must be attached to every module.
func diagnosticFingerprint(
	program *driver.Program,
	files []*shimast.SourceFile,
) diagnosticProjectionFingerprint {
	sourceDigests := map[string]string{}
	for _, file := range files {
		sourceDigests[filepath.Clean(file.FileName())] = hashText(file.Text())
	}
	all := []map[string]any{}
	global := []map[string]any{}
	for _, diagnostic := range program.DiagnosticsForFiles(files) {
		record := map[string]any{
			"file": diagnostic.File, "line": diagnostic.Line, "column": diagnostic.Column,
			"code": diagnostic.Code, "message": diagnostic.Message, "severity": int(diagnostic.Severity),
		}
		if diagnostic.Start != nil {
			record["start"] = *diagnostic.Start
		}
		if diagnostic.Length != nil {
			record["length"] = *diagnostic.Length
		}
		if digest := sourceDigests[filepath.Clean(diagnostic.File)]; digest != "" {
			// Diagnostic facts carry the exact source revision as evidence even
			// when an edit occurs after the diagnostic and leaves its offset and
			// message unchanged.
			record["sourceText"] = digest
		}
		all = append(all, record)
		if diagnostic.File == "" {
			global = append(global, record)
		}
	}
	sortFingerprintRecords(all)
	sortFingerprintRecords(global)
	return diagnosticProjectionFingerprint{
		all: hashText(stableJSON(all)), global: hashText(stableJSON(global)),
	}
}

// moduleDependencyFingerprint covers every source-local input that can alter
// outbound/inbound dependency facts or computed-import issues without changing
// TypeScript's declaration shape. Exact syntax positions are retained because
// module facts expose line/column evidence.
func (a *analyzer) moduleDependencyFingerprint(
	program *driver.Program,
	files []*shimast.SourceFile,
) string {
	x := &extractor{root: a.root, checker: program.Checker, modules: a.modules}
	rows := []map[string]any{}
	ordered := append([]*shimast.SourceFile{}, files...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].FileName() < ordered[j].FileName() })
	for _, source := range ordered {
		references, unresolved := x.dependencyReferences(source)
		for _, reference := range references {
			target := ""
			if resolved := program.TSProgram.GetResolvedModuleFromModuleSpecifier(source, reference.node); resolved != nil && resolved.IsResolved() {
				target = filepath.Clean(resolved.ResolvedFileName)
				if canonical, err := filepath.EvalSymlinks(target); err == nil {
					target = canonical
				}
			}
			sourceOwner, targetOwner := "", ""
			if owner := x.moduleOwner(source.FileName()); owner != nil {
				sourceOwner = owner.ID
			}
			if owner := x.moduleOwner(target); owner != nil {
				targetOwner = owner.ID
			}
			rows = append(rows, map[string]any{
				"file": source.FileName(), "kind": reference.kind, "typeOnly": reference.typeOnly,
				"specifier": reference.specifier, "start": reference.node.Pos(), "end": reference.node.End(),
				"sourceOwner": sourceOwner, "target": target, "targetOwner": targetOwner,
			})
		}
		for _, reference := range unresolved {
			rows = append(rows, map[string]any{
				"file": source.FileName(), "kind": reference.kind, "unresolved": true,
				"start": reference.node.Pos(), "end": reference.node.End(),
			})
		}
	}
	sortFingerprintRecords(rows)
	return hashText(stableJSON(rows))
}

func sortFingerprintRecords(records []map[string]any) {
	sort.Slice(records, func(i, j int) bool {
		return stableJSON(records[i]) < stableJSON(records[j])
	})
}
