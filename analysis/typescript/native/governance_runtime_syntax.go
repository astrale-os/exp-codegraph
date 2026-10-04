package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"sync"
)

// One syntax owner follows the existing compiler Program proposal. It contains
// no capture, checker, symbol, binding result, callback or predecessor owner.
type governanceRuntimeSyntaxOwner struct {
	mu      sync.Mutex
	sources map[*ast.SourceFile]*governanceSourceSyntax
	values  *observabledecision.SourceSyntaxOwner
}

type governanceSourceSyntax struct {
	admitted  map[*ast.Node]string
	functions []*ast.Node
	callsOnce sync.Once
	calls     []*ast.Node
}

func governanceNewRuntimeSyntaxOwner() *governanceRuntimeSyntaxOwner {
	return &governanceRuntimeSyntaxOwner{sources: map[*ast.SourceFile]*governanceSourceSyntax{}, values: observabledecision.NewSourceSyntaxOwner()}
}

func (owner *governanceRuntimeSyntaxOwner) retain(sources []*ast.SourceFile) *governanceRuntimeSyntaxOwner {
	current := governanceNewRuntimeSyntaxOwner()
	if owner == nil {
		return current
	}
	owner.mu.Lock()
	defer owner.mu.Unlock()
	current.values = owner.values.Retain(sources)
	for _, source := range sources {
		if syntax := owner.sources[source]; syntax != nil {
			current.sources[source] = syntax
		}
	}
	return current
}

func (owner *governanceRuntimeSyntaxOwner) source(source *ast.SourceFile) *governanceSourceSyntax {
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if syntax := owner.sources[source]; syntax != nil {
		return syntax
	}
	syntax := &governanceSourceSyntax{admitted: map[*ast.Node]string{}}
	admit := func(body *ast.Node) {
		thin := &thinBody{kinds: map[*ast.Node]string{}}
		thin.walk(body)
		for node, kind := range thin.kinds {
			syntax.admitted[node] = kind
		}
	}
	if !source.IsDeclarationFile && source.Text() != "" {
		admit(source.AsNode())
	}
	walkFile(source, func(node *ast.Node) bool {
		if ast.IsFunctionLike(node) && node.Body() != nil {
			syntax.functions = append(syntax.functions, node)
			if node.Kind == ast.KindArrowFunction && node.Body().Kind != ast.KindBlock {
				syntax.admitted[node.Body()] = "expression"
			}
			admit(node.Body())
		}
		return true
	})

	owner.sources[source] = syntax
	return syntax
}

func (syntax *governanceSourceSyntax) callNodes(source *ast.SourceFile) []*ast.Node {
	syntax.callsOnce.Do(func() {
		walk(source.AsNode(), func(node *ast.Node) bool {
			if node.Kind == ast.KindCallExpression {
				syntax.calls = append(syntax.calls, node)
			}
			return true
		})
	})
	return syntax.calls
}

func (owner *governanceRuntimeAuthority) admission(node *ast.Node) string {
	if kind := owner.Admitted[node]; kind != "" {
		return kind
	}
	if node == nil {
		return ""
	}
	source := ast.GetSourceFileOfNode(node)
	if source == nil {
		return ""
	}
	path, owned := governanceRuntimeProgramOwned(owner.Identity.Project.Root, source.FileName())
	if !owned || !owner.AdmissionsReady[path] || owner.Identity.OwnedProgramFiles[path] != source {
		return ""
	}
	return owner.Syntax.source(source).admitted[node]
}
