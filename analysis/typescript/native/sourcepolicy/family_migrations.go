package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

func migrationRevisionSchema(project *Project, file *File, node *ast.Node) string {
	target := authored.Unwrap(node)
	if target == nil || target.Kind != ast.KindCallExpression || target.AsCallExpression().Arguments == nil || len(target.AsCallExpression().Arguments.Nodes) != 1 {
		return ""
	}
	chain := familyPropertyChain(target.AsCallExpression().Expression)
	if len(chain) == 0 || chain[len(chain)-1] != "revision" {
		return ""
	}
	schema := authored.Unwrap(authored.Argument(target, 0))
	if schema == nil || schema.Kind != ast.KindIdentifier {
		return ""
	}
	symbol, ok := project.Authored(file).ImportedSymbol(schema)
	if ok {
		return symbol.Name
	}
	return schema.Text()
}
func migrationSchemaOrigins(project *Project, outcome *Result) map[string]string {
	out := map[string]string{}
	for _, file := range familyProduction(project, "schema") {
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindVariableDeclaration || node.Name() == nil || node.Name().Kind != ast.KindIdentifier || node.AsVariableDeclaration().Initializer == nil {
				return
			}
			value := authored.Unwrap(node.AsVariableDeclaration().Initializer)
			if value.Kind != ast.KindCallExpression {
				return
			}
			symbol, ok := project.Authored(file).ImportedSymbol(value.AsCallExpression().Expression)
			if !ok || symbol.Name != "defineSchema" {
				return
			}
			origin := authored.Unwrap(authored.Argument(value, 0))
			if origin != nil && origin.Kind == ast.KindStringLiteral {
				value, _, err := familyStaticText(origin)
				if err != nil {
					familyMissing(outcome, "MIG-EXACT-REVS", file, origin, "Captured schema origin literal text is unavailable.")
				} else {
					out[node.Name().Text()] = value.WTF8()
				}
			}
		})
	}
	return out
}
func EvaluateMigrations(project *Project) Result {
	out := familyResult()
	origins := migrationSchemaOrigins(project, &out)
	for _, file := range familyProduction(project, "migrations") {
		for _, definition := range project.Authored(file).Definitions("defineMigration", "", nil, 0) {
			if familyOrigin(&out, "MIG-EXACT-REVS", file, definition, "Migration definition") {
				continue
			}
			object := definition.Object
			if object == nil {
				familyEmit(&out, "MIG-EXACT-REVS", file, definition.Call, "ambiguity", "Migration descriptor is not a static object literal.")
				continue
			}
			from := authored.PropertyExpression(object, "from")
			to := authored.PropertyExpression(object, "to")
			if from == nil || to == nil {
				familyEmit(&out, "MIG-EXACT-REVS", file, object, "violation", "Migration must declare exactly one from and one to revision.")
				continue
			}
			fromSchema := migrationRevisionSchema(project, file, from)
			toSchema := migrationRevisionSchema(project, file, to)
			if fromSchema == "" || toSchema == "" {
				location := to
				if fromSchema == "" {
					location = from
				}
				familyEmit(&out, "MIG-EXACT-REVS", file, location, "ambiguity", "Migration revision is not one static schema.revision binding.")
				continue
			}
			if fromSchema == toSchema {
				familyEmit(&out, "MIG-EXACT-REVS", file, to, "violation", "Migration source and target are both "+toSchema+".")
				continue
			}
			fromOrigin := origins[fromSchema]
			toOrigin := origins[toSchema]
			if fromOrigin == "" || toOrigin == "" {
				familyEmit(&out, "MIG-EXACT-REVS", file, object, "ambiguity", "Cannot establish origins for "+fromSchema+" and "+toSchema+".")
			} else if fromOrigin != toOrigin {
				familyEmit(&out, "MIG-EXACT-REVS", file, object, "violation", "Migration crosses Domain origins "+fromOrigin+" and "+toOrigin+".")
			}
		}
	}
	forbidden := map[string]bool{"integrations": true, "functions": true, "providers": true, "mutations": true, "queries": true, "scripts": true, "ui": true, "views": true}
	for _, file := range familyProduction(project, "migrations") {
		for _, imp := range file.Imports {
			target, known := familyResolve(project, file, imp.Specifier, "MIG-DEDICATED-CTX", &out)
			if !known {
				continue
			}
			layer := ""
			if target != nil {
				layer = target.Layer
			}
			if layer == "" && strings.HasPrefix(imp.Specifier, "#") {
				rest := imp.Specifier[1:]
				if slash := strings.IndexByte(rest, '/'); slash > 0 {
					layer = rest[:slash]
				}
			}
			io := strings.HasPrefix(imp.Specifier, "node:") && !strings.HasPrefix(imp.Specifier, "node:assert") && !strings.HasPrefix(imp.Specifier, "node:util/types")
			if forbidden[layer] || io || strings.HasPrefix(imp.Specifier, "@astrale-os/adapter-") {
				familyEmit(&out, "MIG-DEDICATED-CTX", file, imp.Node, "violation", "Migration imports forbidden boundary "+imp.Specifier+".")
			}
		}
	}
	return out
}
