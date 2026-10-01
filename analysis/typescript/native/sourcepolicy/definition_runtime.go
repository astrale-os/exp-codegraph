package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	runtime "astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"sort"
	"strings"
	"unicode/utf16"
)

type RuntimeDefinitionInput struct {
	Product           runtime.DefinitionProduct
	Migration         Result
	MigrationKnown    bool
	CompleteInventory bool
	// FormatLocation is the ONE service-owned canonical location projection.
	FormatLocation func(*File, *ast.Node) (string, bool)
}

func qmTopLevel(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLike(n) {
			return false
		}
		if n.Kind == ast.KindSourceFile {
			return true
		}
	}
	return false
}
func qmProjectorObject(call *ast.Node) *ast.Node {
	argument := authored.Argument(call, 0)
	if argument == nil {
		return nil
	}
	argument = authored.Unwrap(argument)
	if argument.Kind != ast.KindArrowFunction && argument.Kind != ast.KindFunctionExpression {
		return nil
	}
	returned := authored.ReturnedExpressions(argument)
	if len(returned) != 1 {
		return nil
	}
	object := authored.Unwrap(returned[0])
	if object.Kind != ast.KindObjectLiteralExpression {
		return nil
	}
	return object
}
func (w *qmWriter) literalDefinitionID(file *File, call *ast.Node, name string) (string, *ast.Node) {
	object := qmProjectorObject(call)
	if object == nil {
		w.ambiguity("QLT-DEF-IDS", file, call, name+" input is not a static object literal.")
		return "", call
	}
	expression := authored.PropertyExpression(object, "id")
	anchor := qmAnchor(expression, object)
	if expression != nil && (expression.Kind == ast.KindStringLiteral || expression.Kind == ast.KindNoSubstitutionTemplateLiteral) && qmStableID.MatchString(expression.Text()) {
		return expression.Text(), anchor
	}
	w.violation("QLT-DEF-IDS", file, anchor, name+" ID must be a stable semantic literal.")
	return "", anchor
}
func EvaluateRuntimeDefinitionIDs(project *Project, input RuntimeDefinitionInput) Result {
	w := qmWriter{project: project, out: input.Migration}
	if !input.MigrationKnown {
		w.residual("QLT-DEF-IDS", nil, nil, "Migration literal-ID source product authority unavailable.")
	}
	type owner struct {
		file *File
		node *ast.Node
	}
	owners := map[string]owner{}
	byPath := map[string][]runtime.DefinitionObservation{}
	for _, o := range input.Product.Observations {
		byPath[o.Path] = append(byPath[o.Path], o)
	}
	for _, namespace := range []string{"queries", "mutations"} {
		label := "Query"
		if namespace == "mutations" {
			label = "Mutation"
		}
		for _, file := range project.Files {
			if file.Role != "production" || file.Layer != namespace {
				continue
			}
			names := []string{"defineMutation"}
			if namespace == "queries" {
				names = []string{"defineCollectionQuery", "defineQuery", "defineCompositeQuery"}
			}
			for _, name := range names {
				for _, d := range project.Authored(file).Definitions(name, "", nil, 0) {
					if !qmTopLevel(d.Call) {
						w.origin("QLT-DEF-IDS", name+" definition", file, d)
					}
				}
			}
			observations := byPath[file.Path]
			sort.SliceStable(observations, func(i, j int) bool { return observations[i].Start < observations[j].Start })
			for _, o := range observations {
				var call *ast.Node
				authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
					if node.Kind == ast.KindCallExpression && qmTopLevel(node) && qmStart(file, node) == o.Start && len(utf16.Encode([]rune(file.Source.Text()[:node.End()]))) == o.End {
						call = node
					}
				})
				if call == nil {
					w.ambiguity("QLT-DEF-IDS", file, file.Source.AsNode(), "The observed "+label+" call cannot be located in the current source.")
					continue
				}
				identity := o.Constructor
				if o.Ownership.Kind != "known" || identity == "" {
					w.ambiguity("QLT-DEF-IDS", file, call, "The called factory may be an SDK "+label+" constructor or another value.")
					continue
				}
				if !authored.Contains(names, identity) {
					continue
				}
				before := len(w.out.Evidence)
				literal, syntax := w.literalDefinitionID(file, call, identity)
				id := o.ID
				if id.Kind != "known" {
					w.ambiguity("QLT-DEF-IDS", file, syntax, label+" ID is not established: "+runtime.PublicDefinitionReason(id))
					continue
				}
				if !id.StringPresent || !qmStableID.MatchString(id.String) {
					if len(w.out.Evidence) == before {
						w.violation("QLT-DEF-IDS", file, syntax, "The effective "+label+" ID must be a stable semantic identity.")
					}
					continue
				}
				anchor := call
				if literal == id.String {
					anchor = syntax
				}
				key := namespace + "\x00" + id.String
				prior, exists := owners[key]
				if exists {
					location, known := "", false
					if input.FormatLocation != nil {
						location, known = input.FormatLocation(prior.file, prior.node)
					}
					if !known {
						w.residual("QLT-DEF-IDS", file, anchor, "Canonical prior declaration location projection unavailable.")
					} else {
						w.violation("QLT-DEF-IDS", file, anchor, namespace+" definition ID "+id.String+" is duplicated; first declared in "+location+".")
					}
				} else {
					owners[key] = owner{file, anchor}
				}
			}
			for _, failure := range input.Product.DiscoveryFailures {
				if failure.Path != file.Path {
					continue
				}
				var call *ast.Node
				authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
					if node.Kind == ast.KindCallExpression && qmTopLevel(node) && qmStart(file, node) == failure.Start && len(utf16.Encode([]rune(file.Source.Text()[:node.End()]))) == failure.End {
						call = node
					}
				})
				if call == nil {
					call = file.Source.AsNode()
				}
				w.ambiguity("QLT-DEF-IDS", file, call, label+" discovery is incomplete: "+failure.Reason)
			}
		}
	}
	for _, failure := range input.Product.DiscoveryFailures {
		if failure.Path == "" {
			w.ambiguity("QLT-DEF-IDS", nil, nil, "Definition discovery is incomplete: "+failure.Reason)
		}
	}
	if len(input.Product.InventoryReasons) > 0 {
		w.ambiguity("QLT-DEF-IDS", nil, nil, "Definition call discovery is incomplete: "+strings.Join(input.Product.InventoryReasons, "; "))
	}
	if !input.CompleteInventory || len(input.Product.Residual) > 0 {
		w.residual("QLT-DEF-IDS", nil, nil, "Complete legacy-compatible definition discovery and current compiler membership are not yet established.")
	}
	return w.out
}

// RuntimeDefinitionSubjects preserves source top-level call policy separately
// from native Program/body-call membership and runtime constructor provenance.
func RuntimeDefinitionSubjects(project *Project) runtime.NativeDefinitionSubjects {
	result := runtime.NativeDefinitionSubjects{Known: true}
	for _, file := range project.Files {
		if file.Role != "production" || (file.Layer != "queries" && file.Layer != "mutations") {
			continue
		}
		if file.Source == nil {
			result.Known = false
			continue
		}
		var walk func(*ast.Node)
		walk = func(node *ast.Node) {
			if ast.IsFunctionLike(node) {
				return
			}
			if node.Kind == ast.KindCallExpression {
				result.Subjects = append(result.Subjects, runtime.CapturedDefinitionSubject{Path: file.Path, Start: qmStart(file, node), End: len(utf16.Encode([]rune(file.Source.Text()[:node.End()])))})
			}
			node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
		}
		walk(file.Source.AsNode())
	}
	return result
}
