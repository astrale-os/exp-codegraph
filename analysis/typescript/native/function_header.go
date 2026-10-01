package main

import shimast "github.com/microsoft/typescript-go/shim/ast"

// This is callable shape, not a body or a body-completeness certificate. The
// enclosing complete demand inventory owns its exact source revision/span.
type functionHeader struct {
	Owner      string     `json:"owner"`
	Span       sourceSpan `json:"span"`
	Parameters []string   `json:"parameters"`
	Execution  string     `json:"execution"`
}

// Share parameter resolution with full body extraction. Definition callbacks
// still visit every resolved parameter in original order, before deduplication.
func (x *extractor) functionParameters(function *shimast.Node, definition func(*shimast.Node, string)) []string {
	parameters := []string{}
	if function != nil {
		for _, parameter := range function.Parameters() {
			node := parameter.AsNode()
			id := x.resolveSymbol(node.Name())
			if id == "" {
				id = x.resolveSymbol(node)
			}
			if id != "" {
				parameters = append(parameters, id)
				if definition != nil {
					definition(node, id)
				}
			}
		}
	}
	return uniqueInOrder(parameters)
}

func (x *extractor) functionHeader(owner string, span sourceSpan, function *shimast.Node) *functionHeader {
	return &functionHeader{Owner: owner, Span: span, Parameters: x.functionParameters(function, nil), Execution: functionExecution(function)}
}

func copyFunctionHeader(header *functionHeader) *functionHeader {
	if header == nil {
		return nil
	}
	owned := *header
	if header.Parameters != nil {
		owned.Parameters = append([]string{}, header.Parameters...)
	}
	return &owned
}
