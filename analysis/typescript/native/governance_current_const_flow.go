package main

import (
	"strings"

	bridge "github.com/microsoft/typescript-go/astrale-codegraph-modulebridge"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

// An initializer is not the CURRENT view of a const reference. Only the
// original binder's immediate assignment to this exact declaration permits
// reusing its existing ALL-head proof. Conditions, assertions, captured-flow
// starts and every unknown transition retain the original whole helper.
func (proof *governanceDeclaredHeads) currentConstInitializer(reference *ast.Node) (*ast.Node, bool) {
	if !proof.step() || reference == nil || reference.Kind != ast.KindIdentifier || reference.Flags&ast.NodeFlagsSynthesized != 0 || reference.Pos() < 0 {
		return nil, false
	}
	source := ast.GetSourceFileOfNode(reference)
	if source == nil || source.IsDeclarationFile || source.AsNode().Flags&ast.NodeFlagsJavaScriptFile != 0 || len(source.Diagnostics()) != 0 ||
		(!strings.HasSuffix(source.FileName(), ".ts") && !strings.HasSuffix(source.FileName(), ".tsx")) {
		return nil, false
	}
	path, owned := governanceRuntimeProgramOwned(proof.owner.Identity.Project.Root, source.FileName())
	if !owned || proof.owner.Identity.OwnedProgramFiles[path] != source {
		return nil, false
	}
	check := proof.owner.Identity.TypeOwner.program.Checker
	symbol := check.GetSymbolAtLocation(reference)
	if symbol == nil || symbol.CheckFlags != 0 || symbol.Flags&ast.SymbolFlagsAlias != 0 || len(symbol.Declarations) != 1 {
		return nil, false
	}
	declaration := symbol.Declarations[0]
	if declaration == nil || declaration.Flags&ast.NodeFlagsSynthesized != 0 || declaration.Pos() < 0 || declaration.Kind != ast.KindVariableDeclaration || declaration.Name() == nil || declaration.Name().Kind != ast.KindIdentifier ||
		declaration.Type() != nil || symbol.ValueDeclaration != declaration || declaration.Symbol() != symbol ||
		check.GetSymbolAtLocation(declaration.Name()) != symbol || ast.GetSourceFileOfNode(declaration) != source ||
		governanceConstFlowContainer(reference) != governanceConstFlowContainer(declaration) ||
		ast.GetCombinedNodeFlags(declaration)&ast.NodeFlagsBlockScoped != ast.NodeFlagsConst ||
		ast.GetCombinedModifierFlags(declaration)&(ast.ModifierFlagsExport|ast.ModifierFlagsDefault) != 0 {
		return nil, false
	}
	for node := declaration; node != nil && node != governanceConstFlowContainer(declaration); node = node.Parent {
		if node.Flags&ast.NodeFlagsHasJSDoc != 0 {
			return nil, false
		}
	}
	initializer := declaration.Initializer()
	if initializer == nil || initializer.Kind != ast.KindCallExpression || initializer.Flags&ast.NodeFlagsOptionalChain != 0 {
		return nil, false
	}
	data := reference.FlowNodeData()
	if data == nil || data.FlowNode == nil {
		return nil, false
	}
	flow := data.FlowNode
	allowed := bridge.FlowFlagsAssignment | bridge.FlowFlagsReferenced | bridge.FlowFlagsShared
	if flow.Node != declaration || flow.Flags&bridge.FlowFlagsAssignment == 0 || flow.Flags&^allowed != 0 {
		return nil, false
	}
	return initializer, true
}

func governanceConstFlowContainer(node *ast.Node) *ast.Node {
	for node = node.Parent; node != nil; node = node.Parent {
		if ast.IsFunctionLike(node) || node.Kind == ast.KindSourceFile {
			return node
		}
	}
	return nil
}
