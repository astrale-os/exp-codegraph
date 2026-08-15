package main

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

func packBodyPayload(payload bodyFactPayload, evidence sourceSpan) (physicalPayloadEnvelope, error) {
	body := payload.Body
	constants := make([]string, 3)
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
	occurrences := make([][]any, 0, len(body.Occurrences))
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
		occurrences = append(occurrences, []any{
			compact, internText(occurrence.Kind), occurrence.Span.Start, occurrence.Span.End,
			internText(occurrence.Syntax), symbol,
		})
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
	relations := make([][]any, 0, len(body.Relations))
	for _, relation := range body.Relations {
		parent, refErr := occurrenceRef(relation.Parent)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		child, refErr := occurrenceRef(relation.Child)
		if refErr != nil {
			return physicalPayloadEnvelope{}, refErr
		}
		relations = append(relations, []any{parent, child, internText(relation.Role)})
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
	edges := make([][]any, 0, len(body.Edges))
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
		edges = append(edges, []any{from, to, internText(edge.Kind), evidence})
	}
	definitions := make([][]any, 0, len(body.Definitions))
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
		definitions = append(definitions, []any{defined, used, symbol, internText(definition.Reaching)})
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
			bindings, callbacks, dynamic,
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

	return physicalPayloadEnvelope{
		Codec: typescriptBodyPayloadCodec,
		Data: packedBodyData{
			Constants: constants, Symbols: symbols, Texts: texts, Parameters: parameters,
			Occurrences: occurrences, Relations: relations, Blocks: blocks, Edges: edges,
			Definitions: definitions, Calls: calls,
			Summary: []any{returns, throws, captures, summaryCalls, escapes, recursion},
			Values:  values, Completeness: payload.Completeness,
		},
	}, nil
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
