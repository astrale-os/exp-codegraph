package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
	"time"
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

// Original combined dispatch and full registered rule dispatcher are retained
// independently; only names/calls are redirected to the original test owners.
func governanceCombinedFamilyOriginal(project *governedProject, rule string) (governanceOutcome, bool) {
	group := ""
	scope := ""
	var evaluate func(*sourcepolicy.Project) sourcepolicy.Result
	if _, ok := sourcepolicy.SchemaRevisions[rule]; ok {
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
	out := governanceOutcome{Rule: rule, Revision: governanceRevisions[rule], Status: "pass", Findings: []governanceEvidence{}}
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

func governanceEvaluateOriginal(project *governedProject, rule string) (governanceOutcome, bool) {
	started := time.Now()
	defer func() { project.stats.phase("rule-dispatch-inclusive", started) }()
	project.stats.RuleEvaluations++
	if out, ok := governanceCombinedFamilyOriginal(project, rule); ok {
		return out, true
	}
	if rule == "ROOT-COMPOSE" {
		return governanceRootCompose(project), true
	}
	if rule == "ROOT-FACADE" {
		return governanceRootFacade(project), true
	}
	if rule == "DOM-PUBLIC-DEPS" {
		return governancePublicDependencies(project), true
	}
	if rule == "FNC-XDOM-DECLARED" || rule == "FNC-XDOM-REQ" {
		return governanceFunctionDependencies(project, rule), true
	}
	if rule == "DEP-ALLOWLIST" {
		return governanceDependencyAllowlist(project), true
	}
	if rule == "IMP-ALIAS-CFG" {
		return governanceAliasConfiguration(project), true
	}
	if rule == "QLT-TYPED-COORD" || rule == "QLT-CANON-VALUES" || rule == "NODE-INHERITED" {
		return governanceGlobalSyntax(project, rule), true
	}
	if rule == "QLT-DEF-IDS" {
		return governanceDefinitionIDs(project), true
	}
	if _, ok := sourcepolicy.Revisions[rule]; ok {
		return governanceSourceFamilyOriginal(project, rule), true
	}
	revision, ok := governanceRevisions[rule]
	if !ok {
		return governanceOutcome{}, false
	}
	out := governanceOutcome{Rule: rule, Revision: revision, Status: "pass", Findings: []governanceEvidence{}}
	if rule == "MOD-REQUIRED" {
		out.SubjectCount = 1
		for _, layer := range project.Policy.Layers {
			if layer.Required && !containsString(project.RootEntries, strings.TrimSuffix(layer.SourcePath, "/")) {
				out.Findings = append(out.Findings, governanceViolation(rule, nil, nil, fmt.Sprintf("Required layer %s is missing at %s.", layer.ID, layer.SourcePath)))
			}
		}
		for _, root := range project.Policy.RootFiles {
			if root.Required && !containsString(project.RootEntries, root.SourcePath) {
				out.Findings = append(out.Findings, governanceViolation(rule, nil, nil, fmt.Sprintf("Required root file %s is missing.", root.SourcePath)))
			}
		}
	} else {
		for _, file := range project.Files {
			if file.Role != "production" {
				continue
			}
			out.SubjectCount++
			switch rule {
			case "MOD-GOVERNED":
				governed := file.Layer != ""
				for _, root := range project.Policy.RootFiles {
					governed = governed || root.SourcePath == file.Path
				}
				if governed {
					continue
				}
				message := fmt.Sprintf("Production source %s is outside every declared layer and governed root. Move Domain source into a declared layer; exclude a directory that is not Domain source, such as mockups, with an \"ignore\" glob in astrale.lint.json.", file.Path)
				var anchor *ast.Node
				if file.Source.Statements != nil && len(file.Source.Statements.Nodes) > 0 {
					anchor = file.Source.Statements.Nodes[0]
				}
				out.Findings = append(out.Findings, governanceViolation(rule, file, anchor, message))
			case "TST-NO-PROD-IMP":
				for _, imp := range file.Imports {
					target := project.resolveProjectImport(file, imp.Specifier)
					if target != nil && target.Role != "production" {
						out.Findings = append(out.Findings, governanceViolation(rule, file, imp.Node, fmt.Sprintf("Production source %s imports test artifact %s.", file.Path, target.Path)))
					}
				}
			case "IMP-STATIC":
				out.Findings = append(out.Findings, governanceStaticEvidence(file)...)
			case "IMP-SDK-BOUNDARY":
				for _, imp := range file.Imports {
					s := imp.Specifier
					if s == "@astrale-os/kernel-core" || strings.HasPrefix(s, "@astrale-os/kernel-core/") || s == "@astrale-os/kernel-dsl" || strings.HasPrefix(s, "@astrale-os/kernel-dsl/") {
						out.Findings = append(out.Findings, governanceViolation(rule, file, imp.Node, fmt.Sprintf("Domain source imports %s directly; use the matching @astrale-os/sdk semantic subpath.", s)))
					}
				}
			}
		}
	}
	if len(out.Findings) > 0 {
		out.Status = "fail"
	}
	return out, true
}
