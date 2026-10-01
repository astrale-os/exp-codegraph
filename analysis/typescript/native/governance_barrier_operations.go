package main

import (
	"os"
	"path/filepath"
	"sync"
)

// The seal is a conjunction of independent original-operation guards. Each
// worker owns its result slots and streaming scratch; none touches the captured
// baseline, a compiler/checker, or a reusable receipt. Raw-read projections join
// only the fresh os.ReadFile cell of this barrier. Decoder, streaming digest,
// generic close-checked digest, and custom filesystem operations stay distinct.
func (c *governanceCapture) verifyCapturedOperations(reads *governanceBarrierReads) bool {
	if c.probeInconsistent || c.compiler != nil && c.compiler.inconsistent {
		return false
	}
	probes := make([]governanceProbeKey, 0, len(c.probeObservations))
	for key := range c.probeObservations {
		probes = append(probes, key)
	}
	ordinary := make([]governanceObservation, 0, len(c.observations))
	for _, row := range c.observations {
		ordinary = append(ordinary, row)
	}
	inputs := []compilerInputObservation{}
	var disk *authoredCompilerDisk
	if c.compiler != nil {
		disk, _ = c.compiler.disk.(*authoredCompilerDisk)
		if disk != nil {
			for key, before := range c.compiler.observed {
				inputs = append(inputs, compilerInputObservation{key: key, before: before})
			}
		}
	}
	probeEnd := len(probes)
	ordinaryEnd := probeEnd + len(ordinary)
	results := make([]bool, ordinaryEnd+len(inputs))
	jobs := make(chan int)
	var workers sync.WaitGroup
	for worker := 0; worker < min(compilerObservationWorkers, len(results)); worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			var buffer []byte
			for index := range jobs {
				switch {
				case index < probeEnd:
					key := probes[index]
					results[index] = reads.probe(key) == c.probeObservations[key]
				case index < ordinaryEnd:
					row := ordinary[index-probeEnd]
					value, ok := governanceBarrierObservation(row, reads)
					results[index] = ok && value == row.Value
				default:
					input := inputs[index-ordinaryEnd]
					var value string
					if input.key.kind == inputRead {
						if buffer == nil {
							buffer = make([]byte, compilerObservationBufferBytes)
						}
						value = disk.readObservation(input.key.path, buffer)
					} else {
						if governanceOriginalCompilerBarrierOwner(disk) {
							value = reads.compilerReplay(disk).observeActual(input.key)
						} else {
							value = observeCompilerInput(disk, input.key)
						}
					}
					results[index] = value == input.before
				}
			}
		}()
	}
	for index := range results {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	for _, valid := range results {
		if !valid {
			return false
		}
	}
	if c.compiler != nil && disk == nil {
		// The actual original custom filesystem retains its sequential observer.
		inputs = make([]compilerInputObservation, 0, len(c.compiler.observed))
		for key, before := range c.compiler.observed {
			inputs = append(inputs, compilerInputObservation{key: key, before: before})
		}
		for index, value := range c.compiler.observe(inputs) {
			if value != inputs[index].before {
				return false
			}
		}
	}
	return true
}

func governanceBarrierObservation(row governanceObservation, reads *governanceBarrierReads) (string, bool) {
	var value string
	var err error
	switch row.Kind {
	case "lstat":
		value, err = governanceLstatValue(row.Path)
	case "directory":
		value, err = governanceDirectoryValue(row.Path)
	case "read":
		var bytes []byte
		bytes, err = reads.read(row.Path)
		if os.IsNotExist(err) {
			err = nil
			value = "absent"
		} else if err == nil {
			value = "present:" + governanceHash(bytes)
		}
	case "read-error":
		// Preserve this later-added operation independently of shared raw reads.
		_, failure := os.ReadFile(row.Path)
		if failure == nil {
			value = "known"
		} else {
			value = stableJSON(governanceProbeFailure(failure))
		}
	case "realpath":
		value, err = filepath.EvalSymlinks(row.Path)
	}
	return value, err == nil
}
