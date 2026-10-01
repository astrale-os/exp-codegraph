package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	text "astrale-typespec-v2-native-analysis/jsstring"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

var FamilyRevisions = map[string]string{
	"FNC-INT-TYPES":     "d7f9733e3724ff3c449203551012b7c37bf7af7d2e0bc5b2642308822601a119",
	"FNC-STEP-IDS":      "4bae952733b6f6f85e0380e68f8a8a7318e92dbe1405e57777fb64b36859baa1",
	"FNC-NO-NEST":       "f2d818d1da69830c9ccaf183c5eb0310c795ab5da1a67871952aef1c2ef7600c",
	"FNC-ONE-IMPL":      "98a614772dec03f5a5c669d0b0efcca8d811a2ed6de91347c38c6bd06fe2a84e",
	"PRV-XDOM-TYPED":    "a520d2276cd10135dc189bb248875406c8286c1a74d4cc39f8ec4d5a96510a49",
	"PRV-XDOM-REQ":      "065816fda57910e917670ed657cf45b1ad3bfdc8fba6362f48123221725e20a0",
	"PRV-NO-DOMAIN":     "5905f9e8fdd2130de52b41e2bbd920ada1ad9c04a71a04e79c98b1333c318e1b",
	"MIG-EXACT-REVS":    "2353d23e19e0afa948b8c8c15b906a2e1427622cea441001d7e28c6fea81c860",
	"MIG-DEDICATED-CTX": "be6389211e5ac1c0a2805a45dbc394aace48167f462947edc1db47cb4d34bf1e",
	"VIW-SCHEMA-DECL":   "524ca0956e1ca5ecfd0010f2973075ef9844eb3b4ccf1771d1b784508292f906",
	"VIW-NO-COMPOSE":    "7c1ec262addbd460059e345ab388bf3dcff429618e5d3b1f618a7b0ae4b12d80",
}

func familyResult() Result { return Result{Evidence: []Evidence{}, Residual: []Residual{}} }
func familyEmit(out *Result, rule string, file *File, node *ast.Node, kind, message string) {
	out.Evidence = append(out.Evidence, Evidence{Rule: rule, File: file, Node: node, Kind: kind, Evidence: message})
}
func familyMissing(out *Result, rule string, file *File, node *ast.Node, message string) {
	out.Residual = append(out.Residual, Residual{Rule: rule, File: file, Node: node, Reason: message})
}
func familyProduction(project *Project, layer string) []*File {
	out := []*File{}
	for _, file := range project.Files {
		if file.Role == "production" && (layer == "" || file.Layer == layer) {
			out = append(out, file)
		}
	}
	return out
}
func familyOrigin(out *Result, rule string, file *File, definition authored.Definition, label string) bool {
	if definition.Origin != "ambiguous" {
		return false
	}
	familyEmit(out, rule, file, definition.Call, "ambiguity", label+" resolves through a local facade whose ultimate public constructor origin is unknown.")
	return true
}
func familyResolve(project *Project, file *File, module, rule string, out *Result) (*File, bool) {
	if !strings.HasPrefix(module, ".") && !strings.HasPrefix(module, "#") {
		return nil, true
	}
	var input *Import
	for i := range file.Imports {
		if file.Imports[i].Specifier == module {
			input = &file.Imports[i]
			break
		}
	}
	// resolveProjectImport accepts a bare module string, so do not manufacture
	// a negative resolution just because that call is not a static import row.
	imp := Import{Specifier: module}
	if input != nil {
		imp = *input
	}
	if project.Resolve == nil {
		familyMissing(out, rule, file, imp.Node, "Captured project resolution authority is unavailable.")
		return nil, false
	}
	resolution := project.Resolve(file, imp)
	if !resolution.Known {
		familyMissing(out, rule, file, imp.Node, "Captured project resolution authority is unavailable.")
		return nil, false
	}
	return resolution.Target, true
}
func familyFunction(node *ast.Node) bool {
	return node != nil && (node.Kind == ast.KindArrowFunction || node.Kind == ast.KindFunctionExpression)
}
func familyOwnBody(fn *ast.Node, callback func(*ast.Node)) {
	if fn == nil || fn.Body() == nil {
		return
	}
	body := fn.Body()
	var walk func(*ast.Node)
	walk = func(node *ast.Node) {
		callback(node)
		if node != body && ast.IsFunctionLike(node) {
			return
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(body)
}
func familyPropertyChain(node *ast.Node) []string { return authored.PropertyChain(node) }
func familySameChain(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func familyNestedInside(candidate, owner *ast.Node) bool {
	for parent := candidate.Parent; parent != nil; parent = parent.Parent {
		if parent == owner {
			return true
		}
	}
	return false
}

func familyStaticText(node *ast.Node) (text.String, bool, error) {
	node = authored.Unwrap(node)
	if node == nil || (node.Kind != ast.KindStringLiteral && node.Kind != ast.KindNoSubstitutionTemplateLiteral) {
		return text.String{}, false, nil
	}
	value, err := text.FromNode(node)
	return value, true, err
}
