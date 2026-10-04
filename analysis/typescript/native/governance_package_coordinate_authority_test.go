package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Exact c06a97c predecessor consumers serve as the original-operation oracle.
// These functions deliberately keep their different library and error semantics.
func originalPortableUniversePath(project *governedProject, path string) (string, error) {
	path = filepath.Clean(path)
	if library := typescriptLibraryFile(path); library != "" {
		return "platform:typescript/" + library, nil
	}
	relative, err := filepath.Rel(project.Root, path)
	if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		logical := filepath.ToSlash(relative)
		if !strings.Contains(logical, "/node_modules/") && !strings.HasPrefix(logical, "node_modules/") {
			if logical == "" {
				return ".", nil
			}
			return logical, nil
		}
	}
	directory := filepath.Dir(path)
	inside := pathContains(project.Root, path)
	for {
		if inside && !pathContains(project.Root, directory) {
			break
		}
		bytes, err := project.capture.read(filepath.Join(directory, "package.json"))
		if err == nil {
			var document struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(bytes, &document) != nil {
				break
			}
			if document.Name != "" {
				coordinate := "package:" + document.Name
				if subpath, err := filepath.Rel(directory, path); err == nil && subpath != "." {
					coordinate += "/" + filepath.ToSlash(subpath)
				}
				return coordinate, nil
			}
		} else if !os.IsNotExist(err) {
			break
		}
		if inside && directory == project.Root {
			break
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return "", fmt.Errorf("runtime universe input has no portable coordinate: %s", path)
}
func originalRuntimeDeclarationCoordinate(project *governedProject, path string) (string, error) {
	if typescriptLibraryFile(path) == "" {
		return originalPortableUniversePath(project, path)
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(project.Root, path)
	}
	path = filepath.Clean(path)
	directory := filepath.Dir(path)
	inside := pathContains(project.Root, path)
	for {
		if inside && !pathContains(project.Root, directory) {
			break
		}
		content, err := project.capture.read(filepath.Join(directory, "package.json"))
		if err == nil {
			var document struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(content, &document) != nil {
				break
			}
			if document.Name != "" {
				relative, err := filepath.Rel(directory, path)
				if err != nil {
					return "", err
				}
				return "package:" + document.Name + "/" + filepath.ToSlash(relative), nil
			}
		} else if !os.IsNotExist(err) {
			return "", err
		}
		if inside && directory == project.Root {
			break
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return "", nil
}

func coordinateCapture(root string) *governedProject {
	return &governedProject{Root: root, capture: &governanceCapture{observations: map[string]governanceObservation{}}}
}

func assertCoordinateCaptureEqual(t *testing.T, actual, original *governanceCapture) {
	t.Helper()
	if !reflect.DeepEqual(actual.observations, original.observations) || !reflect.DeepEqual(actual.byteCells, original.byteCells) || actual.probeInconsistent != original.probeInconsistent || actual.canonicalCertificate() != original.canonicalCertificate() {
		t.Fatalf("original actual read/error/negative observations changed: actual=%#v original=%#v", actual.observations, original.observations)
	}
}

func TestPackageCoordinateAuthorityExactOriginalConsumersAndErrors(t *testing.T) {
	for _, nearest := range []string{
		`{"name":"@scope/é😀","largeIgnored":{"name":"other"}}`,
		`{}`, `null`, `{"name":""}`, `{"name":null}`,
		`{"name":42}`, `{"name":"partial","name":false}`,
		`{"name":"first","n\u0061me":"second","NAME":"last"}`,
		`{"name":"ok","ignored":[}`, `{"name":"ok"} trailing`,
		`{"name":"\u00e9\ud83d\ude00"}`, `{"name":"bad\uD800"}`,
		"\ufeff{\"name\":\"bom\"}",
		"absent", "directory", "symlink", "dangling", "not-directory", "permission",
	} {
		t.Run(nearest, func(t *testing.T) {
			base := t.TempDir()
			root := filepath.Join(base, "project")
			governanceWrite(t, root, "package.json", `{"name":"parent"}`)
			manifest := filepath.Join(root, "node_modules/pkg/src/package.json")
			if err := os.MkdirAll(filepath.Dir(manifest), 0755); err != nil {
				t.Fatal(err)
			}
			switch nearest {
			case "absent":
			case "directory":
				if err := os.Mkdir(manifest, 0755); err != nil {
					t.Fatal(err)
				}
			case "permission":
				if err := os.WriteFile(manifest, []byte(`{"name":"unreadable"}`), 0000); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { os.Chmod(manifest, 0644) })
			case "symlink":
				target := filepath.Join(base, "target.json")
				if err := os.WriteFile(target, []byte(`{"name":"target"}`), 0644); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, manifest); err != nil {
					t.Fatal(err)
				}
			case "dangling":
				if err := os.Symlink(filepath.Join(base, "missing.json"), manifest); err != nil {
					t.Fatal(err)
				}
			case "not-directory":
				if err := os.Remove(filepath.Dir(manifest)); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Dir(manifest), []byte("not a directory"), 0644); err != nil {
					t.Fatal(err)
				}
			default:
				if err := os.WriteFile(manifest, []byte(nearest), 0644); err != nil {
					t.Fatal(err)
				}
			}
			paths := []string{
				filepath.Join(root, "local/é😀.ts"), root,
				filepath.Join(root, "node_modules/pkg/src/file.d.ts"),
				filepath.Join(root, "node_modules/pkg/src/sibling.d.ts"),
				"bundled:/libs/lib.es5.d.ts",
				filepath.Join(root, "node_modules/pkg/src/bundled:/libs/lib.es5.d.ts"),
				filepath.Join(root, "node_modules/typescript/lib/lib.es5.d.ts"),
			}
			for _, declaration := range []bool{false, true} {
				actual, original := coordinateCapture(root), coordinateCapture(root)
				for repeat := 0; repeat < 3; repeat++ {
					for _, path := range paths {
						var got, want string
						var gotError, wantError error
						if declaration {
							got, gotError = governanceRuntimeDeclarationCoordinate(actual, path)
							want, wantError = originalRuntimeDeclarationCoordinate(original, path)
						} else {
							got, gotError = governancePortableUniversePath(actual, path)
							want, wantError = originalPortableUniversePath(original, path)
						}
						if got != want || !reflect.DeepEqual(gotError, wantError) {
							t.Fatalf("declaration=%v path=%s result=%q/%v original=%q/%v", declaration, path, got, gotError, want, wantError)
						}
						assertCoordinateCaptureEqual(t, actual.capture, original.capture)
					}
				}
				if valid, err := actual.capture.Verify(); !valid || err != nil {
					t.Fatalf("unchanged actual original operations failed seal: %v %v", valid, err)
				}
			}
		})
	}
}

func TestPackageCoordinateAuthorityRootBoundariesAndSemanticLibraryDifference(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "project")
	governanceWrite(t, root, "package.json", `{"name":"inner"}`)
	governanceWrite(t, base, "package.json", `{"name":"outer"}`)
	for _, path := range []string{filepath.Join(base, "other/decl.d.ts"), filepath.Join(root, "node_modules/unknown/decl.d.ts"), "bundled:/libs/lib.es5.d.ts"} {
		for _, declaration := range []bool{false, true} {
			actual, original := coordinateCapture(root), coordinateCapture(root)
			var got, want string
			var gotError, wantError error
			if declaration {
				got, gotError = governanceRuntimeDeclarationCoordinate(actual, path)
				want, wantError = originalRuntimeDeclarationCoordinate(original, path)
			} else {
				got, gotError = governancePortableUniversePath(actual, path)
				want, wantError = originalPortableUniversePath(original, path)
			}
			if got != want || !reflect.DeepEqual(gotError, wantError) {
				t.Fatal("inside/outside root stop changed", path)
			}
			assertCoordinateCaptureEqual(t, actual.capture, original.capture)
		}
	}
	project := coordinateCapture(root)
	if universe, err := governancePortableUniversePath(project, "bundled:/libs/lib.es5.d.ts"); err != nil || universe != "platform:typescript/lib.es5.d.ts" || len(project.capture.observations) != 0 {
		t.Fatal("universe library must bypass package authority", universe, err)
	}
	if value, err := governanceRuntimeDeclarationCoordinate(project, "bundled:/libs/lib.es5.d.ts"); err != nil || value != "package:inner/bundled:/libs/lib.es5.d.ts" {
		t.Fatal("value library lost captured caller-package provenance", value, err)
	}
}

func TestPackageCoordinateAuthorityImmutableActualProductsAndFreshGeneration(t *testing.T) {
	root := t.TempDir()
	manifest := filepath.Join(root, "node_modules/pkg/package.json")
	governanceWrite(t, root, "node_modules/pkg/package.json", `{"name":"before"}`)
	path := filepath.Join(root, "node_modules/pkg/decl.d.ts")
	project := coordinateCapture(root)
	exposed, err := project.capture.read(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for i := range exposed {
		exposed[i] = 'X'
	}
	got, err := governancePortableUniversePath(project, path)
	if err != nil || got != "package:before/decl.d.ts" {
		t.Fatal("caller corrupted retained actual package bytes", got, err)
	}
	exposed, err = project.capture.read(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for i := range exposed {
		exposed[i] = 'Y'
	}
	if got, err = governancePortableUniversePath(project, path); err != nil || got != "package:before/decl.d.ts" {
		t.Fatal("caller corrupted manifest product", got, err)
	}
	before, err := os.Stat(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(manifest, []byte(`{"name":"after!"}`), before.Mode()); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(manifest, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	if got, err = governancePortableUniversePath(project, path); err != nil || got != "package:before/decl.d.ts" {
		t.Fatal("within-capture product was replaced by later bytes", got, err)
	}
	if valid, _ := project.capture.Verify(); valid {
		t.Fatal("same-size/stat changed bytes survived original fresh guard")
	}
	fresh := coordinateCapture(root)
	if got, err = governancePortableUniversePath(fresh, path); err != nil || got != "package:after!/decl.d.ts" {
		t.Fatal("new actual capture borrowed previous facts", got, err)
	}
	expected := governanceExpectedCapture(project.capture)
	if len(expected.packageCoordinates.manifests) != 0 || len(expected.byteCells) != 0 {
		t.Fatal("actual package products promoted into expected proposals")
	}
	malformed := filepath.Join(root, "bad.json")
	governanceWrite(t, root, "bad.json", `{"name":`)
	first := fresh.capture.packageManifestProduct(malformed)
	second := fresh.capture.packageManifestProduct(malformed)
	if first.parseError == nil || first.parseError != second.parseError {
		t.Fatal("original parse error was not retained as one actual immutable product")
	}
}

func TestPackageCoordinateAuthorityRetainsAllLateOwnedOverlapChecks(t *testing.T) {
	for _, nearest := range []string{`{"name":"near"}`, `{}`, `{"name":"partial","name":false}`, "absent", "directory"} {
		t.Run(nearest, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "package.json", `{"name":"parent"}`)
			manifest := filepath.Join(root, "node_modules/pkg/package.json")
			if err := os.MkdirAll(filepath.Dir(manifest), 0755); err != nil {
				t.Fatal(err)
			}
			switch nearest {
			case "absent":
			case "directory":
				if err := os.Mkdir(manifest, 0755); err != nil {
					t.Fatal(err)
				}
			default:
				if err := os.WriteFile(manifest, []byte(nearest), 0644); err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(root, "node_modules/pkg/decl.d.ts")
			actual, original := coordinateCapture(root), coordinateCapture(root)
			governancePortableUniversePath(actual, path)
			originalPortableUniversePath(original, path)
			assertCoordinateCaptureEqual(t, actual.capture, original.capture)
			// Challenge every observed ancestor independently. Guarding only the
			// nearest path is insufficient when its empty/absent manifest ascends.
			for observed := range actual.capture.byteCells {
				current, predecessor := coordinateCapture(root), coordinateCapture(root)
				governancePortableUniversePath(current, path)
				originalPortableUniversePath(predecessor, path)
				// Model a journal arriving after an early decode. Even a cached
				// malformed, absent, or failed read must recheck the original cell.
				current.capture.ownedGenericBytes = map[string][]byte{observed: []byte("late conflicting actual bytes")}
				predecessor.capture.ownedGenericBytes = map[string][]byte{observed: []byte("late conflicting actual bytes")}
				got, gotError := governancePortableUniversePath(current, path)
				want, wantError := originalPortableUniversePath(predecessor, path)
				if got != want || !reflect.DeepEqual(gotError, wantError) {
					t.Fatal("conflict changed original private result")
				}
				assertCoordinateCaptureEqual(t, current.capture, predecessor.capture)
				if !current.capture.probeInconsistent {
					t.Fatal("cached product skipped ancestor ownedReadMatches", observed)
				}
				if valid, _ := current.capture.Verify(); valid {
					t.Fatal("late overlap contradiction was published")
				}
			}
		})
	}
}

func TestPackageCoordinateAuthorityFreshGuardsNegativeErrorAndSourceChanges(t *testing.T) {
	for _, change := range []string{"negative-appears", "read-error-recovers", "symlink-retargets", "source-changes"} {
		t.Run(change, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "package.json", `{"name":"parent"}`)
			manifest := filepath.Join(root, "node_modules/pkg/src/package.json")
			if err := os.MkdirAll(filepath.Dir(manifest), 0755); err != nil {
				t.Fatal(err)
			}
			switch change {
			case "read-error-recovers":
				if err := os.Mkdir(manifest, 0755); err != nil {
					t.Fatal(err)
				}
			case "symlink-retargets":
				governanceWrite(t, root, "first.json", `{"name":"first"}`)
				governanceWrite(t, root, "other.json", `{"name":"other"}`)
				if err := os.Symlink(filepath.Join(root, "first.json"), manifest); err != nil {
					t.Fatal(err)
				}
			}
			source := filepath.Join(root, "node_modules/pkg/src/decl.d.ts")
			governanceWrite(t, root, "node_modules/pkg/src/decl.d.ts", "before")
			actual, original := coordinateCapture(root), coordinateCapture(root)
			actual.capture.read(source)
			original.capture.read(source)
			governancePortableUniversePath(actual, source)
			originalPortableUniversePath(original, source)
			switch change {
			case "negative-appears":
				governanceWrite(t, root, "node_modules/pkg/src/package.json", `{"name":"appeared"}`)
			case "read-error-recovers":
				if err := os.Remove(manifest); err != nil {
					t.Fatal(err)
				}
				governanceWrite(t, root, "node_modules/pkg/src/package.json", `{"name":"recovered"}`)
			case "symlink-retargets":
				if err := os.Remove(manifest); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(filepath.Join(root, "other.json"), manifest); err != nil {
					t.Fatal(err)
				}
			case "source-changes":
				governanceWrite(t, root, "node_modules/pkg/src/decl.d.ts", "after!")
			}
			got, gotError := governancePortableUniversePath(actual, source)
			want, wantError := originalPortableUniversePath(original, source)
			if got != want || !reflect.DeepEqual(gotError, wantError) {
				t.Fatal("private first actual facts changed after edit")
			}
			assertCoordinateCaptureEqual(t, actual.capture, original.capture)
			if valid, _ := actual.capture.Verify(); valid {
				t.Fatal("post-observation change survived fresh original seal", change)
			}
		})
	}
}
