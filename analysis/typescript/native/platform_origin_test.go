package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestLibraryValueOriginsDoNotBorrowProcessPackageOwnership(t *testing.T) {
	for _, name := range []string{"", "@fixture/caller", "@astrale-os/sdk"} {
		t.Run(name, func(t *testing.T) {
			cwd := governanceTempDir(t)
			if name != "" {
				governanceWrite(t, cwd, "package.json", `{"name":`+platformOriginJSON(name)+`}`)
			}
			t.Chdir(cwd)
			root := governanceTempDir(t)
			governanceWrite(t, root, "package.json", `{"name":"@fixture/project"}`)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","types":[]},"include":["index.ts"]}`)
			governanceWrite(t, root, "index.ts", `import { freeze as fromTypes } from '@types/example';
const page = Object.freeze({size:256});
const bound = Object.freeze({maximumPages:1024});
const immutable = Object; const alias = immutable.freeze({size:64});
export function shadow(){const Object={freeze(value:unknown){return value}};return Object.freeze({size:1})}
fromTypes({size:2});`)
			governanceWrite(t, root, "node_modules/@types/example/package.json", `{"name":"@types/example","types":"index.d.ts"}`)
			governanceWrite(t, root, "node_modules/@types/example/index.d.ts", `export declare function freeze(value:unknown):unknown;`)
			t.Run("ordinary", func(t *testing.T) {
				a, err := newAnalyzer(root, "tsconfig.json", "", []string{sourceNamespace, bodyNamespace}, nil, nil, 0, 0, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer a.close()
				tx, _, err := a.refresh(request{ID: 1, Discover: true})
				if err != nil || tx == nil {
					t.Fatalf("full projection: %v", err)
				}
				checkLibraryValueOrigins(t, tx)
			})
			t.Run("captured", func(t *testing.T) {
				session, _ := liveInputSession(t, nil)
				session.discardProducts()
				project, err := captureGovernedProject(root, governanceTestPolicy())
				if err != nil {
					t.Fatal(err)
				}
				project.capture.compilerInputs()
				state := &governanceProductsSession{Project: project, Token: "library", Generation: "1", Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":3}`)}}
				session.productsSession = state
				governanceSourceObservationFixture(t, session)
				input := governanceSemanticRequest{Token: state.Token, Generation: state.Generation, SourceSnapshotDigest: project.GovernanceDigest}
				raw, _ := json.Marshal(input)
				opened, err := session.openSemanticProjection(raw)
				if err != nil {
					t.Fatal(err)
				}
				input.Lease = opened.(map[string]any)["lease"].(string)
				captured := semanticProjectionRefresh(t, session, input, []string{"index.ts"}, []string{})
				if captured == nil || project.stats.CompilerPrograms != 1 {
					t.Fatal("captured projection did not borrow its one Program")
				}
				checkPackedLibraryValueOrigins(t, captured)
			})

		})
	}
}

func platformOriginJSON(value string) string { b, _ := json.Marshal(value); return string(b) }

type libraryValueOriginInventory struct{ library, alias, shadow, typed int }

func (inventory *libraryValueOriginInventory) observe(t *testing.T, scope string, hasReceiver bool, receiver, target *callTargetOrigin) {
	t.Helper()
	if target != nil && target.Package == "@types/example" {
		inventory.typed++
		return
	}
	if !hasReceiver {
		return
	}
	if receiver != nil && reflect.DeepEqual(receiver.Path, []string{"Object"}) {
		if !reflect.DeepEqual(receiver, &callTargetOrigin{Package: "typescript", File: "lib/lib.es5.d.ts", Path: []string{"Object"}}) {
			t.Fatalf("library receiver borrowed process owner: %#v", receiver)
		}
		if !reflect.DeepEqual(target, &callTargetOrigin{Package: "typescript", File: "lib/lib.es5.d.ts", Path: []string{"ObjectConstructor", "freeze"}}) {
			t.Fatalf("library call origin unavailable/wrong: %#v", target)
		}
		inventory.library++
	} else if receiver != nil && reflect.DeepEqual(receiver.Path, []string{"immutable"}) {
		if !reflect.DeepEqual(receiver, &callTargetOrigin{Package: "@fixture/project", File: "index.ts", Path: []string{"immutable"}}) {
			t.Fatalf("const alias lost authored ownership: %#v", receiver)
		}
		if !reflect.DeepEqual(target, &callTargetOrigin{Package: "typescript", File: "lib/lib.es5.d.ts", Path: []string{"ObjectConstructor", "freeze"}}) {
			t.Fatalf("const alias lost canonical call origin: %#v", target)
		}
		inventory.alias++
	} else if scope == "function" {
		inventory.shadow++
		if receiver != nil && receiver.Package == "typescript" || target != nil && target.Package == "typescript" {
			t.Fatal("local Object acquired platform provenance")
		}
	}
}

func (inventory libraryValueOriginInventory) check(t *testing.T) {
	t.Helper()
	if inventory.library != 2 || inventory.alias != 1 || inventory.shadow != 1 || inventory.typed != 1 {
		t.Fatalf("wrong origin inventory: %#v", inventory)
	}
}

func checkLibraryValueOrigins(t *testing.T, tx *factTransaction) {
	t.Helper()
	inventory := libraryValueOriginInventory{}
	for _, shard := range tx.Upserts {
		if shard.Namespace != bodyNamespace {
			continue
		}
		for _, fact := range shard.Facts {
			payload := fact.Payload.(bodyFactPayload)
			byID := map[string]bodyOccurrence{}
			for _, occurrence := range payload.Body.Occurrences {
				byID[occurrence.ID] = occurrence
			}
			for _, call := range payload.Body.Calls {
				inventory.observe(t, payload.Body.Scope, call.Receiver != "", byID[call.Receiver].SymbolOrigin, call.TargetOrigin)
			}
		}
	}
	inventory.check(t)
}

// Inspect the exact physical payload returned by the captured semantic endpoint,
// including its encoded receiver indices. No second extraction can repair a
// missing or wrongly attributed origin before this publication is checked.
func checkPackedLibraryValueOrigins(t *testing.T, tx *factTransaction) {
	t.Helper()
	inventory := libraryValueOriginInventory{}
	for _, shard := range tx.Upserts {
		if shard.Namespace != bodyNamespace {
			continue
		}
		for _, fact := range shard.Facts {
			bytes, err := json.Marshal(fact.PhysicalPayload)
			if err != nil {
				t.Fatal(err)
			}
			var envelope struct {
				Codec string `json:"codec"`
				Data  struct {
					Constants   []string            `json:"c"`
					Occurrences []json.RawMessage   `json:"o"`
					Calls       [][]json.RawMessage `json:"a"`
				} `json:"data"`
			}
			if err := json.Unmarshal(bytes, &envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.Codec != typescriptBodyPayloadCodec || len(envelope.Data.Occurrences) != 3 || len(envelope.Data.Constants) != 5 {
				t.Fatalf("unexpected captured body codec: %s", bytes)
			}
			var origins []*callTargetOrigin
			if err := json.Unmarshal(envelope.Data.Occurrences[2], &origins); err != nil {
				t.Fatal(err)
			}
			for _, row := range envelope.Data.Calls {
				if len(row) != 10 {
					t.Fatalf("unexpected captured call row: %s", bytes)
				}
				var target *callTargetOrigin
				if err := json.Unmarshal(row[9], &target); err != nil {
					t.Fatal(err)
				}
				var receiver int
				if err := json.Unmarshal(row[3], &receiver); err != nil {
					t.Fatal(err)
				}
				if receiver < 0 {
					inventory.observe(t, envelope.Data.Constants[3], false, nil, target)
					continue
				}
				if receiver >= len(origins) {
					t.Fatal("captured receiver escaped its occurrence table")
				}
				inventory.observe(t, envelope.Data.Constants[3], true, origins[receiver], target)
			}
		}
	}
	inventory.check(t)
}
