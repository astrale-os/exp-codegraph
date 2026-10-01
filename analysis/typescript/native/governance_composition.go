package main

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"regexp"
	"strings"
)

var governanceFacadeIndex = regexp.MustCompile(`/index\.[cm]?[jt]sx?$`)

func governanceCompositionPackage(s string) bool {
	for _, root := range []string{"@astrale-os/sdk", "@astrale-os/kernel-core", "@astrale-os/kernel-dsl"} {
		if s == root || strings.HasPrefix(s, root+"/") {
			return true
		}
	}
	return false
}
func governanceRootCompose(project *governedProject) governanceOutcome {
	rule := "ROOT-COMPOSE"
	out := governanceOutcome{Rule: rule, Revision: governanceRevisions[rule], Status: "pass", Findings: []governanceEvidence{}}
	edges := []governanceDependencyEdge{}
	if json.Unmarshal(project.Policy.Dependencies, &edges) != nil {
		out.Status = "residual"
		project.familyResidual = append(project.familyResidual, rule+": canonical dependency policy unavailable")
		return out
	}
	appendEvidence := func(e governanceEvidence) {
		out.Findings = append(out.Findings, e)
		if e.Kind == "violation" {
			out.Status = "fail"
		} else if out.Status == "pass" {
			out.Status = "indeterminate"
		}
	}
	emit := func(file *governedFile, node *ast.Node, kind, message string) {
		e := governanceViolation(rule, file, node, message)
		e.Kind = kind
		appendEvidence(e)
	}
	composition := map[string]bool{}
	rootIDs := map[string]string{}
	for _, root := range project.Policy.RootFiles {
		rootIDs[root.SourcePath] = root.ID
		if root.Role == "composition" {
			composition[root.SourcePath] = true
		}
	}
	for _, file := range project.Files {
		if file.Role == "production" {
			out.SubjectCount++
		}
	}
	for _, root := range project.Policy.RootFiles {
		if root.Role != "composition" {
			continue
		}
		file := project.FilesByPath[root.SourcePath]
		if file == nil || file.Role != "production" {
			continue
		}
		for _, imp := range file.Imports {
			target := project.resolveProjectImport(file, imp.Specifier)
			kind := "composition"
			if imp.TypeOnly {
				kind = "type-only"
			}
			supported := false
			if target != nil && target.Layer != "" {
				for _, edge := range edges {
					if edge.Source == root.ID && edge.Target == target.Layer && (edge.Kind == kind || kind == "type-only" && edge.Kind == "composition") {
						supported = true
						break
					}
				}
			}
			if target != nil && target.Layer == "integrations" && !imp.TypeOnly {
				for _, e := range governanceIntegrationCompositionEvidence(project, target, imp) {
					appendEvidence(e)
				}
			}
			if target != nil && target.Layer != "" && !supported {
				emit(file, imp.Node, "violation", fmt.Sprintf("Composition root %s imports %s without a permitted %s edge.", root.SourcePath, target.Layer, kind))
			} else if target == nil && !governanceCompositionPackage(imp.Specifier) {
				emit(file, imp.Node, "violation", fmt.Sprintf("Composition root %s imports provider or unsupported package %s.", root.SourcePath, imp.Specifier))
			}
		}
		for _, stmt := range file.Source.Statements.Nodes {
			if !governanceCompositionStatement(project, file, stmt) {
				emit(file, stmt, "violation", fmt.Sprintf("%s contains behavior outside static Domain composition.", root.SourcePath))
			}
		}
	}
	var packageRoot *governanceRoot
	for i := range project.Policy.RootFiles {
		if project.Policy.RootFiles[i].Role == "package-facade" {
			packageRoot = &project.Policy.RootFiles[i]
			break
		}
	}
	if packageRoot == nil {
		return out
	}
	entry := project.FilesByPath[packageRoot.SourcePath]
	if entry == nil || entry.Role != "production" {
		return out
	}
	erased := governanceErasedExports(project, entry)
	targets := map[string]bool{}
	for _, edge := range edges {
		if edge.Source == packageRoot.ID {
			targets[edge.Target] = true
		}
	}
	supported := func(target *governedFile) bool {
		if target == nil {
			return false
		}
		id, hasID := rootIDs[target.Path]
		return composition[target.Path] && hasID && targets[id] || target.Layer != "" && targets[target.Layer] && target.Submodule == "" && governanceFacadeIndex.MatchString(target.Path)
	}
	for _, stmt := range entry.Source.Statements.Nodes {
		switch stmt.Kind {
		case ast.KindEmptyStatement, ast.KindInterfaceDeclaration, ast.KindTypeAliasDeclaration:
			continue
		case ast.KindImportDeclaration:
			erasedImport := false
			for _, imp := range entry.Imports {
				erasedImport = erasedImport || imp.Node == stmt && imp.TypeOnly
			}
			if erasedImport {
				continue
			}
		case ast.KindExportDeclaration:
			e := stmt.AsExportDeclaration()
			erasedImport := false
			for _, imp := range entry.Imports {
				erasedImport = erasedImport || imp.Node == stmt && imp.TypeOnly
			}
			if e.IsTypeOnly || erasedImport {
				continue
			}
			if e.ModuleSpecifier != nil && e.ModuleSpecifier.Kind == ast.KindStringLiteral {
				specifier := e.ModuleSpecifier.Text()
				target := project.resolveProjectImport(entry, specifier)
				if !supported(target) {
					if target != nil {
						emit(entry, stmt, "violation", fmt.Sprintf("Package index.ts bypasses supported facade with %s.", target.Path))
					} else {
						emit(entry, stmt, "ambiguity", fmt.Sprintf("Package export %s cannot be resolved to a supported journey.", specifier))
					}
				}
			} else if e.ExportClause != nil && e.ExportClause.Kind == ast.KindNamedExports {
				for _, node := range e.ExportClause.AsNamedExports().Elements.Nodes {
					x := node.AsExportSpecifier()
					local := x.Name().Text()
					if x.PropertyName != nil {
						local = x.PropertyName.Text()
					}
					if x.IsTypeOnly || erased[local] {
						continue
					}
					imp := governanceImportForLocal(entry, local)
					if imp == nil {
						emit(entry, node, "ambiguity", fmt.Sprintf("Package export %s has no statically resolved import owner.", x.Name().Text()))
						continue
					}
					if governanceTypeOnlyBinding(imp, local) {
						if project.verbatim {
							emit(entry, node, "ambiguity", fmt.Sprintf("Export %s retains a runtime binding from a type-only import; use export type.", x.Name().Text()))
						}
						continue
					}
					target := project.resolveProjectImport(entry, imp.Specifier)
					if !supported(target) {
						if target != nil {
							emit(entry, node, "violation", fmt.Sprintf("Package index.ts bypasses supported facade with %s.", target.Path))
						} else {
							emit(entry, node, "ambiguity", fmt.Sprintf("Package import %s cannot be resolved to a supported journey.", imp.Specifier))
						}
					}
				}
			}
			continue
		}
		emit(entry, stmt, "violation", fmt.Sprintf("Package facade %s contains an unsupported declaration or recursive composition.", packageRoot.SourcePath))
	}
	return out
}

// Force an explicit dependency on the common source authoring owner; composition
// factory identity must never be upgraded through stronger runtime provenance.
var _ = authored.SDKModules
