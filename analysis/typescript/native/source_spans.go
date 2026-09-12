package main

import (
	shimast "github.com/microsoft/typescript-go/shim/ast"
	shimscanner "github.com/microsoft/typescript-go/shim/scanner"
	"github.com/samchon/ttsc/packages/ttsc/driver"
)

func (x *extractor) coordinates(file *shimast.SourceFile) sourceCoordinates {
	if x.sourceCoordinates == nil {
		x.sourceCoordinates = make(map[*shimast.SourceFile]sourceCoordinates)
	}
	if coordinates, exists := x.sourceCoordinates[file]; exists {
		return coordinates
	}
	coordinates := indexSourceCoordinates(file.Text())
	x.sourceCoordinates[file] = coordinates
	return coordinates
}

func (x *extractor) sourceSpan(file *shimast.SourceFile, start, end int) sourceSpan {
	record := x.sources[file.FileName()]
	coordinates := x.coordinates(file)
	start, end = coordinates.utf16(start), coordinates.utf16(end)
	return sourceSpan{Source: record.Source, Revision: record.Revision, Start: start, End: max(start+1, end)}
}

func (x *extractor) lineAndColumn(file *shimast.SourceFile, start int) (int, int) {
	// Reuse the compiler's cached ECMAScript line map (including CR, LS and PS).
	lines := shimscanner.GetECMALineStarts(file)
	line := shimscanner.ComputeLineOfPosition(lines, start)
	coordinates := x.coordinates(file)
	return line + 1, coordinates.utf16(start) - coordinates.utf16(int(lines[line])) + 1
}

// The driver SourceFile accessor scans the whole program. Index diagnostic
// owners once, including declaration files used by public module observations.
func (x *extractor) diagnosticSource(program *driver.Program, path string) *shimast.SourceFile {
	if x.diagnosticSources == nil {
		x.diagnosticSources = make(map[string]*shimast.SourceFile)
		for _, file := range program.TSProgram.SourceFiles() {
			x.diagnosticSources[file.FileName()] = file
		}
	}
	return x.diagnosticSources[path]
}
