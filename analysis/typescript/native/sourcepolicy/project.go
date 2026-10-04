package sourcepolicy

import authored "astrale-typespec-v2-native-analysis/authoredsource"
import ast "github.com/microsoft/typescript-go/shim/ast"

// Known records authority; nil names or an empty graph kind can still be the
// exact existing compiler-unavailable result. Missing migration code cannot
// impersonate that negative proof.
type NamesObservation struct {
	Known bool
	Names []string
}
type OrderObservation struct{Known bool;Groups [][]int}
type KindObservation struct {
	Known bool
	Kind  string
}

// Project is the shared rule product input. The native service owns all ASTs,
// policy, membership and resolution observations through final publication.
// No rule family is allowed to discover an independent filesystem snapshot.
type Project struct {
	Files               []*File
	FilesByPath         map[string]*File
	LayerSourcePaths    map[string]string
	Resolve             func(*File, Import) Resolution
	Authoring           func(*File) *authored.File
	NeutralClassIconSVG *string
	CompositionPaths    map[string]bool
	ApplicationPath     string
	// The SDK owns admissibility. Native authored step literals may be batched
	// into the existing prepare/validate/seal exchange; nil stays residual.
	AcceptStepID               func(string) (bool, error)
	AcceptStepIDUnits          func([]uint16) (bool, error)
	ClosedLiteralPropertyNames func(*File, *ast.Node) NamesObservation
	ExpressionPropertyNames    func(*File, *ast.Node) NamesObservation
	QueryCollectionKind        func(*File, *ast.Node) KindObservation
	// Keep presentation-sensitive comparison owned by the pinned JS runtime.
	// A native byte or rune order cannot impersonate Intl/localeCompare.
	LocaleCompare func(string, string) int
 LocaleOrder func([]string)OrderObservation
	authored      map[*File]*authored.File
}

func (project *Project) Authored(file *File) *authored.File {
	if project.Authoring != nil {
		return project.Authoring(file)
	}
	if project.authored == nil {
		project.authored = map[*File]*authored.File{}
	}
	if cached := project.authored[file]; cached != nil {
		return cached
	}
	value := authored.New(file.Source)
	project.authored[file] = value
	return value
}
