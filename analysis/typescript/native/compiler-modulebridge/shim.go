// Astrale-owned compiler-private extension, not a ttsc-managed shim.
// Its module namespace is under the compiler parent solely for Go internal
// visibility; its local source and replacement are owned by Codegraph.
// Exact pinned compiler primitive bridge. These aliases preserve compiler
// object layouts; there is no alternate resolver or syntax-mode classifier.
// The private compiler usage-mode function is linked with its exact types,
// matching the ttsc toolchain's existing shim convention. Any compiler revision
// update requires requalification of this bridge and contextual oracle.
package module

import (
	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/collections"
	_ "github.com/microsoft/typescript-go/internal/compiler"
	"github.com/microsoft/typescript-go/internal/core"
	inner "github.com/microsoft/typescript-go/internal/module"
	"github.com/microsoft/typescript-go/internal/tspath"
	"strings"
	_ "unsafe"
)

type Resolver = inner.Resolver
type ResolutionHost = inner.ResolutionHost
type ResolvedModule = inner.ResolvedModule

func NewResolver(host ResolutionHost, options *core.CompilerOptions) *Resolver {
	return inner.NewResolver(host, options, "", "")
}

//go:linkname UsageMode github.com/microsoft/typescript-go/internal/compiler.getModeForUsageLocation
func UsageMode(fileName string, metadata ast.SourceFileMetaData, usage *ast.Node, options *core.CompilerOptions) core.ResolutionMode

// Metadata has the same scope/format authority used by compiler.fileLoader.
// No SourceFile loading or Program construction is necessary for this data.
func SourceMetadata(resolver *Resolver, fileName string, options *core.CompilerOptions) ast.SourceFileMetaData {
	scope := resolver.GetPackageScopeForPath(tspath.GetDirectoryPath(fileName))
	kind := options.GetModuleResolutionKind()
	packageType, packageDirectory := "", ""
	if scope.Exists() {
		packageDirectory = scope.PackageDirectory
		if value, ok := scope.Contents.Type.GetValue(); ok {
			if !tspath.FileExtensionIsOneOf(fileName, []string{tspath.ExtensionMts, tspath.ExtensionCts, tspath.ExtensionMjs, tspath.ExtensionCjs}) && core.ModuleResolutionKindNode16 <= kind && kind <= core.ModuleResolutionKindNodeNext || strings.Contains(fileName, "/node_modules/") {
				packageType = value
			}
		}
	}
	return ast.SourceFileMetaData{PackageJsonType: packageType, PackageJsonDirectory: packageDirectory, ImpliedNodeFormat: ast.GetImpliedNodeFormatForFile(fileName, packageType)}
}

type JSONMap = collections.OrderedMap[string, any]
