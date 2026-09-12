package main

import (
	"cmp"
	"slices"
)

func sortBodyRelations(relations []bodyRelation) {
	// Native parents are fixed-width occurrence IDs; childRole emits ASCII
	// tokens without NUL. Field order therefore matches Parent+NUL+Role+NUL+Child,
	// including ordinal prefixes such as argument:1 and argument:10.
	slices.SortFunc(relations, func(left, right bodyRelation) int {
		if order := cmp.Compare(left.Parent, right.Parent); order != 0 {
			return order
		}
		if order := cmp.Compare(left.Role, right.Role); order != 0 {
			return order
		}
		return cmp.Compare(left.Child, right.Child)
	})
}
