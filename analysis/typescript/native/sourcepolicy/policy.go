// Package sourcepolicy evaluates source rules directly on native compiler ASTs.
// It has no compiler Program, generic facts, transport, or filesystem ownership.
// The capture owner supplies admitted files and observed resolution authority.
package sourcepolicy

import (
	"regexp"
	"strings"

	ast "github.com/microsoft/typescript-go/shim/ast"
)

type File struct {
	Path, Role, Layer string
	Submodule         string
	Source            *ast.SourceFile
	Imports           []Import
}

type Import struct {
	Specifier string
	TypeOnly  bool
	Node      *ast.Node
	Bindings  []Binding
	Namespace string
	Dynamic   bool
}

// Binding order is observable for malformed duplicate locals and facade
// resolution. A map would silently lose the SDK's ordered import ownership.
type Binding struct{ Imported, Local string }

// Known with no target means an authoritative resolution found no admitted
// source. Missing authority is separate from a negative resolution result.
type Resolution struct {
	Known  bool
	Target *File
}

type Authority struct {
	Resolve      func(*File, Import) Resolution
	LocallyBound func(*ast.Node) bool
}

type Evidence struct {
	Rule, Kind, Evidence string
	File                 *File
	Node                 *ast.Node
	AmbiguityReason      string
}

type Residual struct {
	Rule, Reason string
	File         *File
	Node         *ast.Node
}

type Result struct {
	Evidence []Evidence
	Residual []Residual
}

// Revisions come from SDK verifiers, not independently maintained rule text.
// A release must bind the policy and native implementation to these revisions.
var Revisions = map[string]string{
	"RUL-SYNC":        "b319f50b900aa00880a19cccc0ec850fe86d6b317ffcb8dc578e7d6fac1c0548",
	"RUL-PURE":        "34957b915d98bd69f459a9865dba400d0c10f76be15502d55175bbd71de416c4",
	"INT-PURE":        "6eddaa070e097a15d194b09ebfeb8d21251c6682879e54a200efb91007742555",
	"UI-NO-DOMAIN":    "042a25c0aaa76576e6c9b4f9f4f1cc9b08fe5860b9d77a3e5cc64be0f121214c",
	"UTL-PUBLIC-DEPS": "b64df16bd3b7d9a03142f4f651a29b4785ae64ab7d0ff8a5868a8fb82df9dc1a",
}

// Evaluate preserves verifier order, admitted file order, and AST preorder.
// Residuals are migration completeness obligations, not new public ambiguities.
func Evaluate(files []*File, authority Authority) Result {
	out := Result{Evidence: []Evidence{}, Residual: []Residual{}}
	emit := func(rule string, file *File, node *ast.Node, kind, message string) {
		out.Evidence = append(out.Evidence, Evidence{Rule: rule, Kind: kind, Evidence: message, File: file, Node: node})
	}
	missing := func(rule string, file *File, node *ast.Node, reason string) {
		out.Residual = append(out.Residual, Residual{rule, reason, file, node})
	}
	resolve := func(rule string, file *File, imp Import) (Resolution, bool) {
		// SDK resolveProjectImport is deliberately restricted to relative and
		// package-import specifiers. An external package cannot be a Domain
		// source target here, independent of compiler or package availability.
		if !strings.HasPrefix(imp.Specifier, ".") && !strings.HasPrefix(imp.Specifier, "#") {
			return Resolution{Known: true}, true
		}
		if authority.Resolve != nil {
			r := authority.Resolve(file, imp)
			if r.Known {
				return r, true
			}
		}
		missing(rule, file, imp.Node, "contextual import resolution authority unavailable")
		return Resolution{}, false
	}
	bound := func(rule string, file *File, node *ast.Node) (bool, bool) {
		if authority.LocallyBound == nil {
			missing(rule, file, node, "lexical binding authority unavailable")
			return false, false
		}
		return authority.LocallyBound(node), true
	}
	for _, file := range files {
		if file.Role != "production" || file.Layer != "rules" {
			continue
		}
		walk(file.Source.AsNode(), func(node *ast.Node) {
			if functionWithBodyProperty(node) {
				if node.ModifierFlags()&ast.ModifierFlagsAsync != 0 {
					emit("RUL-SYNC", file, node, "violation", "Rule function is async.")
				}
				if generator(node) {
					emit("RUL-SYNC", file, node, "violation", "Rule function is a generator.")
				}
				if typ := node.Type(); typ != nil && typeContainsPromise(typ) {
					emit("RUL-SYNC", file, typ, "violation", "Rule return type is asynchronous.")
				}
			}
			if node.Kind == ast.KindAwaitExpression || (node.Kind == ast.KindForOfStatement && node.AsForInOrOfStatement().AwaitModifier != nil) {
				emit("RUL-SYNC", file, node, "violation", "Rule contains asynchronous continuation syntax.")
			}
			if node.Kind == ast.KindNewExpression {
				root, members, ok := accessPath(node.AsNewExpression().Expression)
				if ok && ((root.Text() == "Promise" && len(members) == 0) || (root.Text() == "globalThis" && len(members) == 1 && members[0] != nil && *members[0] == "Promise")) {
					local, known := bound("RUL-SYNC", file, root)
					if known && !local {
						emit("RUL-SYNC", file, node, "violation", "Rule constructs a global Promise.")
					}
				}
			}
			if node.Kind == ast.KindCallExpression {
				root, members, ok := accessPath(node.AsCallExpression().Expression)
				if !ok {
					return
				}
				var member *string
				if root.Text() == "Promise" && len(members) == 1 {
					member = members[0]
				} else if root.Text() == "globalThis" && len(members) == 2 && members[0] != nil && *members[0] == "Promise" {
					member = members[1]
				} else {
					return
				}
				local, known := bound("RUL-SYNC", file, root)
				if !known || local {
					return
				}
				if member == nil {
					emit("RUL-SYNC", file, node, "ambiguity", "Rule invokes a computed member on the global Promise but the member name is dynamic.")
				} else {
					emit("RUL-SYNC", file, node, "violation", "Rule invokes asynchronous global Promise."+*member+".")
				}
			}
		})
	}
	for _, file := range files {
		if file.Role != "production" || file.Layer != "rules" {
			continue
		}
		for _, imp := range file.Imports {
			res, known := resolve("RUL-PURE", file, imp)
			// A syntactically proved disjunct needs no resolution to prove violation.
			forbidden := (!imp.TypeOnly && effectBoundary.MatchString(imp.Specifier)) || strings.HasPrefix(imp.Specifier, "@astrale-os/adapter-") || imp.Specifier == "@astrale-os/kernel-client" || strings.HasPrefix(imp.Specifier, "@astrale-os/kernel-client/")
			if known && res.Target != nil && forbiddenRuleLayers[res.Target.Layer] {
				forbidden = true
			}
			if forbidden {
				emit("RUL-PURE", file, imp.Node, "violation", "Rule imports effect boundary "+imp.Specifier+".")
			}
		}
		walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind != ast.KindCallExpression {
				return
			}
			expression := unwrap(node.AsCallExpression().Expression)
			if expression.Kind == ast.KindIdentifier && forbiddenGlobal[expression.Text()] {
				local, known := bound("RUL-PURE", file, expression)
				if known && !local {
					emit("RUL-PURE", file, node, "violation", "Rule calls effectful global "+expression.Text()+".")
				}
				return
			}
			// Existing SDK propertyChain uses named property access only. In
			// particular globalThis['fetch'] is not silently broadened here.
			chain := namedPropertyChain(expression)
			if len(chain) == 2 && chain[0] == "globalThis" && forbiddenGlobal[chain[1]] {
				emit("RUL-PURE", file, node, "violation", "Rule calls effectful global "+chain[1]+".")
			}
		})
	}
	for _, file := range files {
		if file.Role != "production" || file.Layer != "integrations" {
			continue
		}
		for _, imp := range file.Imports {
			res, known := resolve("INT-PURE", file, imp)
			if !known {
				continue // local/sibling allowance can override a forbidden spelling
			}
			s := imp.Specifier
			forbidden := executionBoundary.MatchString(s) || foreignDomain(s) || providerImport.MatchString(s) || strings.HasPrefix(s, "@astrale-os/adapter-") || (strings.HasPrefix(s, "@astrale-os/sdk") && s != "@astrale-os/sdk/integration") || strings.HasPrefix(s, "@astrale-os/kernel-client")
			allowed := (res.Target != nil && ((res.Target.Layer == "schema" && imp.TypeOnly) || res.Target.Layer == "integrations")) || (imp.TypeOnly && strings.HasPrefix(s, "@astrale-os/kernel-")) || (imp.TypeOnly && !forbidden)
			if !allowed && (res.Target != nil || forbidden) {
				emit("INT-PURE", file, imp.Node, "violation", "Integration imports boundary or concrete dependency "+s+".")
			}
		}
	}
	for _, file := range files {
		if file.Role != "production" || file.Layer != "ui" {
			continue
		}
		for _, imp := range file.Imports {
			res, known := resolve("UI-NO-DOMAIN", file, imp)
			if foreignDomain(imp.Specifier) || (known && res.Target != nil && res.Target.Layer != "" && res.Target.Layer != "ui") {
				emit("UI-NO-DOMAIN", file, imp.Node, "violation", "UI imports Domain dependency "+imp.Specifier+".")
			}
		}
	}
	for _, file := range files {
		if file.Role != "production" || file.Layer != "utils" {
			continue
		}
		for _, imp := range file.Imports {
			res, known := resolve("UTL-PUBLIC-DEPS", file, imp)
			if known && res.Target != nil && res.Target.Layer != "" && res.Target.Layer != "utils" {
				emit("UTL-PUBLIC-DEPS", file, imp.Node, "violation", "Utils imports Domain layer "+res.Target.Layer+".")
			}
			if strings.HasPrefix(imp.Specifier, "@astrale-os/sdk/src/") || strings.HasPrefix(imp.Specifier, "@astrale-os/kernel-core/src/") || strings.HasPrefix(imp.Specifier, "@astrale-os/kernel-dsl/src/") {
				emit("UTL-PUBLIC-DEPS", file, imp.Node, "violation", "Utils deep-imports private package path "+imp.Specifier+".")
			}
			if strings.HasPrefix(imp.Specifier, "@astrale-domains/") {
				emit("UTL-PUBLIC-DEPS", file, imp.Node, "violation", "Utils imports foreign Domain "+imp.Specifier+".")
			}
		}
	}
	return out
}

func walk(node *ast.Node, visit func(*ast.Node)) {
	if node == nil {
		return
	}
	visit(node)
	node.ForEachChild(func(child *ast.Node) bool { walk(child, visit); return false })
}

func unwrap(node *ast.Node) *ast.Node {
	for node != nil {
		switch node.Kind {
		case ast.KindParenthesizedExpression:
			node = node.AsParenthesizedExpression().Expression
		case ast.KindAsExpression:
			node = node.AsAsExpression().Expression
		case ast.KindSatisfiesExpression:
			node = node.AsSatisfiesExpression().Expression
		case ast.KindNonNullExpression:
			node = node.AsNonNullExpression().Expression
		default:
			return node
		}
	}
	return nil
}

func accessPath(node *ast.Node) (*ast.Node, []*string, bool) {
	node = unwrap(node)
	if node == nil {
		return nil, nil, false
	}
	if node.Kind == ast.KindIdentifier {
		return node, nil, true
	}
	if node.Kind == ast.KindPropertyAccessExpression {
		x := node.AsPropertyAccessExpression()
		root, members, ok := accessPath(x.Expression)
		name := node.Name().Text()
		return root, append(members, &name), ok
	}
	if node.Kind == ast.KindElementAccessExpression {
		x := node.AsElementAccessExpression()
		root, members, ok := accessPath(x.Expression)
		var name *string
		arg := unwrap(x.ArgumentExpression)
		if arg != nil && (arg.Kind == ast.KindStringLiteral || arg.Kind == ast.KindNoSubstitutionTemplateLiteral) {
			text := arg.Text()
			name = &text
		}
		return root, append(members, name), ok
	}
	return nil, nil, false
}

func namedPropertyChain(node *ast.Node) []string {
	node = unwrap(node)
	if node == nil {
		return nil
	}
	if node.Kind == ast.KindIdentifier {
		return []string{node.Text()}
	}
	if node.Kind == ast.KindPropertyAccessExpression {
		parent := namedPropertyChain(node.AsPropertyAccessExpression().Expression)
		if parent != nil {
			return append(parent, node.Name().Text())
		}
	}
	return nil
}

func functionWithBodyProperty(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction,
		ast.KindMethodDeclaration, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindConstructor:
		return true
	}
	return false
}

func generator(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindFunctionDeclaration:
		return node.AsFunctionDeclaration().AsteriskToken != nil
	case ast.KindFunctionExpression:
		return node.AsFunctionExpression().AsteriskToken != nil
	case ast.KindMethodDeclaration:
		return node.AsMethodDeclaration().AsteriskToken != nil
	}
	return false
}

func typeContainsPromise(node *ast.Node) bool {
	if node.Kind == ast.KindTypeReference {
		name := node.AsTypeReferenceNode().TypeName
		if name.Kind == ast.KindQualifiedName {
			name = name.AsQualifiedName().Right
		}
		return name.Text() == "Promise" || name.Text() == "AsyncIterable" || name.Text() == "AsyncIterator"
	}
	if node.Kind == ast.KindUnionType {
		for _, member := range node.AsUnionTypeNode().Types.Nodes {
			if typeContainsPromise(member) {
				return true
			}
		}
	}
	return false
}

func foreignDomain(s string) bool {
	if strings.HasPrefix(s, "@astrale-domains/") {
		return true
	}
	parts := strings.Split(s, "/")
	root := parts[0]
	if strings.HasPrefix(s, "@") && len(parts) > 1 {
		root = strings.Join(parts[:2], "/")
	}
	return root == "domain" || strings.HasSuffix(root, "/domain") || strings.HasSuffix(root, "-domain")
}

var forbiddenRuleLayers = map[string]bool{"integrations": true, "functions": true, "providers": true, "mutations": true, "ui": true, "views": true}
var forbiddenGlobal = map[string]bool{"fetch": true, "setTimeout": true, "setInterval": true, "queueMicrotask": true}
var effectBoundary = regexp.MustCompile(`^(?:node:)?(?:child_process|cluster|dgram|dns(?:/promises)?|fs(?:/promises)?|http2?|https|net|os|process|readline(?:/promises)?|repl|sqlite|timers(?:/promises)?|tls|worker_threads)$`)
var executionBoundary = regexp.MustCompile(`^(?:node:)?(?:child_process|cluster|dgram|dns(?:/promises)?|fs(?:/promises)?|http2?|https|net|process|readline(?:/promises)?|repl|sqlite|timers(?:/promises)?|tls|worker_threads)$`)
var providerImport = regexp.MustCompile(`^(?:(?:stripe|twilio|openai)(?:$|/)|@aws-sdk/|@azure/|@google-cloud/)`)
