package main

import (
	"os"
	"sync"
	"unsafe"

	shimbundled "github.com/microsoft/typescript-go/shim/bundled"
	shimvfs "github.com/microsoft/typescript-go/shim/vfs"
)

// A barrier owns fresh results, never the proposal's observations. Only callers
// of the identical os.ReadFile operation share this cell; streaming reads,
// metadata, custom filesystems and decoder reads retain their own operations.
type governanceBarrierRead struct {
	once  sync.Once
	bytes []byte
	err   error
}

type governanceBarrierReads struct {
	mu    sync.Mutex
	reads map[string]*governanceBarrierRead
}

func (world *governanceBarrierReads) read(path string) ([]byte, error) {
	world.mu.Lock()
	if world.reads == nil {
		world.reads = map[string]*governanceBarrierRead{}
	}
	cell := world.reads[path]
	if cell == nil {
		cell = &governanceBarrierRead{}
		world.reads[path] = cell
	}
	world.mu.Unlock()
	cell.once.Do(func() { cell.bytes, cell.err = os.ReadFile(path) })
	return cell.bytes, cell.err
}

type governanceBarrierCompilerRead struct {
	once  sync.Once
	value compilerRawRead
}

type governanceBarrierCompilerDisk struct {
	shimvfs.FS
	owner *authoredCompilerDisk
	world *governanceBarrierReads
	mu    sync.Mutex
	reads map[string]*governanceBarrierCompilerRead
}

func (disk *governanceBarrierCompilerDisk) ReadFile(path string) (string, bool) {
	if shimbundled.IsBundled(path) {
		return disk.FS.ReadFile(path)
	}
	disk.mu.Lock()
	cell := disk.reads[path]
	if cell == nil {
		cell = &governanceBarrierCompilerRead{}
		disk.reads[path] = cell
	}
	disk.mu.Unlock()
	cell.once.Do(func() {
		bytes, err := disk.world.read(path)
		if err != nil {
			return
		}
		if len(bytes) >= 2 && (bytes[0] == 0xff && bytes[1] == 0xfe || bytes[0] == 0xfe && bytes[1] == 0xff) {
			// Original authored semantics execute the decoder as a SECOND read.
			// Its result is not inferred from the first operation's byte buffer.
			cell.value.text, cell.value.present = disk.owner.decoder.ReadFile(path)
		} else {
			// All projections retain this privately owned immutable buffer. Match
			// the authored reader's existing zero-copy string boundary.
			cell.value = compilerRawRead{unsafe.String(unsafe.SliceData(bytes), len(bytes)), true}
		}
	})
	return cell.value.text, cell.value.present
}

func (world *governanceBarrierReads) compilerDisk(disk shimvfs.FS) shimvfs.FS {
	owner, owned := disk.(*authoredCompilerDisk)
	if !owned {
		return disk
	}
	return &governanceBarrierCompilerDisk{FS: disk, owner: owner, world: world, reads: map[string]*governanceBarrierCompilerRead{}}
}
