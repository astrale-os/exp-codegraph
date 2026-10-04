package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf16"

	shimbundled "github.com/microsoft/typescript-go/shim/bundled"
	shimvfs "github.com/microsoft/typescript-go/shim/vfs"
)

func TestOwnedCompilerObservationsMatchOriginalFilesystem(t *testing.T) {
	root := t.TempDir()
	files := map[string][]byte{
		"empty.ts": {}, "single.ts": {'x'}, "utf8.ts": []byte("export const value = 'é雪'\n"),
		"utf8-bom.ts":      append([]byte{0xef, 0xbb, 0xbf}, []byte("export const value = 'é'\n")...),
		"invalid-utf8.ts":  {0xff, 0x00, 0x80, '\n'},
		"large.ts":         bytes.Repeat([]byte("export const value = 'é雪'\n"), 16384),
		"utf16-le.ts":      compilerObservationUTF16("export const value = 'é雪😀'", binary.LittleEndian),
		"utf16-be.ts":      compilerObservationUTF16("export const value = 'é雪😀'", binary.BigEndian),
		"odd-utf16.ts":     append(compilerObservationUTF16("é", binary.LittleEndian), 0xff),
		"partial-utf16.ts": {0xff, 0xfe, 0x00, 0xd8},
	}
	paths := []string{root, filepath.Join(root, "missing.ts")}
	for name, content := range files {
		path := filepath.Join(root, name)
		if err := os.WriteFile(path, content, 0644); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}
	directory := filepath.Join(root, "directory")
	if err := os.Mkdir(directory, 0755); err != nil {
		t.Fatal(err)
	}
	paths = append(paths, directory)
	link := filepath.Join(root, "link.ts")
	if err := os.Symlink(filepath.Join(root, "utf8.ts"), link); err == nil {
		paths = append(paths, link)
	}
	broken := filepath.Join(root, "broken.ts")
	if err := os.Symlink(filepath.Join(root, "missing.ts"), broken); err == nil {
		paths = append(paths, broken)
	}
	if shimbundled.Embedded {
		paths = append(paths, shimbundled.LibPath(), shimbundled.LibPath()+"/"+shimbundled.LibNames[0], "bundled:///libs/missing.d.ts")
	}
	disk := newAuthoredCompilerDisk()
	inputs := []compilerInputObservation{}
	for _, path := range paths {
		for kind := inputRead; kind <= inputMetadata; kind++ {
			key := compilerInputKey{path: path, kind: kind}
			inputs = append(inputs, compilerInputObservation{key: key, before: observeCompilerInput(disk.FS, key)})
		}
	}
	observed := newCompilerInputFS(disk.FS, disk).observe(inputs)
	for index, input := range inputs {
		if observed[index] != input.before {
			t.Fatalf("kind=%d path=%s expected=%q actual=%q", input.key.kind, input.key.path, input.before, observed[index])
		}
	}
}

func TestCompilerStreamingReadPreservesErrorsAndSameStatChanges(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	before := []byte("export const value = 'first'")
	after := []byte("export const value = 'other'")
	if err := os.WriteFile(path, before, 0644); err != nil {
		t.Fatal(err)
	}
	metadata, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	disk := newAuthoredCompilerDisk()
	buffer := make([]byte, compilerObservationBufferBytes)
	first := disk.readObservation(path, buffer)
	if first != inputText(string(before), true) {
		t.Fatal("initial bytes differ")
	}
	if err := os.WriteFile(path, after, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, metadata.ModTime(), metadata.ModTime()); err != nil {
		t.Fatal(err)
	}
	changed := disk.readObservation(path, buffer)
	if changed == first || changed != inputText(string(after), true) {
		t.Fatal("same-stat edit was not observed exactly")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if value := disk.readObservation(path, buffer); value != "absent" {
		t.Fatalf("deleted file: %q", value)
	}
	if value := disk.readObservation(root, buffer); value != "absent" {
		t.Fatalf("directory read: %q", value)
	}
	if err := os.WriteFile(path, before, 0644); err != nil {
		t.Fatal(err)
	}
	if value := disk.readObservation(path, buffer); value != first {
		t.Fatal("deleted/recreated content did not recover")
	}
}

func TestCompilerStreamingReadPreservesDeniedReadObservation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "denied.ts")
	if err := os.WriteFile(path, []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0000); err != nil {
		t.Skipf("permission fixture unavailable: %v", err)
	}
	defer os.Chmod(path, 0600)
	disk := newAuthoredCompilerDisk()
	content, ok := disk.FS.ReadFile(path)
	if ok {
		t.Skip("current user can read permission-denied fixture")
	}
	if !disk.FS.FileExists(path) {
		t.Fatal("fixture must remain stat-visible")
	}
	if value := disk.readObservation(path, make([]byte, compilerObservationBufferBytes)); value != inputText(content, ok) {
		t.Fatalf("denied read changed observation: %q", value)
	}
}

type compilerCustomObservationFS struct {
	shimvfs.FS
	reads, files int
}

func (fs *compilerCustomObservationFS) ReadFile(string) (string, bool) {
	fs.reads++
	return "custom virtual content", true
}
func (fs *compilerCustomObservationFS) FileExists(string) bool { fs.files++; return false }

func TestCompilerCustomFilesystemRetainsEveryObservation(t *testing.T) {
	disk := &compilerCustomObservationFS{FS: newAuthoredCompilerDisk().FS}
	inputs := []compilerInputObservation{}
	for index := 0; index < 32; index++ {
		inputs = append(inputs, compilerInputObservation{key: compilerInputKey{path: "virtual:///custom", kind: inputRead}}, compilerInputObservation{key: compilerInputKey{path: "virtual:///custom", kind: inputFile}})
	}
	values := newCompilerInputFS(disk, disk).observe(inputs)
	for index, value := range values {
		expected := "absent"
		if index%2 == 0 {
			expected = inputText("custom virtual content", true)
		}
		if value != expected {
			t.Fatalf("observation %d changed: %q", index, value)
		}
	}
	if disk.reads != 32 || disk.files != 32 {
		t.Fatalf("operations skipped: reads=%d exists=%d", disk.reads, disk.files)
	}
}

func TestCompilerOwnedDiscoveryRetainsSeparateExistenceProbes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.ts")
	if err := os.WriteFile(path, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	disk := newAuthoredCompilerDisk()
	inputs := []compilerInputObservation{{key: compilerInputKey{path: path, kind: inputRead}}, {key: compilerInputKey{path: path, kind: inputFile}}}
	first := newCompilerInputFS(disk.FS, disk).observe(inputs)
	if first[0] != inputText("content", true) || first[1] != "present" {
		t.Fatal("initial observations differ")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	next := newCompilerInputFS(disk.FS, disk).observe(inputs)
	if next[0] != "absent" || next[1] != "absent" {
		t.Fatal("existence observation was reused from a prior read")
	}
}

type compilerUnlinkBeforeExistsFS struct {
	shimvfs.FS
	path  string
	calls int
}

func (fs *compilerUnlinkBeforeExistsFS) FileExists(path string) bool {
	fs.calls++
	if path == fs.path {
		if err := os.Remove(path); err != nil {
			panic(err)
		}
	}
	return fs.FS.FileExists(path)
}

func TestCompilerExistenceProbeObservesUnlinkAfterSuccessfulRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.ts")
	if err := os.WriteFile(path, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	disk := newAuthoredCompilerDisk()
	// Private test instrumentation edits the actual filesystem at the separate
	// existence operation. Production composition exposes no such callback.
	observation := &compilerUnlinkBeforeExistsFS{FS: disk.FS, path: path}
	disk.FS = observation
	inputs := []compilerInputObservation{{key: compilerInputKey{path: path, kind: inputRead}}, {key: compilerInputKey{path: path, kind: inputFile}}}
	values := newCompilerInputFS(disk.FS, disk).observe(inputs)
	if values[0] != inputText("content", true) || values[1] != "absent" || observation.calls != 1 {
		t.Fatalf("read/existence observations were coalesced: %v calls=%d", values, observation.calls)
	}
}

var compilerObservationBenchmarkSink string

func BenchmarkCompilerReadObservation(b *testing.B) {
	for _, fixture := range []struct {
		name    string
		content []byte
	}{
		{"utf8-4KiB", bytes.Repeat([]byte("authored source é\n"), 256)[:4*1024]},
		{"utf8-1MiB", bytes.Repeat([]byte("authored source é\n"), 65536)[:1024*1024]},
		{"utf16-fallback", compilerObservationUTF16("export const value = 'é雪😀'", binary.LittleEndian)},
	} {
		b.Run(fixture.name, func(b *testing.B) {
			path := filepath.Join(b.TempDir(), "source.ts")
			if err := os.WriteFile(path, fixture.content, 0644); err != nil {
				b.Fatal(err)
			}
			disk := newAuthoredCompilerDisk()
			b.Run("original-full-text", func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(fixture.content)))
				for index := 0; index < b.N; index++ {
					content, ok := disk.FS.ReadFile(path)
					if !ok {
						b.Fatal("read failed")
					}
					compilerObservationBenchmarkSink = inputText(content, ok)
				}
			})
			b.Run("owned-streaming-digest", func(b *testing.B) {
				buffer := make([]byte, compilerObservationBufferBytes)
				b.ReportAllocs()
				b.SetBytes(int64(len(fixture.content)))
				b.ResetTimer()
				for index := 0; index < b.N; index++ {
					compilerObservationBenchmarkSink = disk.readObservation(path, buffer)
					if compilerObservationBenchmarkSink == "absent" {
						b.Fatal("read failed")
					}
				}
			})
		})
	}
}

func compilerObservationUTF16(value string, order binary.ByteOrder) []byte {
	bytes := []byte{0xff, 0xfe}
	if order == binary.BigEndian {
		bytes = []byte{0xfe, 0xff}
	}
	for _, unit := range utf16.Encode([]rune(value)) {
		var encoded [2]byte
		order.PutUint16(encoded[:], unit)
		bytes = append(bytes, encoded[:]...)
	}
	return bytes
}

// All workers must finish before observations are released to the compiler.
// A gate makes the concurrency bound observable without timing assumptions.
type compilerGatedObservationFS struct {
	shimvfs.FS
	entered                chan struct{}
	release                chan struct{}
	active, maximum, calls atomic.Int32
}

func (fs *compilerGatedObservationFS) FileExists(string) bool {
	active := fs.active.Add(1)
	for maximum := fs.maximum.Load(); active > maximum; maximum = fs.maximum.Load() {
		if fs.maximum.CompareAndSwap(maximum, active) {
			break
		}
	}
	fs.entered <- struct{}{}
	<-fs.release
	fs.active.Add(-1)
	fs.calls.Add(1)
	return false
}
func TestCompilerOwnedObservationWorkersAreBoundedAndJoined(t *testing.T) {
	disk := newAuthoredCompilerDisk()
	gated := &compilerGatedObservationFS{FS: disk.FS, entered: make(chan struct{}, 32), release: make(chan struct{})}
	disk.FS = gated
	inputs := make([]compilerInputObservation, 32)
	for index := range inputs {
		inputs[index].key = compilerInputKey{path: fmt.Sprintf("missing-%d", index), kind: inputFile}
	}
	completed := make(chan []string, 1)
	go func() { completed <- newCompilerInputFS(disk.FS, disk).observe(inputs) }()
	released := false
	defer func() {
		if !released {
			close(gated.release)
		}
	}()
	for index := 0; index < compilerObservationWorkers; index++ {
		select {
		case <-gated.entered:
		case <-time.After(5 * time.Second):
			t.Fatal("workers did not enter independent probes")
		}
	}
	select {
	case <-completed:
		t.Fatal("observations published while probes remained active")
	default:
	}
	close(gated.release)
	released = true
	select {
	case results := <-completed:
		for _, result := range results {
			if result != "absent" {
				t.Fatal("probe result lost")
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("workers did not join")
	}
	if gated.active.Load() != 0 || gated.calls.Load() != int32(len(inputs)) || gated.maximum.Load() > compilerObservationWorkers {
		t.Fatalf("worker ownership changed: active=%d calls=%d maximum=%d", gated.active.Load(), gated.calls.Load(), gated.maximum.Load())
	}
}

// UTF-16 must retain the authored reader's direct second decoder operation.
// Re-entering its wrapper adds another OS read and can change which encoding
// owns the result when the file is replaced between independent reads.
type compilerCountingDecoderFS struct {
	shimvfs.FS
	calls       int
	replacePath string
	replacement []byte
}

func (fs *compilerCountingDecoderFS) ReadFile(path string) (string, bool) {
	fs.calls++
	if path == fs.replacePath {
		if err := os.WriteFile(path, fs.replacement, 0644); err != nil {
			panic(err)
		}
	}
	return fs.FS.ReadFile(path)
}
func TestCompilerUTF16ObservationRetainsDirectDecoderOperation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.ts")
	if err := os.WriteFile(path, compilerObservationUTF16("export const value='é'", binary.LittleEndian), 0644); err != nil {
		t.Fatal(err)
	}
	disk := newAuthoredCompilerDisk()
	replacement := append([]byte{0xef, 0xbb, 0xbf}, []byte("export const value='changed'")...)
	decoder := &compilerCountingDecoderFS{FS: disk.decoder, replacePath: path, replacement: replacement}
	disk.decoder = decoder
	actual := disk.readObservation(path, make([]byte, compilerObservationBufferBytes))
	decoded, ok := decoder.FS.ReadFile(path)
	if actual != inputText(decoded, ok) || decoder.calls != 1 {
		t.Fatalf("UTF16 decoder operation changed: actual=%s expected=%s calls=%d", actual, inputText(decoded, ok), decoder.calls)
	}
}
