package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func governanceCatalogCapture(session *governanceSession, root string, canonical bool) (*governedProject, error) {
	policy := governanceTestPolicy()
	if canonical {
		configuration, err := session.captureConfiguration(root)
		if err != nil {
			return nil, err
		}
		return session.continuePolicy(configuration["token"].(string), governanceCompiledPolicy{Source: policy, Digest: "catalog-fixture"})
	}
	project, _, err := session.prepareSource(governancePrepare{Root: root, PolicySource: &policy})
	return project, err
}

func TestGovernanceParseCatalogSuccessfulReplacement(t *testing.T) {
	for _, canonical := range []bool{false, true} {
		name := "source"
		if canonical {
			name = "canonical-policy"
		}
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "mutations/a.ts", `require('a');`)
			governanceWrite(t, root, "mutations/b.ts", `require('b');`)
			session := &governanceSession{}
			first, err := governanceCatalogCapture(session, root, canonical)
			if err != nil {
				t.Fatal(err)
			}
			held := first.FilesByPath
			heldA := held["mutations/a.ts"]
			heldB := held["mutations/b.ts"]
			if first.stats.Parses != 2 || len(session.parseCache) != 2 || session.parseCache["mutations/a.ts"] != heldA {
				t.Fatalf("cold catalog missing actual rows: %+v", first.stats)
			}
			same, err := governanceCatalogCapture(session, root, canonical)
			if err != nil || same.stats.Parses != 0 || same.stats.ParseReuses != 2 || same.FilesByPath["mutations/a.ts"].Source != heldA.Source {
				t.Fatalf("identical source did not reuse actual AST: %v", err)
			}
			governanceWrite(t, root, "mutations/a.ts", `require('edited');`)
			edited, err := governanceCatalogCapture(session, root, canonical)
			if err != nil || edited.stats.Parses != 1 || edited.stats.ParseReuses != 1 || edited.FilesByPath["mutations/a.ts"].Source == heldA.Source || edited.FilesByPath["mutations/b.ts"].Source != heldB.Source {
				t.Fatalf("edit did not replace only its actual AST: %v", err)
			}
			if err := os.Remove(filepath.Join(root, "mutations/a.ts")); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(filepath.Join(root, "mutations/b.ts"), filepath.Join(root, "mutations/renamed.ts")); err != nil {
				t.Fatal(err)
			}
			renamed, err := governanceCatalogCapture(session, root, canonical)
			if err != nil || len(session.parseCache) != 1 || session.parseCache["mutations/a.ts"] != nil || session.parseCache["mutations/b.ts"] != nil {
				t.Fatalf("removed catalog rows remained session roots: %v", err)
			}
			current := renamed.FilesByPath["mutations/renamed.ts"]
			if current == nil || renamed.stats.Parses != 1 || current.Source == heldB.Source || current.Source.FileName() != current.AbsolutePath {
				t.Fatal("renamed source reused a foreign absolute AST owner")
			}
			if len(held) != 2 || held["mutations/a.ts"] != heldA || heldA.Source.Text() != `require('a');` || heldB.Source.Text() != `require('b');` {
				t.Fatal("retiring session catalog mutated an independently held source catalog")
			}
			before, _ := governanceEvaluate(first, "IMP-STATIC")
			fresh, err := captureGovernedProject(root, governanceTestPolicy())
			if err != nil {
				t.Fatal(err)
			}
			got, _ := governanceEvaluate(renamed, "IMP-STATIC")
			want, _ := governanceEvaluate(fresh, "IMP-STATIC")
			if len(before.Findings) != 2 || !reflect.DeepEqual(got, want) || len(got.Findings) != 1 {
				t.Fatal("catalog replacement changed actual parsed rule outcomes")
			}
		})
	}
}

func TestGovernanceParseCatalogCrossRootCannotReuseSameRelativeText(t *testing.T) {
	for _, canonical := range []bool{false, true} {
		rootA, rootB := t.TempDir(), t.TempDir()
		governanceWrite(t, rootA, "mutations/a.ts", `const same=1;`)
		governanceWrite(t, rootB, "mutations/a.ts", `const same=1;`)
		session := &governanceSession{root: rootA}
		first, err := governanceCatalogCapture(session, rootA, canonical)
		if err != nil {
			t.Fatal(err)
		}
		second, err := governanceCatalogCapture(session, rootB, canonical)
		if err != nil {
			t.Fatal(err)
		}
		a, b := first.FilesByPath["mutations/a.ts"], second.FilesByPath["mutations/a.ts"]
		if second.stats.Parses != 1 || second.stats.ParseReuses != 0 || a.Source == b.Source || a.AbsolutePath == b.AbsolutePath || b.Source.FileName() != b.AbsolutePath {
			t.Fatal("equal relative path/text crossed the actual source-root identity")
		}
	}
}

func TestGovernanceParseCatalogFailureLeavesLastSuccessAndRecovers(t *testing.T) {
	for _, canonical := range []bool{false, true} {
		mode := "source"
		if canonical {
			mode = "canonical-policy"
		}
		for _, failure := range []string{"syntax", "utf8", "symbolic-link"} {
			t.Run(mode+"/"+failure, func(t *testing.T) {
				root := t.TempDir()
				governanceWrite(t, root, "mutations/a.ts", `const a=1;`)
				session := &governanceSession{}
				first, err := governanceCatalogCapture(session, root, canonical)
				if err != nil {
					t.Fatal(err)
				}
				held := first.FilesByPath["mutations/a.ts"]
				governanceWrite(t, root, "mutations/00-new.ts", `const next=1;`)
				badPath := filepath.Join(root, "mutations/z-bad.ts")
				switch failure {
				case "syntax":
					governanceWrite(t, root, "mutations/z-bad.ts", `const =;`)
				case "utf8":
					if err := os.WriteFile(badPath, []byte{255}, 0644); err != nil {
						t.Fatal(err)
					}
				case "symbolic-link":
					if err := os.Symlink(filepath.Join(root, "mutations/a.ts"), badPath); err != nil {
						t.Fatal(err)
					}
				}
				failed, err := governanceCatalogCapture(session, root, canonical)
				if err == nil || failed != nil {
					t.Fatal("original malformed source admission unexpectedly succeeded")
				}
				fresh, freshErr := captureGovernedProject(root, governanceTestPolicy())
				if fresh != nil || freshErr == nil || err.Error() != freshErr.Error() {
					t.Fatalf("cached capture changed original admission error: %v / %v", err, freshErr)
				}
				if len(session.parseCache) != 1 || session.parseCache["mutations/a.ts"] != held || session.parseCache["mutations/00-new.ts"] != nil {
					t.Fatal("failed capture published a partial current catalog")
				}
				if err := os.Remove(badPath); err != nil {
					t.Fatal(err)
				}
				recovered, err := governanceCatalogCapture(session, root, canonical)
				if err != nil || recovered.stats.Parses != 1 || recovered.stats.ParseReuses != 1 || len(session.parseCache) != 2 || recovered.FilesByPath["mutations/a.ts"].Source != held.Source {
					t.Fatalf("restoration did not recover against the last successful owner: %v", err)
				}
			})
		}
	}
}

func TestGovernanceParseCatalogPublishesEmptySuccessfulMembership(t *testing.T) {
	for _, canonical := range []bool{false, true} {
		root := t.TempDir()
		governanceWrite(t, root, "mutations/a.ts", `const a=1;`)
		session := &governanceSession{}
		first, err := governanceCatalogCapture(session, root, canonical)
		if err != nil {
			t.Fatal(err)
		}
		held := first.FilesByPath
		if err := os.Remove(filepath.Join(root, "mutations/a.ts")); err != nil {
			t.Fatal(err)
		}
		empty, err := governanceCatalogCapture(session, root, canonical)
		if err != nil || empty == nil || session.parseCache == nil || len(session.parseCache) != 0 || len(empty.Files) != 0 || len(held) != 1 {
			t.Fatalf("empty successful catalog did not replace prior membership: %v", err)
		}
	}
}

func TestGovernanceParseCatalogCurrentWalkAndNegativeBarrier(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/\ue000.ts", `const bmp=1;`)
	governanceWrite(t, root, "mutations/😀.ts", `const astral=1;`)
	session := &governanceSession{}
	first, err := governanceCatalogCapture(session, root, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Files) != 2 || first.Files[0].Path != "mutations/😀.ts" || first.Files[1].Path != "mutations/\ue000.ts" {
		t.Fatal("catalog reused map order instead of original UTF16 walk order")
	}
	governanceWrite(t, root, "mutations/new-dir/c.ts", `require('new');`)
	valid, err := first.capture.Verify()
	if err != nil || valid {
		t.Fatalf("new source/directory escaped original negative barrier: %v", err)
	}
	second, err := governanceCatalogCapture(session, root, true)
	if err != nil || second.stats.ParseReuses != 2 || second.stats.Parses != 1 || len(session.parseCache) != 3 {
		t.Fatalf("current fresh membership omitted new nested source: %v", err)
	}
	for _, file := range second.Files {
		if strings.Contains(file.Path, "new-dir") && file.AbsolutePath != filepath.Join(second.Root, filepath.FromSlash(file.Path)) {
			t.Fatal("current source catalog lost canonical absolute ownership")
		}
	}
}

func TestGovernanceParseCatalogPrivateLaneHandoff(t *testing.T) {
	session, _ := governanceLaneFixture(t)
	defer session.discardProducts()
	if session.parseCache != nil {
		t.Fatal("actor retained the compiler lane's source catalog")
	}
	joined := session.takePolicyLane()
	if joined.err != nil || joined.owner.parseCache != nil || session.productsSession == nil || session.productsSession.Project == nil {
		t.Fatalf("private lane failed to transfer its complete source owner: %v", joined.err)
	}
	project := session.productsSession.Project
	if len(session.parseCache) != len(project.FilesByPath) || session.parseCache["mutations/source.ts"] != project.FilesByPath["mutations/source.ts"] {
		t.Fatal("joined session did not retain the successful project's actual rows")
	}
	prior := project.FilesByPath["mutations/source.ts"].Source
	session.discardProducts()
	next, err := governanceCatalogCapture(session, session.root, true)
	if err != nil || next.stats.Parses != 0 || next.stats.ParseReuses != 1 || next.FilesByPath["mutations/source.ts"].Source != prior {
		t.Fatalf("discard after lane join lost reusable current syntax: %v", err)
	}
}
