package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
)

var platformReferenceTypes = map[string]bool{
	"Map": true, "ReadonlyMap": true, "Set": true, "ReadonlySet": true,
	"WeakMap": true, "WeakSet": true, "Iterable": true, "IterableIterator": true,
	"Iterator": true, "AsyncIterable": true, "AsyncIterableIterator": true,
	"PromiseLike": true, "Pick": true, "Omit": true, "Partial": true,
	"Required": true, "Exclude": true, "Extract": true, "NonNullable": true,
	"Parameters": true, "ReturnType": true, "InstanceType": true, "Awaited": true,
	"Uint8Array": true, "ArrayBuffer": true, "AbortSignal": true, "URL": true,
}

type nativeTypeNormalizer struct {
	x            *extractor
	issues       *[]any
	references   map[string]*shimast.Symbol
	bindings     map[*shimast.Symbol]map[string]any
	bindingNames map[string][]map[string]any
	active       map[uint32]bool
	// recoveredValueAnnotation is non-zero only while normalizing syntax that
	// was recovered from an inferred value's declaration. In that context a
	// `typeof CONSTANT` type argument represents the already-computed semantic
	// value type; it is not an independently authored dependency at the use.
	recoveredValueAnnotation int
	// forceAuthoredDeclarations is non-zero while walking an explicitly authored
	// interface, class, or type-literal member list. Checker member types can be
	// reduced (especially for optional aliases) even though the declaration is
	// the canonical public spelling. Instantiated anonymous checker objects do
	// not set this flag and therefore retain their substituted member types.
	forceAuthoredDeclarations int
	// declaringAlias suppresses only the checker self-reference of the alias
	// currently being normalized; explicit RHS references remain identity-bearing.
	declaringAlias *shimast.Symbol
}

func newNativeTypeNormalizer(x *extractor, issues *[]any) *nativeTypeNormalizer {
	return &nativeTypeNormalizer{
		x: x, issues: issues, references: map[string]*shimast.Symbol{},
		bindings: map[*shimast.Symbol]map[string]any{}, bindingNames: map[string][]map[string]any{}, active: map[uint32]bool{},
	}
}

func (n *nativeTypeNormalizer) normalizeTypeNode(node *shimast.Node) any {
	if node == nil {
		return n.unsupported(nil, nil, "missing type")
	}
	// The shim can expose a constrained type-parameter reference as its constraint
	// type (for example `Kind` as `string`) before normalize sees TypeParameter
	// flags. Authored syntax plus one unambiguous active lexical binding is the
	// stronger evidence and preserves the generic scope exactly.
	if node.Kind == shimast.KindTypeReference {
		reference := node.AsTypeReferenceNode()
		if reference.TypeArguments == nil || len(reference.TypeArguments.Nodes) == 0 {
			name := nodeText(shimast.GetSourceFileOfNode(node), reference.TypeName)
			if binding, exists := n.uniqueBindingByName(name); exists {
				return map[string]any{"kind": "parameter", "scope": binding["scope"], "index": binding["index"]}
			}
		}
	}
	return n.normalize(n.x.checker.GetTypeFromTypeNode(node), node)
}

func (n *nativeTypeNormalizer) normalizeDeclaredAlias(symbol *shimast.Symbol, node *shimast.Node) any {
	previous := n.declaringAlias
	n.declaringAlias = unalias(n.x.checker, symbol)
	defer func() { n.declaringAlias = previous }()
	return n.normalizeTypeNode(node)
}

func (n *nativeTypeNormalizer) normalize(t *shimchecker.Type, node *shimast.Node) any {
	if authored := authoredValueTypeNode(n.x.checker, node); authored != nil {
		n.recoveredValueAnnotation++
		defer func() { n.recoveredValueAnnotation-- }()
		return n.normalize(n.x.checker.GetTypeFromTypeNode(authored), authored)
	}
	useAuthoredNode := node != nil
	if useAuthoredNode && t != nil && normalizedTypeNodeKind(node.Kind) {
		useAuthoredNode = n.x.checker.GetTypeFromTypeNode(node) == t
	}
	if useAuthoredNode {
		switch node.Kind {
		case shimast.KindVariableDeclaration, shimast.KindParameter, shimast.KindPropertySignature, shimast.KindPropertyDeclaration, shimast.KindTypeAliasDeclaration:
			// In an instantiated generic object the member declaration still points
			// at the generic syntax (`Patch`) while memberType is the substituted
			// checker type (`DeltaInput`). Only prefer declaration syntax when it
			// denotes the same checker type; otherwise the instantiated type is the
			// semantic fact and the declaration remains location provenance only.
			if authored := node.Type(); authored != nil && (n.forceAuthoredDeclarations != 0 || t == nil || n.x.checker.GetTypeFromTypeNode(authored) == t) {
				return n.normalize(n.x.checker.GetTypeFromTypeNode(authored), authored)
			}
		case shimast.KindFunctionDeclaration:
			// A function declaration's authored type node is its return type.
			// V1 deliberately reports that declared value type in addition to the
			// full callable signature; treating the function symbol itself as a
			// reference creates a spurious self-edge in the public closure.
			if authored := node.Type(); authored != nil && stableReferenceAt(n.x.checker, authored) {
				return n.normalize(n.x.checker.GetTypeFromTypeNode(authored), authored)
			}
		case shimast.KindParenthesizedType, shimast.KindOptionalType, shimast.KindRestType, shimast.KindNamedTupleMember:
			return n.normalizeTypeNode(node.Type())
		case shimast.KindTypeOperator:
			operator := node.AsTypeOperatorNode()
			if operator.Operator == shimast.KindKeyOfKeyword {
				return map[string]any{"kind": "keyof", "type": n.normalizeTypeNode(operator.Type)}
			}
			value := n.normalizeTypeNode(operator.Type)
			if operator.Operator == shimast.KindReadonlyKeyword {
				if observed, ok := value.(map[string]any); ok && (observed["kind"] == "array" || observed["kind"] == "tuple") {
					observed["readonly"] = true
				}
			}
			return value
		case shimast.KindConditionalType:
			conditional := node.AsConditionalTypeNode()
			return map[string]any{
				"kind": "conditional", "check": n.normalizeTypeNode(conditional.CheckType),
				"extends":   n.normalizeTypeNode(conditional.ExtendsType),
				"trueType":  n.normalizeTypeNode(conditional.TrueType),
				"falseType": n.normalizeTypeNode(conditional.FalseType),
			}
		case shimast.KindTemplateLiteralType:
			texts, expressions := templateLiteralTypeParts(node)
			if len(texts) == 0 && t.Flags()&shimchecker.TypeFlagsTemplateLiteral != 0 {
				texts = append(texts, t.AsTemplateLiteralType().Texts()...)
			}
			types := []any{}
			for _, expression := range expressions {
				types = append(types, n.normalizeTypeNode(expression))
			}
			if len(types)+1 == len(texts) {
				return map[string]any{
					"kind": "template", "texts": texts,
					"types": types,
				}
			}
		case shimast.KindIndexedAccessType:
			indexed := node.AsIndexedAccessTypeNode()
			return map[string]any{
				"kind": "indexed-access", "object": n.normalizeTypeNode(indexed.ObjectType),
				"index": n.normalizeTypeNode(indexed.IndexType),
			}
		case shimast.KindIntersectionType:
			// TypeScript-Go flattens referenced aliases nested in intersections
			// more aggressively than the Node checker. The authored constituents
			// are the public contract here: normalize each with its own checker type
			// so explicit alias boundaries and generic scopes remain intact.
			items := []any{}
			for _, item := range node.AsIntersectionTypeNode().Types.Nodes {
				items = append(items, n.normalizeTypeNode(item))
			}
			return map[string]any{"kind": "intersection", "types": canonicalObservedTypes(items)}
		case shimast.KindUnionType:
			// A checker union is a semantic reduction, not the authored public
			// algebra. TypeScript-Go may expand a named recursive alias or remove a
			// literal already subsumed by a primitive (for example `string | '*'`).
			// Normalize the syntax constituents independently so the portable fact
			// retains every explicit alias boundary and constituent. Consumers that
			// need assignability/reduction can derive it without making this loss of
			// information irreversible.
			items := []any{}
			nodes := node.AsUnionTypeNode().Types.Nodes
			for _, item := range nodes {
				items = append(items, n.normalizeTypeNode(item))
			}
			return map[string]any{"kind": "union", "types": canonicalObservedTypes(items)}
		case shimast.KindArrayType:
			return map[string]any{"kind": "array", "element": n.normalizeTypeNode(node.AsArrayTypeNode().ElementType), "readonly": false}
		case shimast.KindTupleType:
			elements := []any{}
			nodes := node.AsTupleTypeNode().Elements.Nodes
			if t != nil && shimchecker.IsTupleType(t) {
				arguments := shimchecker.Checker_getTypeArguments(n.x.checker, t)
				for index, item := range arguments {
					location := node
					if index < len(nodes) {
						if candidate := tupleElementLocation(n.x.checker, item, nodes[index]); candidate != nil {
							location = candidate
						}
					}
					elements = append(elements, n.normalize(item, location))
				}
				return map[string]any{"kind": "tuple", "elements": elements, "readonly": t.TargetTupleType().IsReadonly()}
			}
			for _, item := range nodes {
				elements = append(elements, n.normalizeTypeNode(item))
			}
			return map[string]any{"kind": "tuple", "elements": elements, "readonly": false}
		case shimast.KindFunctionType, shimast.KindConstructorType:
			callable := n.callableFromFunctionNode(node)
			kind := "function"
			if node.Kind == shimast.KindConstructorType {
				kind = "constructor"
			}
			return map[string]any{"kind": kind, "callable": callable}
		case shimast.KindTypeLiteral:
			literal := node.AsTypeLiteralNode()
			if literal.Members != nil && len(literal.Members.Nodes) == 1 && literal.Members.Nodes[0].Kind == shimast.KindIndexSignature {
				index := literal.Members.Nodes[0].AsIndexSignatureDeclaration()
				if index.Parameters != nil && len(index.Parameters.Nodes) == 1 && index.Parameters.Nodes[0].Type() != nil && index.Type != nil {
					return map[string]any{
						"kind":  "record",
						"key":   n.normalizeTypeNode(index.Parameters.Nodes[0].Type()),
						"value": n.normalizeTypeNode(index.Type),
					}
				}
			}
			return map[string]any{"kind": "object", "members": n.membersFromNodes(node.Members())}
		case shimast.KindTypeReference:
			if result := n.referenceFromNode(t, node); result != nil {
				return result
			}
		case shimast.KindTypeQuery:
			if n.recoveredValueAnnotation != 0 {
				if intrinsic := observedTypeQueryIntrinsic(t); intrinsic != nil {
					return intrinsic
				}
			}
			name := node.AsTypeQueryNode().ExprName
			if name != nil && (name.Kind != shimast.KindQualifiedName || moduleQualifiedName(n.x.checker, name)) {
				if symbol := unalias(n.x.checker, n.x.checker.GetSymbolAtLocation(name)); stableDeclarationSymbol(symbol) {
					return n.reference(symbol, []any{})
				}
			}
		case shimast.KindImportType:
			qualifier := node.AsImportTypeNode().Qualifier
			if symbol := unalias(n.x.checker, n.x.checker.GetSymbolAtLocation(qualifier)); stableDeclarationSymbol(symbol) {
				return n.reference(symbol, []any{})
			}
		case shimast.KindStringKeyword:
			return primitive("string")
		case shimast.KindBooleanKeyword:
			return primitive("boolean")
		case shimast.KindNumberKeyword:
			return primitive("number")
		case shimast.KindBigIntKeyword:
			return primitive("bigint")
		case shimast.KindSymbolKeyword:
			return primitive("symbol")
		case shimast.KindObjectKeyword:
			return primitive("object")
		case shimast.KindUnknownKeyword:
			return map[string]any{"kind": "unknown"}
		case shimast.KindUndefinedKeyword:
			return map[string]any{"kind": "undefined"}
		case shimast.KindNullKeyword:
			return map[string]any{"kind": "null"}
		case shimast.KindVoidKeyword:
			return map[string]any{"kind": "void"}
		case shimast.KindNeverKeyword:
			return map[string]any{"kind": "never"}
		case shimast.KindAnyKeyword:
			return n.unsupported(t, node, "any")
		case shimast.KindThisType:
			if owner := containingTypeSymbol(node); owner != nil {
				return map[string]any{"kind": "this", "owner": n.x.publicSymbolIdentity(owner)}
			}
			return n.unsupported(t, node, "unresolved this-type owner")
		case shimast.KindLiteralType:
			return literalFromTypeNode(node, t)
		}
	}
	if t == nil {
		return n.unsupported(t, node, "missing checker type")
	}
	id := uint32(t.Id())
	if n.active[id] {
		if symbol := stableTypeSymbol(t); stableDeclarationSymbol(symbol) {
			return n.reference(symbol, nil)
		}
		return n.unsupported(t, node, "anonymous recursive type")
	}
	n.active[id] = true
	defer delete(n.active, id)
	flags := t.Flags()
	if flags&shimchecker.TypeFlagsAny != 0 {
		return n.unsupported(t, node, "any")
	}
	if flags&shimchecker.TypeFlagsTypeParameter != 0 {
		if binding, exists := n.typeParameterBinding(t, node); exists {
			return map[string]any{"kind": "parameter", "scope": binding["scope"], "index": binding["index"]}
		}
		return n.unsupported(t, node, "unbound type parameter")
	}
	if flags&shimchecker.TypeFlagsUnknown != 0 {
		return map[string]any{"kind": "unknown"}
	}
	if flags&shimchecker.TypeFlagsUndefined != 0 {
		return map[string]any{"kind": "undefined"}
	}
	if flags&shimchecker.TypeFlagsNull != 0 {
		return map[string]any{"kind": "null"}
	}
	if flags&shimchecker.TypeFlagsVoid != 0 {
		return map[string]any{"kind": "void"}
	}
	if flags&shimchecker.TypeFlagsNever != 0 {
		return map[string]any{"kind": "never"}
	}
	if flags&shimchecker.TypeFlagsLiteral != 0 {
		return literalFromChecker(t)
	}
	if flags&shimchecker.TypeFlagsTemplateLiteral != 0 {
		template := t.AsTemplateLiteralType()
		items := []any{}
		for _, item := range template.Types() {
			items = append(items, n.normalize(item, node))
		}
		return map[string]any{"kind": "template", "texts": append([]string{}, template.Texts()...), "types": items}
	}
	if flags&shimchecker.TypeFlagsStringLike != 0 {
		return primitive("string")
	}
	if flags&shimchecker.TypeFlagsNumberLike != 0 {
		return primitive("number")
	}
	if flags&shimchecker.TypeFlagsBigIntLike != 0 {
		return primitive("bigint")
	}
	if flags&shimchecker.TypeFlagsESSymbolLike != 0 {
		return primitive("symbol")
	}
	if flags&shimchecker.TypeFlagsNonPrimitive != 0 {
		return primitive("object")
	}
	if flags&shimchecker.TypeFlagsBooleanLike != 0 {
		return primitive("boolean")
	}
	if flags&shimchecker.TypeFlagsUnion != 0 || flags&shimchecker.TypeFlagsIntersection != 0 {
		items := []any{}
		for _, item := range t.Types() {
			items = append(items, n.normalize(item, node))
		}
		kind := "union"
		if flags&shimchecker.TypeFlagsIntersection != 0 {
			kind = "intersection"
		}
		return map[string]any{"kind": kind, "types": canonicalObservedTypes(items)}
	}
	if shimchecker.IsTupleType(t) {
		items := []any{}
		locations := tupleValueElements(node)
		for index, item := range shimchecker.Checker_getTypeArguments(n.x.checker, t) {
			location := node
			if index < len(locations) {
				location = locations[index]
			}
			items = append(items, n.normalize(item, location))
		}
		return map[string]any{"kind": "tuple", "elements": items, "readonly": t.TargetTupleType().IsReadonly()}
	}
	if shimchecker.Checker_isArrayType(n.x.checker, t) {
		arguments := shimchecker.Checker_getTypeArguments(n.x.checker, t)
		if len(arguments) == 0 {
			return map[string]any{"kind": "array", "element": n.unsupported(t, node, "array element"), "readonly": false}
		}
		readonly := false
		if symbol := stableTypeSymbol(t); symbol != nil {
			readonly = symbol.Name == "ReadonlyArray"
		}
		return map[string]any{"kind": "array", "element": n.normalize(arguments[0], nil), "readonly": readonly}
	}
	if symbol := stableTypeSymbol(t); stableDeclarationSymbol(symbol) && symbol != n.declaringAlias {
		arguments := typeArguments(n.x.checker, t, node, n)
		// TypeScript-Go can retain a mapped standard-library alias while omitting its
		// instantiated arguments for inferred values such as Object.freeze(...).
		// A zero-argument generic reference is not usable semantic evidence; retain
		// the checker-resolved object below instead of emitting an empty shell.
		if !genericReferenceWithoutArguments(symbol, arguments) {
			return n.reference(symbol, arguments)
		}
	}
	if flags&shimchecker.TypeFlagsObject != 0 {
		calls := shimchecker.Checker_getSignaturesOfType(n.x.checker, t, shimchecker.SignatureKindCall)
		if len(calls) != 0 {
			callables := n.callables(calls, node)
			result := map[string]any{"kind": "function", "callable": callables[0]}
			if len(callables) > 1 {
				result["overloads"] = callables
			}
			return result
		}
		indexes := shimchecker.Checker_getIndexInfosOfType(n.x.checker, t)
		properties := shimchecker.Checker_getPropertiesOfType(n.x.checker, t)
		if len(indexes) == 1 && len(properties) == 0 {
			return map[string]any{
				"kind": "record", "key": n.normalize(indexes[0].KeyType(), node),
				"value": n.normalize(indexes[0].ValueType(), node),
			}
		}
		if len(indexes) != 0 {
			return n.unsupported(t, node, "mixed object index signature")
		}
		return map[string]any{"kind": "object", "members": n.membersOfType(t, nil)}
	}
	return n.unsupported(t, node, "type")
}

func normalizedTypeNodeKind(kind shimast.Kind) bool {
	switch kind {
	case shimast.KindParenthesizedType, shimast.KindOptionalType, shimast.KindRestType,
		shimast.KindNamedTupleMember, shimast.KindTypeOperator, shimast.KindConditionalType,
		shimast.KindTemplateLiteralType,
		shimast.KindIndexedAccessType, shimast.KindUnionType, shimast.KindIntersectionType,
		shimast.KindArrayType, shimast.KindTupleType, shimast.KindFunctionType,
		shimast.KindConstructorType, shimast.KindTypeLiteral, shimast.KindTypeReference,
		shimast.KindTypeQuery, shimast.KindImportType,
		shimast.KindStringKeyword, shimast.KindBooleanKeyword, shimast.KindNumberKeyword,
		shimast.KindBigIntKeyword, shimast.KindSymbolKeyword, shimast.KindObjectKeyword,
		shimast.KindUnknownKeyword, shimast.KindUndefinedKeyword,
		shimast.KindNullKeyword, shimast.KindVoidKeyword, shimast.KindNeverKeyword,
		shimast.KindAnyKeyword, shimast.KindLiteralType:
		return true
	}
	return false
}

func templateLiteralTypeParts(node *shimast.Node) ([]string, []*shimast.Node) {
	texts := []string{}
	expressions := []*shimast.Node{}
	node.ForEachChild(func(child *shimast.Node) bool {
		if child.Kind == shimast.KindTemplateHead {
			texts = append(texts, child.Text())
			return false
		}
		if child.Kind != shimast.KindTemplateLiteralTypeSpan {
			return false
		}
		var expression *shimast.Node
		var literal *shimast.Node
		child.ForEachChild(func(candidate *shimast.Node) bool {
			if candidate.Kind == shimast.KindTemplateMiddle || candidate.Kind == shimast.KindTemplateTail {
				literal = candidate
			} else if expression == nil {
				expression = candidate
			}
			return false
		})
		if expression != nil {
			expressions = append(expressions, expression)
		}
		if literal != nil {
			texts = append(texts, literal.Text())
		}
		return false
	})
	return texts, expressions
}

func moduleQualifiedName(checker *shimchecker.Checker, name *shimast.Node) bool {
	if name == nil || name.Kind != shimast.KindQualifiedName {
		return false
	}
	owner := unalias(checker, checker.GetSymbolAtLocation(name.AsQualifiedName().Left))
	return owner != nil && owner.Flags&shimast.SymbolFlagsModule != 0
}

// A type query for a constant literal denotes the literal type, not a public
// dependency on the implementation variable that happened to carry it. This
// also makes the result independent of whether a compiler exposes the queried
// value symbol through GetSymbolAtLocation.
func observedTypeQueryIntrinsic(t *shimchecker.Type) any {
	if t == nil {
		return nil
	}
	flags := t.Flags()
	if flags&shimchecker.TypeFlagsLiteral != 0 {
		return literalFromChecker(t)
	}
	if flags&shimchecker.TypeFlagsStringLike != 0 {
		return primitive("string")
	}
	if flags&shimchecker.TypeFlagsNumberLike != 0 {
		return primitive("number")
	}
	if flags&shimchecker.TypeFlagsBigIntLike != 0 {
		return primitive("bigint")
	}
	if flags&shimchecker.TypeFlagsESSymbolLike != 0 {
		return primitive("symbol")
	}
	if flags&shimchecker.TypeFlagsNonPrimitive != 0 {
		return primitive("object")
	}
	if flags&shimchecker.TypeFlagsBooleanLike != 0 {
		return primitive("boolean")
	}
	if flags&shimchecker.TypeFlagsUndefined != 0 {
		return map[string]any{"kind": "undefined"}
	}
	if flags&shimchecker.TypeFlagsNull != 0 {
		return map[string]any{"kind": "null"}
	}
	return nil
}

func (n *nativeTypeNormalizer) referenceFromNode(t *shimchecker.Type, node *shimast.Node) any {
	reference := node.AsTypeReferenceNode()
	name := nodeText(shimast.GetSourceFileOfNode(node), reference.TypeName)
	symbol := unalias(n.x.checker, n.x.checker.GetSymbolAtLocation(reference.TypeName))
	arguments := []any{}
	if reference.TypeArguments != nil {
		for _, argument := range reference.TypeArguments.Nodes {
			arguments = append(arguments, n.normalizeTypeNode(argument))
		}
	}
	if (name == "Array" || name == "ReadonlyArray") && platformSymbol(symbol) {
		if len(arguments) == 0 {
			return map[string]any{"kind": "array", "element": n.unsupported(t, node, "array element"), "readonly": name == "ReadonlyArray"}
		}
		return map[string]any{"kind": "array", "element": arguments[0], "readonly": name == "ReadonlyArray"}
	}
	if name == "Record" && len(arguments) == 2 {
		return map[string]any{"kind": "record", "key": arguments[0], "value": arguments[1]}
	}
	if name == "Readonly" && reference.TypeArguments != nil && len(reference.TypeArguments.Nodes) == 1 {
		inner := reference.TypeArguments.Nodes[0]
		if inner.Kind == shimast.KindTypeReference {
			innerReference := inner.AsTypeReferenceNode()
			innerName := nodeText(shimast.GetSourceFileOfNode(inner), innerReference.TypeName)
			if innerName == "Record" && innerReference.TypeArguments != nil && len(innerReference.TypeArguments.Nodes) == 2 {
				return map[string]any{
					"kind":  "record",
					"key":   n.normalizeTypeNode(innerReference.TypeArguments.Nodes[0]),
					"value": n.normalizeTypeNode(innerReference.TypeArguments.Nodes[1]),
				}
			}
		}
	}
	if binding, exists := n.symbolBinding(symbol); exists {
		return map[string]any{"kind": "parameter", "scope": binding["scope"], "index": binding["index"]}
	}
	if !stableDeclarationSymbol(symbol) {
		return nil
	}
	if name == "Uint8Array" || name == "ArrayBuffer" {
		return primitive("bytes")
	}
	if platformReferenceTypes[name] && platformSymbol(symbol) {
		return map[string]any{"kind": "reference", "identity": "platform:typescript#" + name, "name": name, "arguments": arguments}
	}
	return n.reference(symbol, arguments)
}

func genericReferenceWithoutArguments(symbol *shimast.Symbol, arguments []any) bool {
	if len(arguments) != 0 {
		return false
	}
	for _, declaration := range symbol.Declarations {
		switch declaration.Kind {
		case shimast.KindClassDeclaration, shimast.KindInterfaceDeclaration, shimast.KindTypeAliasDeclaration:
			if len(declaration.TypeParameters()) != 0 {
				return true
			}
		}
	}
	return false
}

func (n *nativeTypeNormalizer) reference(symbol *shimast.Symbol, arguments []any) any {
	identity := n.x.publicSymbolIdentity(symbol)
	if identity == "" {
		identity = "ts:<synthetic>#" + percentEncode(symbol.Name)
	}
	n.references[identity] = symbol
	if arguments == nil {
		arguments = []any{}
	}
	return map[string]any{"kind": "reference", "identity": identity, "name": symbol.Name, "arguments": arguments}
}

func (n *nativeTypeNormalizer) unsupported(t *shimchecker.Type, node *shimast.Node, reason string) any {
	display := "<unprintable TypeScript type>"
	if t != nil {
		display = shimchecker.Checker_typeToStringFullyQualified(n.x.checker, t, node)
	}
	location := sourceLocation{File: ".", Line: 1, Column: 1}
	if node != nil {
		location = n.x.location(shimast.GetSourceFileOfNode(node), node)
	}
	*n.issues = append(*n.issues, map[string]any{
		"code": "TYPESCRIPT_TYPE_UNSUPPORTED", "message": fmt.Sprintf("Cannot establish conformance for %s: %s", reason, display),
		"location": location, "actual": display,
	})
	return map[string]any{"kind": "unsupported", "reason": reason, "display": display}
}

func (n *nativeTypeNormalizer) bindTypeParameters(nodes []*shimast.Node, scope string) func() {
	type prior struct {
		symbol  *shimast.Symbol
		binding map[string]any
		present bool
	}
	previous := []prior{}
	names := []string{}
	for index, node := range nodes {
		symbol := n.x.checker.GetSymbolAtLocation(node.Name())
		if symbol == nil {
			continue
		}
		priorBinding, present := n.bindings[symbol]
		previous = append(previous, prior{symbol: symbol, binding: priorBinding, present: present})
		binding := map[string]any{"scope": scope, "index": index}
		n.bindings[symbol] = binding
		name := nodeText(shimast.GetSourceFileOfNode(node), node.Name())
		n.bindingNames[name] = append(n.bindingNames[name], binding)
		names = append(names, name)
	}
	return func() {
		for _, item := range previous {
			if item.present {
				n.bindings[item.symbol] = item.binding
			} else {
				delete(n.bindings, item.symbol)
			}
		}
		for _, name := range names {
			bindings := n.bindingNames[name]
			if len(bindings) <= 1 {
				delete(n.bindingNames, name)
			} else {
				n.bindingNames[name] = bindings[:len(bindings)-1]
			}
		}
	}
}

func (n *nativeTypeNormalizer) typeParameterBinding(t *shimchecker.Type, node *shimast.Node) (map[string]any, bool) {
	candidates := []*shimast.Symbol{t.Symbol(), stableTypeSymbol(t)}
	if node != nil {
		candidates = append(candidates, n.x.checker.GetSymbolAtLocation(node))
	}
	for _, symbol := range candidates {
		if binding, exists := n.symbolBinding(symbol); exists {
			return binding, true
		}
	}
	// TypeScript-Go can expand an authored generic alias inside a union while
	// retaining the alias declaration's syntax node. The checker type is already
	// substituted into the caller's type parameter, but none of the symbol
	// wrappers are pointer- or declaration-identical to the active binding. A
	// name fallback is sound only when exactly one active lexical binding owns
	// the checker's simple parameter name; ambiguity remains explicitly
	// unsupported instead of guessing across nested scopes.
	display := shimchecker.Checker_typeToStringFullyQualified(n.x.checker, t, node)
	if binding, exists := n.uniqueBindingByName(display); exists {
		return binding, true
	}
	return nil, false
}

func (n *nativeTypeNormalizer) uniqueBindingByName(name string) (map[string]any, bool) {
	if name == "" || strings.ContainsAny(name, ".<>{}[]()|& ,:\t\n\r") {
		return nil, false
	}
	bindings := n.bindingNames[name]
	if len(bindings) != 1 {
		return nil, false
	}
	return bindings[0], true
}

func (n *nativeTypeNormalizer) symbolBinding(symbol *shimast.Symbol) (map[string]any, bool) {
	if symbol == nil {
		return nil, false
	}
	if binding, exists := n.bindings[symbol]; exists {
		return binding, true
	}
	declaration := firstDeclaration(symbol)
	if declaration == nil {
		return nil, false
	}
	file := shimast.GetSourceFileOfNode(declaration)
	for candidate, binding := range n.bindings {
		candidateDeclaration := firstDeclaration(candidate)
		if candidateDeclaration == declaration {
			return binding, true
		}
		candidateFile := shimast.GetSourceFileOfNode(candidateDeclaration)
		if file != nil && candidateFile != nil && file.FileName() == candidateFile.FileName() && declaration.Pos() == candidateDeclaration.Pos() && stableSymbolName(symbol) == stableSymbolName(candidate) {
			return binding, true
		}
	}
	return nil, false
}

func containingTypeSymbol(node *shimast.Node) *shimast.Symbol {
	for parent := node.Parent; parent != nil; parent = parent.Parent {
		if parent.Kind == shimast.KindClassDeclaration || parent.Kind == shimast.KindInterfaceDeclaration {
			return parent.Symbol()
		}
	}
	return nil
}

func (n *nativeTypeNormalizer) typeParameters(nodes []*shimast.Node, scope string) []any {
	values := []any{}
	for index, node := range nodes {
		parameter := node.AsTypeParameterDeclaration()
		value := map[string]any{
			"scope": scope, "index": index, "name": nodeText(shimast.GetSourceFileOfNode(node), node.Name()),
			"location": n.x.location(shimast.GetSourceFileOfNode(node), node),
		}
		flags := node.ModifierFlags()
		if flags&shimast.ModifierFlagsIn != 0 && flags&shimast.ModifierFlagsOut != 0 {
			value["variance"] = "in-out"
		} else if flags&shimast.ModifierFlagsIn != 0 {
			value["variance"] = "in"
		} else if flags&shimast.ModifierFlagsOut != 0 {
			value["variance"] = "out"
		}
		if flags&shimast.ModifierFlagsConst != 0 {
			value["const"] = true
		}
		if parameter.Constraint != nil {
			value["constraint"] = n.normalizeTypeNode(parameter.Constraint)
		}
		if parameter.DefaultType != nil {
			value["default"] = n.normalizeTypeNode(parameter.DefaultType)
		}
		values = append(values, value)
	}
	return values
}

func (n *nativeTypeNormalizer) callables(signatures []*shimchecker.Signature, fallback *shimast.Node) []any {
	values := []any{}
	for _, signature := range signatures {
		values = append(values, n.callable(signature, fallback))
	}
	return values
}

func (n *nativeTypeNormalizer) callable(signature *shimchecker.Signature, fallback *shimast.Node) any {
	declaration := fallback
	if signature != nil && signature.Declaration() != nil {
		declaration = signature.Declaration()
	}
	parameters := []any{}
	typeParameterNodes := []*shimast.Node{}
	if declaration != nil && callableCanDeclareTypeParameters(declaration.Kind) {
		typeParameterNodes = declaration.TypeParameters()
	}
	scope := n.x.typeParameterScope(declaration)
	restore := n.bindTypeParameters(typeParameterNodes, scope)
	defer restore()
	for index, parameterSymbol := range shimchecker.Signature_parameters(signature) {
		parameterDeclaration := firstDeclaration(parameterSymbol)
		if parameterDeclaration == nil {
			parameterDeclaration = declaration
		}
		parameterType := shimchecker.Checker_getTypeOfSymbolAtLocation(n.x.checker, parameterSymbol, parameterDeclaration)
		optional := parameterSymbol.Flags&shimast.SymbolFlagsOptional != 0
		rest := false
		if parameterDeclaration != nil && parameterDeclaration.Kind == shimast.KindParameter {
			parameter := parameterDeclaration.AsParameterDeclaration()
			optional = optional || parameter.QuestionToken != nil || parameter.Initializer != nil
			rest = parameter.DotDotDotToken != nil
		}
		var observed any
		if optional && parameterDeclaration != nil && parameterDeclaration.Kind == shimast.KindParameter && parameterDeclaration.Type() != nil {
			authored := n.x.checker.GetTypeFromTypeNode(parameterDeclaration.Type())
			if !checkerTypeContainsParameter(n.x.checker, authored, map[uint32]bool{}) {
				observed = n.normalize(authored, parameterDeclaration.Type())
			}
		}
		if observed == nil {
			observed = n.normalize(parameterType, parameterDeclaration)
		}
		if optional && (parameterDeclaration == nil || parameterDeclaration.Type() == nil || checkerTypeContainsParameter(n.x.checker, n.x.checker.GetTypeFromTypeNode(parameterDeclaration.Type()), map[uint32]bool{})) {
			observed = withoutUndefinedObserved(observed)
		}
		parameters = append(parameters, map[string]any{
			"name": parameterSymbol.Name, "index": index, "optional": optional, "rest": rest,
			"type": observed, "location": n.x.location(shimast.GetSourceFileOfNode(parameterDeclaration), parameterDeclaration),
		})
	}
	rawReturn := shimchecker.Checker_getReturnTypeOfSignature(n.x.checker, signature)
	returnNode := returnTypeNode(declaration)
	assertedReturn := false
	if returnNode == nil {
		returnNode = callableReturnAssertionTypeNode(declaration)
		assertedReturn = returnNode != nil
	}
	returnType, returnNode, promised := n.promiseArgument(rawReturn, returnNode)
	var observedReturn any
	if returnNode != nil && (assertedReturn || n.x.checker.GetTypeFromTypeNode(returnNode) == returnType) {
		// Callable contracts are authored at the return type node. Checker reduction
		// may erase a named alias or indexed access even though both are stable public
		// semantics. The identity check is essential for instantiated generic callable
		// aliases: their declaration can still spell `T` while the signature's return
		// is already substituted, so re-reading the declaration would invent an
		// unbound parameter. Every return is normalized exactly once so diagnostics
		// remain a set of semantic observations rather than traversal artefacts.
		observedReturn = n.normalizeTypeNode(returnNode)
	} else {
		// Inferred returns and instantiated declarations use the resolved Checker type.
		observedReturn = n.normalize(returnType, returnNode)
	}
	result := map[string]any{
		"parameters": parameters, "returns": observedReturn,
		"mode":     map[bool]string{true: "async", false: "sync"}[promised],
		"location": n.x.location(shimast.GetSourceFileOfNode(declaration), declaration), "issues": []any{},
	}
	if values := n.typeParameters(typeParameterNodes, scope); len(values) != 0 {
		result["typeParameters"] = values
	}
	return result
}

func (n *nativeTypeNormalizer) callableFromFunctionNode(node *shimast.Node) any {
	t := n.x.checker.GetTypeFromTypeNode(node)
	signatures := shimchecker.Checker_getSignaturesOfType(n.x.checker, t, shimchecker.SignatureKindCall)
	if node.Kind == shimast.KindConstructorType {
		signatures = shimchecker.Checker_getSignaturesOfType(n.x.checker, t, 1)
	}
	if len(signatures) == 0 {
		return n.callable(nil, node)
	}
	return n.callable(signatures[0], node)
}

func (n *nativeTypeNormalizer) promiseArgument(t *shimchecker.Type, node *shimast.Node) (*shimchecker.Type, *shimast.Node, bool) {
	if t == nil {
		return t, node, false
	}
	if node != nil && node.Kind == shimast.KindTypeReference {
		reference := node.AsTypeReferenceNode()
		symbol := unalias(n.x.checker, n.x.checker.GetSymbolAtLocation(reference.TypeName))
		if symbol != nil && symbol.Name == "Promise" && reference.TypeArguments != nil && len(reference.TypeArguments.Nodes) != 0 {
			argument := reference.TypeArguments.Nodes[0]
			return n.x.checker.GetTypeFromTypeNode(argument), argument, true
		}
	}
	symbol := stableTypeSymbol(t)
	if symbol == nil || symbol.Name != "Promise" {
		return t, node, false
	}
	arguments := shimchecker.Checker_getTypeArguments(n.x.checker, t)
	if len(arguments) == 0 {
		return t, node, false
	}
	return arguments[0], nil, true
}

func (n *nativeTypeNormalizer) membersFromNodes(nodes []*shimast.Node) []any {
	values := []any{}
	for _, node := range nodes {
		if member := n.memberFromNode(node); member != nil {
			values = append(values, member)
		}
	}
	sort.Slice(values, func(i, j int) bool {
		return values[i].(map[string]any)["name"].(string) < values[j].(map[string]any)["name"].(string)
	})
	return values
}

func (n *nativeTypeNormalizer) membersOfType(t *shimchecker.Type, owner *shimast.Node) []any {
	values := []any{}
	for _, symbol := range shimchecker.Checker_getPropertiesOfType(n.x.checker, t) {
		declaration := publicMemberDeclaration(symbol, owner)
		if declaration == nil {
			continue
		}
		if member := n.member(symbol, declaration, owner != nil); member != nil {
			values = append(values, member)
		}
	}
	sort.Slice(values, func(i, j int) bool {
		return values[i].(map[string]any)["name"].(string) < values[j].(map[string]any)["name"].(string)
	})
	return values
}

func (n *nativeTypeNormalizer) memberFromNode(node *shimast.Node) any {
	symbol := node.Symbol()
	if symbol == nil && node.Name() != nil {
		symbol = n.x.checker.GetSymbolAtLocation(node.Name())
	}
	if symbol == nil {
		return nil
	}
	return n.member(symbol, node, true)
}

func (n *nativeTypeNormalizer) member(symbol *shimast.Symbol, declaration *shimast.Node, preferAuthored bool) any {
	if declaration.ModifierFlags()&shimast.ModifierFlagsNonPublicAccessibilityModifier != 0 ||
		(declaration.Name() != nil && declaration.Name().Kind == shimast.KindPrivateIdentifier) {
		return nil
	}
	name := symbol.Name
	if name == "" {
		return nil
	}
	memberType := shimchecker.Checker_getTypeOfSymbolAtLocation(n.x.checker, symbol, declaration)
	optional := symbol.Flags&shimast.SymbolFlagsOptional != 0 || declaration.QuestionToken() != nil
	key := "named"
	if declaration.Name() != nil && declaration.Name().Kind == shimast.KindComputedPropertyName {
		computed := declaration.Name().AsComputedPropertyName()
		expression := computed.Expression
		expressionSymbol := n.x.checker.GetSymbolAtLocation(expression)
		var expressionType *shimchecker.Type
		if expressionSymbol != nil {
			expressionType = shimchecker.Checker_getTypeOfSymbolAtLocation(n.x.checker, expressionSymbol, expression)
		}
		if expressionType != nil && expressionType.Flags()&shimchecker.TypeFlagsUniqueESSymbol != 0 {
			name = nodeText(shimast.GetSourceFileOfNode(declaration), expression)
			key = "unique-symbol"
		} else {
			*n.issues = append(*n.issues, observationIssue(
				"TYPESCRIPT_COMPUTED_MEMBER_UNSUPPORTED",
				"Only unique-symbol computed public members are supported: "+nodeText(shimast.GetSourceFileOfNode(declaration), declaration.Name()),
				n.x.location(shimast.GetSourceFileOfNode(declaration), declaration),
			))
			return nil
		}
	}
	value := map[string]any{
		"name": name, "key": key, "optional": optional,
		"readonly": declaration.ModifierFlags()&shimast.ModifierFlagsReadonly != 0,
		"location": n.x.location(shimast.GetSourceFileOfNode(declaration), declaration),
	}
	method := declaration.Kind == shimast.KindMethodSignature || declaration.Kind == shimast.KindMethodDeclaration
	signatures := shimchecker.Checker_getSignaturesOfType(n.x.checker, memberType, shimchecker.SignatureKindCall)
	if method && len(signatures) != 0 {
		callables := n.callables(signatures, declaration)
		value["callable"] = callables[0]
		if len(callables) > 1 {
			value["overloads"] = callables
		}
	} else {
		if preferAuthored {
			n.forceAuthoredDeclarations++
			defer func() { n.forceAuthoredDeclarations-- }()
		}
		observed := n.normalize(memberType, declaration)
		if optional {
			// With exactOptionalPropertyTypes disabled (the TypeScript default),
			// an optional `never` property is observed as `undefined`: it may only
			// be absent, and a read produces undefined. TypeScript-Go currently
			// returns the authored `never` here while the Node checker returns the
			// effective property type, so make the option's public semantics stable.
			if record, ok := observed.(map[string]any); ok && record["kind"] == "never" {
				observed = map[string]any{"kind": "undefined"}
			}
			observed = withoutUndefinedObserved(observed)
		}
		value["type"] = observed
	}
	return value
}

func publicMemberDeclaration(symbol *shimast.Symbol, owner *shimast.Node) *shimast.Node {
	for _, declaration := range symbol.Declarations {
		if owner != nil && !nodeDescendsFrom(declaration, owner) {
			continue
		}
		if declaration.ModifierFlags()&shimast.ModifierFlagsNonPublicAccessibilityModifier != 0 ||
			(declaration.Name() != nil && declaration.Name().Kind == shimast.KindPrivateIdentifier) {
			continue
		}
		return declaration
	}
	return nil
}

func nodeDescendsFrom(node, owner *shimast.Node) bool {
	for current := node.Parent; current != nil; current = current.Parent {
		if current == owner {
			return true
		}
	}
	return false
}

func constituentTypeNodes(checker *shimchecker.Checker, types []*shimchecker.Type, nodes []*shimast.Node) []*shimast.Node {
	candidates := make([]*shimchecker.Type, len(nodes))
	for index, node := range nodes {
		candidates[index] = checker.GetTypeFromTypeNode(node)
	}
	claimed := map[int]bool{}
	result := make([]*shimast.Node, len(types))
	for index, item := range types {
		for candidateIndex, candidate := range candidates {
			if claimed[candidateIndex] || candidate != item {
				continue
			}
			claimed[candidateIndex] = true
			result[index] = nodes[candidateIndex]
			break
		}
	}
	return result
}

func tupleElementLocation(checker *shimchecker.Checker, item *shimchecker.Type, node *shimast.Node) *shimast.Node {
	if node == nil {
		return nil
	}
	var rest *shimast.Node
	if node.Kind == shimast.KindRestType {
		rest = node.AsRestTypeNode().Type
	} else if node.Kind == shimast.KindNamedTupleMember && node.AsNamedTupleMember().DotDotDotToken != nil {
		rest = node.AsNamedTupleMember().Type
	}
	if rest != nil {
		if shimchecker.Checker_isArrayType(checker, item) {
			return rest
		}
		if rest.Kind == shimast.KindArrayType {
			return rest.AsArrayTypeNode().ElementType
		}
		if rest.Kind == shimast.KindTypeReference {
			reference := rest.AsTypeReferenceNode()
			name := nodeText(shimast.GetSourceFileOfNode(rest), reference.TypeName)
			if (name == "Array" || name == "ReadonlyArray") && reference.TypeArguments != nil && len(reference.TypeArguments.Nodes) != 0 {
				return reference.TypeArguments.Nodes[0]
			}
		}
		return rest
	}
	if node.Kind == shimast.KindNamedTupleMember {
		return node.AsNamedTupleMember().Type
	}
	if node.Kind == shimast.KindOptionalType {
		return node.AsOptionalTypeNode().Type
	}
	return node
}

func typeArguments(checker *shimchecker.Checker, t *shimchecker.Type, node *shimast.Node, normalizer *nativeTypeNormalizer) []any {
	values := []any{}
	if source := unwrappedObservedTypeNode(node); source != nil {
		switch source.Kind {
		case shimast.KindTypeQuery:
			return values
		case shimast.KindTypeReference:
			reference := source.AsTypeReferenceNode()
			if reference.TypeArguments != nil {
				for _, argument := range reference.TypeArguments.Nodes {
					values = append(values, normalizer.normalizeTypeNode(argument))
				}
			}
			return values
		case shimast.KindImportType:
			reference := source.AsImportTypeNode()
			if reference.TypeArguments != nil {
				for _, argument := range reference.TypeArguments.Nodes {
					values = append(values, normalizer.normalizeTypeNode(argument))
				}
			}
			return values
		}
	}
	if t == nil || t.Flags()&shimchecker.TypeFlagsObject == 0 || t.ObjectFlags()&shimchecker.ObjectFlagsReference == 0 {
		return values
	}
	for _, argument := range shimchecker.Checker_getTypeArguments(checker, t) {
		values = append(values, normalizer.normalize(argument, node))
	}
	return values
}

func unwrappedObservedTypeNode(node *shimast.Node) *shimast.Node {
	if node == nil {
		return nil
	}
	current := node
	if !normalizedTypeNodeKind(current.Kind) {
		current = current.Type()
	}
	for current != nil {
		switch current.Kind {
		case shimast.KindParenthesizedType, shimast.KindOptionalType, shimast.KindRestType, shimast.KindNamedTupleMember:
			current = current.Type()
		case shimast.KindTypeOperator:
			if current.AsTypeOperatorNode().Operator != shimast.KindReadonlyKeyword {
				return current
			}
			current = current.AsTypeOperatorNode().Type
		default:
			return current
		}
	}
	return nil
}

// authoredValueTypeNode recovers an explicit value annotation when the
// checker has reduced an inferred tuple element or other value expression to
// its structural type and discarded the alias wrapper. This is provenance
// recovery from authored syntax, not name matching: the expression must
// resolve to the annotated declaration symbol.
func authoredValueTypeNode(checker *shimchecker.Checker, node *shimast.Node) *shimast.Node {
	if node == nil || normalizedTypeNodeKind(node.Kind) {
		return nil
	}
	current := node
	for current != nil {
		switch current.Kind {
		case shimast.KindParenthesizedExpression:
			current = current.AsParenthesizedExpression().Expression
		case shimast.KindAsExpression, shimast.KindTypeAssertionExpression:
			if authored := current.Type(); authored != nil {
				return authored
			}
			current = current.Expression()
		default:
			symbol := unalias(checker, checker.GetSymbolAtLocation(current))
			if symbol == nil {
				return nil
			}
			for _, declaration := range symbol.Declarations {
				switch declaration.Kind {
				case shimast.KindVariableDeclaration, shimast.KindPropertyDeclaration:
					if authored := declaration.Type(); authored != nil {
						return authored
					}
				}
			}
			return nil
		}
	}
	return nil
}

func tupleValueElements(node *shimast.Node) []*shimast.Node {
	if node == nil {
		return nil
	}
	var initializer *shimast.Node
	switch node.Kind {
	case shimast.KindVariableDeclaration:
		initializer = node.AsVariableDeclaration().Initializer
	case shimast.KindPropertyDeclaration:
		initializer = node.AsPropertyDeclaration().Initializer
	case shimast.KindParameter:
		initializer = node.AsParameterDeclaration().Initializer
	case shimast.KindPropertyAssignment:
		initializer = node.AsPropertyAssignment().Initializer
	default:
		// Node.Initializer is a partial TypeScript-Go accessor that panics on
		// type nodes, signatures, and many other valid provenance locations.
		// Those nodes have no value elements to align with a checker tuple.
		return nil
	}
	for initializer != nil {
		switch initializer.Kind {
		case shimast.KindParenthesizedExpression, shimast.KindAsExpression, shimast.KindTypeAssertionExpression, shimast.KindSatisfiesExpression:
			initializer = initializer.Expression()
		default:
			if initializer.Kind == shimast.KindArrayLiteralExpression {
				return initializer.AsArrayLiteralExpression().Elements.Nodes
			}
			return nil
		}
	}
	return nil
}

// boundTypeParameterArguments returns the alias arguments TypeScript exposes
// for a generic merged factory (`type Factory<T> = ...; const Factory = ...`).
// TypeScript-Go does not currently surface aliasTypeArguments through its
// public shim for all non-reference RHS shapes, but the declaration's bound
// parameters are the exact semantic arguments at this observation point.
func boundTypeParameterArguments(nodes []*shimast.Node, normalizer *nativeTypeNormalizer) []any {
	values := make([]any, 0, len(nodes))
	for _, node := range nodes {
		symbol := normalizer.x.checker.GetSymbolAtLocation(node.Name())
		binding, exists := normalizer.bindings[symbol]
		if !exists {
			continue
		}
		values = append(values, map[string]any{
			"kind": "parameter", "scope": binding["scope"], "index": binding["index"],
		})
	}
	return values
}

func stableTypeSymbol(t *shimchecker.Type) *shimast.Symbol {
	if t == nil {
		return nil
	}
	if symbol := shimchecker.Type_getTypeNameSymbol(t); symbol != nil {
		return symbol
	}
	return t.Symbol()
}

func stableReferenceAt(checker *shimchecker.Checker, node *shimast.Node) bool {
	if node == nil {
		return false
	}
	var reference *shimast.Node
	switch node.Kind {
	case shimast.KindTypeReference:
		reference = node.AsTypeReferenceNode().TypeName
	case shimast.KindImportType:
		reference = node.AsImportTypeNode().Qualifier
	case shimast.KindTypeQuery:
		reference = node.AsTypeQueryNode().ExprName
	}
	if reference == nil {
		return false
	}
	symbol := unalias(checker, checker.GetSymbolAtLocation(reference))
	return stableDeclarationSymbol(symbol)
}

func syntheticSymbol(symbol *shimast.Symbol) bool {
	return symbol == nil || symbol.Name == "" || strings.HasPrefix(symbol.Name, "\xFE")
}

func stableDeclarationSymbol(symbol *shimast.Symbol) bool {
	if syntheticSymbol(symbol) {
		return false
	}
	for _, declaration := range symbol.Declarations {
		if declaration.Kind == shimast.KindTypeParameter {
			continue
		}
		name := declaration.Name()
		if name != nil && name.Kind != shimast.KindComputedPropertyName {
			return true
		}
	}
	return false
}

func platformSymbol(symbol *shimast.Symbol) bool {
	for _, declaration := range symbol.Declarations {
		file := shimast.GetSourceFileOfNode(declaration)
		if file != nil && file.IsDeclarationFile && typescriptLibraryFile(file.FileName()) != "" {
			return true
		}
	}
	return false
}

func returnTypeNode(node *shimast.Node) *shimast.Node {
	if node == nil {
		return nil
	}
	switch node.Kind {
	case shimast.KindFunctionDeclaration, shimast.KindArrowFunction, shimast.KindFunctionExpression,
		shimast.KindFunctionType, shimast.KindConstructorType, shimast.KindMethodSignature,
		shimast.KindMethodDeclaration, shimast.KindCallSignature, shimast.KindConstructSignature:
		return node.Type()
	}
	return nil
}

// A concise arrow assertion is exact authored return evidence. Block-bodied
// functions remain the responsibility of body/control-flow analysis.
func callableReturnAssertionTypeNode(node *shimast.Node) *shimast.Node {
	if node == nil {
		return nil
	}
	var body *shimast.Node
	if node.Kind == shimast.KindArrowFunction {
		body = node.AsArrowFunction().Body
	} else if node.Kind == shimast.KindVariableDeclaration {
		initializer := node.AsVariableDeclaration().Initializer
		for initializer != nil && initializer.Kind == shimast.KindParenthesizedExpression {
			initializer = initializer.AsParenthesizedExpression().Expression
		}
		if initializer != nil && initializer.Kind == shimast.KindArrowFunction {
			body = initializer.AsArrowFunction().Body
		}
	}
	if body == nil || body.Kind == shimast.KindBlock {
		return nil
	}
	for body.Kind == shimast.KindParenthesizedExpression {
		body = body.AsParenthesizedExpression().Expression
	}
	if body.Kind == shimast.KindAsExpression || body.Kind == shimast.KindTypeAssertionExpression {
		return body.Type()
	}
	return nil
}

// An authored optional annotation can replace the checker's T | undefined
// wrapper unless doing so would erase a real generic instantiation.
func checkerTypeContainsParameter(checker *shimchecker.Checker, t *shimchecker.Type, active map[uint32]bool) bool {
	if t == nil {
		return false
	}
	if t.Flags()&shimchecker.TypeFlagsTypeParameter != 0 {
		return true
	}
	id := uint32(t.Id())
	if active[id] {
		return false
	}
	active[id] = true
	defer delete(active, id)
	if t.Flags()&(shimchecker.TypeFlagsUnion|shimchecker.TypeFlagsIntersection) != 0 {
		for _, item := range t.Types() {
			if checkerTypeContainsParameter(checker, item, active) {
				return true
			}
		}
	}
	if t.Flags()&shimchecker.TypeFlagsObject != 0 && t.ObjectFlags()&shimchecker.ObjectFlagsReference != 0 {
		for _, argument := range shimchecker.Checker_getTypeArguments(checker, t) {
			if checkerTypeContainsParameter(checker, argument, active) {
				return true
			}
		}
	}
	return false
}

func primitive(name string) map[string]any { return map[string]any{"kind": "primitive", "name": name} }

func callableCanDeclareTypeParameters(kind shimast.Kind) bool {
	switch kind {
	case shimast.KindFunctionDeclaration, shimast.KindFunctionExpression, shimast.KindArrowFunction,
		shimast.KindFunctionType, shimast.KindConstructorType, shimast.KindMethodSignature,
		shimast.KindMethodDeclaration, shimast.KindCallSignature, shimast.KindConstructSignature:
		return true
	default:
		return false
	}
}

func literalFromTypeNode(node *shimast.Node, t *shimchecker.Type) any {
	literal := node.AsLiteralTypeNode().Literal
	if literal != nil && (literal.Kind == shimast.KindStringLiteral || literal.Kind == shimast.KindNoSubstitutionTemplateLiteral) {
		return literalFromSyntax(
			literal.Kind,
			literal.Text(),
			nodeText(shimast.GetSourceFileOfNode(node), node),
			t,
		)
	}
	return literalFromText(nodeText(shimast.GetSourceFileOfNode(node), node), t)
}

func literalFromSyntax(kind shimast.Kind, value string, authored string, t *shimchecker.Type) any {
	if kind == shimast.KindStringLiteral || kind == shimast.KindNoSubstitutionTemplateLiteral {
		return map[string]any{"kind": "literal", "value": value}
	}
	return literalFromText(authored, t)
}

func literalFromText(text string, t *shimchecker.Type) any {
	text = strings.TrimSpace(text)
	if text == "null" {
		return map[string]any{"kind": "null"}
	}
	if value, err := strconv.Unquote(text); err == nil {
		return map[string]any{"kind": "literal", "value": value}
	}
	if text == "true" {
		return map[string]any{"kind": "literal", "value": true}
	}
	if text == "false" {
		return map[string]any{"kind": "literal", "value": false}
	}
	if strings.HasSuffix(text, "n") {
		value := strings.TrimSuffix(text, "n")
		if _, ok := new(big.Int).SetString(value, 10); ok {
			return map[string]any{"kind": "bigint-literal", "value": value}
		}
	}
	if number, err := strconv.ParseFloat(text, 64); err == nil {
		return map[string]any{"kind": "literal", "value": number}
	}
	if t != nil && t.Flags()&shimchecker.TypeFlagsLiteral != 0 {
		return literalFromChecker(t)
	}
	return map[string]any{"kind": "unsupported", "reason": "literal", "display": text}
}

func literalFromChecker(t *shimchecker.Type) any {
	if t == nil {
		return map[string]any{"kind": "unsupported", "reason": "literal", "display": "<missing>"}
	}
	value := t.AsLiteralType().Value()
	if _, ok := value.(bool); ok {
		return map[string]any{"kind": "literal", "value": value}
	}
	if _, ok := value.(string); ok {
		return map[string]any{"kind": "literal", "value": value}
	}
	rendered := shimchecker.ValueToString(value)
	if t.Flags()&shimchecker.TypeFlagsBigIntLiteral != 0 {
		return map[string]any{"kind": "bigint-literal", "value": strings.TrimSuffix(rendered, "n")}
	}
	if number, err := strconv.ParseFloat(rendered, 64); err == nil {
		return map[string]any{"kind": "literal", "value": number}
	}
	return map[string]any{"kind": "unsupported", "reason": "literal", "display": rendered}
}

func canonicalObservedTypes(values []any) []any {
	byJSON := map[string]any{}
	for _, value := range values {
		byJSON[observedTypeSortKey(value)] = value
	}
	keys := make([]string, 0, len(byJSON))
	for key := range byJSON {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	output := []any{}
	for _, key := range keys {
		output = append(output, byJSON[key])
	}
	return output
}

// V1 orders union/intersection constituents by JSON.stringify on the public
// observed-type model, whose first property is always `kind`. Go map encoding
// sorts keys and would instead place fields such as `key` before `kind`, which
// changes a semantic array's wire order. Build the equivalent structural key
// explicitly while leaving generation digests on the global canonical JSON
// contract.
func observedTypeSortKey(value any) string {
	record, ok := value.(map[string]any)
	if !ok {
		return stableJSON(value)
	}
	kind, _ := record["kind"].(string)
	key := kind + "\x00"
	child := func(name string) string { return observedTypeSortKey(record[name]) }
	children := func(name string) string {
		values, _ := record[name].([]any)
		parts := make([]string, 0, len(values))
		for _, entry := range values {
			parts = append(parts, observedTypeSortKey(entry))
		}
		return strings.Join(parts, "\x01")
	}
	switch kind {
	case "primitive":
		return key + fmt.Sprint(record["name"])
	case "reference":
		return key + fmt.Sprint(record["identity"]) + "\x00" + fmt.Sprint(record["name"]) + "\x00" + children("arguments")
	case "parameter":
		return key + fmt.Sprint(record["scope"]) + "\x00" + fmt.Sprint(record["index"])
	case "literal":
		return key + stableJSON(record["value"])
	case "bigint-literal":
		return key + fmt.Sprint(record["value"])
	case "template":
		return key + stableJSON(record["texts"]) + "\x00" + children("types")
	case "array":
		return key + child("element") + "\x00" + fmt.Sprint(record["readonly"])
	case "record":
		return key + child("key") + "\x00" + child("value")
	case "tuple":
		return key + children("elements") + "\x00" + fmt.Sprint(record["readonly"])
	case "union", "intersection":
		return key + children("types")
	case "conditional":
		return key + child("check") + "\x00" + child("extends") + "\x00" + child("trueType") + "\x00" + child("falseType")
	case "keyof":
		return key + child("type")
	case "indexed-access":
		return key + child("object") + "\x00" + child("index")
	case "object":
		members, _ := record["members"].([]any)
		parts := make([]string, 0, len(members))
		for _, member := range members {
			parts = append(parts, observedMemberSortKey(member))
		}
		return key + strings.Join(parts, "\x01")
	case "function", "constructor":
		return key + stableJSON(record["callable"]) + "\x00" + stableJSON(record["overloads"])
	case "unsupported":
		return key + fmt.Sprint(record["reason"]) + "\x00" + fmt.Sprint(record["display"])
	default:
		return key + stableJSON(record)
	}
}

func observedMemberSortKey(value any) string {
	record, ok := value.(map[string]any)
	if !ok {
		return stableJSON(value)
	}
	key := fmt.Sprint(record["name"]) + "\x00" + fmt.Sprint(record["key"]) + "\x00" +
		fmt.Sprint(record["optional"]) + "\x00" + fmt.Sprint(record["readonly"]) + "\x00"
	if memberType, exists := record["type"]; exists {
		key += "type\x00" + observedTypeSortKey(memberType)
	} else {
		key += "callable\x00" + stableJSON(record["callable"]) + "\x00" + stableJSON(record["overloads"])
	}
	return key + "\x00" + stableJSON(record["location"])
}

func withoutUndefinedObserved(value any) any {
	record, ok := value.(map[string]any)
	if !ok || record["kind"] != "union" {
		return value
	}
	items, _ := record["types"].([]any)
	kept := []any{}
	for _, item := range items {
		candidate, _ := item.(map[string]any)
		if candidate["kind"] != "undefined" {
			kept = append(kept, item)
		}
	}
	if len(kept) == 1 {
		return kept[0]
	}
	return map[string]any{"kind": "union", "types": kept}
}

func (x *extractor) typeParameterScope(node *shimast.Node) string {
	location := sourceLocation{File: ".", Line: 1, Column: 1}
	if node != nil {
		location = x.location(shimast.GetSourceFileOfNode(node), node)
	}
	file := location.File
	if file == "" {
		file = location.External
	}
	return fmt.Sprintf("%s:%d:%d", file, location.Line, location.Column)
}

func attachDeclarationToIssues(issues []any, identity string) []any {
	output := make([]any, 0, len(issues))
	for _, issue := range issues {
		record, ok := issue.(map[string]any)
		if !ok {
			output = append(output, issue)
			continue
		}
		copy := map[string]any{}
		for key, value := range record {
			copy[key] = value
		}
		if _, exists := copy["declaration"]; !exists {
			copy["declaration"] = identity
		}
		output = append(output, copy)
	}
	return output
}

func semanticJSON(value any) any {
	raw, _ := json.Marshal(value)
	var result any
	_ = json.Unmarshal(raw, &result)
	return result
}
