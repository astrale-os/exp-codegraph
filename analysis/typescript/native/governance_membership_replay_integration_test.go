package main

import (
	"testing"
	"time"
)

// A projected membership receipt may replay after a regular file's timestamp
// changes; its current publication and retained expected capture still guard
// the full physical Stat. Shared prefix ownership must preserve both laws.
func TestSource60SharedRegularityPrefixKeepsFullPhysicalPublicationGuard(t *testing.T) {
	root := t.TempDir()
	info := regularityTestInfo{mode: 0600, size: 4, modified: time.Unix(1, 0)}
	disk := &regularityTestFS{FS: newAuthoredCompilerDisk(), info: info, exists: true}
	old := regularityCapture(disk).compiler
	if old.regularity("source") != "regular" {
		t.Fatal("original physical membership absent")
	}
	base := &governanceTypeReceiptBase{root: root, sources: map[string]governanceTypeSource{}}
	first := &governanceTypeReceipt{base: base, demanded: "first", prefix: source59Prefix(old)}
	if !old.FileExists("source") {
		t.Fatal("original file membership absent")
	}
	second := &governanceTypeReceipt{base: base, demanded: "second", prefix: source59Prefix(old)}
	if len(first.prefix.observations) != 1 || len(second.prefix.observations) != 2 {
		t.Fatal("original regularity frontiers changed")
	}
	disk.info = regularityTestInfo{mode: 0600, size: 4, modified: time.Unix(2, 0)}
	disk.stats.Store(0)
	capture := regularityCapture(disk)
	project := &governedProject{Root: root, capture: capture}
	if capture.compiler.regularity("source") != "regular" || !capture.compiler.FileExists("source") {
		t.Fatal("current projected membership absent")
	}
	cache := &governanceTypeDemandCache{}
	state := source59Accept(t, project, cache, governanceTypeDemandKey{path: "first"}, first)
	additions, same, valid := second.replayForCache(project, cache)
	if !valid || same != state || len(additions.barrierReads) != 0 || len(additions.barrierObservations) != 1 {
		t.Fatal("shared projected frontier did not transfer only its delta")
	}
	capture.acceptTypeReplay(cache, governanceTypeDemandKey{path: "second"}, additions)
	same.accept(second.prefix)
	if disk.stats.Load() != 1 {
		t.Fatal("same capture duplicated physical Stat")
	}
	metadata := compilerInputKey{"source", inputMetadata}
	if _, invented := compilerTestObservations(capture.compiler)[metadata]; invented {
		t.Fatal("shared projected receipt consumed a general Stat")
	}
	if _, invented := capture.typeCacheLeases[0].barrierObservations[metadata]; invented {
		t.Fatal("shared prefix promoted physical Stat into semantic receipt")
	}
	expected := governanceExpectedCapture(capture)
	if compilerTestObservations(expected.compiler)[metadata] != inputStat(disk.info) || expected.canonicalCertificate() != capture.canonicalCertificate() {
		t.Fatal("combined expected capture lost full current physical Stat")
	}
	if _, valid := source59OriginalReplay(second, project); !valid {
		t.Fatal("original scalar replay disagrees with combined projected replay")
	}
	if valid, err := expected.Verify(); err != nil || !valid {
		t.Fatalf("unchanged combined capture refused: %t %v", valid, err)
	}
	disk.info = regularityTestInfo{mode: 0600, size: 4, modified: time.Unix(3, 0)}
	if valid, err := expected.Verify(); err != nil || valid {
		t.Fatalf("combined retained publication lost full physical tuple: %t %v", valid, err)
	}
}
