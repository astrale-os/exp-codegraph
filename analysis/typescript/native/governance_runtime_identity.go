package main

import (
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

type governanceRuntimeIdentity struct {
	Project            *governedProject
	TypeOwner          *governanceTypeAuthority
	Universe           string
	CallSources        map[string]*governanceRuntimeCallSource
	CallIdentityHashes int
	CallSeekNodes      int
	Calls              map[*ast.Node]string
	CallSpans          map[string]sourceSpan
	OwnedProgramFiles  map[string]*ast.SourceFile
	Complete           bool
	Reason             string
}

func governancePortableUniversePath(project *governedProject, path string) (string, error) {
	path = filepath.Clean(path)
	if library := typescriptLibraryFile(path); library != "" {
		return "platform:typescript/" + library, nil
	}
	relative, err := filepath.Rel(project.Root, path)
	if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		logical := filepath.ToSlash(relative)
		if !strings.Contains(logical, "/node_modules/") && !strings.HasPrefix(logical, "node_modules/") {
			if logical == "" {
				return ".", nil
			}
			return logical, nil
		}
	}
	directory := filepath.Dir(path)
	inside := pathContains(project.Root, path)
	for {
		if inside && !pathContains(project.Root, directory) {
			break
		}
		manifest := project.capture.packageManifestProduct(filepath.Join(directory, "package.json"))
		if manifest.readError == nil {
			if manifest.parseError != nil {
				break
			}
			if manifest.name != "" {
				coordinate := "package:" + manifest.name
				if subpath, err := filepath.Rel(directory, path); err == nil && subpath != "." {
					coordinate += "/" + filepath.ToSlash(subpath)
				}
				return coordinate, nil
			}
		} else if !os.IsNotExist(manifest.readError) {
			break
		}
		if inside && directory == project.Root {
			break
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return "", fmt.Errorf("runtime universe input has no portable coordinate: %s", path)
}
func governanceCapturedUniverse(owner *governanceTypeAuthority) (string, error) {
	universe, _, err := governanceCapturedUniverseConfiguration(owner)
	return universe, err
}
func governanceCapturedUniverseConfiguration(owner *governanceTypeAuthority) (string, []map[string]any, error) {
	owner.open()
	if owner.program == nil {
		return "", nil, fmt.Errorf("native runtime Program authority unavailable")
	}
	project := owner.project
	configs, err := parsedProjectConfigs(owner.program)
	if err != nil {
		return "", nil, err
	}
	paths := []string{}
	projects := []string{}
	for _, parsed := range configs {
		paths = append(paths, parsed.ConfigName())
		paths = append(paths, parsed.ExtendedSourceFiles()...)
		logical, err := governancePortableUniversePath(project, parsed.ConfigName())
		if err != nil {
			return "", nil, err
		}
		projects = append(projects, logical)
	}
	paths = sortedUnique(paths)
	configuration := []map[string]any{}
	for _, path := range paths {
		if path == "" {
			continue
		}
		info, err := project.capture.lstat(path)
		if err == nil && info.IsDir() {
			path = filepath.Join(path, "tsconfig.json")
		}
		content, err := project.capture.read(path)
		if err != nil {
			return "", nil, err
		}
		logical, err := governancePortableUniversePath(project, path)
		if err != nil {
			return "", nil, err
		}
		configuration = append(configuration, map[string]any{"path": logical, "digest": hashText(string(content))})
	}
	sort.Slice(configuration, func(i, j int) bool { return configuration[i]["path"].(string) < configuration[j]["path"].(string) })
	rootConfig, err := governancePortableUniversePath(project, owner.program.ParsedConfig.ConfigName())
	if err != nil {
		return "", nil, err
	}
	return deriveID("project-universe", "astrale.analysis.typescript.universe.v2", map[string]any{"configuration": configuration, "project": rootConfig, "projects": sortedUnique(projects), "producer": map[string]any{"name": "ttsc-typescript-go", "version": producerVersion, "ttsc": ttscVersion, "typescriptGo": core.Version(), "protocol": protocolVersion}, "platform": map[string]any{"os": runtime.GOOS, "architecture": runtime.GOARCH}}), configuration, nil
}
func governanceRuntimeProgramOwned(root, path string) (string, bool) {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	relative = filepath.ToSlash(relative)
	if strings.Contains(relative, "/node_modules/") || strings.HasPrefix(relative, "node_modules/") || strings.HasSuffix(relative, ".d.ts") || strings.HasSuffix(relative, ".d.mts") || strings.HasSuffix(relative, ".d.cts") {
		return "", false
	}
	return relative, true
}
func governanceBuildRuntimeIdentity(project *governedProject) *governanceRuntimeIdentity {
	out := &governanceRuntimeIdentity{Project: project, CallSources: map[string]*governanceRuntimeCallSource{}, Calls: map[*ast.Node]string{}, CallSpans: map[string]sourceSpan{}, OwnedProgramFiles: map[string]*ast.SourceFile{}}
	owner := project.typeOwner
	if owner == nil {
		out.Reason = "runtime demanded compiler owner unavailable"
		return out
	}
	out.TypeOwner = owner
	universe, err := governanceCapturedUniverse(owner)
	if err != nil {
		out.Reason = err.Error()
		return out
	}
	if filepath.Clean(owner.program.ParsedConfig.ConfigName()) != filepath.Join(project.Root, "tsconfig.json") {
		out.Reason = "runtime explicit configuration differs from demanded type ancestor configuration"
		return out
	}
	out.Universe = universe
	for _, source := range owner.program.TSProgram.GetSourceFiles() {
		logical, owned := governanceRuntimeProgramOwned(project.Root, source.FileName())
		if !owned {
			continue
		}
		out.OwnedProgramFiles[logical] = source

	}
	out.Complete = true
	return out
}
func (identity *governanceRuntimeIdentity) CallIdentity(file *sourcepolicy.File, node *ast.Node) (string, bool) {
	if !identity.Complete || file == nil || node == nil || node.Kind != ast.KindCallExpression {
		return "", false
	}
	captured := identity.Project.FilesByPath[file.Path]
	source := identity.OwnedProgramFiles[file.Path]
	if captured == nil || source == nil || captured.Text != source.Text() {
		return "", false
	}
	start := scanner.SkipTrivia(captured.Text, node.Pos())
	key := fmt.Sprintf("%s:%d:%d", file.Path, start, node.End())
	if span, ok := identity.CallSpans[key]; ok {
		identity.CallIdentityHashes++
		workspace := occurrenceIdentityWorkspace{}
		return workspace.identify(identity.Universe, span, "body-call"), true
	}
	// Authored and Program ASTs can be different original parser products. Keep
	// the prior exact-span membership requirement, seeking only the demanded
	// original call rather than hashing every call in every source beforehand.
	var matched *ast.Node
	walk(source.AsNode(), func(candidate *ast.Node) bool {
		identity.CallSeekNodes++
		if matched != nil {
			return false
		}
		if candidate.Kind == ast.KindCallExpression && candidate.End() == node.End() && scanner.SkipTrivia(source.Text(), candidate.Pos()) == start {
			matched = candidate
			return false
		}
		return candidate.Pos() <= node.End() && candidate.End() >= start
	})
	if matched == nil {
		return "", false
	}
	return identity.nativeCallIdentity(file.Path, matched)
}

type governanceRuntimeCallSource struct {
	SourceID    string
	Revision    string
	Coordinates sourceCoordinates
}

func (identity *governanceRuntimeIdentity) callSource(path string) *governanceRuntimeCallSource {
	if memo := identity.CallSources[path]; memo != nil {
		return memo
	}
	source := identity.OwnedProgramFiles[path]
	if source == nil {
		return nil
	}
	sourceID := deriveID("source", "typescript:"+identity.Universe, map[string]any{"path": path})
	memo := &governanceRuntimeCallSource{SourceID: sourceID, Revision: deriveID("source-revision", sourceID, map[string]any{"digest": hashText(source.Text())}), Coordinates: indexSourceCoordinates(source.Text())}
	identity.CallSources[path] = memo
	return memo
}

// Only the original Program's call iterator and the exact authored-span bridge
// above invoke this private method; no client node or cached expected identity
// is admitted as an actual call observation.
func (identity *governanceRuntimeIdentity) nativeCallIdentity(path string, node *ast.Node) (string, bool) {
	source := identity.OwnedProgramFiles[path]
	if !identity.Complete || source == nil || node == nil || node.Kind != ast.KindCallExpression || ast.GetSourceFileOfNode(node) != source {
		return "", false
	}
	if id, ok := identity.Calls[node]; ok {
		return id, true
	}
	memo := identity.callSource(path)
	start := scanner.SkipTrivia(source.Text(), node.Pos())
	span := sourceSpan{Source: memo.SourceID, Revision: memo.Revision, Start: memo.Coordinates.utf16(start), End: memo.Coordinates.utf16(node.End())}
	workspace := occurrenceIdentityWorkspace{}
	id := workspace.identify(identity.Universe, span, "body-call")
	identity.CallIdentityHashes++
	identity.Calls[node] = id
	identity.CallSpans[fmt.Sprintf("%s:%d:%d", path, start, node.End())] = span
	return id, true
}
