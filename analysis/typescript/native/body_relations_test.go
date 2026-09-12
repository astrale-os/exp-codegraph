package main

import (
	"bytes"
	"fmt"
	"math/rand"
	"slices"
	"sort"
	"testing"
)

func relationOrderFixture() []bodyRelation {
	roles := []string{"callee", "name", "initializer", "expression", "condition", "when-true", "when-false", "left", "right", "then", "else"}
	for _, prefix := range []string{"argument", "type-argument", "property", "child"} {
		for _, ordinal := range []int{0, 1, 2, 9, 10, 11, 19, 20, 99, 100} {
			roles = append(roles, fmt.Sprintf("%s:%d", prefix, ordinal))
		}
	}
	var relations []bodyRelation
	for _, parent := range []int{1, 16, 256} {
		for _, role := range roles {
			for _, child := range []int{2, 32, 512} {
				relations = append(relations, bodyRelation{
					Parent: fmt.Sprintf("occurrence:%064x", parent), Role: role, Child: fmt.Sprintf("occurrence:%064x", child),
				})
			}
		}
	}
	// Repeated relations are identical values, so the sort's stability does not
	// introduce a hidden tie-breaker into the serialized body.
	relations = append(relations, relations[0], relations[len(relations)-1])
	return relations
}

func legacySortBodyRelations(relations []bodyRelation) {
	sort.Slice(relations, func(i, j int) bool {
		left := relations[i].Parent + "\x00" + relations[i].Role + "\x00" + relations[i].Child
		right := relations[j].Parent + "\x00" + relations[j].Role + "\x00" + relations[j].Child
		return left < right
	})
}

func TestBodyRelationOrderPreservesNativeIdentity(t *testing.T) {
	expected := relationOrderFixture()
	legacySortBodyRelations(expected)
	random := rand.New(rand.NewSource(20260912))
	for attempt := 0; attempt < 8; attempt++ {
		actual := slices.Clone(expected)
		random.Shuffle(len(actual), func(i, j int) { actual[i], actual[j] = actual[j], actual[i] })
		sortBodyRelations(actual)
		if !slices.Equal(actual, expected) {
			t.Fatalf("attempt %d changed native relation order", attempt)
		}
		prepare := func(relations []bodyRelation) preparedFact {
			entry, err := prepareFact(fact{
				Namespace: "typescript.body", SchemaVersion: 1, Kind: "function-body", Subject: "symbol:owner",
				Completeness: completeness{Kind: "complete"},
				Payload: bodyFactPayload{Body: functionBodyIR{Function: "symbol:owner", Relations: relations},
					Values: map[string]any{}, Completeness: completeness{Kind: "complete"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			return entry
		}
		before, after := prepare(expected), prepare(actual)
		if before.ID != after.ID || before.semanticBytes != after.semanticBytes || !bytes.Equal(before.canonicalPayload, after.canonicalPayload) {
			t.Fatal("relation ordering changed the semantic fact preimage")
		}
		previous := finishShard("typescript.body", "symbol:owner", completeness{Kind: "complete"}, []preparedFact{before})
		next := finishShard("typescript.body", "symbol:owner", completeness{Kind: "complete"}, []preparedFact{after})
		if previous.Digest != next.Digest {
			t.Fatal("relation ordering changed the semantic shard identity")
		}
	}
}

func TestBodyRelationSortDoesNotAllocateComparisonKeys(t *testing.T) {
	input := relationOrderFixture()
	slices.Reverse(input)
	work := make([]bodyRelation, len(input))
	if allocations := testing.AllocsPerRun(10, func() {
		copy(work, input)
		sortBodyRelations(work)
	}); allocations != 0 {
		t.Fatalf("sorting %d native relations allocated %.0f objects", len(input), allocations)
	}
}
