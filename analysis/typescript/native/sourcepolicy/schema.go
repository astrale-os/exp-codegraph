package sourcepolicy

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
)

var SchemaRevisions = map[string]string{
	"SCH-ONE-DECL":      "efaecd2e6978d1ec6d61559536246505c746b53f5968caf2560e811a970f2d04",
	"SCH-ICON-REQUIRED": "f4055b93066289f9b7d9cfceb5ef236420f88311a357ea11161b6fda0922ab9f",
	"SCH-ICON-NEUTRAL":  "061939249964440ceba92dcb86f166553d56cc0196dff15785616423963d4d5b",
	"SCH-EXACT-TYPES":   "952b22e447d155ca168ac900eede803085cf6326ae73df3c588f6dc8caa3f116",
	"SCH-DECL-ONLY":     "3243da10715f3fbb500444cc562195ae10eb61dad84646ab8ef1d1a73b94c99a",
}

func (result *Result) emit(rule string, file *File, node *ast.Node, kind, message string) {
	result.Evidence = append(result.Evidence, Evidence{Rule: rule, Kind: kind, Evidence: message, File: file, Node: node})
}
func (result *Result) residual(rule string, file *File, node *ast.Node, message string) {
	result.Residual = append(result.Residual, Residual{rule, message, file, node})
}
