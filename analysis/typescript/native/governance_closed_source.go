package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

// Experimental private source phase; the original capture owns each scalar.
type governanceClosedSourceRequest struct {
	Token, Generation, SourceSnapshotDigest, Path, Operation string
	Input                                                    *governanceClosedSourceInputRequest
	SpecifierUnits                                           []uint16
	Start, End                                               int
	PackageOnly                                              bool
}
type governanceClosedSourceAnswer struct {
	Token                string                            `json:"token,omitempty"`
	Generation           string                            `json:"generation,omitempty"`
	SourceSnapshotDigest string                            `json:"sourceSnapshotDigest,omitempty"`
	Row                  *compilerResolutionInput          `json:"row,omitempty"`
	Status               string                            `json:"status"`
	Reason               string                            `json:"reason,omitempty"`
	Names                []jsstring.JSONText               `json:"names"`
	Kind                 *string                           `json:"kind"`
	Mapping              string                            `json:"mapping,omitempty"`
	Resolution           *governanceClosedSourceResolution `json:"resolution"`
}
type governanceClosedSourceResolution struct {
	ResolvedPath jsstring.JSONText `json:"resolvedPath"`
}

// The main actor must receive the original typed owner before any operation.
// Pending never reads the lane's Program, parser cache or IO-only actor seed.
func (session *governanceSession) observeClosedSource(request governanceClosedSourceRequest) (answer governanceClosedSourceAnswer, err error) {
	if request.Operation == "input" {
		return session.observeClosedSourceInput(request)
	}
	state := session.productsSession
	if state == nil || !governanceClosedSourceOffered(state.Prepare.Options) || state.Token != request.Token || state.Generation != request.Generation {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed source attempt is retired")
	}
	if session.policyLane != nil {
		return governanceClosedSourceAnswer{Status: "pending"}, nil
	}
	if state.Project == nil || state.ProductsDigest != "" || state.SourceProducts != nil {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed source owner is not admitting observations")
	}
	project := state.Project
	if project.GovernanceDigest != request.SourceSnapshotDigest {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed source snapshot differs")
	}
	if !state.sourceBody.matches(state) || !state.sourceBody.opened || !state.sourceBody.projected {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed source observation lacks an admitted projection")
	}
	file := project.FilesByPath[request.Path]
	if file == nil {
		return governanceClosedSourceAnswer{}, fmt.Errorf("closed source file is foreign")
	}
	specifier := jsstring.FromUnits(request.SpecifierUnits)
	if !specifier.ValidUnicode() {
		return governanceClosedSourceAnswer{Status: "unavailable", Reason: "Captured module specifier UTF16/OS-path authority unavailable."}, nil
	}
	answer = governanceClosedSourceAnswer{Status: "known"}
	defer func() {
		if err == nil && answer.Status == "known" && !project.capture.metadataFidelity() {
			answer = governanceClosedSourceAnswer{Status: "unavailable", Reason: "Captured compiler JSON code-unit authority unavailable."}
		}
	}()
	switch request.Operation {
	case "resolve":
		result := project.resolveImport(file, specifier.WTF8(), request.PackageOnly)
		if result.IsResolved() {
			answer.Resolution = &governanceClosedSourceResolution{ResolvedPath: jsstring.JSONText(result.ResolvedFileName)}
		}
		return answer, nil
	case "package-mapping":
		answer.Mapping = project.packageImportMappingKind(file, specifier.WTF8())
		return answer, nil
	case "closed", "names", "collection":
	default:
		return governanceClosedSourceAnswer{}, fmt.Errorf("unknown closed source operation")
	}
	var expression *ast.Node
	if request.Start < 0 || request.End < request.Start || request.End > file.coordinates.utf16(len(file.Text)) {
		return governanceClosedSourceAnswer{}, fmt.Errorf("invalid closed source span")
	}
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		start := scanner.GetTokenPosOfNode(node, file.Source, false)
		if file.coordinates.utf16(start) == request.Start && file.coordinates.utf16(node.End()) == request.End {
			expression = node
		}
		return true
	})
	if expression == nil {
		return governanceClosedSourceAnswer{Status: "unavailable", Reason: "Captured expression anchor authority unavailable."}, nil
	}
	shared := governanceSharedProject(project)
	captured := shared.FilesByPath[file.Path]
	if request.Operation == "collection" {
		observed := project.typeOwner.collectionKind(captured, expression)
		if !observed.Known {
			return governanceClosedSourceAnswer{Status: "unavailable", Reason: "Captured collection type authority unavailable."}, nil
		}
		if observed.Kind != "" {
			answer.Kind = &observed.Kind
		}
		return answer, nil
	}
	var observed sourcepolicy.NamesObservation
	if request.Operation == "names" {
		observed = project.typeOwner.names(captured, expression)
	} else {
		observed = project.typeOwner.closed(captured, expression)
	}
	if !observed.Known {
		return governanceClosedSourceAnswer{Status: "unavailable", Reason: "Captured property names authority unavailable."}, nil
	}
	if observed.Names != nil {
		answer.Names = []jsstring.JSONText{}
		for _, name := range observed.Names {
			answer.Names = append(answer.Names, jsstring.JSONText(name))
		}
	}
	return answer, nil
}
