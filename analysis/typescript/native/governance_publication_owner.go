package main

import (
	"sync"
)

// These cells contain only fresh original results. Expected obligations cannot
// initialize them. Operation kind and exact logical path remain distinct;
// metadata/existence/enumeration/streaming reads are never inferred from bytes.
type governanceFreshCompilerOperation struct {
	once        sync.Once
	read        compilerRawRead
	observation string
	physical    any
}

func (world *governanceTypeReplayWorld) actualCell(key compilerInputKey) *governanceFreshCompilerOperation {
	world.mu.Lock()
	defer world.mu.Unlock()
	if world.cells == nil {
		world.cells = map[compilerInputKey]*governanceFreshCompilerOperation{}
	}
	cell := world.cells[key]
	if cell == nil {
		cell = &governanceFreshCompilerOperation{}
		world.cells[key] = cell
	}
	return cell
}
func (world *governanceTypeReplayWorld) readActual(path string) compilerRawRead {
	cell := world.actualCell(compilerInputKey{path, inputRead})
	cell.once.Do(func() {
		text, present := world.disk.ReadFile(path)
		cell.read = compilerRawRead{text, present}
		cell.physical = cell.read
	})
	return cell.read
}
func (world *governanceTypeReplayWorld) observeActual(key compilerInputKey) string {
	// Authored raw replay and the streaming observed-read verifier are separate
	// contracts. The latter never enters this method.
	if key.kind == inputRead {
		panic("streaming read cannot enter raw compiler replay cell")
	}
	cell := world.actualCell(key)
	cell.once.Do(func() {
		switch key.kind {
		case inputFile:
			value := world.disk.FileExists(key.path)
			cell.physical = value
			cell.observation = inputBool(value)
		case inputDirectory:
			value := world.disk.DirectoryExists(key.path)
			cell.physical = value
			cell.observation = inputBool(value)
		case inputEnumeration:
			value := copyCompilerEntries(world.disk.GetAccessibleEntries(key.path))
			cell.physical = value
			cell.observation = inputEntries(value)
		case inputRealpath:
			value := world.disk.Realpath(key.path)
			cell.physical = value
			cell.observation = value
		case inputMetadata:
			value := world.disk.Stat(key.path)
			cell.physical = value
			cell.observation = inputStat(value)
		}
	})
	return cell.observation
}

type governancePublicationProjection struct {
	contract     string
	path         string
	kind         string
	compilerKind compilerInputKind
	follow       bool
}
type governancePublicationExpected struct {
	text    string
	present bool
}

// A publication first closes its expected obligation set. Contradictory
// projections of the same ORIGINAL operation can never describe one world.
// Reject them before any fresh I/O; retire affected mutable leases, never alter
// immutable expected receipts. The ordered original verification below keeps
// artifact/error/lease provenance. No proposal becomes an actual observation.
func governancePublicationConsistent(captures []*governanceCapture) bool {
	expected := map[governancePublicationProjection]governancePublicationExpected{}
	valid := true
	add := func(key governancePublicationProjection, value governancePublicationExpected) {
		if before, seen := expected[key]; seen && before != value {
			valid = false
		}
		expected[key] = value
	}
	for _, capture := range captures {
		if capture == nil || capture.probeInconsistent || capture.compiler != nil && capture.compiler.inconsistent {
			valid = false
			continue
		}
		for _, row := range capture.observations {
			add(governancePublicationProjection{contract: "governed", path: row.Path, kind: row.Kind}, governancePublicationExpected{text: row.Value})
		}
		for key, value := range capture.probeObservations {
			add(governancePublicationProjection{contract: "generic-original", path: key.Path, kind: key.Kind, follow: key.FollowLinks}, governancePublicationExpected{text: value})
		}
		if capture.compiler == nil {
			if len(capture.compilerAssertions)+len(capture.typeCacheLeases) > 0 {
				valid = false
			}
			continue
		}
		if !governanceOriginalCompilerBarrierOwner(capture.compiler.disk) {
			continue
		}
		for key, value := range capture.compiler.observed {
			// inputRead uses the original streaming/decoder observer; keep it separate.
			add(governancePublicationProjection{contract: "compiler-observed", path: key.path, compilerKind: key.kind}, governancePublicationExpected{text: value})
		}
		check := func(reads map[string]compilerRawRead, observations map[compilerInputKey]string) {
			for path, value := range reads {
				add(governancePublicationProjection{contract: "compiler-raw", path: path}, governancePublicationExpected{text: value.text, present: value.present})
			}
			for key, value := range observations {
				if key.kind == inputRead {
					valid = false
					continue
				}
				add(governancePublicationProjection{contract: "compiler-observed", path: key.path, compilerKind: key.kind}, governancePublicationExpected{text: value})
			}
		}
		for _, assertions := range capture.compilerAssertions {
			if assertions == nil {
				valid = false
				continue
			}
			check(assertions.barrierReads, assertions.barrierObservations)
		}
		for _, lease := range capture.typeCacheLeases {
			if lease == nil || lease.cache == nil || lease.cacheKeys == nil {
				valid = false
				continue
			}
			check(lease.barrierReads, lease.barrierObservations)
		}
	}
	if !valid {
		// A contradiction identifies no particular physical winner. Retire every
		// participating mutable lease rather than guessing which old receipt is current.
		for _, capture := range captures {
			if capture != nil {
				for _, lease := range capture.typeCacheLeases {
					if lease != nil && lease.cache != nil {
						for key := range lease.cacheKeys {
							delete(lease.cache.entries, key)
						}
					}
				}
			}
		}
	}
	return valid
}
func governanceVerifyPublication(captures []*governanceCapture) (bool, error) {
	valid, err, _ := governanceVerifyPublicationOwner(captures)
	return valid, err
}
func governanceVerifyPublicationOwner(captures []*governanceCapture) (bool, error, *governanceBarrierReads) {
	if !governancePublicationConsistent(captures) {
		return false, nil, nil
	}
	world := &governanceBarrierReads{}
	for _, capture := range captures {
		valid, err := capture.verifyWithin(world)
		if err != nil || !valid {
			world.failedCapture = capture
			return valid, err, world
		}
	}
	return true, nil, world
}

// Diagnostic counts name ORIGINAL adapter invocations, not OS syscalls. An
// enumeration may internally follow symlinks; a UTF16 read performs its own
// separate decoder operation. Those operations are not removed by this table.
func (world *governanceBarrierReads) compilerOperationCounts() map[string]int {
	counts := map[string]int{}
	if world == nil || world.compilerWorld == nil {
		return counts
	}
	world.compilerWorld.mu.Lock()
	defer world.compilerWorld.mu.Unlock()
	names := []string{"authored-raw-read", "file-exists", "directory-exists", "accessible-entries", "realpath", "metadata"}
	for key := range world.compilerWorld.cells {
		if int(key.kind) < len(names) {
			counts[names[key.kind]]++
		}
	}
	return counts
}

func governanceOriginalCompilerSchedule(captures []*governanceCapture) []map[string]int {
	rows := []map[string]int{}
	for _, capture := range captures {
		row := map[string]int{}
		if capture.compiler != nil && governanceOriginalCompilerBarrierOwner(capture.compiler.disk) {
			raw := map[string]bool{}
			operations := map[compilerInputKey]bool{}
			add := func(reads map[string]compilerRawRead, observations map[compilerInputKey]string) {
				for path := range reads {
					raw[path] = true
				}
				for key := range observations {
					if key.kind != inputRead {
						operations[key] = true
					}
				}
			}
			for _, part := range capture.compilerAssertions {
				add(part.barrierReads, part.barrierObservations)
			}
			for _, part := range capture.typeCacheLeases {
				add(part.barrierReads, part.barrierObservations)
			}
			row["raw-replay-methods"] = len(raw)
			row["nonread-replay-methods"] = len(operations)
			for key := range capture.compiler.observed {
				if key.kind == inputRead {
					row["separate-streaming-observations"]++
				} else {
					row["nonread-observed-methods"]++
				}
			}
		}
		rows = append(rows, row)
	}
	return rows
}
