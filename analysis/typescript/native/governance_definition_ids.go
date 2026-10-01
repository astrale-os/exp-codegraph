package main

import (
	"astrale-typespec-v2-native-analysis/authoredsource"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"regexp"
)

var governanceStableID = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`)

func governanceDefinitionIDs(project *governedProject) governanceOutcome {
	out := governanceOutcome{Rule: "QLT-DEF-IDS", Revision: "0c51a2194d039facdb5833a288b4ec2eadea94bbd0afb02bd1065994592c6c07", Status: "pass", Findings: []governanceEvidence{}}
	owners := map[string]*governedFile{}
	authored := map[*governedFile]*authoredsource.File{}
	for _, file := range project.Files {
		if file.Role == "production" && (file.Layer == "queries" || file.Layer == "mutations" || file.Layer == "migrations") {
			out.SubjectCount++
			authored[file] = file.authoring()
		}
	}
	definitions := []struct{ layer, name string }{{"queries", "defineCollectionQuery"}, {"queries", "defineQuery"}, {"queries", "defineCompositeQuery"}, {"mutations", "defineMutation"}, {"migrations", "defineMigration"}}
	emit := func(file *governedFile, node *ast.Node, kind, message string) {
		e := governanceViolation(out.Rule, file, node, message)
		e.Kind = kind
		out.Findings = append(out.Findings, e)
		if kind == "violation" {
			out.Status = "fail"
		} else if out.Status == "pass" {
			out.Status = "indeterminate"
		}
	}
	for _, definition := range definitions {
		for _, file := range project.Files {
			if file.Role != "production" || file.Layer != definition.layer {
				continue
			}
			for _, candidate := range authored[file].Definitions(definition.name, "", nil, 0) {
				if candidate.Origin == "ambiguous" {
					emit(file, candidate.Call, "ambiguity", fmt.Sprintf("%s definition resolves through a local facade whose ultimate public constructor origin is unknown.", definition.name))
					continue
				}
				if !authoredsource.IsTopLevelDefinition(candidate.Call) {
					continue
				}
				if candidate.Object == nil {
					emit(file, candidate.Call, "ambiguity", fmt.Sprintf("%s input is not a static object literal.", definition.name))
					continue
				}
				expression := authoredsource.PropertyExpression(candidate.Object, "id")
				node := expression
				if node == nil {
					node = candidate.Object
				}
				id := ""
				if expression != nil && (expression.Kind == ast.KindStringLiteral || expression.Kind == ast.KindNoSubstitutionTemplateLiteral) {
					id = expression.Text()
				}
				if id == "" || !governanceStableID.MatchString(id) {
					emit(file, node, "violation", fmt.Sprintf("%s ID must be a stable semantic literal.", definition.name))
					continue
				}
				key := definition.layer + "\000" + id
				if prior := owners[key]; prior != nil {
					emit(file, node, "violation", fmt.Sprintf("%s definition ID %s is duplicated; first declared in %s.", definition.layer, id, prior.Path))
				} else {
					owners[key] = file
				}
			}
		}
	}
	return out
}
