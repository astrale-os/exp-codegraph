package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"sort"
)

// Runtime inventory is a projection of the existing admitted body owner, never
// a second all-AST call scan. Canonical ordering is a capture-owned JS leaf.
func (owner *governanceRuntimeAuthority) Calls(paths []string) observabledecision.NativeCallInventory {
	out := observabledecision.NativeCallInventory{Known: owner.Identity.Complete, Complete: owner.Identity.Complete}
	if !out.Known {
		out.Reasons = []string{owner.Identity.Reason}
		return out
	}
	wanted := map[string]bool{}
	for _, path := range paths {
		wanted[path] = true
	}
	sourcePaths := []string{}
	for path := range wanted {
		if owner.Identity.OwnedProgramFiles[path] != nil {
			sourcePaths = append(sourcePaths, path)
		}
	}
	sort.Strings(sourcePaths) // Request the leaf with a deterministic input pool only.
	rank := map[string]int{}
	if len(sourcePaths) > 1 {
		project := governanceSharedProject(owner.Identity.Project)
		if project.LocaleOrder == nil {
			out.Known = false
			out.Reasons = []string{"Canonical call inventory ordering unavailable."}
			return out
		}
		order := project.LocaleOrder(sourcePaths)
		seen := map[int]bool{}
		for group, indices := range order.Groups {
			for _, index := range indices {
				if index < 0 || index >= len(sourcePaths) || seen[index] {
					out.Known = false
					return out
				}
				seen[index] = true
				rank[sourcePaths[index]] = group
			}
		}
		if !order.Known || len(seen) != len(sourcePaths) {
			out.Known = false
			out.Reasons = []string{"Canonical call inventory ordering pending."}
			return out
		}
	}
	for _, path := range sourcePaths {
		source := owner.Identity.OwnedProgramFiles[path]
		coordinates := indexSourceCoordinates(source.Text())
		walk(source.AsNode(), func(node *ast.Node) bool {
			if owner.Admitted[node] == "call" {
				id, ok := owner.Identity.Calls[node]
				if !ok {
					out.Known = false
					return true
				}
				start := scanner.SkipTrivia(source.Text(), node.Pos())
				callee := node.AsCallExpression().Expression
				if callee != nil && callee.Kind == ast.KindIdentifier {
					symbol := owner.Symbol(owner.ByPath[path], callee)
					if !symbol.Known {
						out.Known = false
					} else if symbol.Key == "" {
						callee = nil
						out.Complete = false
						if !containsString(out.Reasons, "A call site lacks its callee relation or logical source path.") {
							out.Reasons = append(out.Reasons, "A call site lacks its callee relation or logical source path.")
						}
					}
				}
				out.Sites = append(out.Sites, observabledecision.CapturedCall{Path: path, SubjectID: id, Node: node, Callee: callee, Start: coordinates.utf16(start), End: coordinates.utf16(node.End())})
			}
			return true
		})
		bodies := []*ast.Node{source.AsNode()}
		walkFile(source, func(node *ast.Node) bool {
			if owner.FunctionBodies[node] {
				bodies = append(bodies, node.Body())
			}
			return true
		})
		for _, body := range bodies {
			builder := &bodyBuilder{file: source, body: body, occurrence: map[*ast.Node]string{}, occurrenceIndex: map[string]int{}}
			walk(body, func(node *ast.Node) bool {
				builder.occurrence[node] = governanceRuntimeNodeKey(source, node)
				return true
			})
			flow := buildControlFlow(builder)
			for _, raw := range flow.completion.Reasons {
				reason, ok := raw.(map[string]any)
				if !ok {
					out.Known = false
					continue
				}
				code, _ := reason["code"].(string)
				switch code {
				case "CFG_EXPRESSION_BRANCH_PARTIAL", "CFG_SWITCH_PARTIAL", "CFG_TRY_PARTIAL", "CFG_LABEL_PARTIAL", "CFG_UNRESOLVED_CONTINUE", "CFG_UNRESOLVED_BREAK":
					continue
				}
				out.Complete = false
				out.Reasons = append(out.Reasons, fmt.Sprint(reason["message"]))
			}
		}
	}
	sort.SliceStable(out.Sites, func(i, j int) bool {
		a, b := out.Sites[i], out.Sites[j]
		if rank[a.Path] != rank[b.Path] {
			return rank[a.Path] < rank[b.Path]
		}
		if a.Start != b.Start {
			return a.Start < b.Start
		}
		return a.SubjectID < b.SubjectID
	})
	out.Reads = []observabledecision.SemanticRead{{Kind: "native-admitted-call-inventory", Fingerprint: owner.Identity.Project.capture.certificate()}}
	return out
}

func (owner *governanceRuntimeAuthority) DefinitionSubjects(paths []string) observabledecision.NativeDefinitionSubjects {
	result := sourcepolicy.RuntimeDefinitionSubjects(governanceSharedProject(owner.Identity.Project))
	wanted := map[string]bool{}
	for _, path := range paths {
		wanted[path] = true
	}
	filtered := result.Subjects[:0]
	for _, subject := range result.Subjects {
		if wanted[subject.Path] {
			filtered = append(filtered, subject)
		}
	}
	result.Subjects = filtered
	result.Reads = []observabledecision.SemanticRead{{Kind: "governed-authored-definition-subjects", Fingerprint: owner.Identity.Project.capture.certificate()}}
	return result
}
