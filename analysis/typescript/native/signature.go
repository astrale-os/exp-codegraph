package main

import (
	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
	shimscanner "github.com/microsoft/typescript-go/shim/scanner"
)

// Signature identities describe the declaration selected by the checker, not
// the display of an instantiated type. Rendering types is both unbounded and
// sensitive to compiler union/cache ordering, so it must not enter fact hashes.
func (x *extractor) signatureIdentity(signature *shimchecker.Signature) string {
	declaration := signature.Declaration()
	if declaration == nil {
		return ""
	}
	if x.signatureIDs == nil {
		x.signatureIDs = map[*shimast.Node]string{}
	}
	if id, exists := x.signatureIDs[declaration]; exists {
		return id
	}
	file := shimast.GetSourceFileOfNode(declaration)
	if file == nil {
		return ""
	}
	owner := x.functionID(declaration)
	if owner == "" {
		return ""
	}
	start := shimscanner.SkipTrivia(file.Text(), declaration.Pos())
	end := declaration.End()
	if body := declaration.Body(); body != nil {
		end = body.Pos()
	}
	if end < start || end > len(file.Text()) {
		return ""
	}
	coordinate, _ := x.symbolSourceCoordinate(file.FileName())
	ordinal := 0
	if symbol := unalias(x.checker, declaration.Symbol()); symbol != nil {
		for index, candidate := range symbol.Declarations {
			if candidate == declaration {
				ordinal = index
				break
			}
		}
	}
	id := deriveID("signature", "typescript:"+x.universe, map[string]any{
		"owner": owner, "source": coordinate, "ordinal": ordinal,
		"syntax": declaration.KindString(), "declaration": file.Text()[start:end],
	})
	x.signatureIDs[declaration] = id
	return id
}
