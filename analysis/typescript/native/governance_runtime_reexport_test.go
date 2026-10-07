package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"reflect"
	"testing"
)

func runtimeReexportOwner(t *testing.T, root string) (*governedProject, *governanceRuntimeAuthority) {
	t.Helper()
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		t.Fatal(identity.Reason)
	}
	t.Cleanup(func() {
		if project.typeRelease != nil {
			project.typeRelease()
			project.typeRelease = nil
		}
	})
	return project, governanceNewRuntimeAuthority(identity)
}

func TestRuntimeReexportHelperEditCollisionFreshAndRetained(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","types":"index.d.ts"}`)
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", `export {defineMutation} from './dist/application/mutation/define';`)
	governanceWrite(t, root, "node_modules/@astrale-os/sdk/dist/application/mutation/define.d.ts", `export declare function defineMutation(): (projector:()=>unknown)=>unknown;`)
	governanceWrite(t, root, "mutations/source.ts", `import {defineMutation} from '@astrale-os/sdk';import {contractProjector} from '../schema/facade';export const mutation=defineMutation()(contractProjector);export const other=defineMutation()(()=>({id:'employee.create'}));`)
	governanceWrite(t, root, "schema/facade.ts", `export {transitionProjector as contractProjector} from './projector';`)
	governanceWrite(t, root, "schema/projector.ts", `import {transitionDefinition} from './helper';export function transitionProjector(){return transitionDefinition()}`)
	governanceWrite(t, root, "schema/helper.ts", `export function transitionDefinition(){return {id:'contract.transition'}}`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts","schema/**/*.ts"]}`)
	observe := func(project *governedProject, owner *governanceRuntimeAuthority) []string {
		product := observabledecision.ObserveDefinitionIDs(owner.DemandContext(observabledecision.Limits{}))
		if !product.InventoryKnown || len(product.Observations) != 2 {
			t.Fatalf("definitions=%#v", product)
		}
		ids := []string{}
		for _, definition := range product.Observations {
			if definition.ID.Kind != "known" {
				t.Fatalf("ID=%#v", definition.ID)
			}
			ids = append(ids, definition.ID.String)
		}
		return ids
	}
	first, owner := runtimeReexportOwner(t, root)
	before := observe(first, owner)
	if !reflect.DeepEqual(before, []string{"contract.transition", "employee.create"}) {
		t.Fatal(before)
	}
	if valid, err := first.capture.Verify(); err != nil || !valid {
		t.Fatal(valid, err)
	}
	first.typeRelease()
	first.typeRelease = nil
	generation := governanceRetainProgramGeneration(first, first.typeOwner.generationBroker)
	if generation == nil {
		t.Fatal("original generation not retained")
	}
	governanceWrite(t, root, "schema/helper.ts", `export function transitionDefinition(){return {id:'employee.create'}}`)
	if valid, err := first.capture.Verify(); err != nil || valid {
		t.Fatal("old body capture did not reject helper edit", valid, err)
	}
	resident, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	resident.programGeneration = generation
	governanceSharedProject(resident)
	residentIdentity := governanceBuildRuntimeIdentity(resident)
	if !residentIdentity.Complete {
		t.Fatal(residentIdentity.Reason)
	}
	defer resident.typeRelease()
	if resident.borrowedGeneration == nil {
		t.Fatal("BODY update did not exercise retained Program proposal")
	}
	residentIDs := observe(resident, governanceNewRuntimeAuthority(residentIdentity))
	fresh, freshOwner := runtimeReexportOwner(t, root)
	freshIDs := observe(fresh, freshOwner)
	if !reflect.DeepEqual(residentIDs, freshIDs) || !reflect.DeepEqual(freshIDs, []string{"employee.create", "employee.create"}) {
		t.Fatal(residentIDs, freshIDs)
	}
	governanceWrite(t, root, "schema/helper.ts", `export function transitionDefinition(){return {id:'contract.transition'}}`)
	if valid, err := resident.capture.Verify(); err != nil || valid {
		t.Fatal("resident capture did not reject repair", valid, err)
	}
	repaired, repairedOwner := runtimeReexportOwner(t, root)
	if repairedIDs := observe(repaired, repairedOwner); !reflect.DeepEqual(repairedIDs, before) {
		t.Fatal("repair changed original IDs", repairedIDs, before)
	}

}

func TestRuntimeReexportRejectsAnotherCaptureDeclaration(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", `import {contractProjector} from './helper';const selected=contractProjector;`)
	governanceWrite(t, root, "mutations/helper.ts", `export function contractProjector(){return {id:'stable.id'}}`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts"]}`)
	_, old := runtimeReexportOwner(t, root)
	resolution := old.Resolve("mutations/source.ts", "./helper", "contractProjector")
	_, current := runtimeReexportOwner(t, root)
	context := current.DemandContext(observabledecision.Limits{})
	context.Resolve = func(string, string, string) observabledecision.Resolution { return resolution }
	var expression *ast.Node
	file := current.ByPath["mutations/source.ts"]
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration {
			expression = node.AsVariableDeclaration().Initializer
		}
		return true
	})
	proof := observabledecision.NewNativeValueReader(context).Expression(file.Path, expression).Resolve(observabledecision.Limits{})
	if proof.Outcome.Kind != "unknown" || proof.Outcome.Reason != "resolved declaration belongs to another capture" {
		t.Fatal(proof)
	}
}

func TestRuntimeReexportCapturedReaderSurvivesNewEpoch(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", `import {published} from './helper';const selected=published;`)
	governanceWrite(t, root, "mutations/helper.ts", `function privateProjector(){return {id:'before'}} export {privateProjector as published}`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts"]}`)
	prior, old := runtimeReexportOwner(t, root)
	file := old.ByPath["mutations/source.ts"]
	var expression *ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration {
			expression = node.AsVariableDeclaration().Initializer
		}
		return true
	})
	reader := observabledecision.NewNativeValueReader(old.DemandContext(observabledecision.Limits{}))
	plan := reader.Expression(file.Path, expression).Invoke().Property("id")
	before := plan.Resolve(observabledecision.Limits{})
	if before.Outcome.Kind != "known" || before.Value.Literal != "before" {
		t.Fatal(before)
	}
	governanceWrite(t, root, "mutations/helper.ts", `function privateProjector(){return {id:'after'}} export {privateProjector as published}`)
	_, current := runtimeReexportOwner(t, root)
	if next := runtimeReexportID(t, current); next.Outcome.Kind != "known" || next.Value.Literal != "after" {
		t.Fatal(next)
	}
	if retained := plan.Resolve(observabledecision.Limits{}); retained.Outcome.Kind != "known" || retained.Value.Literal != "before" {
		t.Fatal("old reader lost captured value", retained)
	}
	if valid, err := prior.capture.Verify(); err != nil || valid {
		t.Fatal("old epoch cannot publish after edit", valid, err)
	}
}

func runtimeReexportID(t *testing.T, owner *governanceRuntimeAuthority) observabledecision.NativeDemandProof {
	t.Helper()
	file := owner.ByPath["mutations/source.ts"]
	var expression *ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && node.Name().Text() == "selected" {
			expression = node.AsVariableDeclaration().Initializer
		}
		return true
	})
	if expression == nil {
		t.Fatal("missing selected binding")
	}
	reader := observabledecision.NewNativeValueReader(owner.DemandContext(observabledecision.Limits{}))
	return reader.Expression(file.Path, expression).Invoke().Property("id").Resolve(observabledecision.Limits{})
}

func TestRuntimeReexportUsesCapturedDeclarationIdentity(t *testing.T) {
	for _, fixture := range []struct{ name, helper, middle, facade, source string }{
		{"direct", `export function contractProjector(){return {id:'stable.id'}}`, "", `export {contractProjector} from './helper'`, `import {contractProjector} from './facade';const selected=contractProjector;`},
		{"nested-renames", `export function privateProjector(){return {id:'stable.id'}}`, `export {privateProjector as middleName} from './helper'`, `export {middleName as contractProjector} from './middle'`, `import {contractProjector as localName} from './facade';const selected=localName;`},
		{"private-named-export", `function privateProjector(){return {id:'stable.id'}} export {privateProjector as published}`, "", `export {published as contractProjector} from './helper'`, `import {contractProjector} from './facade';const selected=contractProjector;`},
		{"module-closure", `const prefix='stable.id';function privateProjector(){return {id:prefix}} export {privateProjector as published}`, "", `export {published as contractProjector} from './helper'`, `import {contractProjector} from './facade';const selected=contractProjector;`},
		{"const-factory-closure", `function factory(id:string){return ()=>({id})} const published=factory('stable.id');export {published}`, "", `export {published as contractProjector} from './helper'`, `import {contractProjector} from './facade';const selected=contractProjector;`},
		{"const-alias", `function privateProjector(){return {id:'stable.id'}} const alias=privateProjector;export {alias as published}`, "", `export {published as contractProjector} from './helper'`, `import {contractProjector} from './facade';const selected=contractProjector;`},
		{"namespace-import", `function privateProjector(){return {id:'stable.id'}} export {privateProjector as published}`, "", `export {published as contractProjector} from './helper'`, `import * as api from './facade';const selected=api.contractProjector;`},
		{"shadowed-name", `function privateProjector(){return {id:'stable.id'}} export {privateProjector as published}`, `function privateProjector(){return {id:'wrong.id'}} export {published as contractProjector} from './helper'`, `export {contractProjector} from './middle'`, `import {contractProjector} from './facade';const selected=contractProjector;`},
		{"default-export", `export default function privateProjector(){return {id:'stable.id'}}`, "", `export {default as contractProjector} from './helper'`, `import {contractProjector} from './facade';const selected=contractProjector;`},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "mutations/source.ts", fixture.source)
			governanceWrite(t, root, "mutations/helper.ts", fixture.helper)
			governanceWrite(t, root, "mutations/middle.ts", fixture.middle)
			governanceWrite(t, root, "mutations/facade.ts", fixture.facade)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts"]}`)
			_, owner := runtimeReexportOwner(t, root)
			resolved := owner.Resolve("mutations/source.ts", "./facade", "contractProjector")
			if resolved.Reason != "" || resolved.Target == nil || resolved.Path != "mutations/helper.ts" || ast.GetSourceFileOfNode(resolved.Target) != owner.ByPath[resolved.Path].Source {
				t.Fatalf("resolution=%#v", resolved)
			}
			id := runtimeReexportID(t, owner)
			if id.Outcome.Kind != "known" || id.Value.Literal != "stable.id" {
				t.Fatalf("ID=%#v", id)
			}
			found := false
			for _, read := range id.Outcome.Reads {
				if read.Kind == "source-bytes" && read.Path == "mutations/helper.ts" {
					found = true
				}
			}
			if !found {
				t.Fatal("declaring body omitted from semantic reads")
			}
		})
	}
}

func TestRuntimeReexportPreservesValueRestrictions(t *testing.T) {
	for _, fixture := range []struct{ name, helper, facade, reason string }{
		{"mutable", `let privateProjector=()=>({id:'unsafe'});export {privateProjector as published}`, `export {published as contractProjector} from './helper'`, "mutable export requires effect refinement"},
		{"mutable-const-alias", `let privateProjector=()=>({id:'unsafe'});const alias=privateProjector;export {alias as published}`, `export {published as contractProjector} from './helper'`, "mutable export requires effect refinement"},
		{"type-only", `export function published(){return {id:'unsafe'}}`, `export type {published as contractProjector} from './helper'`, "runtime export is type-only"},
		{"namespace-container", `export namespace published {export function member(){return {id:'unsafe'}}}`, `export {published as contractProjector} from './helper'`, "unsupported local export declaration"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "mutations/source.ts", `import {contractProjector} from './facade';const selected=contractProjector;`)
			governanceWrite(t, root, "mutations/helper.ts", fixture.helper)
			governanceWrite(t, root, "mutations/facade.ts", fixture.facade)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts"]}`)
			_, owner := runtimeReexportOwner(t, root)
			id := runtimeReexportID(t, owner)
			if id.Outcome.Kind != "unknown" || id.Outcome.Reason != fixture.reason {
				t.Fatalf("ID=%#v", id)
			}
		})
	}
}

// Compiler resolution can reach the same function through value and type-only
// imports; only the former certifies a runtime callable binding.
func TestRuntimeReexportConstAliasesRequireRuntimeImports(t *testing.T) {
	for _, form := range []struct{ name, valueImport, typeImport, initializer string }{
		{"named", `import {identity} from './helper';`, `import type {identity} from './helper';`, "identity"},
		{"specifier", `import {identity} from './helper';`, `import {type identity} from './helper';`, "identity"},
		{"namespace", `import * as api from './helper';`, `import type * as api from './helper';`, "api.identity"},
		{"default", `import identity from './helper';`, `import type identity from './helper';`, "identity"},
		{"namespace-factory", `import * as api from './helper';`, `import type * as api from './helper';`, "api.factory()"},
		{"factory", `import {factory} from './helper';`, `import type {factory} from './helper';`, "factory()"},
	} {
		for _, nested := range []bool{false, true} {
			for _, runtime := range []bool{true, false} {
				name := form.name + "/type-only"
				imported := form.typeImport
				if runtime {
					name = form.name + "/runtime"
					imported = form.valueImport
				}
				if nested {
					name += "/nested"
				}
				t.Run(name, func(t *testing.T) {
					root := t.TempDir()
					governanceWrite(t, root, "mutations/helper.ts", `export function identity(){return {id:'stable.id'}} export function factory(){return identity} export default identity;`)
					middle := imported + "export const published=" + form.initializer + ";"
					if nested {
						middle = imported + "const first=" + form.initializer + "; const second=first; export const published=second;"
					}
					governanceWrite(t, root, "mutations/middle.ts", middle)
					governanceWrite(t, root, "mutations/facade.ts", `export {published as contractProjector} from './middle';`)
					governanceWrite(t, root, "mutations/source.ts", `import {contractProjector} from './facade'; const selected=contractProjector;`)
					governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts"]}`)
					_, owner := runtimeReexportOwner(t, root)
					proof := runtimeReexportID(t, owner)
					if runtime {
						if proof.Outcome.Kind != "known" || proof.Value.Literal != "stable.id" {
							t.Fatalf("runtime alias: %#v", proof)
						}
					} else if proof.Outcome.Kind != "unknown" {
						t.Fatalf("type-only alias manufactured a runtime function: %#v", proof)
					}
				})
			}
		}
	}
}

func TestRuntimeReexportSDKConstAliasesRequireRuntimeImports(t *testing.T) {
	for _, namespace := range []bool{false, true} {
		for _, runtime := range []bool{true, false} {
			name := "named/type-only"
			imported := `import type {defineMutation} from '@astrale-os/sdk';`
			initializer := "defineMutation"
			if runtime {
				name = "named/runtime"
				imported = `import {defineMutation} from '@astrale-os/sdk';`
			}
			if namespace {
				name = "namespace/type-only"
				imported = `import type * as sdk from '@astrale-os/sdk';`
				initializer = "sdk.defineMutation"
				if runtime {
					name = "namespace/runtime"
					imported = `import * as sdk from '@astrale-os/sdk';`
				}
			}
			t.Run(name, func(t *testing.T) {
				root := t.TempDir()
				governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","types":"index.d.ts"}`)
				governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", `export {defineMutation} from './dist/application/mutation/define';`)
				governanceWrite(t, root, "node_modules/@astrale-os/sdk/dist/application/mutation/define.d.ts", `export declare function defineMutation(): (projector:()=>unknown)=>unknown;`)
				governanceWrite(t, root, "schema/middle.ts", imported+"const first="+initializer+"; export const published=first;")
				governanceWrite(t, root, "schema/facade.ts", `export {published as createMutation} from './middle';`)
				governanceWrite(t, root, "mutations/source.ts", `import {createMutation} from '../schema/facade';export const mutation=createMutation()(()=>({id:'stable.id'}));`)
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts","schema/**/*.ts"]}`)
				_, owner := runtimeReexportOwner(t, root)
				resolution := owner.Resolve("mutations/source.ts", "../schema/facade", "createMutation")
				if runtime {
					if resolution.Origin == nil {
						t.Fatalf("runtime SDK origin unavailable: %#v", resolution)
					}
				} else if resolution.Origin != nil {
					t.Fatalf("type-only SDK origin manufactured: %#v", resolution)
				}
				product := observabledecision.ObserveDefinitionIDs(owner.DemandContext(observabledecision.Limits{}))
				if !product.InventoryKnown {
					t.Fatalf("actual definition inventory unavailable: %#v", product)
				}
				if runtime {
					if !product.InventoryKnown || len(product.Observations) != 1 || product.Observations[0].ID.Kind != "known" || product.Observations[0].ID.String != "stable.id" {
						t.Fatalf("runtime SDK constructor: %#v", product)
					}
				} else {
					for _, definition := range product.Observations {
						if definition.ID.Kind == "known" {
							t.Fatalf("type-only SDK alias manufactured definition: %#v", product)
						}
					}
				}
			})
		}
	}
}

func TestRuntimeReexportImportModeEditFreshAndRetained(t *testing.T) {
	for _, barrel := range []bool{false, true} {
		name := "import-modifier"
		if barrel {
			name = "barrel-modifier"
		}
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "mutations/source.ts", `import {contractProjector} from '../schema/facade';const selected=contractProjector;`)
			governanceWrite(t, root, "schema/helper.ts", `export function identity(){return {id:'stable.id'}}`)
			governanceWrite(t, root, "schema/middle.ts", `import {identity} from './helper';export const published=identity;`)
			governanceWrite(t, root, "schema/facade.ts", `export {published as contractProjector} from './middle';`)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts","schema/**/*.ts"]}`)
			var generation *governanceProgramGeneration
			var previous *governedProject
			var previousOwner *governanceRuntimeAuthority
			for step, runtime := range []bool{false, true, false, true} {
				if barrel {
					modifier := "type "
					if runtime {
						modifier = ""
					}
					governanceWrite(t, root, "schema/facade.ts", "export "+modifier+`{published as contractProjector} from './middle';`)
				} else {
					modifier := "type "
					if runtime {
						modifier = ""
					}
					governanceWrite(t, root, "schema/middle.ts", "import "+modifier+`{identity} from './helper';export const published=identity;`)
				}
				if previous != nil {
					prior := runtimeReexportID(t, previousOwner)
					if (prior.Outcome.Kind == "known") == (runtime) {
						t.Fatal("old reader changed import authority", prior)
					}
					if valid, err := previous.capture.Verify(); err != nil || valid {
						t.Fatal("old capture admitted modifier edit", valid, err)
					}
				}
				resident, err := captureGovernedProject(root, governanceTestPolicy())
				if err != nil {
					t.Fatal(err)
				}
				resident.programGeneration = generation
				governanceSharedProject(resident)
				identity := governanceBuildRuntimeIdentity(resident)
				if !identity.Complete {
					t.Fatal(identity.Reason)
				}
				if step > 0 && resident.borrowedGeneration == nil {
					t.Fatal("modifier edit did not exercise retained Program proposal")
				}
				residentOwner := governanceNewRuntimeAuthority(identity)
				current := runtimeReexportID(t, residentOwner)
				_, freshOwner := runtimeReexportOwner(t, root)
				fresh := runtimeReexportID(t, freshOwner)
				if current.Outcome.Kind != fresh.Outcome.Kind || current.Value.Literal != fresh.Value.Literal {
					t.Fatal("fresh/retained mismatch", current, fresh)
				}
				if runtime {
					if current.Outcome.Kind != "known" || current.Value.Literal != "stable.id" {
						t.Fatal(current)
					}
				} else if current.Outcome.Kind != "unknown" {
					t.Fatal("type-only mode became runtime", current)
				}
				if !barrel && !runtime {
					found := false
					for _, read := range current.Outcome.Reads {
						if read.Kind == "canonical-runtime-alias-source" && read.Path == "schema/middle.ts" {
							found = true
						}
					}
					if !found {
						t.Fatal("type-only refusal omitted declaring source read")
					}
				}
				if valid, err := resident.capture.Verify(); err != nil || !valid {
					t.Fatal(step, valid, err)
				}
				resident.typeRelease()
				resident.typeRelease = nil
				generation = governanceRetainProgramGeneration(resident, resident.typeOwner.generationBroker)
				if generation == nil {
					t.Fatal("generation not retained")
				}
				previous, previousOwner = resident, residentOwner
			}
		})
	}
}

// The existing ElementAccess demand is unsupported even with a runtime import;
// typed callable metadata must not manufacture a value for the type-only case.
func TestRuntimeReexportElementAccessKeepsUnsupportedContract(t *testing.T) {
	for _, runtime := range []bool{true, false} {
		name := "type-only"
		modifier := "type "
		if runtime {
			name = "runtime"
			modifier = ""
		}
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "mutations/source.ts", `import {contractProjector} from '../schema/facade';const selected=contractProjector;`)
			governanceWrite(t, root, "schema/helper.ts", `function identity(){return {id:'stable.id'}} export function factory(){return identity}`)
			governanceWrite(t, root, "schema/middle.ts", "import "+modifier+`* as api from './helper';export const published=api['factory']();`)
			governanceWrite(t, root, "schema/facade.ts", `export {published as contractProjector} from './middle';`)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts","schema/**/*.ts"]}`)
			_, owner := runtimeReexportOwner(t, root)
			proof := runtimeReexportID(t, owner)
			if proof.Outcome.Kind != "unknown" || proof.Outcome.Reason != "VALUE_NO_SEMANTIC_PATH" {
				t.Fatalf("unsupported element access manufactured runtime value: %#v", proof)
			}
		})
	}
}

func TestRuntimeReexportMutableNamespaceAliasPreservesTypeOnlyProvenance(t *testing.T) {
	for _, runtime := range []bool{true, false} {
		name, modifier := "type-only", "type "
		if runtime {
			name, modifier = "runtime", ""
		}
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "mutations/source.ts", `import {contractProjector} from '../schema/facade';const selected=contractProjector;`)
			governanceWrite(t, root, "schema/helper.ts", `export function identity(){return {id:'stable.id'}}`)
			governanceWrite(t, root, "schema/middle.ts", "import "+modifier+`* as ns from './helper';let receiver=ns;export const published=receiver.identity;`)
			governanceWrite(t, root, "schema/facade.ts", `export {published as contractProjector} from './middle';`)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts","schema/**/*.ts"]}`)
			_, owner := runtimeReexportOwner(t, root)
			proof := runtimeReexportID(t, owner)
			if runtime {
				if proof.Outcome.Kind != "known" || proof.Value.Literal != "stable.id" {
					t.Fatalf("runtime namespace alias rejected: %#v", proof)
				}
			} else if proof.Outcome.Kind != "unknown" {
				t.Fatalf("mutable receiver erased type-only provenance: %#v", proof)
			}
		})
	}
}
