package main

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

// A closed set of original declaration headers, not a selected Call row. Type
// inference may choose a header or recover with declaration-free parameters.
// No mutation consumer may treat this set as exact selected alias identities.
type governanceParameterHeader struct {
	Declaration *ast.Node
	Parameters  []string
	Rest        bool
}
type governanceParameterOrigins struct {
	Known   bool
	Headers []governanceParameterHeader
}

func (projection governanceParameterOrigins) noRest() bool {
	if !projection.Known || len(projection.Headers) == 0 {
		return false
	}
	for _, header := range projection.Headers {
		if header.Rest {
			return false
		}
	}
	return true
}
func (owner *governanceRuntimeAuthority) directParameterOrigins(node *ast.Node) governanceParameterOrigins {
	out := governanceParameterOrigins{}
	if node == nil || node.Kind != ast.KindCallExpression {
		return out
	}
	expression := node.AsCallExpression().Expression
	if expression == nil || (expression.Kind != ast.KindIdentifier && expression.Kind != ast.KindPropertyAccessExpression) {
		return out
	}
	check := owner.Identity.TypeOwner.program.Checker
	// Callable declaration provenance is distinct from canonical runtime alias
	// ownership: a const alias may assert a different rest callable type.
	symbol := unalias(check, check.GetSymbolAtLocation(expression))
	return owner.plainParameterHeaders(symbol)
}
func (owner *governanceRuntimeAuthority) plainParameterHeaders(symbol *ast.Symbol) governanceParameterOrigins {
	out := governanceParameterOrigins{}
	if symbol == nil || symbol.CheckFlags != 0 || len(symbol.Declarations) == 0 {
		return out
	}
	for _, declaration := range symbol.Declarations {
		source := ast.GetSourceFileOfNode(declaration)
		if source == nil || (!strings.HasSuffix(source.FileName(), ".ts") && !strings.HasSuffix(source.FileName(), ".tsx")) {
			return governanceParameterOrigins{}
		}
		switch declaration.Kind {
		case ast.KindFunctionDeclaration, ast.KindMethodDeclaration, ast.KindMethodSignature:
		default:
			return governanceParameterOrigins{}
		}
		header := governanceParameterHeader{Declaration: declaration}
		for _, parameter := range declaration.Parameters() {
			param := parameter.AsParameterDeclaration()
			if param.DotDotDotToken != nil {
				header.Rest = true
			}
			header.Parameters = append(header.Parameters, owner.symbolKey(parameter.Symbol()))
		}
		out.Headers = append(out.Headers, header)
	}
	out.Known = true
	return out
}
