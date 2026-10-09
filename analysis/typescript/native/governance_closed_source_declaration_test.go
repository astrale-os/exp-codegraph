package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"unicode/utf16"

	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

func closedSourceDeclaration(t *testing.T, path, text, declaration string) governanceClosedSourceDeclaration {
	t.Helper()
	start := strings.Index(text, declaration)
	if start < 0 {
		t.Fatal("expected canonical declaration missing")
	}
	out := governanceClosedSourceDeclaration{Path: path}
	out.Span.Start = len(utf16.Encode([]rune(text[:start])))
	out.Span.End = out.Span.Start + len(utf16.Encode([]rune(declaration)))
	return out
}

func TestClosedSourceSymbolLocalDeclarationsFollowAliasesAndBarrels(t *testing.T) {
	const function = `export function canonical() { return "😀" }`
	const arrow = `canonical = () => "😀"`
	for _, fixture := range []struct{ name, source, facade, text, declaration string }{
		{"direct-alias", `import {canonical as selectedName} from './schema/implementation';const selected=selectedName;`, "", "//😀 before\n" + function, function},
		{"barrel-renames", `import {renamed as selectedName} from './schema/facade';const selected=selectedName;`, `export {canonical as renamed} from './implementation';`, "//😀 before\n" + function, function},
		{"namespace", `import * as api from './schema/facade';const selected=api.renamed;`, `export {canonical as renamed} from './implementation';`, "//😀 before\n" + function, function},
		{"star-barrel", `import {canonical as selectedName} from './schema/facade';const selected=selectedName;`, `export * from './implementation';`, "//😀 before\n" + function, function},
		{"type-only-binding", `import type {canonical as selectedName} from './schema/implementation';const selected=selectedName;`, "", "//😀 before\n" + function, function},
		{"arrow", `import {canonical as selectedName} from './schema/implementation';const selected=selectedName;`, "", "//😀 before\nexport const " + arrow + ";", arrow},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			session, _ := liveInputSession(t, func(root string) {
				governanceWrite(t, root, "index.ts", "//😀 import\n"+fixture.source)
				governanceWrite(t, root, "schema/implementation.ts", fixture.text)
				governanceWrite(t, root, "schema/facade.ts", fixture.facade)
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
			})
			answer := capturedSymbolObserve(t, session)
			expected := []governanceClosedSourceDeclaration{closedSourceDeclaration(t, "schema/implementation.ts", fixture.text, fixture.declaration)}
			if answer.Status != "known" || answer.Symbol == nil || !answer.Symbol.Local || answer.Symbol.Origin != nil || string(answer.Symbol.Name) != "canonical" || !reflect.DeepEqual(answer.Symbol.Declarations, expected) {
				t.Fatalf("canonical local declaration differs: %#v", answer.Symbol)
			}
			// The private continuation wire carries portable paths and UTF16 spans,
			// not the import token, compiler nodes or checkout path.
			wire, err := json.Marshal(answer)
			var transport struct {
				Symbol struct {
					Declarations []governanceClosedSourceDeclaration `json:"declarations"`
				} `json:"symbol"`
			}
			if err != nil || json.Unmarshal(wire, &transport) != nil || !reflect.DeepEqual(transport.Symbol.Declarations, expected) {
				t.Fatalf("canonical declaration transport differs: %s (%v)", wire, err)
			}
			if session.productsSession.Project.stats.CompilerPrograms != 1 {
				t.Fatal("canonical declaration opened another compiler")
			}
		})
	}
}

func TestClosedSourceSymbolLocalDeclarationsRetainAllOverloads(t *testing.T) {
	declarations := []string{
		`export function canonical(input: string): string;`,
		`export function canonical(input: number): number;`,
		`export function canonical(input: unknown) { return input }`,
	}
	text := "//😀 overloads\n" + strings.Join(declarations, "\n")
	session, _ := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "index.ts", `import {canonical as alias} from './schema/implementation';const selected=alias;`)
		governanceWrite(t, root, "schema/implementation.ts", text)
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
	})
	answer := capturedSymbolObserve(t, session)
	var expected []governanceClosedSourceDeclaration
	for _, declaration := range declarations {
		expected = append(expected, closedSourceDeclaration(t, "schema/implementation.ts", text, declaration))
	}
	if answer.Symbol == nil || !reflect.DeepEqual(answer.Symbol.Declarations, expected) {
		t.Fatalf("overload declarations were collapsed or reordered: %#v", answer.Symbol)
	}
}

func TestClosedSourceSymbolTwoBarrelsRetainTheSameDeclarationOwner(t *testing.T) {
	const declaration = `export function canonical() { return "😀" }`
	const text = "//😀 declaration\n" + declaration
	session, _ := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "index.ts", `import {renamed as one} from './schema/facade';import {middle as two} from './schema/middle';const selected=one;const other=two;`)
		governanceWrite(t, root, "schema/facade.ts", `export {canonical as renamed} from './implementation';`)
		governanceWrite(t, root, "schema/middle.ts", `export {canonical as middle} from './implementation';`)
		governanceWrite(t, root, "schema/implementation.ts", text)
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
	})
	first := capturedSymbolObserve(t, session)
	request := capturedSymbolRequest(t, session)
	file := session.productsSession.Project.FilesByPath["index.ts"]
	var expression *ast.Node
	walkFile(file.Source, func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && node.Name() != nil && node.Name().Text() == "other" {
			expression = node.AsVariableDeclaration().Initializer
		}
		return true
	})
	if expression == nil {
		t.Fatal("second alias use missing")
	}
	request.Start = file.coordinates.utf16(scanner.GetTokenPosOfNode(expression, file.Source, false))
	request.End = file.coordinates.utf16(expression.End())
	second, err := session.observeClosedSource(request)
	expected := []governanceClosedSourceDeclaration{closedSourceDeclaration(t, "schema/implementation.ts", text, declaration)}
	if err != nil || first.Symbol == nil || !reflect.DeepEqual(first.Symbol.Declarations, expected) || !reflect.DeepEqual(first.Symbol, second.Symbol) {
		t.Fatal("two facade aliases manufactured distinct declaration owners", first, second, err)
	}
	if session.productsSession.Project.stats.CompilerPrograms != 1 {
		t.Fatal("second alias opened another compiler")
	}
}

func TestClosedSourceSymbolLocalDeclarationRequiresCapturedOwner(t *testing.T) {
	for _, mode := range []string{"unrepresented", "different-bytes", "foreign-owner"} {
		t.Run(mode, func(t *testing.T) {
			path := "schema/implementation.ts"
			if mode == "unrepresented" {
				path = "dist/implementation.ts" // Imported compiler input, absent from the source body.
			}
			session, _ := liveInputSession(t, func(root string) {
				governanceWrite(t, root, "index.ts", `import {canonical} from './`+strings.TrimSuffix(path, ".ts")+`';const selected=canonical;`)
				governanceWrite(t, root, path, `export function canonical() { return 1 }`)
				governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
			})
			request := capturedSymbolRequest(t, session)
			if mode != "unrepresented" {
				if before, err := session.observeClosedSource(request); err != nil || before.Symbol == nil || len(before.Symbol.Declarations) != 1 {
					t.Fatal("original local declaration missing", before, err)
				}
				project := session.productsSession.Project
				if mode == "different-bytes" {
					project.FilesByPath[path].Text = `export function canonical() { return 2 }`
				} else {
					foreign := *project
					session.productsSession.Project = &foreign
				}
			}
			answer, err := session.observeClosedSource(request)
			if mode == "foreign-owner" {
				if err == nil {
					t.Fatal("foreign capture owner admitted declarations", answer)
				}
			} else if err != nil || answer.Status != "known" || answer.Symbol == nil || answer.Symbol.Local || len(answer.Symbol.Declarations) != 0 {
				t.Fatal("unowned source bytes manufactured a declaration", answer, err)
			}
		})
	}
}

func TestClosedSourceSymbolLocalDeclarationRetainsCaptureAndRejectsChangedPublication(t *testing.T) {
	const before = "//😀 before\nexport function canonical() { return 1 }"
	const after = "//😀 after\nexport function canonical() { return 'new and longer' }"
	session, root := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "index.ts", `import {canonical} from './schema/implementation';const selected=canonical;`)
		governanceWrite(t, root, "schema/implementation.ts", before)
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"moduleResolution":"Bundler","module":"ESNext","noLib":true},"include":["index.ts"]}`)
	})
	first := capturedSymbolObserve(t, session)
	governanceWrite(t, root, "schema/implementation.ts", after)
	if retained := capturedSymbolObserve(t, session); !reflect.DeepEqual(first, retained) {
		t.Fatal("canonical declaration read later filesystem bytes", retained)
	}
	if valid, err := session.productsSession.Project.capture.Verify(); err != nil || valid {
		t.Fatal("changed declaration passed the publication guard", valid, err)
	}
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	project.capture.compilerInputs()
	fresh := &governanceSession{productsSession: &governanceProductsSession{
		Project: project, Token: "fresh", Generation: "next", Prepare: session.productsSession.Prepare,
	}}
	t.Cleanup(fresh.discardProducts)
	current := capturedSymbolObserve(t, fresh)
	expected := []governanceClosedSourceDeclaration{closedSourceDeclaration(t, "schema/implementation.ts", after, `export function canonical() { return 'new and longer' }`)}
	if current.Symbol == nil || !reflect.DeepEqual(current.Symbol.Declarations, expected) || reflect.DeepEqual(first.Symbol.Declarations, current.Symbol.Declarations) {
		t.Fatal("fresh capture did not own the current declaration bytes", current)
	}
	if answer, err := fresh.observeClosedSource(capturedSymbolRequest(t, session)); err == nil {
		t.Fatal("retired declaration request entered the fresh capture", answer)
	}
}

func TestClosedSourceSymbolLocalDeclarationsPreserveMergedIdentityInCanonicalOrder(t *testing.T) {
	const first = `function canonical(input: string): string;`
	const second = `function canonical(input: number): number;`
	session, _ := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "index.ts", `const selected=canonical;`)
		governanceWrite(t, root, "schema/z.ts", second)
		governanceWrite(t, root, "schema/a.ts", first)
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"noLib":true},"files":["index.ts","schema/z.ts","schema/a.ts"]}`)
	})
	answer := capturedSymbolObserve(t, session)
	expected := []governanceClosedSourceDeclaration{
		closedSourceDeclaration(t, "schema/a.ts", first, first),
		closedSourceDeclaration(t, "schema/z.ts", second, second),
	}
	if answer.Status != "known" || answer.Symbol == nil || !reflect.DeepEqual(answer.Symbol.Declarations, expected) {
		t.Fatal("merged declarations were reduced to an arbitrary unique definition", answer)
	}
}
