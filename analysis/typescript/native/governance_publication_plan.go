package main

import "sync"

// Immutable expected nodes are distinct from fresh operation cells. Only an
// explicit producer snapshot may retain this plan across generations; mutable
// builders and lease key sets never become shared expectation owners.
type governanceCompilerExpectedRead struct {
	path  string
	value compilerRawRead
}
type governanceCompilerExpectationPlan struct {
	reads        []governanceCompilerExpectedRead
	observations []compilerInputObservation
}

func (a *governanceCompilerReadAssertions) expectationPlan() *governanceCompilerExpectationPlan {
	if a.frozen != nil {
		return a.frozen
	}
	p := &governanceCompilerExpectationPlan{}
	for path, value := range a.barrierReads {
		p.reads = append(p.reads, governanceCompilerExpectedRead{path, value})
	}
	for key, value := range a.barrierObservations {
		p.observations = append(p.observations, compilerInputObservation{key, value})
	}
	return p
}
func (a *governanceCompilerReadAssertions) freezeOwned() *governanceCompilerReadAssertions {
	a.frozen = a.expectationPlan()
	return a
}
func (a *governanceCompilerReadAssertions) immutableSnapshot() *governanceCompilerReadAssertions {
	if a.frozen != nil {
		return a
	}
	out := a.clone()
	out.frozen = out.expectationPlan()
	return out
}
func (p *governanceCompilerExpectationPlan) verify(world *governanceTypeReplayWorld) bool {
	if value, seen := world.checkedPlans[p]; seen {
		return value
	}
	valid := p.verifyFresh(world)
	if world.checkedPlans == nil {
		world.checkedPlans = map[*governanceCompilerExpectationPlan]bool{}
	}
	world.checkedPlans[p] = valid
	return valid
}
func (p *governanceCompilerExpectationPlan) verifyFresh(world *governanceTypeReplayWorld) bool {
	world.preparePlan(p)
	for _, read := range p.reads {
		if world.reads[read.path] != read.value {
			return false
		}
	}
	for _, observation := range p.observations {
		if world.observations[observation.key] != observation.before {
			return false
		}
	}
	return true
}

// One joined worker owner per publication; individual gates still finish
// before a later assertion/lease/capture can run. Direct standalone observers
// use the same bounded operation algorithm with a temporary worker owner.
type governancePublicationJob struct {
	index int
	run   func(int, []byte)
	done  *sync.WaitGroup
}
type governancePublicationWorkers struct {
	jobs    chan governancePublicationJob
	workers sync.WaitGroup
}

func (p *governancePublicationWorkers) run(size int, run func(int, []byte)) {
	if size == 0 {
		return
	}
	if p.jobs == nil {
		p.jobs = make(chan governancePublicationJob)
		for range compilerObservationWorkers {
			p.workers.Add(1)
			go func() {
				defer p.workers.Done()
				var scratch []byte
				for job := range p.jobs {
					if scratch == nil {
						scratch = make([]byte, compilerObservationBufferBytes)
					}
					job.run(job.index, scratch)
					job.done.Done()
				}
			}()
		}
	}
	var done sync.WaitGroup
	done.Add(size)
	for index := 0; index < size; index++ {
		p.jobs <- governancePublicationJob{index, run, &done}
	}
	done.Wait()
}
func (p *governancePublicationWorkers) close() {
	if p.jobs != nil {
		close(p.jobs)
		p.workers.Wait()
	}
}
func (world *governanceBarrierReads) runBatch(size int, run func(int, []byte)) {
	if world.batch != nil {
		world.batch.run(size, run)
		return
	}
	p := &governancePublicationWorkers{}
	defer p.close()
	p.run(size, run)
}

type governanceBarrierStream struct {
	once  sync.Once
	value string
}

func (world *governanceBarrierReads) stream(disk *authoredCompilerDisk, path string, scratch []byte) string {
	// A changed delegate retains the original independent observer lane.
	if !governanceOriginalCompilerBarrierOwner(disk) {
		return disk.readObservation(path, scratch)
	}
	world.mu.Lock()
	if world.streams == nil {
		world.streams = map[string]*governanceBarrierStream{}
	}
	cell := world.streams[path]
	if cell == nil {
		cell = &governanceBarrierStream{}
		world.streams[path] = cell
	}
	world.mu.Unlock()
	// This observer keeps its own open/read/ignored-close and UTF16 second
	// decoder operation. It never borrows a raw ReadFile or generic digest.
	cell.once.Do(func() { cell.value = disk.readObservation(path, scratch) })
	return cell.value
}

type governancePublicationPlanCounts struct {
	captures         int
	compilerClosures int
}
type governancePublicationCompilerGate struct {
	expected *governanceCompilerExpectationPlan
	lease    *governanceTypeCacheLease
}
type governancePublicationCapturePlan struct {
	capture    *governanceCapture
	gates      []governancePublicationCompilerGate
	operations *governanceCapturedOperationPlan
}
type governancePublicationPlan struct {
	captures   []governancePublicationCapturePlan
	consistent bool
	counts     governancePublicationPlanCounts
}

func governanceCompilePublication(captures []*governanceCapture) *governancePublicationPlan {
	p := &governancePublicationPlan{consistent: true}
	expected := map[governancePublicationProjection]governancePublicationExpected{}
	add := func(key governancePublicationProjection, value governancePublicationExpected) {
		if old, seen := expected[key]; seen && old != value {
			p.consistent = false
		}
		expected[key] = value
	}
	for _, capture := range captures {
		part := governancePublicationCapturePlan{capture: capture}
		p.counts.captures++
		if capture == nil || capture.probeInconsistent || capture.compiler != nil && capture.compiler.inconsistent {
			p.consistent = false
			p.captures = append(p.captures, part)
			continue
		}
		part.operations = governanceCompileCapturedOperations(capture)
		for _, row := range part.operations.ordinary {
			add(governancePublicationProjection{contract: "governed", path: row.Path, kind: row.Kind}, governancePublicationExpected{text: row.Value})
		}
		for _, probe := range part.operations.probes {
			add(governancePublicationProjection{contract: "generic-original", path: probe.key.Path, kind: probe.key.Kind, follow: probe.key.FollowLinks}, governancePublicationExpected{text: probe.before})
		}
		original := capture.compiler != nil && governanceOriginalCompilerBarrierOwner(capture.compiler.disk)
		for _, row := range part.operations.inputs {
			if original {
				add(governancePublicationProjection{contract: "compiler-observed", path: row.key.path, compilerKind: row.key.kind}, governancePublicationExpected{text: row.before})
			}
		}
		appendGate := func(a *governanceCompilerReadAssertions, lease *governanceTypeCacheLease) {
			if a == nil || capture.compiler == nil {
				p.consistent = false
				return
			}
			if original && lease != nil && (lease.cache == nil || lease.cacheKeys == nil) {
				p.consistent = false
			}
			nodes := a.expectationPlan()
			part.gates = append(part.gates, governancePublicationCompilerGate{nodes, lease})
			p.counts.compilerClosures++
			if !original {
				return
			}
			for _, read := range nodes.reads {
				add(governancePublicationProjection{contract: "compiler-raw", path: read.path}, governancePublicationExpected{text: read.value.text, present: read.value.present})
			}
			for _, row := range nodes.observations {
				if row.key.kind == inputRead {
					p.consistent = false
					continue
				}
				add(governancePublicationProjection{contract: "compiler-observed", path: row.key.path, compilerKind: row.key.kind}, governancePublicationExpected{text: row.before})
			}
		}
		for _, a := range capture.compilerAssertions {
			appendGate(a, nil)
		}
		for _, lease := range capture.typeCacheLeases {
			if lease == nil {
				p.consistent = false
				continue
			}
			appendGate(&governanceCompilerReadAssertions{barrierReads: lease.barrierReads, barrierObservations: lease.barrierObservations}, lease)
		}
		p.captures = append(p.captures, part)
	}
	if !p.consistent {
		// The same contradiction policy as the original owner: no physical
		// winner is guessed, and every participating mutable lease retires.
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
	return p
}
func (p *governancePublicationPlan) verify(world *governanceBarrierReads) (bool, error) {
	for _, part := range p.captures {
		capture := part.capture
		// Artifact lifecycle remains mutable and is checked at EVERY original
		// gate under its own mutex. Neither l.closed nor verify() is memoized.
		if capture.ownedGenericArtifact != nil && !capture.ownedGenericArtifact.verify() {
			world.failedCapture = capture
			return false, nil
		}
		var replay *governanceTypeReplayWorld
		if len(part.gates) > 0 {
			replay = world.compilerReplay(capture.compiler.disk)
			replay.batch = world.batch
		}
		for _, gate := range part.gates {
			if gate.lease != nil && (gate.lease.cache == nil || gate.lease.cacheKeys == nil) {
				world.failedCapture = capture
				return false, nil
			}
			if !gate.expected.verify(replay) {
				if gate.lease != nil {
					for key := range gate.lease.cacheKeys {
						delete(gate.lease.cache.entries, key)
					}
				}
				world.failedCapture = capture
				return false, nil
			}
		}
		if !part.operations.verify(capture, world) {
			world.failedCapture = capture
			return false, nil
		}
	}
	return true, nil
}
