package main

// This session owner retains the original compiler's syntax/resolution capsule
// and plain expected observations, never a checker or a semantic linter result.
// Reuse is speculative until the current generation's original final barrier.
import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	compiler "github.com/microsoft/typescript-go/shim/compiler"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"github.com/samchon/ttsc/packages/ttsc/driver"
	"path/filepath"
	"reflect"
)

type governanceGenerationBroker struct{ compiler.CompilerHost }
type governanceGenerationIdentityHost struct {
	compiler.CompilerHost
	source *ast.SourceFile
}

func (h governanceGenerationIdentityHost) GetSourceFile(opts ast.SourceFileParseOptions) *ast.SourceFile {
	if opts.Path == h.source.Path() {
		return h.source
	}
	return h.CompilerHost.GetSourceFile(opts)
}

type governanceProgramGeneration struct {
	root     string
	program  *compiler.Program
	broker   *governanceGenerationBroker
	receipts []*governanceCompilerReadAssertions
	syntax   *governanceRuntimeSyntaxOwner
}

func governanceGenerationReceiptCopy(before *governanceCompilerReadAssertions) *governanceCompilerReadAssertions {
	after := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
	for path, value := range before.barrierReads {
		after.barrierReads[path] = value
	}
	for key, value := range before.barrierObservations {
		after.barrierObservations[key] = value
	}
	return after
}

// Must be called only after the prior checker has been released and the original
// final publication barrier passed. The identity update creates a new lazy pool.
func governanceRetainProgramGeneration(project *governedProject, broker *governanceGenerationBroker) *governanceProgramGeneration {
	owner := project.typeOwner
	if owner.program == nil || broker == nil || project.typeRelease != nil {
		return nil
	}
	var identity *ast.SourceFile
	for _, source := range owner.program.TSProgram.GetSourceFiles() {
		if project.FilesByPath[governanceGenerationRelative(project.Root, source.FileName())] != nil {
			identity = source
			break
		}
	}
	if identity == nil {
		return nil
	}
	snapshot, reused := owner.program.TSProgram.UpdateProgram(identity.Path(), governanceGenerationIdentityHost{broker, identity}, nil)
	if !reused {
		return nil
	}
	fs := project.capture.compiler
	receipt := &governanceCompilerReadAssertions{barrierReads: map[string]compilerRawRead{}, barrierObservations: map[compilerInputKey]string{}}
	fs.mu.Lock()
	for key, cell := range fs.operations {
		if key.kind == inputRead && cell.value != nil {
			receipt.barrierReads[key.path] = cell.value.(compilerCapturedValue[compilerRawRead]).value
		}
	}
	for key, cell := range fs.operations {
		if !cell.observed {
			continue
		}
		value := cell.observation
		if _, raw := receipt.barrierReads[key.path]; key.kind == inputRead && raw {
			continue
		}
		receipt.barrierObservations[key] = value
	}
	fs.mu.Unlock()
	// Overlay source reads bypass compiler FS. Their byte authority must therefore
	// be retained explicitly, including every actual Program source, not just roots.
	for _, source := range snapshot.GetSourceFiles() {
		receipt.barrierReads[source.FileName()] = compilerRawRead{source.Text(), true}
	}
	result := &governanceProgramGeneration{root: project.Root, program: snapshot, broker: broker, receipts: []*governanceCompilerReadAssertions{receipt}, syntax: project.runtimeSyntax.retain(snapshot.GetSourceFiles())}
	for _, pending := range project.capture.compilerAssertions {
		result.receipts = append(result.receipts, pending.immutableSnapshot())
	}
	for _, lease := range project.capture.typeCacheLeases {
		result.receipts = append(result.receipts, lease.assertions())
	}
	// One sealed assertion capsule, not an accumulating chain of old generation
	// maps. Contradictory obligations decline retention instead of overwriting.
	merged, consistent := governanceUnionCompilerAssertions(result.receipts)
	if !consistent {
		return nil
	}
	result.receipts = []*governanceCompilerReadAssertions{merged.freezeOwned()}

	return result
}
func governanceGenerationOverlay(project *governedProject) (compiler.CompilerHost, vfs.FS) {
	overlay := driver.NewOverlayFS(project.capture.compiler)
	for _, file := range project.Files {
		overlay.Set(file.AbsolutePath, file.Text)
	}
	return driver.DefaultHost(project.Root, overlay), overlay
}

// Metadata remains a private speculative proposal. Old receipts are retained
// as pending expectations until the original final barrier; expected cached rows
// are never inserted into CURRENT actual operation cells.
func (generation *governanceProgramGeneration) propose(project *governedProject) (*compiler.Program, bool) {
	if generation == nil || generation.program == nil || generation.broker == nil || project.Root != generation.root {
		return nil, false
	}
	project.typeOwner.configuration()
	parsed := project.typeOwner.parsed
	if parsed == nil || !reflect.DeepEqual(parsed.FileNames(), generation.program.CommandLine().FileNames()) {
		return nil, false
	}
	// Original driver pins one checker. Normalize this same original owner setting
	// before comparing all option fields; no caller-defined option is suppressed.
	one := 1
	parsed.ParsedConfig.CompilerOptions.Checkers = &one
	if !reflect.DeepEqual(parsed.CompilerOptions(), generation.program.Options()) {
		return nil, false
	}
	var changed *ast.SourceFile
	for _, source := range generation.program.GetSourceFiles() {
		if file := project.FilesByPath[governanceGenerationRelative(project.Root, source.FileName())]; file != nil && file.Text != source.Text() {
			if changed != nil {
				return nil, false
			}
			changed = source
		}
	}
	if changed == nil {
		return nil, false
	}
	pending := make([]*governanceCompilerReadAssertions, 0, len(generation.receipts))
	for _, old := range generation.receipts {
		receipt := governanceGenerationReceiptCopy(old)
		// Original UpdateProgram's one replaced source is the only admitted change.
		// Timestamp/size and bytes for it are supplied by the CURRENT source capture.
		delete(receipt.barrierReads, changed.FileName())
		delete(receipt.barrierObservations, compilerInputKey{changed.FileName(), inputRead})
		delete(receipt.barrierObservations, compilerInputKey{changed.FileName(), inputMetadata})
		pending = append(pending, receipt.freezeOwned())
	}
	host, _ := governanceGenerationOverlay(project)
	generation.broker.CompilerHost = host
	prior := generation.program
	// Borrow once. Any resolver-cache writes made by this proposal acquire CURRENT
	// receipts. Abandonment cannot reuse them under the predecessor receipt vector.
	generation.program = nil
	syntax := generation.syntax
	generation.syntax = nil
	updated, reused := prior.UpdateProgram(changed.Path(), generation.broker, nil)
	if !reused {
		return nil, false
	} // callers rebuild from CURRENT parsed configuration
	project.runtimeSyntax = syntax.retain(updated.GetSourceFiles())
	project.capture.compilerAssertions = append(project.capture.compilerAssertions, pending...)
	return updated, true
}

func governanceGenerationRelative(root, path string) string {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	return filepath.ToSlash(relative)
}

// A type cell computed from speculative old metadata is also private. If this
// draft is rejected or abandoned, its descendants must not survive as ready
// cross-generation type cells. Successful seal clears borrowedGeneration first.
func (session *governanceSession) retireProgramProposal(project *governedProject) {
	if project.borrowedGeneration == nil {
		return
	}
	if project.typeDemandCache != nil {
		*project.typeDemandCache = governanceTypeDemandCache{}
	}
	project.runtimeSyntax = nil
	project.borrowedGeneration = nil
	session.programGeneration = nil
}
