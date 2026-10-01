package main

import (
	bridge "github.com/microsoft/typescript-go/astrale-codegraph-modulebridge"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

// One bounded declaration-origin path: external declared const -> actual
// identity-value mapping -> direct literal property -> typeof plain function.
// It neither evaluates a type argument nor certifies exact selected Call rows.
func (owner *governanceRuntimeAuthority) mappedParameterOrigins(call *ast.Node) governanceParameterOrigins {
	unknown := governanceParameterOrigins{}
	if call == nil || call.Kind != ast.KindCallExpression {
		return unknown
	}
	expression := call.AsCallExpression().Expression
	if expression == nil || expression.Kind != ast.KindPropertyAccessExpression || expression.Name().Kind != ast.KindIdentifier {
		return unknown
	}
	receiver := expression.AsPropertyAccessExpression().Expression
	if receiver == nil || receiver.Kind != ast.KindIdentifier {
		return unknown
	}
	check := owner.Identity.TypeOwner.program.Checker
	value := unalias(check, check.GetSymbolAtLocation(receiver))
	if value == nil || value.CheckFlags != 0 || len(value.Declarations) != 1 {
		return unknown
	}
	declaration := value.Declarations[0]
	if declaration.Kind != ast.KindVariableDeclaration || !ast.IsConst(declaration) {
		return unknown
	}
	source := ast.GetSourceFileOfNode(declaration)
	if source == nil || !source.IsDeclarationFile {
		return unknown
	}
	coordinate, err := governanceRuntimeDeclarationCoordinate(owner.Identity.Project, source.FileName())
	if err != nil || !strings.HasPrefix(coordinate, "package:@astrale-os/sdk/") {
		return unknown
	}
	literal := declaration.Type()
	if literal == nil || literal.Kind != ast.KindTypeReference {
		return unknown
	}
	reference := literal.AsTypeReferenceNode()
	if reference.TypeArguments == nil || len(reference.TypeArguments.Nodes) != 1 {
		return unknown
	}
	template := unalias(check, check.GetSymbolAtLocation(reference.TypeName))
	if template == nil || template.CheckFlags != 0 || len(template.Declarations) != 1 {
		return unknown
	}
	alias := template.Declarations[0]
	if alias.Kind != ast.KindTypeAliasDeclaration || len(alias.TypeParameters()) != 1 {
		return unknown
	}
	parameter := alias.TypeParameters()[0]
	parameterData := parameter.AsTypeParameterDeclaration()
	if parameterData.Constraint != nil || parameterData.DefaultType != nil || parameterData.Expression != nil {
		return unknown
	}
	parameterSymbol := check.GetSymbolAtLocation(parameter.Name())
	if parameterSymbol == nil {
		return unknown
	}
	refers := func(node *ast.Node, symbol *ast.Symbol) bool {
		if node == nil || node.Kind != ast.KindTypeReference {
			return false
		}
		ref := node.AsTypeReferenceNode()
		return ref.TypeName.Kind == ast.KindIdentifier && (ref.TypeArguments == nil || len(ref.TypeArguments.Nodes) == 0) && check.GetSymbolAtLocation(ref.TypeName) == symbol
	}
	mapping := alias.Type()
	if mapping == nil || mapping.Kind != ast.KindMappedType {
		return unknown
	}
	mapped := mapping.AsMappedTypeNode()
	if mapped.NameType != nil || mapped.QuestionToken != nil || (mapped.Members != nil && len(mapped.Members.Nodes) > 0) || mapped.TypeParameter == nil {
		return unknown
	}
	key := mapped.TypeParameter.AsTypeParameterDeclaration()
	if key.Constraint == nil || key.Constraint.Kind != ast.KindTypeOperator || key.DefaultType != nil || key.Expression != nil {
		return unknown
	}
	constraint := key.Constraint.AsTypeOperatorNode()
	if constraint.Operator != ast.KindKeyOfKeyword || !refers(constraint.Type, parameterSymbol) {
		return unknown
	}
	keySymbol := check.GetSymbolAtLocation(mapped.TypeParameter.Name())
	if keySymbol == nil || mapped.Type == nil || mapped.Type.Kind != ast.KindIndexedAccessType {
		return unknown
	}
	access := mapped.Type.AsIndexedAccessTypeNode()
	if !refers(access.ObjectType, parameterSymbol) || !refers(access.IndexType, keySymbol) {
		return unknown
	}
	literal = reference.TypeArguments.Nodes[0]
	if literal.Kind != ast.KindTypeLiteral || literal.AsTypeLiteralNode().Members == nil {
		return unknown
	}
	var selected *ast.Node
	for _, member := range literal.AsTypeLiteralNode().Members.Nodes {
		name := member.Name()
		if name == nil || name.Kind != ast.KindIdentifier || (member.Kind != ast.KindPropertySignature && member.Kind != ast.KindMethodSignature) {
			return unknown
		}
		if name.Text() == expression.Name().Text() {
			if selected != nil {
				return unknown
			}
			selected = member
		}
	}
	if selected == nil || selected.Kind != ast.KindPropertySignature {
		return unknown
	}
	if !owner.closedParameterReferences(ast.GetSourceFileOfNode(call), value) || !owner.literalHasNoThisPredicate(literal) {
		return unknown
	}
	property := selected.AsPropertySignatureDeclaration()
	if selected.QuestionToken() != nil || property.Type == nil || property.Type.Kind != ast.KindTypeQuery {
		return unknown
	}
	memberSymbol := unalias(check, check.GetSymbolAtLocation(expression))
	allowed := bridge.IdentityValueMemberFlags
	if memberSymbol == nil || memberSymbol.CheckFlags&^allowed != 0 || len(memberSymbol.Declarations) != 1 || memberSymbol.Declarations[0] != selected {
		return unknown
	}
	query := property.Type.AsTypeQueryNode()
	if query.ExprName.Kind != ast.KindIdentifier || (query.TypeArguments != nil && len(query.TypeArguments.Nodes) > 0) {
		return unknown
	}
	return owner.plainParameterHeaders(unalias(check, check.GetSymbolAtLocation(query.ExprName)))
}
