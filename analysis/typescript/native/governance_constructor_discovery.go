package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"encoding/json"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"os"
	"strings"
)

func (owner *governanceRuntimeAuthority) constructorDiscovery(core *observabledecision.NativeEffectCore) func(string, *ast.Node, observabledecision.Limits) observabledecision.ConstructorExclusion {
	// The pinned original signature constructors preserve declaration parameters;
	// synthetic union parameters without declarations have empty canonical keys.
	// JavaScript/JSDoc remain outside this prototype. Parameter properties
	// also retain a constructor-local Parameter declaration (pinned binder).
	domainKnown := owner.Identity.Complete
	reasons := []string{}
	for _, file := range owner.Files {
		if owner.Identity.OwnedProgramFiles[file.Path] == nil {
			continue
		}
		if len(file.Source.Diagnostics()) != 0 || (!strings.HasSuffix(file.Path, ".ts") && !strings.HasSuffix(file.Path, ".tsx")) {
			domainKnown = false
			reasons = append(reasons, "source:"+file.Path)
		}

	}
	if trace := os.Getenv("ASTRALE_DISCOVERY_CEILING_TRACE"); trace != "" {
		row, _ := json.Marshal(map[string]any{"domainKnown": domainKnown, "reasons": reasons})
		f, err := os.OpenFile(trace, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err == nil {
			f.Write(append(row, '\n'))
			f.Close()
		}
	}
	parameter := func(file observabledecision.CapturedFile, node *ast.Node) (bool, bool) {
		matched, known := owner.node(file, node)
		if !known {
			return false, false
		}
		symbol := unalias(owner.Identity.TypeOwner.program.Checker, owner.Identity.TypeOwner.program.Checker.GetSymbolAtLocation(matched))
		if symbol != nil {
			for _, decl := range symbol.Declarations {
				if decl.Kind == ast.KindParameter {
					return true, true
				}
			}
		}
		return false, true
	}
	certify := func(file observabledecision.CapturedFile, node *ast.Node, kind string) bool {
		matched, known := owner.node(file, node)
		return known && matched == node && file.Source == owner.Identity.OwnedProgramFiles[file.Path]
	}
	ceilingFor := core.NewDiscoveryAliasCeiling(parameter, certify)
	return func(path string, node *ast.Node, limits observabledecision.Limits) observabledecision.ConstructorExclusion {
		out := observabledecision.ConstructorExclusion{}
		if !domainKnown || node == nil || node.Kind != ast.KindIdentifier || limits.MaximumDepth < 1 || limits.MaximumSteps < 1 {
			return out
		}
		file, exists := owner.ByPath[path]
		if !exists {
			return out
		}
		matched, known := owner.node(file, node)
		if !known {
			return out
		}
		admitted, known := owner.ExpressionAdmitted(path, node)
		if !known || !admitted {
			return out
		}
		available, known := owner.ReferenceAvailable(path, node)
		if !known || !available {
			return out
		}
		check := owner.Identity.TypeOwner.program.Checker
		symbol := unalias(check, check.GetSymbolAtLocation(matched))
		if symbol != nil {
			for _, decl := range symbol.Declarations {
				if src := ast.GetSourceFileOfNode(decl); src != nil {
					if _, owned := governanceRuntimeProgramOwned(owner.Identity.Project.Root, src.FileName()); owned {
						return out
					}
				}
			}
		}
		global := owner.GlobalValue(path, node)
		if !global.Known || global.Target != nil || (global.Origin != nil && !observabledecision.CanonicalExternalOrigin(global.Origin)) {
			return out
		}
		bound, known := ceilingFor(owner.symbolKey(symbol))
		if !known {
			return out
		}
		out.MaximumSteps = 1 + 2*bound
		out.Known = out.MaximumSteps <= limits.MaximumSteps
		out.Excluded = out.Known
		if trace := os.Getenv("ASTRALE_DISCOVERY_CEILING_TRACE"); trace != "" {
			row, _ := json.Marshal(map[string]any{"path": path, "pos": node.Pos(), "name": node.Text(), "ceiling": out.MaximumSteps, "excluded": out.Excluded})
			f, err := os.OpenFile(trace, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
			if err == nil {
				f.Write(append(row, '\n'))
				f.Close()
			}
		}
		return out
	}
}
