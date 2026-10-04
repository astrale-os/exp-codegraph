package main

import (
	"slices"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimcompiler "github.com/microsoft/typescript-go/shim/compiler"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

// A capture is an invalidation receipt, not a compiler object or a claim that
// unchanged augmentation bytes have unchanged semantics. Every reached owned
// contributor is projected again with the current checker. Unsupported forms
// retain the previous full-current fallback.
type compilerAugmentationCapture struct {
	textDigest string
	targets    []string
	owners     []string
	complete   bool
	// Kept only for inspection; a reason never authorizes reuse.
	reason string
}

func captureExternalAugmentation(program *driver.Program, file *shimast.SourceFile, files map[string]bool) compilerAugmentationCapture {
	result := compilerAugmentationCapture{}
	fail := func(reason string) compilerAugmentationCapture {
		result.reason = reason
		return result
	}
	if file.ExternalModuleIndicator == nil || shimcompiler.FileAffectsGlobalScope(file) || len(file.ModuleAugmentations) == 0 {
		return fail("not-an-external-nonglobal-augmentation")
	}
	result.textDigest = hashText(file.Text())
	owners := map[string]bool{file.FileName(): true}
	targets := map[string]bool{}
	// Use precisely the current checker that projects the native rows. Do not
	// keep symbols or ASTs in the result across compilerSession.Apply.
	checker := program.Checker
	declarationFailure := ""
	addDeclarations := func(symbol *shimast.Symbol, interfacesOnly bool) bool {
		if symbol == nil || len(symbol.Declarations) == 0 {
			declarationFailure = "declarationless-symbol"
			return false
		}
		for _, declaration := range symbol.Declarations {
			if interfacesOnly && declaration.Kind != shimast.KindInterfaceDeclaration {
				declarationFailure = "unsupported-interface-contributor:" + declaration.KindString()
				return false
			}
			if !interfacesOnly && declaration.Kind != shimast.KindSourceFile && declaration.Kind != shimast.KindModuleDeclaration {
				declarationFailure = "unsupported-module-contributor:" + declaration.KindString()
				return false
			}
			contributor := shimast.GetSourceFileOfNode(declaration)
			if contributor == nil || !files[contributor.FileName()] || contributor.ExternalModuleIndicator == nil {
				declarationFailure = "unmapped-or-nonexternal-contributor"
				return false
			}
			if shimcompiler.FileAffectsGlobalScope(contributor) {
				declarationFailure = "global-declaration-contributor:" + contributor.FileName()
				return false
			}
			owners[contributor.FileName()] = true
		}
		return true
	}
	for _, name := range file.ModuleAugmentations {
		if name.Kind != shimast.KindStringLiteral || strings.Contains(name.Text(), "*") || name.Parent == nil || name.Parent.Kind != shimast.KindModuleDeclaration || name.Parent.Parent != file.AsNode() {
			return fail("unsupported-augmentation-name")
		}
		resolved := program.TSProgram.GetResolvedModuleFromModuleSpecifier(file, name)
		if resolved == nil || !resolved.IsResolved() {
			return fail("unresolved-augmentation-target")
		}
		target := program.TSProgram.GetSourceFileForResolvedModule(resolved.ResolvedFileName)
		if target == nil || !files[target.FileName()] || target.ExternalModuleIndicator == nil || shimcompiler.FileAffectsGlobalScope(target) {
			return fail("unsupported-augmentation-target")
		}
		// export= and namespace/pattern/global merges need a distinct qualified
		// contribution relation. The first admission is ordinary ES modules.
		if target.Statements != nil {
			for _, statement := range target.Statements.Nodes {
				if statement.Kind == shimast.KindExportAssignment {
					return fail("export-assignment-target")
				}
			}
		}
		module := checker.GetSymbolAtLocation(name)
		if !addDeclarations(module, false) {
			return fail("uncertified-module-declarations:" + declarationFailure)
		}
		hasTarget := false
		for _, declaration := range module.Declarations {
			if declaration.Kind == shimast.KindSourceFile && declaration.AsSourceFile() == target {
				hasTarget = true
			}
		}
		if !hasTarget {
			return fail("resolved-target-not-in-merged-module")
		}
		targets[target.FileName()] = true
		body := name.Parent.Body()
		if body == nil || body.Kind != shimast.KindModuleBlock || body.AsModuleBlock().Statements == nil {
			return fail("unsupported-augmentation-body")
		}
		exports := checker.GetExportsOfModule(module)
		for _, declaration := range body.AsModuleBlock().Statements.Nodes {
			// Enumerate every contributed declaration; an unsupported member
			// cannot be silently interpreted as no contribution. Interface type
			// expressions retain the compiler-reference/read dependency graph.
			if declaration.Kind != shimast.KindInterfaceDeclaration || declaration.Name() == nil || declaration.Name().Kind != shimast.KindIdentifier {
				return fail("unsupported-augmentation-declaration")
			}
			merged := checker.GetSymbolAtLocation(declaration.Name())
			if !addDeclarations(merged, true) {
				return fail("uncertified-interface-merge:" + declarationFailure)
			}
			found := false
			for _, exported := range exports {
				if exported.Name != declaration.Name().Text() {
					continue
				}
				found = true
				aliased := unalias(checker, exported)
				if aliased == nil || len(aliased.Declarations) == 0 {
					return fail("uncertified-forwarded-export")
				}
				// Export tables may contain raw/unmerged symbols or aliases.
				// Re-query each supported declaration name to obtain CURRENT
				// merged declarations, including an export-star's base owner.
				for _, forwarded := range aliased.Declarations {
					if forwarded.Kind != shimast.KindInterfaceDeclaration || forwarded.Name() == nil || !addDeclarations(checker.GetSymbolAtLocation(forwarded.Name()), true) {
						return fail("unsupported-forwarded-declaration:" + declarationFailure)
					}
				}
			}
			if !found {
				return fail("contribution-not-an-export")
			}
		}
	}
	for target := range targets {
		result.targets = append(result.targets, target)
	}
	for owner := range owners {
		result.owners = append(result.owners, owner)
	}
	slices.Sort(result.targets)
	slices.Sort(result.owners)
	result.complete = true
	return result
}

func unchangedExternalAugmentation(old, next *compilerReferenceSnapshot, path string) bool {
	previous, captured := old.augmentations[path]
	current, recaptured := next.augmentations[path]
	return captured && recaptured && previous.complete && current.complete &&
		previous.textDigest == current.textDigest && slices.Equal(previous.targets, current.targets) && slices.Equal(previous.owners, current.owners)
}
