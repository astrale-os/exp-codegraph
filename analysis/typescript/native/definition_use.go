package main

import (
	"sort"

	shimast "github.com/microsoft/typescript-go/shim/ast"
)

type completedDefinition struct {
	id         string
	start, end int
}

func (b *bodyBuilder) finishDefinitionUses(flow controlFlowResult) {
	linear := flow.completion.Kind == "complete"
	for _, edge := range flow.edges {
		if edge.Kind == "true" || edge.Kind == "false" || edge.Kind == "loop" {
			linear = false
			break
		}
	}
	completed := map[string]completedDefinition{}
	if linear {
		for node, id := range b.occurrence {
			occurrence := b.occurrences[b.occurrenceIndex[id]]
			if occurrence.Kind != "definition" {
				continue
			}
			end := node.End()
			// Initializers and assignment RHSs run before their destination
			// is written: x = x must read the preceding x, not its own write.
			if parent := node.Parent; parent != nil {
				if parent.Kind == shimast.KindVariableDeclaration {
					end = parent.End()
				} else if parent.Kind == shimast.KindBinaryExpression && parent.AsBinaryExpression().Left == node {
					end = parent.End()
				}
			}
			completed[id] = completedDefinition{id: id, start: node.Pos(), end: end}
		}
	}
	for symbol, uses := range b.uses {
		definitions := b.defs[symbol]
		if len(definitions) == 0 {
			b.captures[symbol] = true
			continue
		}
		ordered := make([]completedDefinition, 0, len(definitions))
		if linear {
			for _, id := range definitions {
				ordered = append(ordered, completed[id])
			}
			sort.Slice(ordered, func(i, j int) bool {
				if ordered[i].end == ordered[j].end {
					return ordered[i].start > ordered[j].start
				}
				return ordered[i].end < ordered[j].end
			})
		}
		for _, use := range uses {
			if linear {
				start := b.occurrences[b.occurrenceIndex[use]].Span.Start
				index := sort.Search(len(ordered), func(i int) bool { return ordered[i].end > start }) - 1
				if index >= 0 {
					b.definitions = append(b.definitions, definitionUse{
						Definition: ordered[index].id, Use: use, Symbol: symbol, Reaching: "definite",
					})
				}
				continue
			}
			// Until branch/loop reaching sets are computed, retain every
			// possible write rather than mistaking source order for dominance.
			for _, definition := range definitions {
				b.definitions = append(b.definitions, definitionUse{
					Definition: definition, Use: use, Symbol: symbol, Reaching: "possible",
				})
			}
		}
	}
}
