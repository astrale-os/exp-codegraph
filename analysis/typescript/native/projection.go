package main

import "sort"

// projectionPlan separates the requested semantic product from the private
// compiler work needed to produce it. A prerequisite may execute without
// publishing its own namespace, but an unrelated projector never runs merely
// because another capability was requested.
type projectionPlan struct {
	project     bool
	diagnostics bool
	modules     bool
	sources     bool
	symbols     bool
	occurrences bool
	bodies      bool
}

func planProjections(capabilities []string) projectionPlan {
	wanted := make(map[string]bool, len(capabilities))
	for _, capability := range capabilities {
		wanted[capability] = true
	}
	return projectionPlan{
		project:     wanted[projectNamespace],
		diagnostics: wanted[diagnosticNamespace],
		modules:     wanted[moduleNamespace],
		sources:     wanted[sourceNamespace],
		symbols:     wanted[symbolNamespace],
		occurrences: wanted[occurrenceNamespace],
		bodies:      wanted[bodyNamespace],
	}
}

func (p projectionPlan) sourceOwned() bool {
	return p.sources || p.symbols || p.occurrences || p.bodies
}

func (p projectionPlan) enables(capability string) bool {
	switch capability {
	case projectNamespace:
		return p.project
	case diagnosticNamespace:
		return p.diagnostics
	case moduleNamespace:
		return p.modules
	case sourceNamespace:
		return p.sources
	case symbolNamespace:
		return p.symbols
	case occurrenceNamespace:
		return p.occurrences
	case bodyNamespace:
		return p.bodies
	default:
		return false
	}
}

func (p projectionPlan) capabilities() []string {
	var capabilities []string
	for _, capability := range supportedCapabilities {
		if p.enables(capability) {
			capabilities = append(capabilities, capability)
		}
	}
	sort.Strings(capabilities)
	return capabilities
}

func (p projectionPlan) stages() []string {
	var stages []string
	if p.project {
		stages = append(stages, "project")
	}
	if p.diagnostics {
		stages = append(stages, "diagnostics")
	}
	if p.modules {
		stages = append(stages, "modules")
	}
	if p.sources {
		stages = append(stages, "sources")
	}
	if p.symbols {
		stages = append(stages, "symbol-discovery", "symbols")
	}
	if p.occurrences {
		stages = append(stages, "occurrences")
	}
	if p.bodies {
		stages = append(stages, "bodies")
	}
	sort.Strings(stages)
	return stages
}
