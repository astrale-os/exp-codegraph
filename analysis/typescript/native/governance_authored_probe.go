package main

import (
	"astrale-typespec-v2-native-analysis/authoredsource"
	"encoding/json"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

type governanceAuthoredDescriptor struct {
	Name          string   `json:"name"`
	Member        string   `json:"member"`
	Modules       []string `json:"modules"`
	ArgumentIndex int      `json:"argumentIndex"`
}
type governanceAuthoredCall struct {
	Origin   string            `json:"origin"`
	Location *decisionLocation `json:"location"`
}
type governanceAuthoredDefinition struct {
	Origin    string            `json:"origin"`
	Call      *decisionLocation `json:"call"`
	Object    *decisionLocation `json:"object,omitempty"`
	Projector *decisionLocation `json:"projector,omitempty"`
}
type governanceAuthoredSummary struct {
	Path        string                         `json:"path"`
	Name        string                         `json:"name"`
	Member      string                         `json:"member"`
	Calls       []governanceAuthoredCall       `json:"calls"`
	Definitions []governanceAuthoredDefinition `json:"definitions"`
}

func (file *governedFile) authoring() *authoredsource.File {
	if file.authored == nil {
		file.authored = authoredsource.New(file.Source)
	}
	return file.authored
}
func governanceProbeAuthoring(project *governedProject, options json.RawMessage) []governanceAuthoredSummary {
	var debug struct {
		Authored []governanceAuthoredDescriptor `json:"debugAuthored"`
	}
	_ = json.Unmarshal(options, &debug)
	out := []governanceAuthoredSummary{}
	for _, file := range project.Files {
		for _, descriptor := range debug.Authored {
			row := governanceAuthoredSummary{Path: file.Path, Name: descriptor.Name, Member: descriptor.Member, Calls: []governanceAuthoredCall{}, Definitions: []governanceAuthoredDefinition{}}
			calls := file.authoring().Calls(descriptor.Name, descriptor.Modules)
			if descriptor.Member != "" {
				calls = file.authoring().MemberCalls(descriptor.Name, descriptor.Member, descriptor.Modules)
			}
			for _, candidate := range calls {
				row.Calls = append(row.Calls, governanceAuthoredCall{candidate.Origin, governanceLocation(file, candidate.Call)})
			}
			for _, candidate := range file.authoring().Definitions(descriptor.Name, descriptor.Member, descriptor.Modules, descriptor.ArgumentIndex) {
				d := governanceAuthoredDefinition{Origin: candidate.Origin, Call: governanceLocation(file, candidate.Call)}
				if candidate.Object != nil {
					d.Object = governanceLocation(file, candidate.Object)
				}
				if candidate.Projector != nil {
					d.Projector = governanceLocation(file, candidate.Projector)
				}
				row.Definitions = append(row.Definitions, d)
			}
			out = append(out, row)
		}
	}
	return out
}

// This helper exposes the source-authority predicate to family adapters. Runtime
// intrinsic provenance remains a different observation with different premises.
func governanceImportedSymbol(file *governedFile, expression *ast.Node) (authoredsource.Origin, bool) {
	return file.authoring().ImportedSymbol(expression)
}
