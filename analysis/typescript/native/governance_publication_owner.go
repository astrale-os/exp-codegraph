package main

import (
	"sync"

	shimvfs "github.com/microsoft/typescript-go/shim/vfs"
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
		case inputRegularity:
			metadata := compilerInputKey{key.path, inputMetadata}
			world.observeActual(metadata)
			// The metadata cell may contain an actual nil Stat result.
			var value shimvfs.FileInfo
			if physical := world.actualCell(metadata).physical; physical != nil {
				value = physical.(shimvfs.FileInfo)
			}
			cell.physical = value
			cell.observation = inputRegularityValue(value)
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

func governanceVerifyPublication(captures []*governanceCapture) (bool, error) {
	valid, err, _ := governanceVerifyPublicationOwner(captures)
	return valid, err
}
func governanceVerifyPublicationOwner(captures []*governanceCapture) (bool, error, *governanceBarrierReads) {
	plan := governanceCompilePublication(captures)
	if !plan.consistent {
		return false, nil, nil
	}
	world := &governanceBarrierReads{batch: &governancePublicationWorkers{}, planCounts: plan.counts}
	defer world.batch.close()
	valid, err := plan.verify(world)
	return valid, err, world
}

// Diagnostic counts name original operation cells, not OS syscalls. Metadata
// counts actual Stat calls; regularity counts a derived view of that SAME cell.
// Adding those two counters would overcount physical Stat invocations. An
// enumeration may internally follow symlinks; a UTF16 read performs its own
// separate decoder operation. Those operations are not removed by this table.
func (world *governanceBarrierReads) compilerOperationCounts() map[string]int {
	counts := map[string]int{}
	if world == nil || world.compilerWorld == nil {
		return counts
	}
	world.compilerWorld.mu.Lock()
	defer world.compilerWorld.mu.Unlock()
	names := []string{"authored-raw-read", "file-exists", "directory-exists", "accessible-entries", "realpath", "metadata", "regularity"}
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
			for key, cell := range capture.compiler.operations {
				if !cell.observed {
					continue
				}
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
