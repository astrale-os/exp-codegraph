package main

import (
	"encoding/json"
	"reflect"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

func capturedSymbolRequest(t *testing.T, session *governanceSession) governanceClosedSourceRequest {
	t.Helper()
	governanceSourceObservationFixture(t, session)
	state := session.productsSession
	file := state.Project.FilesByPath["index.ts"]
	var expression *ast.Node
	walkFile(file.Source, func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && node.Name() != nil && node.Name().Text() == "selected" {
			expression = node.AsVariableDeclaration().Initializer
		}
		return true
	})
	if expression == nil {
		t.Fatal("captured selection missing")
	}
	return governanceClosedSourceRequest{Token: state.Token, Generation: state.Generation,
		SourceSnapshotDigest: state.Project.GovernanceDigest, Path: "index.ts", Operation: "symbol",
		Start: file.coordinates.utf16(scanner.GetTokenPosOfNode(expression, file.Source, false)), End: file.coordinates.utf16(expression.End())}
}

func capturedSymbolObserve(t *testing.T, session *governanceSession) governanceClosedSourceAnswer {
	t.Helper()
	request := capturedSymbolRequest(t, session)
	raw, err := json.Marshal(map[string]any{"token": request.Token, "kind": "source-observe", "request": request})
	if err != nil {
		t.Fatal(err)
	}
	result, err := session.continueProducts(raw)
	if err != nil {
		t.Fatal(err)
	}
	return result.(governanceClosedSourceAnswer)
}

func TestClosedSourceSymbolUsesActualCanonicalDeclaration(t *testing.T) {
	for _, fixture := range []struct{ name, source, facade, expectedPackage, expectedName string }{
		{"direct", `import {defineDomain as domain} from '@astrale-os/sdk/domain';const selected=domain;`, "", "@astrale-os/sdk", "defineDomain"},
		{"barrel-renames", `import {domain as local} from './schema/facade';const selected=local;`, `export {middle as domain} from './middle';`, "@astrale-os/sdk", "defineDomain"},
		{"namespace", `import * as api from './schema/facade';const selected=api.domain;`, `export {middle as domain} from './middle';`, "@astrale-os/sdk", "defineDomain"},
		{"type-only-binding", `import type {defineDomain as domain} from '@astrale-os/sdk/domain';const selected=domain;`, "", "@astrale-os/sdk", "defineDomain"},
		{"lookalike", `import {defineDomain as domain} from '@example/other';const selected=domain;`, "", "@example/other", "defineDomain"},
		{"shadowed", `import {defineDomain as domain} from '@astrale-os/sdk/domain';function body(domain:()=>unknown){const selected=domain;}`, "", "", "domain"},
		{"local", `function domain(){return {}}const selected=domain;`, "", "", "domain"},
		{"missing", `const selected=missing;`, "", "", ""},
		{"missing-export", `import {missing as domain} from '@astrale-os/sdk/domain';const selected=domain;`, "", "", ""},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			session, _ := liveInputSession(t, func(root string) {
				governanceWrite(t, root, "index.ts", "//😀 UTF16\n"+fixture.source)
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
				governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","exports":{"./domain":{"types":"./dist/application/index.d.ts"}}}`)
				governanceWrite(t, root, "node_modules/@astrale-os/sdk/dist/application/index.d.ts", `export {defineDomain} from './define';`)
				governanceWrite(t, root, "node_modules/@astrale-os/sdk/dist/application/define.d.ts", `export declare function defineDomain(input:unknown):unknown;`)
				governanceWrite(t, root, "node_modules/@example/other/package.json", `{"name":"@example/other","types":"index.d.ts"}`)
				governanceWrite(t, root, "node_modules/@example/other/index.d.ts", `export declare function defineDomain(input:unknown):unknown;`)
				governanceWrite(t, root, "schema/middle.ts", `export {defineDomain as middle} from '@astrale-os/sdk/domain';`)
				governanceWrite(t, root, "schema/facade.ts", fixture.facade)
			})
			answer := capturedSymbolObserve(t, session)
			if answer.Status != "known" {
				t.Fatalf("binding unavailable: %#v", answer)
			}
			if fixture.expectedName == "" {
				if answer.Symbol != nil {
					t.Fatalf("missing binding manufactured: %#v", answer.Symbol)
				}
			} else if answer.Symbol == nil || string(answer.Symbol.Name) != fixture.expectedName {
				t.Fatalf("name differs: %#v", answer.Symbol)
			} else if fixture.expectedPackage == "" {
				if answer.Symbol.Origin != nil || !answer.Symbol.Local {
					t.Fatalf("local binding inherited imported provenance: %#v", answer.Symbol)
				}
			} else {
				origin := answer.Symbol.Origin
				if answer.Symbol.Local || origin == nil || origin.Package != fixture.expectedPackage || !reflect.DeepEqual(origin.Path, []string{fixture.expectedName}) {
					t.Fatalf("canonical provenance differs: %#v", answer.Symbol)
				}
				if fixture.expectedPackage == "@astrale-os/sdk" && origin.File != "dist/application/define.d.ts" {
					t.Fatal("alias spelling replaced declaration file", origin)
				}
			}
			if session.productsSession.Project.stats.CompilerPrograms != 1 {
				t.Fatal("symbol observation opened a second compiler")
			}
			if repeated := capturedSymbolObserve(t, session); !reflect.DeepEqual(answer, repeated) || session.productsSession.Project.stats.CompilerPrograms != 1 {
				t.Fatal("repeated binding observation changed owner")
			}
			if valid, err := session.productsSession.Project.capture.Verify(); err != nil || !valid {
				t.Fatal("same compiler inputs cannot be sealed", valid, err)
			}
		})
	}
}

func TestClosedSourceSymbolRetainsCapturedBarrelAndNegativeResolutionGuards(t *testing.T) {
	for _, mode := range []string{"barrel", "package-manifest", "missing-module"} {
		t.Run(mode, func(t *testing.T) {
			session, root := liveInputSession(t, func(root string) {
				governanceWrite(t, root, "index.ts", `import {domain} from './schema/facade';const selected=domain;`)
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
				if mode != "missing-module" {
					governanceWrite(t, root, "schema/facade.ts", `export {defineDomain as domain} from '@astrale-os/sdk/domain';`)
					governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","exports":{"./domain":{"types":"./dist/application/define.d.ts"}}}`)
					governanceWrite(t, root, "node_modules/@astrale-os/sdk/dist/application/define.d.ts", `export declare function defineDomain(input:unknown):unknown;`)
				}
			})
			before := capturedSymbolObserve(t, session)
			if before.Status != "known" || (before.Symbol == nil) != (mode == "missing-module") {
				t.Fatalf("initial binding differs: %#v", before)
			}
			switch mode {
			case "barrel", "missing-module":
				governanceWrite(t, root, "schema/facade.ts", `export function domain(){return {}}`)
			case "package-manifest":
				governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@example/forged","exports":{"./domain":{"types":"./dist/application/define.d.ts"}}}`)
			}
			if retained := capturedSymbolObserve(t, session); !reflect.DeepEqual(before, retained) {
				t.Fatal("retained binding read current filesystem", retained)
			}
			if valid, err := session.productsSession.Project.capture.Verify(); err != nil || valid {
				t.Fatal("changed canonical input passed publication guard", valid, err)
			}
		})
	}
}

func TestClosedSourceSymbolCapabilityPreservesLegacyProjectionAndSpanGuards(t *testing.T) {
	session, _ := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "index.ts", "//😀 UTF16\nfunction local(){} const selected=local;")
	})
	first, err := session.closedSourceHandoff(false)
	if err != nil || first.(map[string]any)["symbolAuthorityRevision"] != 1 {
		t.Fatal("new authority is not negotiated in the first body", first, err)
	}
	governanceSourceObservationFixture(t, session)
	projection, err := session.closedSourceHandoff(true)
	if err != nil || len(projection.(map[string]any)) != 6 {
		t.Fatal("existing source projection shape changed", projection, err)
	}
	for _, kind := range []string{"foreign-file", "foreign-token", "foreign-generation", "foreign-digest", "negative", "beyond-source", "non-node"} {
		t.Run(kind, func(t *testing.T) {
			request := capturedSymbolRequest(t, session)
			switch kind {
			case "foreign-file":
				request.Path = "unowned.ts"
			case "foreign-token":
				request.Token = "unowned"
			case "foreign-generation":
				request.Generation = "retired"
			case "foreign-digest":
				request.SourceSnapshotDigest = "other-bytes"
			case "negative":
				request.Start = -1
			case "beyond-source":
				request.End = 1000
			case "non-node":
				request.Start++
			}
			answer, err := session.observeClosedSource(request)
			if kind == "non-node" {
				if err != nil || answer.Status != "unavailable" || answer.Symbol != nil {
					t.Fatal("non-node anchor manufactured a binding", answer, err)
				}
			} else if err == nil {
				t.Fatal("foreign symbol request was admitted", answer)
			}
			if session.productsSession.Project.stats.CompilerPrograms != 0 {
				t.Fatal("invalid symbol request reached the compiler")
			}
		})
	}
}

func TestClosedSourceSymbolNamespacePresentationHasPortableCoordinates(t *testing.T) {
	session, _ := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "index.ts", `import * as api from '@example/api';const selected=api;`)
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
		governanceWrite(t, root, "node_modules/@example/api/package.json", `{"name":"@example/api","types":"index.d.ts"}`)
		governanceWrite(t, root, "node_modules/@example/api/index.d.ts", `export declare function value():unknown;`)
	})
	answer := capturedSymbolObserve(t, session)
	if answer.Status != "known" || answer.Symbol == nil || string(answer.Symbol.Name) != "package:@example/api/index.d.ts" || answer.Symbol.Origin != nil || answer.Symbol.Local {
		t.Fatal("namespace fabricated a declaration or exposed an install path", answer)
	}
}

func TestClosedSourceSymbolImportAnchorAndUseSharePortableWireIdentity(t *testing.T) {
	session, _ := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "index.ts", "//😀 UTF16\nimport {defineDomain as domain} from '@astrale-os/sdk/domain';const selected=domain;")
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
		governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","exports":{"./domain":{"types":"./dist/application/define.d.ts"}}}`)
		governanceWrite(t, root, "node_modules/@astrale-os/sdk/dist/application/define.d.ts", `export declare function defineDomain(input:unknown):unknown;`)
	})
	request := capturedSymbolRequest(t, session)
	project := session.productsSession.Project
	file := project.FilesByPath[request.Path]
	var binding *ast.Node
	walkFile(file.Source, func(node *ast.Node) bool {
		if node.Kind == ast.KindImportSpecifier {
			binding = node.Name()
		}
		return true
	})
	if binding == nil {
		t.Fatal("import binding anchor missing")
	}
	for _, kind := range []string{"declaration", "use"} {
		t.Run(kind, func(t *testing.T) {
			anchor := request
			if kind == "declaration" {
				anchor.Start = file.coordinates.utf16(scanner.GetTokenPosOfNode(binding, file.Source, false))
				anchor.End = file.coordinates.utf16(binding.End())
			}
			raw, err := json.Marshal(map[string]any{"token": anchor.Token, "kind": "source-observe", "request": anchor})
			if err != nil {
				t.Fatal(err)
			}
			answer, err := session.continueProducts(raw)
			if err != nil {
				t.Fatal(err)
			}
			wire, err := json.Marshal(answer)
			const expected = `{"status":"known","names":null,"kind":null,"resolution":null,"symbol":{"name":"\u0064\u0065\u0066\u0069\u006e\u0065\u0044\u006f\u006d\u0061\u0069\u006e","origin":{"package":"@astrale-os/sdk","file":"dist/application/define.d.ts","path":["defineDomain"]}}}`
			if err != nil || string(wire) != expected {
				t.Fatalf("symbol wire identity differs: %s (%v)", wire, err)
			}
		})
	}
	if matched, known := project.typeOwner.compilerNode(governanceSharedProject(project).FilesByPath[file.Path], binding); !known || matched != nil {
		t.Fatal("binding authority broadened value-expression admission", matched, known)
	}
	if project.stats.CompilerPrograms != 1 {
		t.Fatal("binding and use did not share the captured compiler")
	}
}
