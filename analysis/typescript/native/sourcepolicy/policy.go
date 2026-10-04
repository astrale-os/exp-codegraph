// Package sourcepolicy evaluates source rules directly on native compiler ASTs.
// It has no compiler Program, generic facts, transport, or filesystem ownership.
// The capture owner supplies admitted files and observed resolution authority.
package sourcepolicy

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
)

type File struct {
	Path, Role, Layer string
	Submodule         string
	Source            *ast.SourceFile
	Imports           []Import
	index             *fileSourceIndex
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
