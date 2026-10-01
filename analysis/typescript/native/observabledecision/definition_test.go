package observabledecision

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestDefinitionIDImportedHelperDemandDoesNotEnterBuild(t *testing.T) {
	context := fixtureContext([]CapturedFile{captured("query.ts", `import {defineQuery} from '@astrale-os/sdk/query';import {identity} from './helper';
export const query=defineQuery()((domain)=>({id:identity('stable.id'),build:()=>{throw new Error('not observed')}}));`), captured("helper.ts", `export function identity(name:string){return name}`)})
	context.Limits = Limits{MaximumSteps: 8, MaximumDepth: 5}
	product := ObserveDefinitionIDs(context)
	if product.Complete || len(product.Observations) != 1 {
		t.Fatalf("product=%+v", product)
	}
	id := product.Observations[0].ID
	if id.Kind != "known" || id.String != "stable.id" || id.Steps != 8 {
		t.Fatalf("id=%+v", id)
	}
	context.Limits.MaximumSteps = 7
	limited := ObserveDefinitionIDs(context)
	if len(limited.Observations) != 1 || limited.Observations[0].ID.Reason != "VALUE_STEP_LIMIT" {
		t.Fatalf("limited=%+v", limited)
	}
}

func TestDefinitionIDPreservesJavaScriptSurrogateWire(t *testing.T) {
	context := fixtureContext([]CapturedFile{captured("query.ts", `import {defineQuery} from '@astrale-os/sdk/query';export const query=defineQuery()((domain)=>({id:'\uD800'}));`)})
	product := ObserveDefinitionIDs(context)
	if len(product.Observations) != 1 || product.Observations[0].ID.Kind != "known" {
		t.Fatalf("product=%+v", product)
	}
	data, err := json.Marshal(product.Observations[0].ID)
	if err != nil || !bytes.Contains(data, []byte(`"String":"\ud800"`)) {
		t.Fatalf("wire=%s err=%v", data, err)
	}
}

func TestDefinitionIDFullUncertaintyMessagesMatchFrozenSelectedBudgetOracle(t *testing.T) {
	var oracle struct {
		Cases []struct {
			Limits      Limits
			Definitions []struct {
				Source struct {
					Path       string
					Start, End int
				}
				ID struct {
					Kind, Value             string
					Reasons, ReasonMessages []string
				}
			}
		}
	}
	data, err := os.ReadFile("testdata/budgets/definition-oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &oracle); err != nil {
		t.Fatal(err)
	}
	files := []CapturedFile{}
	for _, name := range []string{"read-tag.ts", "list-visible-issues.ts", "helper-query.ts", "helper.ts"} {
		directory := "testdata/issues/"
		if name == "helper-query.ts" || name == "helper.ts" {
			directory = "testdata/budgets/"
		}
		text, err := os.ReadFile(directory + name)
		if err != nil {
			t.Fatal(err)
		}
		file := captured(name, string(text))
		if name == "helper.ts" {
			file.Layer = "shared"
		}
		files = append(files, file)
	}
	comparisons := 0
	for _, c := range oracle.Cases {
		context := fixtureContext(files)
		context.Limits = c.Limits
		product := ObserveDefinitionIDs(context)
		for _, e := range c.Definitions {
			var actual *DefinitionObservation
			for index := range product.Observations {
				o := &product.Observations[index]
				if o.Path == e.Source.Path && o.Start == e.Source.Start && o.End == e.Source.End {
					actual = o
					break
				}
			}
			if actual == nil {
				t.Fatalf("lost selected definition %+v", e.Source)
			}
			if actual.ID.Kind != e.ID.Kind || (e.ID.Kind == "known" && actual.ID.String != e.ID.Value) {
				t.Fatalf("ID mismatch %+v expected%+v actual%+v", c.Limits, e.ID, actual.ID)
			}
			if e.ID.Kind == "unknown" {
				parts := []string{}
				for index, message := range e.ID.ReasonMessages {
					if e.ID.Reasons[index] == "VALUE_STEP_LIMIT" || e.ID.Reasons[index] == "VALUE_DEPTH_LIMIT" || e.ID.Reasons[index] == "VALUE_ALTERNATIVE_LIMIT" {
						message = "analysis budget exhausted: " + message
					}
					parts = append(parts, message)
				}
				expected := strings.Join(parts, "; ")
				if got := PublicDefinitionReason(actual.ID); got != expected {
					t.Fatalf("ID full reason %+v %s expected%q actual%q", c.Limits, actual.Path, expected, got)
				}
			}
			comparisons++
		}
	}
	t.Logf("%d selected ID full outcomes/reasons matched frozen oracle", comparisons)
}
