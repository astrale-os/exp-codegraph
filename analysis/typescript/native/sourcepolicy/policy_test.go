package sourcepolicy

import (
	"path/filepath"
	"strings"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
)

func source(path, layer, text string) *File {
	absolute, err := filepath.Abs(path)
	if err != nil {
		panic(err)
	}
	return &File{Path: path, Layer: layer, Role: "production", Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: absolute}, text, core.ScriptKindTS)}
}

func TestAsyncSyntaxAndPromiseAuthority(t *testing.T) {
	f := source("rules/a.ts", "rules", `
async function f(): Promise<void> { await value; }
function* g(): NS.AsyncIterable<string> { yield "a"; }
const z = new Promise(() => {});
Promise.resolve(1); globalThis["Promise"][name](1);
const irrelevant: (x: number) => Promise<number> = x => x;
`)
	r := Evaluate([]*File{f}, Authority{LocallyBound: func(*ast.Node) bool { return false }})
	if len(r.Residual) != 0 || len(r.Evidence) != 8 {
		t.Fatalf("want 8 async/Promise decisions, got %+v", r)
	}
	if r.Evidence[7].Kind != "ambiguity" || !strings.Contains(r.Evidence[7].Evidence, "computed member") {
		t.Fatalf("computed Promise must retain ambiguity: %+v", r.Evidence)
	}
	// Bound globals stop Promise construction/member diagnostics; asynchronous
	// syntax and authored return type decisions are independent observations.
	local := Evaluate([]*File{f}, Authority{LocallyBound: func(*ast.Node) bool { return true }})
	if len(local.Evidence) != 5 || len(local.Residual) != 0 {
		t.Fatalf("lexical authority changed unrelated syntax: %+v", local)
	}
	missing := Evaluate([]*File{f}, Authority{})
	if len(missing.Evidence) != 5 || len(missing.Residual) != 3 {
		t.Fatalf("missing binding authority must be explicit: %+v", missing)
	}
}

func TestRuleGlobalPropertyChainPreservesAuthoredScope(t *testing.T) {
	f := source("rules/a.ts", "rules", `fetch("x"); globalThis.fetch("x"); globalThis["fetch"]("x"); (<any>fetch)("x");`)
	r := Evaluate([]*File{f}, Authority{LocallyBound: func(*ast.Node) bool { return false }})
	if len(r.Evidence) != 2 || len(r.Residual) != 0 {
		t.Fatalf("must preserve named property/unwrap scope, got %+v", r)
	}
	shadow := Evaluate([]*File{f}, Authority{LocallyBound: func(*ast.Node) bool { return true }})
	// The current SDK's explicit globalThis branch does not inspect shadowing.
	// This migration preserves that behavior rather than introducing a fix.
	if len(shadow.Evidence) != 1 || shadow.Evidence[0].Evidence != "Rule calls effectful global fetch." {
		t.Fatalf("scope changed: %+v", shadow)
	}
}

func TestPromiseUnwrapMatchesSDKForms(t *testing.T) {
	f := source("rules/a.ts", "rules", `(Promise).resolve(1); (Promise as any).resolve(1); (Promise satisfies typeof Promise).resolve(1); Promise!.resolve(1); (<any>Promise).resolve(1);`)
	r := Evaluate([]*File{f}, Authority{LocallyBound: func(*ast.Node) bool { return false }})
	if len(r.Evidence) != 4 || len(r.Residual) != 0 {
		t.Fatalf("unwrap scope drifted or assertion was broadened: %+v", r)
	}
}

func TestImportDecisionsDistinguishResolutionFromAbsence(t *testing.T) {
	rules := source("rules/a.ts", "rules", "")
	rules.Imports = []Import{{Specifier: "node:fs", Node: rules.Source.AsNode()}, {Specifier: "../functions/a.js", Node: rules.Source.AsNode()}, {Specifier: "@astrale-os/adapter-x", TypeOnly: true, Node: rules.Source.AsNode()}}
	u := source("utils/a.ts", "utils", "")
	u.Imports = []Import{{Specifier: "../schema/a.js", Node: u.Source.AsNode()}, {Specifier: "@astrale-os/sdk/src/a", Node: u.Source.AsNode()}, {Specifier: "@astrale-domains/issues", Node: u.Source.AsNode()}}
	ui := source("ui/a.ts", "ui", "")
	ui.Imports = []Import{{Specifier: "@org/sales-domain/query", Node: ui.Source.AsNode()}, {Specifier: "@org/domain/subpath", Node: ui.Source.AsNode()}, {Specifier: "@org/domainish", Node: ui.Source.AsNode()}}
	resolve := func(_ *File, imp Import) Resolution {
		if strings.Contains(imp.Specifier, "functions") {
			return Resolution{Known: true, Target: &File{Layer: "functions"}}
		}
		return Resolution{Known: true, Target: &File{Layer: "schema"}}
	}
	r := Evaluate([]*File{rules, u, ui}, Authority{Resolve: resolve})
	if len(r.Evidence) != 8 || len(r.Residual) != 0 {
		t.Fatalf("want 3 rule + 2 UI + 3 utils decisions, got %+v", r)
	}
	missing := Evaluate([]*File{rules, u, ui}, Authority{})
	if len(missing.Evidence) != 6 || len(missing.Residual) != 2 {
		t.Fatalf("missing local resolver must not become negative proof: %+v", missing)
	}
}

func TestIntegrationAllowancesOverrideBoundarySpelling(t *testing.T) {
	f := source("integrations/a.ts", "integrations", "")
	f.Imports = []Import{
		{Specifier: "../sibling.js", Node: f.Source.AsNode()},
		{Specifier: "../schema.js", TypeOnly: true, Node: f.Source.AsNode()},
		{Specifier: "openai", TypeOnly: true, Node: f.Source.AsNode()},
		{Specifier: "@astrale-os/kernel-client", TypeOnly: true, Node: f.Source.AsNode()},
		{Specifier: "node:os", Node: f.Source.AsNode()},
		{Specifier: "node:fs", Node: f.Source.AsNode()},
	}
	r := Evaluate([]*File{f}, Authority{Resolve: func(_ *File, imp Import) Resolution {
		if strings.Contains(imp.Specifier, "sibling") {
			return Resolution{Known: true, Target: &File{Layer: "integrations"}}
		}
		return Resolution{Known: true, Target: &File{Layer: "schema"}}
	}})
	// Portable os is permitted by INT-PURE (but effectful under RUL-PURE),
	// and kernel type imports are explicitly allowed even for kernel-client.
	if len(r.Evidence) != 2 || len(r.Residual) != 0 {
		t.Fatalf("allowance precedence drifted: %+v", r)
	}
	if !strings.Contains(r.Evidence[0].Evidence, "openai") || !strings.Contains(r.Evidence[1].Evidence, "node:fs") {
		t.Fatalf("unexpected decisions: %+v", r.Evidence)
	}
	f.Role = "focused-test"
	if skipped := Evaluate([]*File{f}, Authority{}); len(skipped.Evidence)+len(skipped.Residual) != 0 {
		t.Fatalf("test role was broadened: %+v", skipped)
	}
}
