package main

import (
	"fmt"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"path/filepath"
	"testing"
)

// This is an operation fixture, not a compiler or whole-report benchmark.
// It exercises complete current/lease/expected closures for actual source edits.
func TestPublicationPlanOperationFixture(t *testing.T) {
	root := t.TempDir()
	for _, phase := range []string{"noop", "id", "body"} {
		t.Run(phase, func(t *testing.T) {
			current := publicationCapture()
			for index := 0; index < 3; index++ {
				text := fmt.Sprintf("export const value%d={id:'before',run:()=>1};", index)
				if index == 0 && phase == "id" {
					text = "export const value0={id:'after',run:()=>1};"
				}
				if index == 0 && phase == "body" {
					text = "export const value0={id:'before',run:()=>2};"
				}
				name := fmt.Sprintf("source%d.ts", index)
				governanceWrite(t, root, name, text)
				path := filepath.Join(root, name)
				current.read(path)
				current.compiler.ReadFile(path)
				current.compiler.FileExists(path)
			}
			current.compiler.FileExists(filepath.Join(root, "absent.ts"))
			assertions := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
			for path, value := range current.compiler.rawReads {
				assertions.barrierReads[path] = value
			}
			for key, value := range current.compiler.observed {
				if key.kind != inputRead {
					assertions.barrierObservations[key] = value
				}
			}
			current.compilerAssertions = []*governanceCompilerReadAssertions{assertions}
			cache := &governanceTypeDemandCache{}
			current.typeCacheLeases = []*governanceTypeCacheLease{newGovernanceTypeCacheLease(cache, governanceTypeDemandKey{path: "fixture"}, assertions)}
			expected := governanceExpectedCapture(current)
			valid, err, world := governanceVerifyPublicationOwner([]*governanceCapture{current, expected})
			if !valid || err != nil {
				t.Fatalf("original operation fixture failed: %v %v", valid, err)
			}
			if len(world.streams) != 3 || len(world.reads) != 3 {
				t.Fatal("fresh same-observer ownership not shared", len(world.streams), len(world.reads))
			}
			t.Logf("phase=%s streamingObservers=%d rawReads=%d compilerMethods=%v", phase, len(world.streams), len(world.reads), world.compilerOperationCounts())
		})
	}
}

func TestPublicationPlanImmutableExpectedClosureAndFreshCells(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "source.ts")
	governanceWrite(t, root, "source.ts", "before")
	builder := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{path: {"before", true}}}
	frozen := builder.immutableSnapshot()
	builder.barrierReads[path] = compilerRawRead{"changed builder", true}
	current := publicationCapture()
	current.compilerAssertions = []*governanceCompilerReadAssertions{frozen}
	one, two := governanceExpectedCapture(current), governanceExpectedCapture(current)
	if one.compilerAssertions[0] != frozen || two.compilerAssertions[0] != frozen {
		t.Fatal("immutable retained closure copied")
	}
	valid, _, first := governanceVerifyPublicationOwner([]*governanceCapture{current, one, two})
	if !valid || len(first.compilerWorld.checkedPlans) != 3 {
		t.Fatal("distinct actual raw snapshot plans or shared frozen plan lost")
	}
	copy := governanceGenerationReceiptCopy(frozen)
	copy.barrierReads[path] = compilerRawRead{"independent change", true}
	if frozen.barrierReads[path].text != "before" {
		t.Fatal("changed generation borrowed immutable producer map")
	}
	governanceWrite(t, root, "source.ts", "after!")
	valid, _, second := governanceVerifyPublicationOwner([]*governanceCapture{current, one, two})
	if valid || second == first || second.compilerWorld == first.compilerWorld || second.failedCapture != current {
		t.Fatal("expected nodes became fresh authority")
	}
	governanceWrite(t, root, "source.ts", "before")
	if valid, _, _ := governanceVerifyPublicationOwner([]*governanceCapture{current, one, two}); !valid {
		t.Fatal("restored current source cannot recover")
	}
}

type publicationPlanCustomFS struct {
	vfs.FS
	calls  int
	onRead func()
}

func (fs *publicationPlanCustomFS) ReadFile(path string) (string, bool) {
	fs.calls++
	if fs.onRead != nil {
		fs.onRead()
	}
	return "custom", true
}
func TestPublicationPlanCustomCapturesRemainIndependentAndOrdered(t *testing.T) {
	fs := &publicationPlanCustomFS{FS: newAuthoredCompilerDisk()}
	one, two := publicationCapture(), publicationCapture()
	for _, capture := range []*governanceCapture{one, two} {
		capture.compiler.disk = fs
		capture.compilerAssertions = []*governanceCompilerReadAssertions{{barrierReads: map[string]compilerRawRead{"custom-path": {"custom", true}}}}
	}
	if valid, _, _ := governanceVerifyPublicationOwner([]*governanceCapture{one, two}); !valid || fs.calls != 2 {
		t.Fatal("independent custom captures joined", fs.calls)
	}
	fs.calls = 0
	one.compilerAssertions[0].barrierReads["custom-path"] = compilerRawRead{"different", true}
	valid, _, world := governanceVerifyPublicationOwner([]*governanceCapture{one, two})
	if valid || fs.calls != 1 || world.failedCapture != one {
		t.Fatal("custom failure reordered or later operation executed", fs.calls)
	}
}

func TestPublicationPlanArtifactLifetimeIsCheckedAtEveryGate(t *testing.T) {
	raw := ownedArtifactTestBytes(t)
	lease, err := governanceAcquireOwnedArtifact(raw, ownedArtifactTestStore(t))
	if err != nil {
		t.Fatal(err)
	}
	defer lease.close()
	fs := &publicationPlanCustomFS{FS: newAuthoredCompilerDisk(), onRead: lease.close}
	one, two := publicationCapture(), publicationCapture()
	one.ownedGenericArtifact = lease
	one.compiler.disk = fs
	one.compilerAssertions = []*governanceCompilerReadAssertions{{barrierReads: map[string]compilerRawRead{"custom-path": {"custom", true}}}}
	two.ownedGenericArtifact = lease
	two.compiler.disk = fs
	two.compilerAssertions = one.compilerAssertions
	valid, _, world := governanceVerifyPublicationOwner([]*governanceCapture{one, two})
	if valid || fs.calls != 1 || world.failedCapture != two {
		t.Fatal("closed artifact lifecycle was memoized or later observer executed", fs.calls)
	}
}

func TestPublicationPlanStreamDoesNotBorrowRawOrCustomDecoder(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "utf16.ts")
	governanceWrite(t, root, "utf16.ts", string([]byte{0xff, 0xfe, 'a', 0, 'x'}))
	disk := newAuthoredCompilerDisk()
	world := &governanceBarrierReads{}
	raw := world.compilerDisk(disk).ReadFile
	if _, present := raw(path); !present {
		t.Fatal("raw decoder failure")
	}
	before := disk.readObservation(path, make([]byte, compilerObservationBufferBytes))
	for range 2 {
		if world.stream(disk, path, make([]byte, compilerObservationBufferBytes)) != before {
			t.Fatal("streaming decoder differs")
		}
	}
	if len(world.streams) != 1 || len(world.reads) != 1 {
		t.Fatal("separate raw/stream observer identities lost")
	}
	decoder := &barrierDecoderWitness{FS: disk.decoder}
	disk.decoder = decoder
	for range 2 {
		world.stream(disk, path, make([]byte, compilerObservationBufferBytes))
	}
	if decoder.calls != 2 {
		t.Fatal("custom decoder observer was coalesced", decoder.calls)
	}
}
