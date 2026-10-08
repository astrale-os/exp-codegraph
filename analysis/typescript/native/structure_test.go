package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func writeStructuralFixture(t *testing.T, root string) {
	t.Helper()
	for path, text := range map[string]string{
		"tsconfig.json": `{"compilerOptions":{"noLib":true,"module":"ESNext","moduleResolution":"Bundler"},"include":["*.ts"]}`,
		"api.ts":        `export interface Payment {id:string} export function charge(amount:number){return amount} export function refund(amount:number){return amount} export default charge`,
		"barrel.ts":     `export {charge as pay, type Payment} from './api'; export * from './api'`,
		"consumer.ts": `import {pay as selected, type Payment} from './barrel'; import * as api from './api';
const copied=selected; const object={selected}; const payment:Payment={id:'x'};
const other:api.Payment=payment; selected(1); api.charge(2); const indexed=api['charge'];
export {selected as exported}; const lazy=import('./api'); type Imported=import('./api').Payment;`,
		"empty.ts": `// No declarations, references or module requests.`,
	} {
		if err := os.WriteFile(filepath.Join(root, path), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func openStructuralAnalyzer(t *testing.T, root string, extra ...string) *analyzer {
	t.Helper()
	a, err := newAnalyzer(root, "tsconfig.json", "", append([]string{structureNamespace}, extra...), nil, nil, 0, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func structuralPayloads(t *testing.T, transaction *factTransaction) map[string]structurePayload {
	t.Helper()
	result := map[string]structurePayload{}
	if transaction == nil {
		t.Fatal("missing structural transaction")
	}
	for _, shard := range transaction.Upserts {
		if shard.Namespace == structureNamespace {
			if len(shard.Facts) != 1 {
				t.Fatal("structure must publish exactly one fact per source")
			}
			payload := shard.Facts[0].Payload.(structurePayload)
			result[payload.LogicalPath] = payload
		}
	}
	return result
}

func structuralExport(t *testing.T, payload structurePayload, name string) string {
	t.Helper()
	for _, exported := range payload.Exports {
		if exported.Name == name {
			return exported.Symbol
		}
	}
	t.Fatalf("missing export %s in %s", name, payload.LogicalPath)
	return ""
}

func TestStructuralProjectionCanonicalAliasesTypesShorthandAndEmptySources(t *testing.T) {
	root := t.TempDir()
	writeStructuralFixture(t, root)
	a := openStructuralAnalyzer(t, root)
	defer a.close()
	current, _, err := a.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	rows := structuralPayloads(t, current)
	if len(rows) != 4 {
		t.Fatalf("owned source inventory: got %d rows", len(rows))
	}
	for _, shard := range current.Upserts {
		if shard.Namespace != structureNamespace {
			t.Fatalf("structural-only request materialized an unrelated namespace: %s", shard.Namespace)
		}
	}
	charge := structuralExport(t, rows["api.ts"], "charge")
	if structuralExport(t, rows["barrel.ts"], "pay") != charge || structuralExport(t, rows["consumer.ts"], "exported") != charge {
		t.Fatal("barrel/local export aliases lost their canonical declaration")
	}
	payment := structuralExport(t, rows["api.ts"], "Payment")
	valueReferences, typeReferences := 0, 0
	for _, reference := range rows["consumer.ts"].References {
		if reference.Symbol == charge && reference.Kind == "value" {
			valueReferences++
		}
		if reference.Symbol == payment && reference.Kind == "type" {
			typeReferences++
		}
	}
	if valueReferences < 5 || typeReferences < 2 {
		t.Fatalf("bare/namespace/shorthand/computed/type references were dropped: value=%d type=%d\n%s", valueReferences, typeReferences, stableJSON(rows["consumer.ts"]))
	}
	// The authored shorthand token denotes the imported value, not the new
	// object's structural property symbol.
	text, _ := os.ReadFile(filepath.Join(root, "consumer.ts"))
	start := strings.Index(string(text), "{selected}") + 1
	matched := false
	for _, reference := range rows["consumer.ts"].References {
		if reference.Start == start && reference.Symbol == charge && reference.Kind == "value" {
			matched = true
		}
	}
	if !matched {
		t.Fatal("shorthand property did not retain its value binding")
	}
	empty := rows["empty.ts"]
	if empty.Source == "" || empty.Revision == "" || len(empty.References) != 0 || len(empty.Dependencies) != 0 || empty.Completeness.References.Kind != "complete" {
		t.Fatal("empty source lost its coverage certificate", empty)
	}
	for _, edge := range rows["consumer.ts"].Dependencies {
		if edge.TargetPath != "api.ts" && edge.TargetPath != "barrel.ts" {
			t.Fatalf("a resolved owned module did not keep its portable path: %+v", edge)
		}
	}
	if rows["consumer.ts"].Completeness.References.Kind != "complete" {
		t.Fatal("supported static references did not retain complete coverage", rows["consumer.ts"].Completeness)
	}
}

func TestStructuralExternalDeclarationsKeepPortableOriginsWithoutInventingOwnedSources(t *testing.T) {
	root := t.TempDir()
	writeStructuralFixture(t, root)
	packageRoot := filepath.Join(root, "node_modules", "@fixture", "payments")
	if err := os.MkdirAll(packageRoot, 0755); err != nil {
		t.Fatal(err)
	}
	for path, text := range map[string]string{
		filepath.Join(packageRoot, "package.json"): `{"name":"@fixture/payments","types":"index.d.ts"}`,
		filepath.Join(packageRoot, "index.d.ts"):   `export interface Payment {id:string} export declare function charge(amount:number):number`,
		filepath.Join(root, "external.ts"):         `import {charge} from '@fixture/payments'; import * as api from '@fixture/payments'; export {charge as externalCharge}; const use=charge; api.charge(1)`,
	} {
		if err := os.WriteFile(path, []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := openStructuralAnalyzer(t, root)
	defer a.close()
	current, _, err := a.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	rows := structuralPayloads(t, current)
	external := rows["external.ts"]
	id := structuralExport(t, external, "externalCharge")
	found := false
	for _, symbol := range external.Symbols {
		if strings.Contains(stableJSON(symbol), root) {
			t.Fatal("structural presentation leaked a physical package path", symbol)
		}
		if symbol.Symbol == id {
			found = symbol.Origin != nil && symbol.Origin.Package == "@fixture/payments" && symbol.Origin.File == "index.d.ts" && reflect.DeepEqual(symbol.Origin.Path, []string{"charge"}) && len(symbol.Declarations) == 0
		}
	}
	if !found {
		t.Fatal("external API lost its proven portable origin")
	}
	for _, edge := range external.Dependencies {
		if edge.TargetPath != "package:@fixture/payments/index.d.ts" {
			t.Fatal("external request lost its package coordinate", edge)
		}
	}
	if len(rows) != 5 {
		t.Fatal("external declaration file was invented as an owned source", len(rows))
	}
}

func TestStructuralUnknownRequestsMembersAndParserRecoveryRemainPartial(t *testing.T) {
	root := t.TempDir()
	writeStructuralFixture(t, root)
	for path, text := range map[string]string{
		"unknown.ts":    `import * as api from './api'; declare const key:string; api[key]; import(key); require(key); import('./missing')`,
		"broken.ts":     `export const broken = (`,
		"unresolved.ts": `export * from './missing'`,
	} {
		if err := os.WriteFile(filepath.Join(root, path), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := openStructuralAnalyzer(t, root)
	defer a.close()
	current, _, err := a.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	rows := structuralPayloads(t, current)
	unknown := rows["unknown.ts"]
	if unknown.Completeness.Dependencies.Kind != "partial" || unknown.Completeness.References.Kind != "partial" {
		t.Fatal("computed/failed resolution claimed absence certainty")
	}
	computed, missing := 0, 0
	for _, edge := range unknown.Dependencies {
		if edge.Kind == "dynamic" && edge.Specifier == nil && edge.TargetPath == "" || edge.Kind == "require" && edge.Specifier == nil && edge.TargetPath == "" {
			computed++
		}
		if edge.Specifier != nil && *edge.Specifier == "./missing" && edge.TargetPath == "" {
			missing++
		}
	}
	if computed != 2 || missing != 1 {
		t.Fatalf("unknown module requests vanished: computed=%d missing=%d", computed, missing)
	}
	if rows["unresolved.ts"].Completeness.Exports.Kind != "partial" {
		t.Fatal("unresolved star export claimed complete exports")
	}
	broken := rows["broken.ts"].Completeness
	if broken.Exports.Kind != "partial" || broken.References.Kind != "partial" || broken.Dependencies.Kind != "partial" {
		t.Fatal("parser recovery certified complete absence")
	}
}

func TestStructuralRefreshBarrelTargetAndFailedResolutionMatchFresh(t *testing.T) {
	root := t.TempDir()
	writeStructuralFixture(t, root)
	if err := os.WriteFile(filepath.Join(root, "late.ts"), []byte(`import {late} from './missing'; export const selected=late`), 0644); err != nil {
		t.Fatal(err)
	}
	a := openStructuralAnalyzer(t, root)
	defer a.close()
	current, _, err := a.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: current.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	unchanged, identity, err := a.refresh(request{ID: 2, Base: current.Next.ID, BaseSequence: 1, Discover: true})
	if err != nil || unchanged != nil || identity != current.Next.ID {
		t.Fatalf("structural no-op was not stable: %v", err)
	}
	for index, change := range []struct{ path, text string }{
		{"barrel.ts", `export {refund as pay, type Payment} from './api'; export * from './api'`},
		{"missing.ts", `export const late='resolved'`},
		{"api.ts", `// inserted before declarations
export interface Payment {id:string} export function charge(amount:number){return amount} export function refund(amount:number){return amount} export default charge`},
	} {
		if err := os.WriteFile(filepath.Join(root, change.path), []byte(change.text), 0644); err != nil {
			t.Fatal(err)
		}
		sequence := index + 1
		next, _, err := a.refresh(request{ID: index + 3, Base: a.acknowledged.generation.ID, BaseSequence: sequence, Changed: []string{change.path}, Discover: true})
		if err != nil || next == nil {
			t.Fatalf("structural edit: %v", err)
		}
		fresh := openStructuralAnalyzer(t, root)
		oracle, _, err := fresh.refresh(request{ID: 1})
		fresh.close()
		if err != nil {
			t.Fatal(err)
		}
		// Compare admitted complete manifests, not merely the changed upserts.
		if next.Next.ID != oracle.Next.ID || !reflect.DeepEqual(next.Manifest, oracle.Manifest) {
			t.Fatalf("incremental structural projection differs from fresh after %s", change.path)
		}
		if err := a.acknowledge(request{Generation: next.Next.ID, Sequence: sequence + 1}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestStructuralCapabilityIsExplicitAndPreservesOccurrencePayloads(t *testing.T) {
	if planProjections(supportedCapabilities).structure {
		t.Fatal("structural projection changed the native historical defaults")
	}
	root := t.TempDir()
	writeStructuralFixture(t, root)
	legacy, err := newAnalyzer(root, "tsconfig.json", "", []string{sourceNamespace, symbolNamespace, occurrenceNamespace}, nil, nil, 0, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.close()
	before, _, err := legacy.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	with := openStructuralAnalyzer(t, root, sourceNamespace, symbolNamespace, occurrenceNamespace)
	defer with.close()
	after, _, err := with.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	payloads := func(transaction *factTransaction) map[string]string {
		result := map[string]string{}
		for _, shard := range transaction.Upserts {
			if shard.Namespace == structureNamespace {
				continue
			}
			for _, fact := range shard.Facts {
				result[fact.ID] = stableJSON(fact.Payload)
			}
		}
		return result
	}
	if !reflect.DeepEqual(payloads(before), payloads(after)) {
		t.Fatal("opt-in structure changed an existing source/symbol/occurrence payload")
	}
}

func TestStructuralTypeOnlyStarExportsUseCompilerRuntimeAvailability(t *testing.T) {
	root := t.TempDir()
	writeStructuralFixture(t, root)
	for path, text := range map[string]string{
		"typed-star.ts":          `export type * from './api'`,
		"indirect-typed-star.ts": `export * from './typed-star'`,
		"mixed-star.ts":          `export type * from './api'; export {charge} from './api'`,
	} {
		if err := os.WriteFile(filepath.Join(root, path), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := openStructuralAnalyzer(t, root)
	defer a.close()
	current, _, err := a.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	rows := structuralPayloads(t, current)
	charge := structuralExport(t, rows["api.ts"], "charge")
	for _, path := range []string{"typed-star.ts", "indirect-typed-star.ts", "mixed-star.ts"} {
		if structuralExport(t, rows[path], "charge") != charge {
			t.Fatal("type-only route changed the canonical API identity", path)
		}
		for _, exported := range rows[path].Exports {
			if exported.Name == "charge" && exported.TypeOnly != (path != "mixed-star.ts") {
				t.Fatalf("type-only star route disagrees with runtime availability: %s %+v", path, exported)
			}
			if exported.Name == "Payment" && !exported.TypeOnly {
				t.Fatal("interface acquired a runtime export", path)
			}
		}
	}
}

func TestStructuralModuleRequestsPreserveEmptyLiteralsAndRequireOwnership(t *testing.T) {
	root := t.TempDir()
	writeStructuralFixture(t, root)
	for path, text := range map[string]string{
		"empty-request.ts": `import ''; import(''); const actual=require('./api'); function shadowed(require:(value:string)=>unknown){ return require('./not-a-module') }`,
		"type-require.ts":  `import type api = require('./api'); type Payment=api.Payment`,
	} {
		if err := os.WriteFile(filepath.Join(root, path), []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := openStructuralAnalyzer(t, root)
	defer a.close()
	current, _, err := a.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	rows := structuralPayloads(t, current)
	if len(rows["empty-request.ts"].Dependencies) != 3 {
		t.Fatal("shadowed require was admitted as a module request", rows["empty-request.ts"].Dependencies)
	}
	empty := 0
	for _, edge := range rows["empty-request.ts"].Dependencies {
		if edge.Specifier == nil {
			t.Fatal("literal request lost its authored specifier", edge)
		}
		if *edge.Specifier == "" {
			empty++
			if !strings.Contains(stableJSON(edge), `"specifier":""`) {
				t.Fatal("JSON conflated an empty literal request with a computed request", edge)
			}
		}
	}
	if empty != 2 {
		t.Fatal("empty literal module request vanished", empty)
	}
	typed := rows["type-require.ts"].Dependencies
	if len(typed) != 1 || !typed[0].TypeOnly || typed[0].Kind != "import" || typed[0].TargetPath != "api.ts" {
		t.Fatal("type-only import-equals request lost its phase or target", typed)
	}
}

func TestStructuralLooseExternalBasenameCollisionsDoNotInventCanonicalMatches(t *testing.T) {
	fixture := t.TempDir()
	root := filepath.Join(fixture, "project")
	for _, directory := range []string{root, filepath.Join(fixture, "first"), filepath.Join(fixture, "second")} {
		if err := os.MkdirAll(directory, 0755); err != nil {
			t.Fatal(err)
		}
	}
	writeStructuralFixture(t, root)
	for path, text := range map[string]string{
		filepath.Join(fixture, "first", "api.ts"):  `export function charge(){return 'first'}`,
		filepath.Join(fixture, "second", "api.ts"): `export function charge(){return 'second'}`,
		filepath.Join(root, "loose.ts"): `import {charge as first} from '../first/api'; import {charge as second} from '../second/api';
first(); second(); export {first, second}`,
		filepath.Join(root, "loose-import.ts"): `import {charge} from '../first/api'; charge()`,
	} {
		if err := os.WriteFile(path, []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := openStructuralAnalyzer(t, root)
	defer a.close()
	current, _, err := a.refresh(request{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	rows := structuralPayloads(t, current)
	loose := rows["loose.ts"]
	if len(loose.Exports) != 0 || len(loose.Symbols) != 0 || len(loose.References) == 0 {
		t.Fatal("ambiguous external identity was admitted or authored tokens were dropped", loose)
	}
	for _, reference := range loose.References {
		if reference.Symbol != "" {
			t.Fatal("same-basename loose external APIs fabricated a canonical match", reference)
		}
	}
	if len(loose.Dependencies) != 2 {
		t.Fatal("resolved loose module requests vanished", loose.Dependencies)
	}
	for _, dependency := range loose.Dependencies {
		if dependency.TargetPath != "" || dependency.Specifier == nil || *dependency.Specifier == "" {
			t.Fatal("ambiguous module identity escaped or its authored specifier vanished", dependency)
		}
	}
	for _, dimension := range []completeness{loose.Completeness.Exports, loose.Completeness.References, loose.Completeness.Dependencies} {
		if dimension.Kind != "partial" || !strings.Contains(stableJSON(dimension), "STRUCTURE_EXTERNAL_COORDINATE_UNREGISTERED") {
			t.Fatal("unsupported ownership failed to explain its uncertainty", dimension)
		}
	}
	if rows["loose-import.ts"].Completeness.Exports.Kind != "complete" {
		t.Fatal("a loose import polluted the unrelated empty export inventory")
	}
	for _, path := range []string{"api.ts", "barrel.ts", "consumer.ts", "empty.ts"} {
		coverage := rows[path].Completeness
		if coverage.Exports.Kind != "complete" || coverage.References.Kind != "complete" || coverage.Dependencies.Kind != "complete" {
			t.Fatal("loose external ownership polluted a supported owned source", path, coverage)
		}
	}
}
