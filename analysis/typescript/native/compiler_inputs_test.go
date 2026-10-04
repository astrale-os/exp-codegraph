package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompilerInputDiscovery(t *testing.T) {
	root := t.TempDir()
	write := func(name, content string) {
		t.Helper()
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("tsconfig.json", `{"compilerOptions":{"noLib":true,"module":"ESNext","moduleResolution":"Bundler"},"files":["index.ts"]}`)
	write("index.ts", `import { helper } from './ignored/helper'; export const result=helper()`)
	write("ignored/helper.ts", `export const helper=()=> 'first'`)
	session, diagnostics, err := newCompilerSession(root, "tsconfig.json")
	if err != nil || len(diagnostics) != 0 {
		t.Fatalf("open: %v %v", err, diagnostics)
	}
	defer session.Close()
	if paths, rebuild := session.discover(); len(paths) != 0 || rebuild {
		t.Fatalf("unchanged: %v %v", paths, rebuild)
	}
	path := filepath.Join(root, "ignored/helper.ts")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	write("ignored/helper.ts", `export const helper=()=> 'other'`)
	if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	paths, rebuild := session.discover()
	if rebuild || len(paths) != 1 || paths[0] != "ignored/helper.ts" {
		t.Fatalf("same-stat source edit: %v %v", paths, rebuild)
	}
	session.Apply(path, `export const helper=()=> 'other'`)
	if paths, rebuild := session.discover(); len(paths) != 0 || rebuild {
		t.Fatalf("applied overlay was not captured: %v %v", paths, rebuild)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, rebuild := session.discover(); !rebuild {
		t.Fatal("source deletion did not invalidate resolution")
	}
}

func TestCompilerInputDiscoveryFailedDirectoryAndMembership(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"noLib":true,"module":"ESNext","moduleResolution":"Bundler"},"include":["*.ts"]}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.ts"), []byte(`import { helper } from './missing/deep/helper'; export const result=helper()`), 0644); err != nil {
		t.Fatal(err)
	}
	session, _, err := newCompilerSession(root, "tsconfig.json")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if paths, rebuild := session.discover(); len(paths) != 0 || rebuild {
		t.Fatalf("unchanged unresolved project: %v %v", paths, rebuild)
	}
	if err := os.MkdirAll(filepath.Join(root, "missing/deep"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "missing/deep/helper.ts"), []byte(`export const helper=()=> true`), 0644); err != nil {
		t.Fatal(err)
	}
	if _, rebuild := session.discover(); !rebuild {
		t.Fatal("new missing parent directory did not invalidate resolution")
	}
	// A new baseline makes root membership independent of the repaired import.
	session.Close()
	session, _, err = newCompilerSession(root, "tsconfig.json")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if paths, rebuild := session.discover(); len(paths) != 0 || rebuild {
		t.Fatalf("repaired baseline: %v %v", paths, rebuild)
	}
	// Observe the initial compiler directory inventory independently of imports.
	if err := os.WriteFile(filepath.Join(root, "unrelated.ts"), []byte(`export const unrelated=true`), 0644); err != nil {
		t.Fatal(err)
	}
	if _, rebuild := session.discover(); !rebuild {
		t.Fatal("included root membership change was not discovered")
	}
}

// Telemetry is flushed synchronously after projection. This deterministic
// writer edits the source at that boundary, before publication, without timing.
type discoveryMutationWriter struct {
	path              string
	remaining, writes int
}

func (w *discoveryMutationWriter) Write(data []byte) (int, error) {
	if w.remaining > 0 && strings.Contains(string(data), `"phase":"projection.total"`) {
		w.remaining--
		w.writes++
		if err := os.WriteFile(w.path, []byte(fmt.Sprintf("export const value = '%d'", w.writes)), 0644); err != nil {
			return 0, err
		}
	}
	return len(data), nil
}
func TestCompilerDiscoveryRetriesBeforePublicationAndRecovers(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"noLib":true},"files":["index.ts"]}`), 0644); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "index.ts")
	if err := os.WriteFile(path, []byte(`export const value = 'initial'`), 0644); err != nil {
		t.Fatal(err)
	}
	mutation := &discoveryMutationWriter{path: path, remaining: 1}
	writer := bufio.NewWriter(mutation)
	telemetry := &nativeTelemetry{writer: writer, encoder: json.NewEncoder(writer)}
	a, err := newAnalyzer(root, "tsconfig.json", "", []string{"typescript.source", "typescript.body"}, nil, nil, 0, 0, telemetry)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	transaction, _, err := a.refresh(request{ID: 1, Discover: true})
	if err != nil || transaction == nil || mutation.writes != 1 {
		t.Fatalf("coherent retry failed: %v", err)
	}
	if content, _ := a.session.SourceText(filepath.Join(a.root, "index.ts")); content != "export const value = '1'" {
		t.Fatalf("published stale source: %s", content)
	}
	if err := a.acknowledge(request{Generation: transaction.Next.ID, Sequence: 1}); err != nil {
		t.Fatal(err)
	}
	pinned := a.acknowledged.generation.ID
	mutation.remaining = 4
	if err := os.WriteFile(path, []byte(`export const value = 'changed'`), 0644); err != nil {
		t.Fatal(err)
	}
	_, _, err = a.refresh(request{ID: 2, Base: pinned, Discover: true})
	failure, ok := err.(nativeError)
	if !ok || failure.code != "INPUT_CHANGED" || a.pending != nil || a.acknowledged.generation.ID != pinned || !a.pendingFull {
		t.Fatalf("unstable refresh corrupted publication: %v", err)
	}
	mutation.remaining = 0
	recovered, _, err := a.refresh(request{ID: 3, Base: pinned, Discover: true})
	if err != nil || recovered == nil {
		t.Fatalf("recovery failed: %v", err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if actual, _ := a.session.SourceText(filepath.Join(a.root, "index.ts")); actual != string(content) {
		t.Fatalf("recovery source stale: %s", actual)
	}
}
