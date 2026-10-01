package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"
)

func TestUnchangedSourceHintsDoNotAdvanceCompiler(t *testing.T) {
	root := t.TempDir()
	writeChangeAdmissionFixture(t, root)
	var encoded bytes.Buffer
	writer := bufio.NewWriter(&encoded)
	telemetry := &nativeTelemetry{writer: writer, encoder: json.NewEncoder(writer)}
	a := openChangeAdmissionAnalyzer(t, root, telemetry)
	defer a.close()
	resident := a.session.Program().TSProgram
	initial, _, err := a.refresh(request{ID: 1, Changed: []string{"index.ts", "helper.ts"}, Discover: true})
	if err != nil || initial == nil {
		t.Fatalf("initial hints: %v", err)
	}
	if a.session.Program().TSProgram != resident {
		t.Fatal("identical initial bytes advanced the compiler")
	}
	if !bytes.Contains(encoded.Bytes(), []byte(`"files":0`)) {
		t.Fatal("identical hints did not admit an empty shape selection")
	}
	if bytes.Contains(encoded.Bytes(), []byte(`"phase":"compiler.apply"`)) {
		t.Fatal("identical hints applied a compiler update")
	}
	oracle := openChangeAdmissionAnalyzer(t, root, nil)
	expected, _, err := oracle.refresh(request{ID: 1, Discover: true})
	oracle.close()
	if err != nil || expected == nil || expected.Next.ID != initial.Next.ID {
		t.Fatalf("initial hints changed the complete generation: %v", err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	for _, discover := range []bool{false, true} {
		next, unchanged, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1,
			Changes: []sourceChange{{Path: "index.ts", Kind: "change"}, {Path: "helper.ts", Kind: "unknown"}}, Discover: discover})
		if err != nil || next != nil || unchanged != initial.Next.ID {
			t.Fatalf("unchanged hints: %v %s", err, unchanged)
		}
		if a.session.Program().TSProgram != resident {
			t.Fatal("unchanged watch hints advanced the compiler")
		}
	}
}

func TestMixedSourceHintsPreserveFreshGenerationAndDeletionRecovery(t *testing.T) {
	root := t.TempDir()
	writeChangeAdmissionFixture(t, root)
	a := openChangeAdmissionAnalyzer(t, root, nil)
	defer a.close()
	initial, _, err := a.refresh(request{ID: 1, Discover: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	helper := filepath.Join(root, "helper.ts")
	if err := os.WriteFile(helper, []byte(`export const helper = (): string => 'changed'`), 0644); err != nil {
		t.Fatal(err)
	}
	next, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Changed: []string{"index.ts", "helper.ts"}, Discover: true})
	if err != nil || next == nil {
		t.Fatalf("mixed hints: %v", err)
	}
	oracle := openChangeAdmissionAnalyzer(t, root, nil)
	expected, _, err := oracle.refresh(request{ID: 1, Discover: true})
	oracle.close()
	if err != nil || expected == nil || next.Next.ID != expected.Next.ID {
		t.Fatalf("mixed hints differed from fresh extraction: %v", err)
	}
	if err := a.acknowledge(request{Generation: next.Next.ID, Sequence: 2}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(helper); err != nil {
		t.Fatal(err)
	}
	deleted, _, err := a.refresh(request{ID: 3, Base: next.Next.ID, BaseSequence: 2,
		Changes: []sourceChange{{Path: "index.ts", Kind: "change"}, {Path: "helper.ts", Kind: "unlink"}}, Discover: true})
	if err != nil || deleted == nil {
		t.Fatalf("deletion after unchanged hint: %v", err)
	}
	oracle = openChangeAdmissionAnalyzer(t, root, nil)
	expected, _, err = oracle.refresh(request{ID: 1, Discover: true})
	oracle.close()
	if err != nil || expected == nil || deleted.Next.ID != expected.Next.ID {
		t.Fatalf("deletion recovery differed from fresh extraction: %v", err)
	}
}

func TestSourceHintAdmissionUsesAuthoredDecoding(t *testing.T) {
	for _, encoding := range []string{"utf8-bom", "utf16-le", "utf16-be"} {
		t.Run(encoding, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"noLib":true},"files":["index.ts"]}`), 0644); err != nil {
				t.Fatal(err)
			}
			source := `export const value = 'é'`
			encode := func(text string) []byte {
				if encoding == "utf8-bom" {
					return append([]byte{0xef, 0xbb, 0xbf}, []byte(text)...)
				}
				order := binary.ByteOrder(binary.LittleEndian)
				bom := []byte{0xff, 0xfe}
				if encoding == "utf16-be" {
					order, bom = binary.BigEndian, []byte{0xfe, 0xff}
				}
				result := append([]byte{}, bom...)
				for _, value := range utf16.Encode([]rune(text)) {
					var unit [2]byte
					order.PutUint16(unit[:], value)
					result = append(result, unit[:]...)
				}
				return result
			}
			path := filepath.Join(root, "index.ts")
			if err := os.WriteFile(path, encode(source), 0644); err != nil {
				t.Fatal(err)
			}
			a := openChangeAdmissionAnalyzer(t, root, nil)
			defer a.close()
			resident := a.session.Program().TSProgram
			initial, _, err := a.refresh(request{ID: 1, Changed: []string{"index.ts"}, Discover: true})
			if err != nil || initial == nil || a.session.Program().TSProgram != resident {
				t.Fatalf("authored identical bytes advanced compiler: %v", err)
			}
			if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, encode(`export const value = 'œ'`), 0644); err != nil {
				t.Fatal(err)
			}
			next, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Changed: []string{"index.ts"}, Discover: true})
			if err != nil || next == nil {
				t.Fatalf("authored real edit: %v", err)
			}
			oracle := openChangeAdmissionAnalyzer(t, root, nil)
			expected, _, err := oracle.refresh(request{ID: 1, Discover: true})
			oracle.close()
			if err != nil || expected == nil || next.Next.ID != expected.Next.ID {
				t.Fatalf("authored edit differed from cold: %v", err)
			}
		})
	}
}

func TestUnchangedHintsDoNotSkipFreshAnalyzerAdoption(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "project")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	for path, content := range map[string]string{
		filepath.Join(root, "tsconfig.json"): `{"compilerOptions":{"noLib":true,"module":"ESNext","moduleResolution":"Bundler"},"include":["*.ts"]}`,
		filepath.Join(root, "index.ts"):      `import { helper } from '../external'; export const value = helper('value')`,
		filepath.Join(root, "retired.ts"):    `export const retired = 'previous'`,
		filepath.Join(parent, "external.ts"): `export function helper(value:string):string { return value }`,
	} {
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	a := openChangeAdmissionAnalyzer(t, root, nil)
	initial, _, err := a.refresh(request{ID: 1, Discover: true})
	a.close()
	if err != nil || initial == nil {
		t.Fatalf("initial external source: %v", err)
	}
	if err := os.WriteFile(filepath.Join(parent, "external.ts"), []byte(`export function helper<T>(value:T):T { return value }`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, "retired.ts")); err != nil {
		t.Fatal(err)
	}
	// The fresh compiler already sees the new dependency. Its disk baseline
	// therefore cannot discover the difference from a prior process's facts.
	restarted := openChangeAdmissionAnalyzer(t, root, nil)
	defer restarted.close()
	next, unchanged, err := restarted.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1,
		Changed: []string{"index.ts"}, Discover: true})
	if err != nil || next == nil || unchanged != "" {
		t.Fatalf("fresh adoption incorrectly reused prior facts: %v %s", err, unchanged)
	}
	if next.Next.ID == initial.Next.ID {
		t.Fatal("external signature movement did not change the fresh generation")
	}
	if next.Base != "" || len(next.Deletes) != 0 || len(next.Upserts) != len(next.Manifest) {
		t.Fatal("changed adoption is not a complete base-less snapshot")
	}
	for _, shard := range next.Upserts {
		if shard.Namespace == sourceNamespace {
			for _, fact := range shard.Facts {
				if fact.Payload.(sourceFactPayload).LogicalPath == "retired.ts" {
					t.Fatal("changed adoption carried a source removed from the compiler universe")
				}
			}
		}
	}
	oracle := openChangeAdmissionAnalyzer(t, root, nil)
	expected, _, err := oracle.refresh(request{ID: 1, Discover: true})
	oracle.close()
	if err != nil || expected == nil || next.Next.ID != expected.Next.ID {
		t.Fatalf("fresh adoption differs from independent extraction: %v", err)
	}
}

func TestBodyProjectionRechecksTransitiveCallSignaturesWithoutDeclarationEmit(t *testing.T) {
	root := t.TempDir()
	for path, content := range map[string]string{
		"tsconfig.json": `{"compilerOptions":{"noLib":true,"module":"ESNext","moduleResolution":"Bundler"},"include":["*.ts"]}`,
		"value.ts":      `export function value():string { return 'initial' }`,
		"barrel.ts":     `export { value } from './value'`,
		"index.ts":      `import { value } from './barrel'; function consume(value:string):string; function consume(value:number):number; function consume(value:string|number) { return value }; export const result = consume(value())`,
	} {
		if err := os.WriteFile(filepath.Join(root, path), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	var encoded bytes.Buffer
	writer := bufio.NewWriter(&encoded)
	a := openChangeAdmissionAnalyzer(t, root, &nativeTelemetry{writer: writer, encoder: json.NewEncoder(writer)})
	defer a.close()
	initial, _, err := a.refresh(request{ID: 1, Discover: true})
	if err != nil || initial == nil {
		t.Fatalf("initial overloaded call: %v", err)
	}
	if err := a.acknowledge(request{Generation: initial.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	encoded.Reset()
	if err := os.WriteFile(filepath.Join(root, "value.ts"), []byte(`export function value():number { return 3 }`), 0644); err != nil {
		t.Fatal(err)
	}
	next, _, err := a.refresh(request{ID: 2, Base: initial.Next.ID, BaseSequence: 1, Changed: []string{"value.ts"}, Discover: true})
	if err != nil || next == nil {
		t.Fatalf("public return movement: %v", err)
	}
	if bytes.Contains(encoded.Bytes(), []byte(`"phase":"compiler.updated-shapes"`)) {
		t.Fatal("body-only projection emitted a declaration surface")
	}
	if !bytes.Contains(encoded.Bytes(), []byte(`"selectedSources":3`)) {
		t.Fatal("body-only projection did not include the transitive compiler reference closure")
	}
	indexSource := a.acknowledged.sources[filepath.Join(a.root, "index.ts")].Source
	dependentChanged := false
	for _, shard := range next.Upserts {
		if shard.Namespace != bodyNamespace {
			continue
		}
		for _, fact := range shard.Facts {
			for _, span := range fact.Provenance.Evidence {
				dependentChanged = dependentChanged || span.Source == indexSource
			}
		}
	}
	oracle := openChangeAdmissionAnalyzer(t, root, nil)
	expected, _, err := oracle.refresh(request{ID: 1, Discover: true})
	oracle.close()
	if err != nil || expected == nil || next.Next.ID != expected.Next.ID {
		t.Fatalf("transitive body projection differs from full extraction: %v", err)
	}
	if !dependentChanged {
		t.Fatal("changed inferred argument did not reproject the dependent overloaded call")
	}
}

func writeChangeAdmissionFixture(t *testing.T, root string) {
	t.Helper()
	for path, content := range map[string]string{
		"tsconfig.json": `{"compilerOptions":{"noLib":true,"module":"ESNext","moduleResolution":"Bundler"},"include":["*.ts"]}`,
		"index.ts":      `import { helper } from './helper'; export const value = (): string => helper()`,
		"helper.ts":     `export const helper = (): string => 'initial'`,
	} {
		if err := os.WriteFile(filepath.Join(root, path), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func openChangeAdmissionAnalyzer(t *testing.T, root string, telemetry *nativeTelemetry) *analyzer {
	t.Helper()
	a, err := newAnalyzer(root, "tsconfig.json", "", []string{projectNamespace, sourceNamespace, symbolNamespace, bodyNamespace}, nil, nil, 0, 0, telemetry)
	if err != nil {
		t.Fatal(err)
	}
	return a
}
