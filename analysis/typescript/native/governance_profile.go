package main

import "time"

// Inclusive intervals overlap deliberately: a family may demand a type cell,
// whose first read opens the native Program. Do not sum these into total time.
func (stats *governancePhaseCounters) phase(name string, started time.Time) {
	if stats.PhaseNanoseconds == nil {
		stats.PhaseNanoseconds = map[string]int64{}
	}
	stats.PhaseNanoseconds[name] += time.Since(started).Nanoseconds()
}

type governanceTypeRequest struct {
	Operation          string   `json:"operation"`
	Path               string   `json:"path"`
	Start              int      `json:"start"`
	End                int      `json:"end"`
	Expression         string   `json:"expression"`
	Known              bool     `json:"known"`
	Names              []string `json:"names,omitempty"`
	Kind               string   `json:"kind,omitempty"`
	ElapsedNanoseconds int64    `json:"elapsedNanoseconds"`
	ProgramNanoseconds int64    `json:"programNanoseconds"`
}
