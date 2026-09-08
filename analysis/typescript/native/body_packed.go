package main

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

func negotiatedBodyPayloadCodec(codecs map[string]bool) string {
	if codecs[typescriptBodyPayloadCodec] {
		return typescriptBodyPayloadCodec
	}
	if codecs[typescriptBodyPayloadCodecV5] {
		return typescriptBodyPayloadCodecV5
	}
	return ""
}

func packBodyPayload(payload bodyFactPayload, evidence sourceSpan, codec string) (physicalPayloadEnvelope, error) {
	columnar := codec == typescriptBodyPayloadCodec
	if !columnar && codec != typescriptBodyPayloadCodecV5 {
		return physicalPayloadEnvelope{}, fmt.Errorf("unsupported body payload codec %q", codec)
	}
	body := payload.Body
	constants := make([]string, 5)
	constants[3] = body.Scope
	constants[4] = body.Execution
	var err error
	if constants[0], err = compactAnalysisID(evidence.Source, "source"); err != nil {
		return physicalPayloadEnvelope{}, err
	}
	if constants[1], err = compactAnalysisID(evidence.Revision, "source-revision"); err != nil {
		return physicalPayloadEnvelope{}, err
	}
	if constants[2], err = compactAnalysisID(body.Function, "symbol"); err != nil {
		return physicalPayloadEnvelope{}, err
	}
	if body.Summary.Function != body.Function {
		return physicalPayloadEnvelope{}, fmt.Errorf("body summary owner differs from the body owner")
	}

	symbols := []string{}
	symbolIndex := map[string]int{}
	internSymbol := func(value string) (int, error) {
		if value == "" {
			return -1, nil
		}
		if index, ok := symbolIndex[value]; ok {
			return index, nil
		}
		compact, compactErr := compactAnalysisID(value, "symbol")
		if compactErr != nil {
			return -1, compactErr
		}
		index := len(symbols)
		symbolIndex[value] = index
		symbols = append(symbols, compact)
		return index, nil
	}
	texts := []string{}
	textIndex := map[string]int{}
	internText := func(value string) int {
		if index, ok := textIndex[value]; ok {
			return index
		}
		index := len(texts)
		textIndex[value] = index
		texts = append(texts, value)
		return index
	}
	occurrenceIndex := make(map[string]int, len(body.Occurrences))
	var occurrenceRows [][]any
	var occurrenceIDs []string
	var occurrenceFields []int
	var occurrenceOrigins []*callTargetOrigin
	if columnar {
		capacity, capacityErr := packedFieldCapacity(len(body.Occurrences), 9)
		if capacityErr != nil {
			return physicalPayloadEnvelope{}, capacityErr
		}
		occurrenceIDs = make([]string, 0, len(body.Occurrences))
		occurrenceFields = make([]int, 0, capacity)
		occurrenceOrigins = make([]*callTargetOrigin, 0, len(body.Occurrences))
	} else {
		occurrenceRows = make([][]any, 0, len(body.Occurrences))
	}
	for index, occurrence := range body.Occurrences {
		if _, exists := occurrenceIndex[occurrence.ID]; exists {
			return physicalPayloadEnvelope{}, fmt.Errorf("body occurrence %s is duplicated", occurrence.ID)
		}
		if occurrence.Owner != body.Function || occurrence.Span.Source != evidence.Source || occurrence.Span.Revision != evidence.Revision {
			return physicalPayloadEnvelope{}, fmt.Errorf("body occurrence %s does not share its body owner and source", occurrence.ID)
		}
		compact, compactErr := compactAnalysisID(occurrence.ID, "occurrence")
		if compactErr != nil {
			return physicalPayloadEnvelope{}, compactErr
		}
		symbol, symbolErr := internSymbol(occurrence.Symbol)
		if symbolErr != nil {
			return physicalPayloadEnvelope{}, symbolErr
		}
		occurrenceIndex[occurrence.ID] = index
		operator := -1
		if occurrence.Operator != "" {
			operator = internText(occurrence.Operator)
		}
		symbolKind := -1
		if occurrence.SymbolKind != "" {
			symbolKind = internText(occurrence.SymbolKind)
		}
		propertyName := -1
		if occurrence.PropertyName != "" {
			propertyName = internText(occurrence.PropertyName)
		}
		propertyNamespace, namespaceErr := internSymbol(occurrence.PropertyNamespace)
		if namespaceErr != nil {
			return physicalPayloadEnvelope{}, namespaceErr
		}
		kind, syntax := internText(occurrence.Kind), internText(occurrence.Syntax)
		if columnar {
			occurrenceIDs = append(occurrenceIDs, compact)
			occurrenceFields = append(occurrenceFields, kind, occurrence.Span.Start, occurrence.Span.End,
				syntax, symbol, operator, symbolKind, propertyName, propertyNamespace)
			occurrenceOrigins = append(occurrenceOrigins, occurrence.SymbolOrigin)
		} else {
			occurrenceRows = append(occurrenceRows, []any{
				compact, kind, occurrence.Span.Start, occurrence.Span.End,
				syntax, symbol, occurrence.SymbolOrigin, operator, symbolKind, propertyName, propertyNamespace,
			})
		}
	}
	occurrenceRef := func(value string) (int, error) {
		index, ok := occurrenceIndex[value]
		if !ok {
			return -1, fmt.Errorf("body references unknown occurrence %s", value)
		}
		return index, nil
	}
	occurrenceRefs := func(values []string) ([]int, error) {
		result := make([]int, 0, len(values))
		for _, value := range values {
			index, refErr := occurrenceRef(value)
			if refErr != nil {
				return nil, refErr
			}
			result = append(result, index)
		}
		return result, nil
	}
	symbolRefs := func(values []string) ([]int, error) {
		result := make([]int, 0, len(values))
		for _, value := range values {
			index, refErr := internSymbol(value)
			if refErr != nil {
				return nil, refErr
			}
			result = append(result, index)
		}
		return result, nil
	}
	textRefs := func(values []string) []int {
		result := make([]int, 0, len(values))
		for _, value := range values {
			result = append(result, internText(value))
		}
		return result
	}

	parameters, err := symbolRefs(body.Parameters)
	if err != nil {
		return physicalPayloadEnvelope{}, err
	}
	var relationRows [][]any
	var relationFields []int
	if columnar {
		capacity, capacityErr := packedFieldCapacity(len(body.Relations), 3)
		if capacityErr != nil {
			return physicalPayloadEnvelope{}, capacityErr
		}
		relationFields = make([]int, 0, capacity)
	} else {
		relationRows = make([][]any, 0, len(body.Relations))
	}
	for _, relation := range body.Relations {
		parent, refErr := occurrenceRef(relation.Parent)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		child, refErr := occurrenceRef(relation.Child)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		role := internText(relation.Role)
		if columnar {
			relationFields = append(relationFields, parent, child, role)
		} else {
			relationRows = append(relationRows, []any{parent, child, role})
		}
	}
	blocks := make([][]any, 0, len(body.Blocks))
	blockIndex := make(map[string]int, len(body.Blocks))
	for index, block := range body.Blocks {
		if _, exists := blockIndex[block.ID]; exists {
			return physicalPayloadEnvelope{}, fmt.Errorf("body block %s is duplicated", block.ID)
		}
		refs, refErr := occurrenceRefs(block.Occurrences)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		blockIndex[block.ID] = index
		blocks = append(blocks, []any{internText(block.ID), refs})
	}
	var edgeRows [][]any
	var edgeFields []int
	if columnar {
		capacity, capacityErr := packedFieldCapacity(len(body.Edges), 4)
		if capacityErr != nil {
			return physicalPayloadEnvelope{}, capacityErr
		}
		edgeFields = make([]int, 0, capacity)
	} else {
		edgeRows = make([][]any, 0, len(body.Edges))
	}
	for _, edge := range body.Edges {
		from, fromOK := blockIndex[edge.From]
		to, toOK := blockIndex[edge.To]
		if !fromOK || !toOK {
			return physicalPayloadEnvelope{}, fmt.Errorf("body edge references an unknown block")
		}
		evidence := -1
		if edge.Evidence != "" {
			if evidence, err = occurrenceRef(edge.Evidence); err != nil {
				return physicalPayloadEnvelope{}, err
			}
		}
		kind := internText(edge.Kind)
		if columnar {
			edgeFields = append(edgeFields, from, to, kind, evidence)
		} else {
			edgeRows = append(edgeRows, []any{from, to, kind, evidence})
		}
	}
	var definitionRows [][]any
	var definitionFields []int
	if columnar {
		capacity, capacityErr := packedFieldCapacity(len(body.Definitions), 4)
		if capacityErr != nil {
			return physicalPayloadEnvelope{}, capacityErr
		}
		definitionFields = make([]int, 0, capacity)
	} else {
		definitionRows = make([][]any, 0, len(body.Definitions))
	}
	for _, definition := range body.Definitions {
		defined, refErr := occurrenceRef(definition.Definition)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		used, refErr := occurrenceRef(definition.Use)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		symbol, symbolErr := internSymbol(definition.Symbol)
		if symbolErr != nil {
			return physicalPayloadEnvelope{}, symbolErr
		}
		reaching := internText(definition.Reaching)
		if columnar {
			definitionFields = append(definitionFields, defined, used, symbol, reaching)
		} else {
			definitionRows = append(definitionRows, []any{defined, used, symbol, reaching})
		}
	}
	calls := make([][]any, 0, len(body.Calls))
	for _, call := range body.Calls {
		occurrence, refErr := occurrenceRef(call.Occurrence)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		target, symbolErr := internSymbol(call.Target)
		if symbolErr != nil {
			return physicalPayloadEnvelope{}, symbolErr
		}
		signature := -1
		if call.Signature != "" {
			signature = internText(call.Signature)
		}
		receiver := -1
		if call.Receiver != "" {
			if receiver, refErr = occurrenceRef(call.Receiver); refErr != nil {
				return physicalPayloadEnvelope{}, refErr
			}
		}
		arguments, refErr := occurrenceRefs(call.Arguments)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		bindings := make([][]any, 0, len(call.Bindings))
		for _, binding := range call.Bindings {
			argument, bindingErr := occurrenceRef(binding.Argument)
			if bindingErr != nil {
				return physicalPayloadEnvelope{}, bindingErr
			}
			parameter, bindingErr := internSymbol(binding.Parameter)
			if bindingErr != nil {
				return physicalPayloadEnvelope{}, bindingErr
			}
			rest := 0
			if binding.Rest {
				rest = 1
			}
			bindings = append(bindings, []any{argument, parameter, binding.Index, rest})
		}
		callbacks, symbolErr := symbolRefs(call.Callbacks)
		if symbolErr != nil {
			return physicalPayloadEnvelope{}, symbolErr
		}
		dynamic := 0
		if call.Dynamic {
			dynamic = 1
		}
		calls = append(calls, []any{
			occurrence, target, signature, receiver, textRefs(call.TypeArguments), arguments,
			bindings, callbacks, dynamic, call.TargetOrigin,
		})
	}
	returns, err := occurrenceRefs(body.Summary.Returns)
	if err != nil {
		return physicalPayloadEnvelope{}, err
	}
	throws, err := occurrenceRefs(body.Summary.Throws)
	if err != nil {
		return physicalPayloadEnvelope{}, err
	}
	captures, err := symbolRefs(body.Summary.Captures)
	if err != nil {
		return physicalPayloadEnvelope{}, err
	}
	summaryCalls, err := occurrenceRefs(body.Summary.Calls)
	if err != nil {
		return physicalPayloadEnvelope{}, err
	}
	escapes, err := occurrenceRefs(body.Summary.Escapes)
	if err != nil {
		return physicalPayloadEnvelope{}, err
	}
	recursion := 0
	if body.Summary.Recursion {
		recursion = 1
	}
	values := make([][]any, 0, len(payload.Values))
	for index, occurrence := range body.Occurrences {
		if value, exists := payload.Values[occurrence.ID]; exists {
			values = append(values, []any{index, value})
		}
	}
	if len(values) != len(payload.Values) {
		return physicalPayloadEnvelope{}, fmt.Errorf("body values contain an unknown occurrence")
	}

	packed := packedBodyData{
		Constants: constants, Symbols: symbols, Texts: texts, Parameters: parameters,
		Occurrences: occurrenceRows, Relations: relationRows, Blocks: blocks, Edges: edgeRows,
		Definitions: definitionRows, Calls: calls,
		Summary: []any{returns, throws, captures, summaryCalls, escapes, recursion},
		Values:  values, Completeness: payload.Completeness,
	}
	if columnar {
		packed.Occurrences = []any{occurrenceIDs, occurrenceFields, occurrenceOrigins}
		packed.Relations = relationFields
		packed.Edges = edgeFields
		packed.Definitions = definitionFields
	}
	return physicalPayloadEnvelope{Codec: codec, Data: packed}, nil
}

// A column cannot silently wrap its allocation size. This checks machine-int
// arithmetic only; values and ordinals retain their existing integer domain.
func packedFieldCapacity(rows, stride int) (int, error) {
	if rows < 0 || stride < 1 || rows > int(^uint(0)>>1)/stride {
		return 0, fmt.Errorf("packed body column capacity overflows")
	}
	return rows * stride, nil
}

func compactAnalysisID(value, kind string) (string, error) {
	prefix := kind + ":"
	if len(value) != len(prefix)+64 || value[:len(prefix)] != prefix {
		return "", fmt.Errorf("expected %s identity, received %q", kind, value)
	}
	digest, err := hex.DecodeString(value[len(prefix):])
	if err != nil || len(digest) != 32 {
		return "", fmt.Errorf("%s identity is not a canonical SHA-256 identity", kind)
	}
	return base64.RawURLEncoding.EncodeToString(digest), nil
}
