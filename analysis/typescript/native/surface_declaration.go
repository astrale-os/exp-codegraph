package main

import (
	"sort"

	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimchecker "github.com/microsoft/typescript-go/shim/checker"
)

func (x *extractor) observePublicDeclaration(symbol *shimast.Symbol, exportPaths [][]string) (observedDeclarationPayload, map[string]*shimast.Symbol) {
	identity := x.publicSymbolIdentity(symbol)
	kind := declarationKindOf(x.checker, symbol)
	declaration := firstDeclaration(symbol)
	issues := []any{}
	normalizer := newNativeTypeNormalizer(x, &issues)
	result := observedDeclarationPayload{
		Identity: identity, Name: symbol.Name, Kind: kind, Location: x.symbolLocation(symbol),
		ExportPaths: clonePaths(exportPaths), ReferencedDeclarations: []string{}, Issues: []any{},
	}
	if declaration != nil {
		result.PackageCoordinate = x.declarationPackageCoordinate(shimast.GetSourceFileOfNode(declaration))
	}
	if declaration == nil {
		result.Issues = issues
		return result, normalizer.references
	}
	// External declarations are stable boundary stubs. Recursively expanding a
	// dependency or compiler-library body would make a module surface depend on
	// incidental provider internals and can explode the public closure. The
	// coordinate, identity, kind and location retain the exact semantic target.
	if !x.symbolWithinCatalog(symbol) {
		return result, normalizer.references
	}
	parameterNodes := declarationTypeParameterNodes(declaration)
	scope := x.typeParameterScope(declaration)
	restore := normalizer.bindTypeParameters(parameterNodes, scope)
	defer restore()
	if values := normalizer.typeParameters(parameterNodes, scope); len(values) != 0 {
		result.TypeParameters = values
	}
	if kind == "factory" {
		// V1 distinguishes declaration-level generic issues from the two
		// independently observed factory facets. Preserve that useful provenance
		// without allowing the final common attachment step to erase it.
		issues = attachDeclarationToIssues(issues, identity+"#factory")
	}

	switch kind {
	case "factory":
		typeDeclaration, valueDeclaration := factoryDeclarations(symbol)
		if typeDeclaration == nil || valueDeclaration == nil {
			issues = append(issues, observationIssue("TYPESCRIPT_FACTORY_FACETS_UNRESOLVED", "Factory declaration facets could not be resolved.", result.Location))
			break
		}
		typeIssues := []any{}
		typeNormalizer := newNativeTypeNormalizer(x, &typeIssues)
		typeParameters := declarationTypeParameterNodes(typeDeclaration)
		typeScope := x.typeParameterScope(typeDeclaration)
		typeRestore := typeNormalizer.bindTypeParameters(typeParameters, typeScope)
		authoredTypeIssues := []any{}
		authoredTypeNormalizer := newNativeTypeNormalizer(x, &authoredTypeIssues)
		authoredTypeRestore := authoredTypeNormalizer.bindTypeParameters(typeParameters, typeScope)
		typeNode := typeDeclaration.Type()
		authoredTypeValue := authoredTypeNormalizer.normalizeDeclaredAlias(symbol, typeNode)
		typeValue := authoredTypeValue
		retainedTypeIssues := authoredTypeIssues
		if alias := unalias(x.checker, shimchecker.Checker_getAliasSymbolForTypeNode(x.checker, typeNode)); typeNode.Kind != shimast.KindTypeReference && typeNode.Kind != shimast.KindTemplateLiteralType && stableDeclarationSymbol(alias) {
			// Keep the stable merged-factory alias as the semantic view while retaining
			// the already-normalized authored RHS and its exact reference closure as an
			// independent view for conformance and downstream analysis.
			typeValue = typeNormalizer.reference(alias, boundTypeParameterArguments(typeParameters, typeNormalizer))
			retainedTypeIssues = typeIssues
		}
		typeRestore()
		authoredTypeRestore()
		mergeReferences(normalizer.references, typeNormalizer.references)
		mergeReferences(normalizer.references, authoredTypeNormalizer.references)
		issues = append(issues, attachDeclarationToIssues(retainedTypeIssues, identity)...)

		valueIssues := []any{}
		valueNormalizer := newNativeTypeNormalizer(x, &valueIssues)
		valueType := shimchecker.Checker_getTypeOfSymbolAtLocation(x.checker, symbol, valueDeclaration)
		signatures := shimchecker.Checker_getSignaturesOfType(x.checker, valueType, shimchecker.SignatureKindCall)
		valueFacet := map[string]any{"kind": "value", "location": x.location(shimast.GetSourceFileOfNode(valueDeclaration), valueDeclaration)}
		if len(signatures) != 0 {
			callables := valueNormalizer.callables(signatures, valueDeclaration)
			valueFacet = map[string]any{"kind": "callable", "callable": callables[0], "location": x.location(shimast.GetSourceFileOfNode(valueDeclaration), valueDeclaration)}
			if len(callables) > 1 {
				valueFacet["overloads"] = callables
			}
		} else {
			valueFacet["valueType"] = valueNormalizer.normalize(valueType, valueDeclaration)
		}
		mergeReferences(normalizer.references, valueNormalizer.references)
		issues = append(issues, attachDeclarationToIssues(valueIssues, identity+"#value")...)
		result.Facets = map[string]any{
			"type":  map[string]any{"kind": "type-alias", "valueType": typeValue, "authoredValueType": authoredTypeValue, "location": x.location(shimast.GetSourceFileOfNode(typeDeclaration), typeDeclaration)},
			"value": valueFacet,
		}
	case "callable":
		valueType := shimchecker.Checker_getTypeOfSymbolAtLocation(x.checker, symbol, declaration)
		signatures := shimchecker.Checker_getSignaturesOfType(x.checker, valueType, shimchecker.SignatureKindCall)
		if len(signatures) != 0 {
			callables := normalizer.callables(signatures, declaration)
			result.Callable = callables[0]
			if len(callables) > 1 {
				result.Overloads = callables
			}
		}
		result.ValueType = normalizer.normalize(valueType, declaration)
	case "interface", "class":
		instance := shimchecker.Checker_getDeclaredTypeOfSymbol(x.checker, symbol)
		members := normalizer.membersOfType(instance, declaration)
		properties, callables := splitObservedMembers(members)
		result.Properties = properties
		result.Callables = callables
		signatures := shimchecker.Checker_getSignaturesOfType(x.checker, instance, shimchecker.SignatureKindCall)
		if len(signatures) != 0 {
			values := normalizer.callables(signatures, declaration)
			result.Callable = values[0]
			if len(values) > 1 {
				result.Overloads = values
			}
		}
		if kind == "class" {
			result.Statics = x.observeStaticMembers(symbol, declaration, normalizer)
		}
		extended, implemented := x.observeHeritage(declaration, normalizer)
		result.Extends = extended
		result.Implements = implemented
	case "value":
		valueType := declaredSymbolType(x.checker, symbol, declaration)
		observed := normalizer.normalize(valueType, declaration)
		result.ValueType = observed
		if declaration.Kind == shimast.KindTypeAliasDeclaration && declaration.Type() != nil {
			authoredIssues := []any{}
			authoredNormalizer := newNativeTypeNormalizer(x, &authoredIssues)
			authoredRestore := authoredNormalizer.bindTypeParameters(
				declarationTypeParameterNodes(declaration),
				x.typeParameterScope(declaration),
			)
			result.AuthoredValueType = authoredNormalizer.normalizeDeclaredAlias(symbol, declaration.Type())
			authoredRestore()
			mergeReferences(normalizer.references, authoredNormalizer.references)
		}
		callCount := len(shimchecker.Checker_getSignaturesOfType(x.checker, valueType, shimchecker.SignatureKindCall))
		constructCount := len(shimchecker.Checker_getSignaturesOfType(x.checker, valueType, 1))
		indexCount := 0
		if record, ok := observed.(map[string]any); ok && record["kind"] == "object" {
			indexCount = len(shimchecker.Checker_getIndexInfosOfType(x.checker, valueType))
		}
		result.CallSignatureCount, result.ConstructSignatureCount, result.IndexSignatureCount = integer(callCount), integer(constructCount), integer(indexCount)
		if record, ok := observed.(map[string]any); ok && record["kind"] == "object" {
			members, _ := record["members"].([]any)
			fields, callables := splitObservedMembers(members)
			result.Fields = fields
			result.Callables = callables
		}
	default:
		issues = append(issues, observationIssue("TYPESCRIPT_DECLARATION_KIND_UNSUPPORTED", "Unsupported exported declaration kind for "+symbol.Name+".", result.Location))
	}
	result.ReferencedDeclarations = sortedReferenceKeys(normalizer.references)
	// Ordinary declaration issues are scoped by this declaration fact. The
	// flattened module projection attaches this identity later; factory facet
	// issues retain their finer-grained (#factory, type facet, or #value) owner.
	result.Issues = issues
	return result, normalizer.references
}

func declarationTypeParameterNodes(declaration *shimast.Node) []*shimast.Node {
	if declaration == nil {
		return nil
	}
	switch declaration.Kind {
	case shimast.KindClassDeclaration, shimast.KindInterfaceDeclaration, shimast.KindTypeAliasDeclaration, shimast.KindFunctionDeclaration:
		return declaration.TypeParameters()
	}
	return nil
}

func declaredSymbolType(checker *shimchecker.Checker, symbol *shimast.Symbol, declaration *shimast.Node) *shimchecker.Type {
	if symbol.Flags&(shimast.SymbolFlagsTypeAlias|shimast.SymbolFlagsInterface) != 0 {
		return shimchecker.Checker_getDeclaredTypeOfSymbol(checker, symbol)
	}
	return shimchecker.Checker_getTypeOfSymbolAtLocation(checker, symbol, declaration)
}

func factoryDeclarations(symbol *shimast.Symbol) (*shimast.Node, *shimast.Node) {
	var typeDeclaration, valueDeclaration *shimast.Node
	for _, declaration := range symbol.Declarations {
		switch declaration.Kind {
		case shimast.KindTypeAliasDeclaration:
			typeDeclaration = declaration
		case shimast.KindFunctionDeclaration, shimast.KindVariableDeclaration:
			valueDeclaration = declaration
		}
	}
	return typeDeclaration, valueDeclaration
}

func (x *extractor) observeStaticMembers(symbol *shimast.Symbol, owner *shimast.Node, normalizer *nativeTypeNormalizer) []any {
	valueType := shimchecker.Checker_getTypeOfSymbolAtLocation(x.checker, symbol, owner)
	values := []any{}
	for _, member := range shimchecker.Checker_getPropertiesOfType(x.checker, valueType) {
		if member.Name == "prototype" {
			continue
		}
		var declaration *shimast.Node
		for _, candidate := range member.Declarations {
			if candidate.Parent == owner && candidate.ModifierFlags()&shimast.ModifierFlagsStatic != 0 {
				declaration = candidate
				break
			}
		}
		if declaration == nil {
			continue
		}
		if observed := normalizer.member(member, declaration, true); observed != nil {
			values = append(values, observed)
		}
	}
	sort.Slice(values, func(i, j int) bool {
		return values[i].(map[string]any)["name"].(string) < values[j].(map[string]any)["name"].(string)
	})
	return values
}

func (x *extractor) observeHeritage(declaration *shimast.Node, normalizer *nativeTypeNormalizer) ([]string, []string) {
	extended, implemented := []string{}, []string{}
	var clauses *shimast.NodeList
	switch declaration.Kind {
	case shimast.KindClassDeclaration:
		clauses = declaration.AsClassDeclaration().HeritageClauses
	case shimast.KindInterfaceDeclaration:
		clauses = declaration.AsInterfaceDeclaration().HeritageClauses
	default:
		return extended, implemented
	}
	if clauses == nil {
		return extended, implemented
	}
	for _, clauseNode := range clauses.Nodes {
		clause := clauseNode.AsHeritageClause()
		if clause.Types == nil {
			continue
		}
		for _, typeNode := range clause.Types.Nodes {
			expression := typeNode.AsExpressionWithTypeArguments().Expression
			symbol := unalias(x.checker, x.checker.GetSymbolAtLocation(expression))
			if symbol == nil {
				*normalizer.issues = append(*normalizer.issues, observationIssue("TYPESCRIPT_HERITAGE_UNRESOLVED", "Cannot resolve heritage target: "+nodeText(shimast.GetSourceFileOfNode(typeNode), typeNode), x.location(shimast.GetSourceFileOfNode(typeNode), typeNode)))
				continue
			}
			identity := x.publicSymbolIdentity(symbol)
			normalizer.references[identity] = symbol
			if clause.Token == shimast.KindImplementsKeyword {
				implemented = append(implemented, identity)
			} else {
				extended = append(extended, identity)
			}
		}
	}
	sort.Strings(extended)
	sort.Strings(implemented)
	return extended, implemented
}

func splitObservedMembers(values []any) ([]any, []any) {
	properties, callables := []any{}, []any{}
	for _, value := range values {
		record, _ := value.(map[string]any)
		if _, exists := record["type"]; exists {
			properties = append(properties, value)
		}
		if _, exists := record["callable"]; exists {
			callables = append(callables, value)
		}
	}
	return properties, callables
}

func mergeReferences(target map[string]*shimast.Symbol, source map[string]*shimast.Symbol) {
	for identity, symbol := range source {
		target[identity] = symbol
	}
}

func sortedReferenceKeys(references map[string]*shimast.Symbol) []string {
	values := make([]string, 0, len(references))
	for identity := range references {
		values = append(values, identity)
	}
	sort.Strings(values)
	return values
}

func clonePaths(paths [][]string) [][]string {
	values := make([][]string, 0, len(paths))
	for _, path := range paths {
		values = append(values, append([]string{}, path...))
	}
	return values
}

func integer(value int) *int { return &value }
