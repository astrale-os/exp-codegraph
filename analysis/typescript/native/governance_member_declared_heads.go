package main

import (
	"strings"

	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
)

// A missed declaration proof preserves the original helper, including its
// receiver lookup before the general call-target lookup in ScopedEffects.
func (owner *governanceRuntimeAuthority) externalFactoryMemberCannotSelf(expression *ast.Node, self string) bool {
	if owner.externalDeclaredMemberCannotSelf(expression, self) {
		return true
	}
	return owner.externalFactoryMemberCannotSelfOriginal(expression, self)
}

// This product owns only the negative declaration-origin fact. It neither
// selects an overload nor certifies call arguments, signatures or resource
// replay. In particular, a successful proof skips an original checker prefix;
// equivalence of subsequent checker observations needs separate qualification.
func (owner *governanceRuntimeAuthority) externalDeclaredMemberCannotSelf(expression *ast.Node, self string) bool {
	if self == "" || !governanceDirectMemberAccess(expression) {
		return false
	}
	receiver := expression.AsPropertyAccessExpression().Expression
	if receiver == nil || (receiver.Kind != ast.KindCallExpression && receiver.Kind != ast.KindIdentifier) {
		return false
	}
	proof := governanceDeclaredHeads{owner: owner, remaining: 1024}
	heads, ok := proof.valueHeads(receiver, 0)
	if !ok || len(heads) == 0 {
		return false
	}
	for _, head := range heads {
		members, ok := proof.members(head, expression.Name().Text())
		if !ok {
			return false
		}
		for _, member := range members {
			key := owner.symbolKey(member)
			if key == "" || key == self {
				return false
			}
		}
	}
	return true
}

func governanceDirectMemberAccess(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindPropertyAccessExpression &&
		node.Flags&ast.NodeFlagsOptionalChain == 0 && node.Name() != nil && node.Name().Kind == ast.KindIdentifier
}

type governanceDeclaredHeads struct {
	owner     *governanceRuntimeAuthority
	remaining int
}

func (proof *governanceDeclaredHeads) step() bool {
	proof.remaining--
	return proof.remaining >= 0
}

func (proof *governanceDeclaredHeads) canonical(node *ast.Node) bool {
	if !proof.step() || node == nil {
		return false
	}
	source := ast.GetSourceFileOfNode(node)
	if source == nil {
		return false
	}
	coordinate, err := governanceRuntimeDeclarationCoordinate(proof.owner.Identity.Project, source.FileName())
	return err == nil && strings.HasPrefix(coordinate, "package:@astrale-os/kernel-core/")
}

// The seed is an ORIGINAL property lookup with a non-call identifier receiver.
// Binding Query alone cannot certify its current flow-narrowed member origins.
// We never run this lookup on a receiver containing an earlier fluent call.
func (proof *governanceDeclaredHeads) valueHeads(node *ast.Node, depth int) ([]*ast.Symbol, bool) {
	if node == nil || depth >= 32 || !proof.step() || node.Flags&ast.NodeFlagsOptionalChain != 0 {
		return nil, false
	}
	if node.Kind == ast.KindIdentifier {
		initializer, ok := proof.currentConstInitializer(node)
		if !ok {
			return nil, false
		}
		return proof.valueHeads(initializer, depth+1)
	}
	if node.Kind != ast.KindCallExpression {
		return nil, false
	}
	callee := node.AsCallExpression().Expression
	if callee != nil && callee.Kind == ast.KindIdentifier {
		return proof.directCallableHeads(callee)
	}
	if !governanceDirectMemberAccess(callee) {
		return nil, false
	}
	receiver := callee.AsPropertyAccessExpression().Expression
	if receiver != nil && receiver.Kind == ast.KindIdentifier {
		if initializer, ok := proof.currentConstInitializer(receiver); ok {
			parents, ok := proof.valueHeads(initializer, depth+1)
			if !ok {
				return nil, false
			}
			return proof.callHeads(parents, callee.Name().Text())
		}
		check := proof.owner.Identity.TypeOwner.program.Checker
		// Do not canonicalize a const initializer here: runtime alias identity
		// can survive an assertion that changes the current callable return head.
		member := unalias(check, check.GetSymbolAtLocation(callee))
		if !proof.closedMethod(member, callee.Name().Text()) {
			return nil, false
		}
		return proof.methodHeads([]*ast.Symbol{member})
	}
	parents, ok := proof.valueHeads(receiver, depth+1)
	if !ok {
		return nil, false
	}
	return proof.callHeads(parents, callee.Name().Text())
}

// A direct factory's binding is not its current callable authority. Flow,
// assertions and aliases can change that view while retaining a runtime symbol.
// Obtain the original current callee type, then inspect ALL call signatures.
// Only fixed annotated canonical declarations enter the existing head product.
func (proof *governanceDeclaredHeads) directCallableHeads(callee *ast.Node) ([]*ast.Symbol, bool) {
	if !proof.step() {
		return nil, false
	}
	check := proof.owner.Identity.TypeOwner.program.Checker
	value := check.GetTypeAtLocation(callee)
	if value == nil || value.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsNever|checker.TypeFlagsUnion|checker.TypeFlagsIntersection|checker.TypeFlagsNull|checker.TypeFlagsUndefined|checker.TypeFlagsInstantiable) != 0 {
		return nil, false
	}
	signatures := checker.Checker_getSignaturesOfType(check, value, checker.SignatureKindCall)
	if len(signatures) == 0 || len(checker.Checker_getSignaturesOfType(check, value, checker.SignatureKindConstruct)) != 0 {
		return nil, false
	}
	var heads []*ast.Symbol
	for _, signature := range signatures {
		if !proof.step() || signature == nil || signature.Target() != nil {
			return nil, false
		}
		declaration := signature.Declaration()
		if declaration == nil || declaration.Kind != ast.KindFunctionDeclaration || declaration.Name() == nil || !proof.canonical(declaration) {
			return nil, false
		}
		// A composite can retain one constituent declaration while changing its
		// return. Require the actual signature object owned by that declaration's
		// original current binding, not merely the same declaration coordinates.
		declaredType := check.GetTypeAtLocation(declaration.Name())
		if declaredType == nil {
			return nil, false
		}
		raw := false
		for _, declared := range checker.Checker_getSignaturesOfType(check, declaredType, checker.SignatureKindCall) {
			raw = raw || declared == signature
		}
		if !raw {
			return nil, false
		}
		part, ok := proof.returnHeads(declaration.Type())
		if !ok {
			return nil, false
		}
		heads = governanceAppendHeads(heads, part)
	}
	return heads, len(heads) != 0
}

func (proof *governanceDeclaredHeads) returnHeads(node *ast.Node) ([]*ast.Symbol, bool) {
	return proof.returnHeadsAtDepth(node, 0)
}

func (proof *governanceDeclaredHeads) returnHeadsAtDepth(node *ast.Node, depth int) ([]*ast.Symbol, bool) {
	if node == nil || depth >= 32 || !proof.step() {
		return nil, false
	}
	if node.Kind == ast.KindUnionType {
		var heads []*ast.Symbol
		if node.AsUnionTypeNode().Types == nil {
			return nil, false
		}
		for _, branch := range node.AsUnionTypeNode().Types.Nodes {
			part, ok := proof.returnHeadsAtDepth(branch, depth+1)
			if !ok {
				return nil, false
			}
			heads = governanceAppendHeads(heads, part)
		}
		return heads, len(heads) != 0
	}
	if node.Kind != ast.KindTypeReference || node.AsTypeReferenceNode().TypeName == nil || node.AsTypeReferenceNode().TypeName.Kind != ast.KindIdentifier {
		return nil, false
	}
	check := proof.owner.Identity.TypeOwner.program.Checker
	symbol := unalias(check, check.GetSymbolAtLocation(node.AsTypeReferenceNode().TypeName))
	if !proof.closedInterface(symbol) {
		return nil, false
	}
	return []*ast.Symbol{symbol}, true
}

func (proof *governanceDeclaredHeads) closedInterface(symbol *ast.Symbol) bool {
	if symbol == nil || len(symbol.Declarations) == 0 {
		return false
	}
	for _, declaration := range symbol.Declarations {
		if declaration.Kind != ast.KindInterfaceDeclaration || !proof.canonical(declaration) {
			return false
		}
		shape := declaration.AsInterfaceDeclaration()
		if shape.Members == nil || (shape.HeritageClauses != nil && len(shape.HeritageClauses.Nodes) != 0) {
			return false
		}
		for _, member := range shape.Members.Nodes {
			if !proof.step() || member.Name() == nil || member.Name().Kind != ast.KindIdentifier ||
				(member.Kind != ast.KindMethodSignature && member.Kind != ast.KindPropertySignature) {
				return false
			}
		}
	}
	return true
}

func (proof *governanceDeclaredHeads) closedMethod(symbol *ast.Symbol, name string) bool {
	if symbol == nil || len(symbol.Declarations) == 0 {
		return false
	}
	for _, declaration := range symbol.Declarations {
		if declaration.Kind != ast.KindMethodSignature || declaration.QuestionToken() != nil ||
			declaration.Name() == nil || declaration.Name().Kind != ast.KindIdentifier || declaration.Name().Text() != name ||
			!proof.canonical(declaration) {
			return false
		}
	}
	return true
}

func (proof *governanceDeclaredHeads) members(head *ast.Symbol, name string) ([]*ast.Symbol, bool) {
	if !proof.closedInterface(head) {
		return nil, false
	}
	check := proof.owner.Identity.TypeOwner.program.Checker
	var members []*ast.Symbol
	for _, declaration := range head.Declarations {
		for _, member := range declaration.AsInterfaceDeclaration().Members.Nodes {
			if member.Name().Text() != name {
				continue
			}
			if member.Kind != ast.KindMethodSignature || member.QuestionToken() != nil {
				return nil, false
			}
			// Declaration-name binding obtains the current merged overload symbol
			// without typing the fluent value receiver.
			symbol := unalias(check, check.GetSymbolAtLocation(member.Name()))
			if !proof.closedMethod(symbol, name) {
				return nil, false
			}
			members = governanceAppendHeads(members, []*ast.Symbol{symbol})
		}
	}
	return members, len(members) != 0
}

func (proof *governanceDeclaredHeads) methodHeads(members []*ast.Symbol) ([]*ast.Symbol, bool) {
	var heads []*ast.Symbol
	for _, member := range members {
		for _, declaration := range member.Declarations {
			part, ok := proof.returnHeads(declaration.Type())
			if !ok {
				return nil, false
			}
			heads = governanceAppendHeads(heads, part)
		}
	}
	return heads, len(heads) != 0
}

func (proof *governanceDeclaredHeads) callHeads(parents []*ast.Symbol, name string) ([]*ast.Symbol, bool) {
	var heads []*ast.Symbol
	for _, parent := range parents {
		members, ok := proof.members(parent, name)
		if !ok {
			return nil, false
		}
		part, ok := proof.methodHeads(members)
		if !ok {
			return nil, false
		}
		heads = governanceAppendHeads(heads, part)
	}
	return heads, len(heads) != 0
}

func governanceAppendHeads(heads, extra []*ast.Symbol) []*ast.Symbol {
	for _, candidate := range extra {
		found := false
		for _, head := range heads {
			found = found || head == candidate
		}
		if !found {
			heads = append(heads, candidate)
		}
	}
	return heads
}
