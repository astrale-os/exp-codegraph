package main

import (
	"os"
	"path/filepath"
)

// The seal is a conjunction of independent original-operation guards. Each
// worker owns its result slots and streaming scratch; none touches the captured
// baseline, a compiler/checker, or a reusable receipt. Raw-read projections join
// only the fresh os.ReadFile cell of this barrier. Decoder, streaming digest,
// generic close-checked digest, and custom filesystem operations stay distinct.
type governanceProbeExpected struct {
	key    governanceProbeKey
	before string
}
type governanceCapturedOperationPlan struct {
	probes   []governanceProbeExpected
	ordinary []governanceObservation
	inputs   []compilerInputObservation
	disk     *authoredCompilerDisk
}

func governanceCompileCapturedOperations(c *governanceCapture) *governanceCapturedOperationPlan {
	p := &governanceCapturedOperationPlan{}
	for key, before := range c.probeObservations {
		p.probes = append(p.probes, governanceProbeExpected{key, before})
	}
	for _, row := range c.observations {
		p.ordinary = append(p.ordinary, row)
	}
	if c.compiler != nil {
		p.disk, _ = c.compiler.disk.(*authoredCompilerDisk)
		for key, before := range c.compiler.observed {
			p.inputs = append(p.inputs, compilerInputObservation{key, before})
		}
	}
	return p
}
func (c *governanceCapture) verifyCapturedOperations(reads *governanceBarrierReads) bool {
	if c.probeInconsistent || c.compiler != nil && c.compiler.inconsistent {
		return false
	}
	return governanceCompileCapturedOperations(c).verify(c, reads)
}
func (p *governanceCapturedOperationPlan) verify(c *governanceCapture, reads *governanceBarrierReads) bool {
	probes, ordinary, inputs, disk := p.probes, p.ordinary, p.inputs, p.disk
	// Arbitrary custom FS observed inputs keep their original separate observer.
	if disk == nil {
		inputs = nil
	}
	probeEnd := len(probes)
	ordinaryEnd := probeEnd + len(ordinary)
	results := make([]bool, ordinaryEnd+len(inputs))
	reads.runBatch(len(results), func(index int, buffer []byte) {
		switch {
		case index < probeEnd:
			probe := probes[index]
			results[index] = reads.probe(probe.key) == probe.before
		case index < ordinaryEnd:
			row := ordinary[index-probeEnd]
			value, ok := governanceBarrierObservation(row, reads)
			results[index] = ok && value == row.Value
		default:
			input := inputs[index-ordinaryEnd]
			var value string
			if input.key.kind == inputRead {
				value = reads.stream(disk, input.key.path, buffer)
			} else if governanceOriginalCompilerBarrierOwner(disk) {
				value = reads.compilerReplay(disk).observeActual(input.key)
			} else {
				value = observeCompilerInput(disk, input.key)
			}
			results[index] = value == input.before
		}
	})
	for _, valid := range results {
		if !valid {
			return false
		}
	}
	if c.compiler != nil && disk == nil {
		// The actual original custom filesystem retains its sequential observer.
		inputs = p.inputs
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
