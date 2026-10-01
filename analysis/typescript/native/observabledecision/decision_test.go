package observabledecision

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const intrinsic = "@qualified/sdk/query"

func write(t *testing.T, p, text string) {
	t.Helper()
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(p, []byte(text), 0600); e != nil {
		t.Fatal(e)
	}
}
func refresh(t *testing.T, s *Session) Report {
	t.Helper()
	r, e := s.Refresh()
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func freshEqual(t *testing.T, s *Session, r Report) {
	t.Helper()
	other, e := New(s.paths, intrinsic)
	if e != nil {
		t.Fatal(e)
	}
	fresh := refresh(t, other)
	if !Equivalent(r, fresh) {
		t.Fatalf("incremental != fresh: %+v / %+v", r, fresh)
	}
}
func TestImportedHelperIDEditUpdatesOneDecisionAndDuplicateBucket(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.ts")
	b := filepath.Join(dir, "b.ts")
	c := filepath.Join(dir, "c.ts")
	helper := filepath.Join(dir, "helper.ts")
	fallback := filepath.Join(dir, "helper/index.ts")
	write(t, helper, "export function id(name: string) { return 'issues.' + name; }")
	source := func(name string) string {
		return "import { Query } from '@qualified/sdk/query'; import { id } from './helper'; export const query = Query({ id: id('" + name + "') });"
	}
	write(t, a, source("alpha"))
	write(t, b, source("beta"))
	write(t, c, "import { Query } from '@qualified/sdk/query'; export const query = Query({ id: 'issues.gamma' });")
	s, e := New([]string{a, b, c, helper, fallback}, intrinsic)
	if e != nil {
		t.Fatal(e)
	}
	cold := refresh(t, s)
	if cold.Stats.Evaluated != 3 || len(cold.Duplicates) != 0 || cold.Decisions[0].Result.ID != "issues.alpha" {
		t.Fatalf("cold: %+v", cold)
	}
	freshEqual(t, s, cold)
	write(t, b, source("alpha"))
	warm := refresh(t, s)
	if warm.Stats.Parsed != 1 || warm.Stats.Evaluated != 1 || warm.Stats.Reused != 2 || warm.Stats.BucketDeltas != 2 || len(warm.Duplicates["issues.alpha"]) != 2 {
		t.Fatalf("warm: %+v", warm)
	}
	freshEqual(t, s, warm)
	write(t, helper, "export function id(name: string) { return 'new.' + name; }")
	helperEdit := refresh(t, s)
	if helperEdit.Stats.Evaluated != 2 || helperEdit.Stats.Reused != 1 || len(helperEdit.Duplicates["new.alpha"]) != 2 {
		t.Fatalf("helper: %+v", helperEdit)
	}
	freshEqual(t, s, helperEdit)
	write(t, helper, "export function id(name: string | 'type-only') { return 'new.' + name; }")
	typeEdit := refresh(t, s)
	if typeEdit.Stats.Evaluated != 2 || typeEdit.Stats.BucketDeltas != 0 {
		t.Fatalf("semantic cutoff failed: %+v", typeEdit)
	}
	freshEqual(t, s, typeEdit)
	write(t, helper, "export function id(name: string) { return 'new.' + name; }\nconst effect = arbitrary();")
	effect := refresh(t, s)
	if effect.Decisions[0].Result.Reason == "" || effect.Decisions[1].Result.Reason == "" || effect.Decisions[2].Result.Reason != "" {
		t.Fatalf("effects must residual: %+v", effect)
	}
	freshEqual(t, s, effect)
	write(t, helper, "export function id(name: string) { return 'issues.' + name; }")
	repair := refresh(t, s)
	freshEqual(t, s, repair)
	unchanged := refresh(t, s)
	if unchanged.Stats.Evaluated != 0 || unchanged.Stats.Reused != 3 || unchanged.Stats.BarrierReads != 5 {
		t.Fatalf("unchanged: %+v", unchanged)
	}
	if target := os.Getenv("OBSERVABLE_DECISION_EVIDENCE"); target != "" {
		data, _ := json.MarshalIndent(map[string]Report{"cold": cold, "fieldEdit": warm, "helperEdit": helperEdit, "typeOnlySemanticCutoff": typeEdit, "effectResidual": effect, "repair": repair, "unchanged": unchanged}, "", "  ")
		if e := os.WriteFile(target, data, 0600); e != nil {
			t.Fatal(e)
		}
	}
}
func TestNegativeResolutionProbeInvalidatesOnHigherPriorityInsertion(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.ts")
	helper := filepath.Join(dir, "helper.ts")
	index := filepath.Join(dir, "helper/index.ts")
	write(t, a, "import { Query } from '@qualified/sdk/query'; import { id } from './helper'; export const query = Query({ id: id('alpha') });")
	write(t, index, "export function id(name: string) { return 'fallback.' + name; }")
	s, e := New([]string{a, helper, index}, intrinsic)
	if e != nil {
		t.Fatal(e)
	}
	r := refresh(t, s)
	if r.Decisions[0].Result.ID != "fallback.alpha" {
		t.Fatalf("%+v", r)
	}
	if _, ok := r.Decisions[0].Reads[helper]; !ok {
		t.Fatal("absence not traced")
	}
	write(t, helper, "export function id(name: string) { return 'preferred.' + name; }")
	r = refresh(t, s)
	if r.Stats.Evaluated != 1 || r.Decisions[0].Result.ID != "preferred.alpha" {
		t.Fatalf("%+v", r)
	}
	freshEqual(t, s, r)
	if e := os.Remove(helper); e != nil {
		t.Fatal(e)
	}
	r = refresh(t, s)
	if r.Decisions[0].Result.ID != "fallback.alpha" {
		t.Fatalf("%+v", r)
	}
	freshEqual(t, s, r)
}
func TestMissingPropertyAndReceiverAreResidual(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.ts")
	write(t, p, "import { Query } from '@qualified/sdk/query'; export const query = Query({other: 'x'});")
	s, _ := New([]string{p}, intrinsic)
	r := refresh(t, s)
	if r.Decisions[0].Result.Reason != "missing id" {
		t.Fatalf("%+v", r)
	}
	write(t, p, "import { Query } from '@qualified/sdk/query'; export const query = Query({id: 'new'});")
	r = refresh(t, s)
	if r.Decisions[0].Result.ID != "new" {
		t.Fatalf("%+v", r)
	}
	freshEqual(t, s, r)
	write(t, p, "import { Query } from '@qualified/sdk/query'; export const query = namespace.Query({id: 'new'});")
	r = refresh(t, s)
	if r.Decisions[0].Result.Reason == "" {
		t.Fatalf("receiver was guessed: %+v", r)
	}
}

func TestRuntimeOwnershipRejectsAsyncAndUnexportedHelper(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.ts")
	helper := filepath.Join(dir, "helper.ts")
	write(t, p, "import { Query } from '@qualified/sdk/query'; import { id } from './helper'; export const query = Query({ id: id('alpha') });")
	s, _ := New([]string{p, helper}, intrinsic)
	for _, source := range []string{
		"export async function id(name: string) { return 'issues.' + name; }",
		"function id(name: string) { return 'issues.' + name; }",
		"export function id(name: string) { return missingPrefix + name; }",
		"export function id(name: string) { return 'issues.' + name; }\nlet prefix = 'changed';",
		"export function id(name: string) { return 'unterminated; }",
	} {
		write(t, helper, source)
		r := refresh(t, s)
		if r.Decisions[0].Result.Reason == "" {
			t.Fatalf("false known for %q: %+v", source, r)
		}
		freshEqual(t, s, r)
	}
}
