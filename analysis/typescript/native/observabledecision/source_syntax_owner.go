package observabledecision

import (
	"crypto/sha256"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"sync"
)

// SourceSyntaxOwner retains parser-owned structure only. A native Program owner
// replaces its membership on every update; callbacks, files, symbols, results,
// semantic reads and demand allowances never enter these records.
type SourceSyntaxOwner struct {
	mu      sync.Mutex
	sources map[*ast.SourceFile]*sourceSyntax
	allowed map[*ast.SourceFile]bool
}

type sourceSyntax struct {
	moduleOnce  sync.Once
	module      *demandModule
	effectsOnce sync.Once
	effects     []effectCandidate
	mu          sync.Mutex
	structures  map[*ast.Node]*demandFunctionStructure
}

func NewSourceSyntaxOwner() *SourceSyntaxOwner {
	return &SourceSyntaxOwner{sources: map[*ast.SourceFile]*sourceSyntax{}}
}

// Retain returns a distinct current-membership map, without predecessor links.
// Only exact current compiler SourceFile pointers can carry syntax forward.
func (owner *SourceSyntaxOwner) Retain(sources []*ast.SourceFile) *SourceSyntaxOwner {
	current := NewSourceSyntaxOwner()
	current.allowed = map[*ast.SourceFile]bool{}
	for _, source := range sources {
		current.allowed[source] = true
	}
	if owner == nil {
		return current
	}
	owner.mu.Lock()
	defer owner.mu.Unlock()
	for _, source := range sources {
		if syntax := owner.sources[source]; syntax != nil {
			current.sources[source] = syntax
		}
	}
	return current
}

func (owner *SourceSyntaxOwner) source(source *ast.SourceFile) *sourceSyntax {
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if owner.allowed != nil && !owner.allowed[source] {
		// Governed syntax outside the Program stays local to its fresh consumer.
		return &sourceSyntax{structures: map[*ast.Node]*demandFunctionStructure{}}
	}
	syntax := owner.sources[source]
	if syntax == nil {
		syntax = &sourceSyntax{structures: map[*ast.Node]*demandFunctionStructure{}}
		owner.sources[source] = syntax
	}
	return syntax
}

func shaText(text string) [32]byte { return sha256.Sum256([]byte(text)) }

func syntaxModule(source *ast.SourceFile) *demandModule {
	h := sha256.Sum256([]byte(source.Text()))
	m := &demandModule{digest: fmt.Sprintf("%x", h), bindings: map[string]demandBinding{}}
	if len(source.Diagnostics()) != 0 {
		m.reason = "source syntax diagnostics"
	}
	put := func(name string, b demandBinding) {
		if _, ok := m.bindings[name]; ok {
			m.reason = "duplicate module binding"
		}
		m.bindings[name] = b
	}
	for _, n := range source.Statements.Nodes {
		switch n.Kind {
		case ast.KindImportDeclaration:
			d := n.AsImportDeclaration()
			if d.ImportClause == nil {
				continue
			}
			c := d.ImportClause.AsImportClause()
			if c.PhaseModifier == ast.KindTypeKeyword {
				continue
			}
			if c.Name() != nil {
				put(c.Name().Text(), demandBinding{specifier: d.ModuleSpecifier.Text(), export: "default"})
			}
			if c.NamedBindings != nil {
				switch c.NamedBindings.Kind {
				case ast.KindNamespaceImport:
					put(c.NamedBindings.Name().Text(), demandBinding{specifier: d.ModuleSpecifier.Text(), export: "*", namespace: true})
				case ast.KindNamedImports:
					for _, el := range c.NamedBindings.AsNamedImports().Elements.Nodes {
						v := el.AsImportSpecifier()
						if v.IsTypeOnly {
							continue
						}
						name := el.Name().Text()
						export := name
						if v.PropertyName != nil {
							export = v.PropertyName.Text()
						}
						put(name, demandBinding{specifier: d.ModuleSpecifier.Text(), export: export})
					}
				}
			}
		case ast.KindVariableStatement:
			d := n.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
			for _, v := range d.Declarations.Nodes {
				if v.Name().Kind != ast.KindIdentifier {
					continue
				}
				put(v.Name().Text(), demandBinding{node: v.AsVariableDeclaration().Initializer, exported: n.ModifierFlags()&ast.ModifierFlagsExport != 0, mutable: d.Flags&ast.NodeFlagsConst == 0})
				if v.AsVariableDeclaration().Initializer != nil {
					m.candidates = append(m.candidates, v.AsVariableDeclaration().Initializer)
				}
			}
		case ast.KindFunctionDeclaration:
			if n.Name() != nil {
				put(n.Name().Text(), demandBinding{node: n, exported: n.ModifierFlags()&ast.ModifierFlagsExport != 0})
			}
		}
	}
	return m
}

func (owner *SourceSyntaxOwner) module(source *ast.SourceFile) *demandModule {
	syntax := owner.source(source)
	syntax.moduleOnce.Do(func() { syntax.module = syntaxModule(source) })
	return syntax.module
}

func syntaxEffectCandidates(source *ast.SourceFile) []effectCandidate {
	var candidates []effectCandidate
	var walk func(*ast.Node)
	walk = func(node *ast.Node) {
		switch node.Kind {
		case ast.KindVariableDeclaration:
			declaration := node.AsVariableDeclaration()
			if declaration.Initializer != nil && declaration.Name().Kind == ast.KindIdentifier {
				if root := effectRoot(declaration.Initializer); root != nil {
					candidates = append(candidates, effectCandidate{node: node, root: root, name: declaration.Name(), kind: "alias"})
				}
			}
		case ast.KindBinaryExpression:
			binary := node.AsBinaryExpression()
			if binary.OperatorToken.Kind >= ast.KindFirstAssignment && binary.OperatorToken.Kind <= ast.KindLastAssignment {
				if root := effectRoot(binary.Left); root != nil {
					candidates = append(candidates, effectCandidate{node: node, root: root, kind: "mutation"})
				}
			}
		case ast.KindDeleteExpression:
			if root := effectRoot(node.AsDeleteExpression().Expression); root != nil {
				candidates = append(candidates, effectCandidate{node: node, root: root, kind: "delete"})
			}
		case ast.KindCallExpression:
			for _, argument := range node.AsCallExpression().Arguments.Nodes {
				if root := effectRoot(argument); root != nil {
					candidates = append(candidates, effectCandidate{node: node, root: root, kind: "call"})
				}
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
	}
	walk(source.AsNode())
	return candidates
}

func (owner *SourceSyntaxOwner) effectCandidates(source *ast.SourceFile) []effectCandidate {
	syntax := owner.source(source)
	syntax.effectsOnce.Do(func() { syntax.effects = syntaxEffectCandidates(source) })
	return syntax.effects
}

func (owner *SourceSyntaxOwner) function(source *ast.SourceFile, function *ast.Node) *demandFunctionStructure {
	syntax := owner.source(source)
	syntax.mu.Lock()
	defer syntax.mu.Unlock()
	structure := syntax.structures[function]
	if structure == nil {
		structure = &demandFunctionStructure{}
		syntax.structures[function] = structure
	}
	return structure
}
