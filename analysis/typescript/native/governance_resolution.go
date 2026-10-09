package main

import (
	module "github.com/microsoft/typescript-go/astrale-codegraph-modulebridge"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	tspath "github.com/microsoft/typescript-go/shim/tspath"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"strings"
	"time"
)

type governanceResolver struct {
	resolver *module.Resolver
	options  *core.CompilerOptions
	modes    map[string]map[string]map[core.ResolutionMode]bool
	results  map[string]*module.ResolvedModule
}

func (project *governedProject) resolver(packageOnly bool) *governanceResolver {
	if held := project.resolvers[packageOnly]; held != nil {
		return held
	}
	project.capture.compilerInputs()
	options := *project.compilerOptions
	if packageOnly {
		options.Paths = nil
		options.BaseUrl = ""
	}
	host := governanceConfigHost{project.Root, project.capture.compiler}
	owner := &governanceResolver{module.NewResolver(host, &options), &options, map[string]map[string]map[core.ResolutionMode]bool{}, map[string]*module.ResolvedModule{}}
	project.resolvers[packageOnly] = owner
	return owner
}

// Native resolution retains distinct compiler/package-only contexts and each
// usage's actual compiler-selected emit/resolution mode. Conflicting modes for
// one textual specifier are authoritatively unresolved as in SDK resolver.
func (project *governedProject) resolveImport(file *governedFile, specifier string, packageOnly bool) *module.ResolvedModule {
	started := time.Now()
	defer func() { project.stats.phase("contextual-resolution-inclusive", started) }()
	if !project.compilerValid {
		return nil
	}
	owner := project.resolver(packageOnly)
	key := file.Path + "\000" + specifier
	if cached, ok := owner.results[key]; ok {
		return cached
	}
	modes, ok := owner.modes[file.Path]
	compilerPath := tspath.NormalizePath(file.AbsolutePath)
	metadata := module.SourceMetadata(owner.resolver, compilerPath, owner.options)
	if !ok {
		modes = map[string]map[core.ResolutionMode]bool{}
		var visit func(*ast.Node)
		visit = func(node *ast.Node) {
			if governanceLiteral(node) && node.Parent != nil {
				parent := node.Parent
				usage := parent.Kind == ast.KindImportDeclaration || parent.Kind == ast.KindExportDeclaration || (parent.Kind == ast.KindCallExpression && parent.AsCallExpression().Expression.Kind == ast.KindImportKeyword) || (parent.Kind == ast.KindLiteralType && parent.Parent != nil && parent.Parent.Kind == ast.KindImportType)
				if usage {
					mode := module.UsageMode(compilerPath, metadata, node, owner.options)
					if modes[node.Text()] == nil {
						modes[node.Text()] = map[core.ResolutionMode]bool{}
					}
					modes[node.Text()][mode] = true
					return
				}
			}
			node.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
		}
		visit(file.Source.AsNode())
		owner.modes[file.Path] = modes
	}
	usages := modes[specifier]
	if len(usages) > 1 {
		owner.results[key] = nil
		return nil
	}
	mode := metadata.ImpliedNodeFormat
	for m := range usages {
		mode = m
	}
	resolved, _ := owner.resolver.ResolveModuleName(specifier, compilerPath, mode, nil)
	owner.results[key] = resolved
	return resolved
}
func (project *governedProject) resolveProjectImport(file *governedFile, specifier string) *governedFile {
	if !strings.HasPrefix(specifier, ".") && !strings.HasPrefix(specifier, "#") {
		return nil
	}
	resolved := project.resolveImport(file, specifier, false)
	if !resolved.IsResolved() {
		return nil
	}
	for _, target := range project.Files {
		if tspath.NormalizePath(target.AbsolutePath) == resolved.ResolvedFileName {
			return target
		}
	}
	return nil
}

func governanceNewCompilerInputFS(disk vfs.FS) *compilerInputFS {
	fs := newCompilerInputFS(disk, disk)
	fs.singleCapture = true
	return fs
}
