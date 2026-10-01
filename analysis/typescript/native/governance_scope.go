package main

import (
	"astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

func governanceLocallyOwned(identifier *ast.Node, bound bool) bool {
	return authoredsource.LocallyOwned(identifier, bound)
}
