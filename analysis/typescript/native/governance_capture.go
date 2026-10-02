package main

import (
	"astrale-typespec-v2-native-analysis/authoredsource"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	options "github.com/microsoft/typescript-go/shim/tsoptions"
	tspath "github.com/microsoft/typescript-go/shim/tspath"
	vfs "github.com/microsoft/typescript-go/shim/vfs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

type governanceLayer struct {
	ID         string `json:"id"`
	SourcePath string `json:"sourcePath"`
	Facade     string `json:"facade,omitempty"`
	Required   bool   `json:"required"`
}
type governanceRoot struct {
	ID         string `json:"id"`
	SourcePath string `json:"sourcePath"`
	Role       string `json:"role"`
	Required   bool   `json:"required"`
}
type governancePolicy struct {
	Rules        string            `json:"rules"`
	Layers       []governanceLayer `json:"layers"`
	RootFiles    []governanceRoot  `json:"rootFiles"`
	Dependencies json.RawMessage   `json:"dependencies"`
	Aliases      json.RawMessage   `json:"aliases"`
}
type governanceImport struct {
	Specifier         string
	TypeOnly, Dynamic bool
	Node              *ast.Node
	Bindings          []authoredsource.Binding
	Namespace         string
}
type governedFile struct {
	Path, AbsolutePath, Text, Role, Layer, Submodule string
	Source                                           *ast.SourceFile
	Imports                                          []governanceImport
	coordinates                                      sourceCoordinates
	authored                                         *authoredsource.File
}
type governedProject struct {
	sourceProofState   *governanceProductsSession
	Root               string
	Files              []*governedFile
	FilesByPath        map[string]*governedFile
	RootEntries        []string
	Policy             governancePolicy
	GovernanceDigest   string
	Disabled           map[string]string
	capture            *governanceCapture
	verbatim           bool
	compilerOptions    *core.CompilerOptions
	compilerValid      bool
	resolvers          map[bool]*governanceResolver
	familyResidual     []string
	sharedProject      *sourcepolicy.Project
	sharedFileOwners   map[*sourcepolicy.File]*governedFile
	familyProducts     map[string]sourcepolicy.Result
	stats              governancePhaseCounters
	policyDigest       string
	typeRelease        func()
	typeOwner          *governanceTypeAuthority
	typeDemandCache    *governanceTypeDemandCache
	programGeneration  *governanceProgramGeneration
	borrowedGeneration *governanceProgramGeneration
}
type governanceObservation struct {
	Path  string `json:"path"`
	Kind  string `json:"kind"`
	Value string `json:"value"`
}
type governanceCapturedBytes struct {
	bytes []byte
	err   error
}

type governanceCapture struct {
	packageCoordinates governancePackageCoordinateAuthority

	ownedGenericArtifact *governanceOwnedArtifactLease
	byteCells            map[string]governanceCapturedBytes
	ticket               governanceCaptureTicket

	ownedGenericRows          map[governanceProbeKey]governanceProbeObservation
	ownedGenericOwner         *governanceOwnedOwner
	ownedGenericProducerTrace []governanceOwnedPhysicalPair
	ownedGenericBytes         map[string][]byte
	probeObservations         map[governanceProbeKey]string
	probeInconsistent         bool
	compilerAssertions        []*governanceCompilerReadAssertions
	typeCacheLeases           []*governanceTypeCacheLease

	observations map[string]governanceObservation
	compiler     *compilerInputFS
	root         string
}

func governanceHash(bytes []byte) string {
	value := sha256.Sum256(bytes)
	return hex.EncodeToString(value[:])
}
func (c *governanceCapture) remember(path, kind, value string) {
	key := kind + "\000" + path
	if before, seen := c.observations[key]; seen {
		if before.Value != value {
			c.probeInconsistent = true
		}
		return
	}
	c.observations[key] = governanceObservation{path, kind, value}
}
func governanceLstatValue(path string) (string, error) {
	m, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return "absent", nil
	}
	if err != nil {
		return "", err
	}
	value := fmt.Sprintf("%s:%d", m.Mode(), m.Size())
	if m.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(path)
		if err != nil {
			return "", err
		}
		value += "->" + target
	}
	return value, nil
}
func (c *governanceCapture) lstat(path string) (os.FileInfo, error) {
	m, err := os.Lstat(path)
	if os.IsNotExist(err) {
		c.remember(path, "lstat", "absent")
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	value := fmt.Sprintf("%s:%d", m.Mode(), m.Size())
	if m.Mode()&os.ModeSymlink != 0 {
		target, e := os.Readlink(path)
		if e != nil {
			return nil, e
		}
		value += "->" + target
	}
	c.remember(path, "lstat", value)
	return m, nil
}
func governanceDirectoryValue(path string) (string, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return "", err
	}
	rows := make([]string, 0, len(entries))
	for _, entry := range entries {
		rows = append(rows, fmt.Sprintf("%s:%s", entry.Name(), entry.Type()))
	}
	return strings.Join(rows, "\000"), nil
}
func (c *governanceCapture) directory(path string) ([]os.DirEntry, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	rows := make([]string, 0, len(entries))
	for _, entry := range entries {
		rows = append(rows, fmt.Sprintf("%s:%s", entry.Name(), entry.Type()))
	}
	c.remember(path, "directory", strings.Join(rows, "\000"))
	return entries, nil
}
func (c *governanceCapture) read(path string) ([]byte, error) {
	if c.byteCells == nil {
		c.byteCells = map[string]governanceCapturedBytes{}
	}
	if before, seen := c.byteCells[path]; seen {
		if !c.ownedReadMatches(path, before.bytes, before.err) {
			c.probeInconsistent = true
		}
		return append([]byte(nil), before.bytes...), before.err
	}
	bytes, err := os.ReadFile(path)
	if !c.ownedReadMatches(path, bytes, err) {
		c.probeInconsistent = true
	}
	c.byteCells[path] = governanceCapturedBytes{append([]byte(nil), bytes...), err}
	if os.IsNotExist(err) {
		c.remember(path, "read", "absent")
		return nil, err
	}
	if err != nil {
		c.remember(path, "read-error", stableJSON(governanceProbeFailure(err)))
		return nil, err
	}
	c.remember(path, "read", "present:"+governanceHash(bytes))
	return bytes, nil
}
func (c *governanceCapture) optional(path string, limit int) ([]byte, error) {
	m, err := os.Stat(path)
	if os.IsNotExist(err) {
		c.remember(path, "read", "absent")
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if m.Size() > int64(limit) {
		return nil, fmt.Errorf("%s exceeds %d config bytes.", filepath.Base(path), limit)
	}
	return c.read(path)
}
func (c *governanceCapture) canonicalCertificate() string {
	rows := make([]governanceObservation, 0, len(c.observations))
	for _, row := range c.observations {
		rows = append(rows, row)
	}
	if c.compiler != nil {
		for key, value := range c.compiler.observed {
			rows = append(rows, governanceObservation{key.path, fmt.Sprintf("compiler:%d", key.kind), value})
		}
	}
	for _, receipt := range c.compilerAssertions {
		rows = append(rows, receipt.certificateObservations()...)
	}
	for _, lease := range c.typeCacheLeases {
		rows = append(rows, lease.certificateObservations()...)
	}
	for key, value := range c.probeObservations {
		rows = append(rows, governanceObservation{key.Path, fmt.Sprintf("captured-probe:%s:%t", key.Kind, key.FollowLinks), value})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Kind != rows[j].Kind {
			return rows[i].Kind < rows[j].Kind
		}
		return rows[i].Path < rows[j].Path
	})
	bytes, _ := json.Marshal(rows)
	return governanceHash(bytes)
}

// One uncached barrier, called only after the consumer has admitted a candidate.
// This proves replay equality of all observed operations, not a filesystem-wide
// atomic transaction or immunity to an edit after the barrier has returned.
func (c *governanceCapture) Verify() (bool, error) {
	return governanceVerifyPublication([]*governanceCapture{c})
}

func (c *governanceCapture) verifyWithin(reads *governanceBarrierReads) (bool, error) {
	if c.ownedGenericArtifact != nil && !c.ownedGenericArtifact.verify() {
		return false, nil
	}
	var replay *governanceTypeReplayWorld
	if len(c.compilerAssertions)+len(c.typeCacheLeases) > 0 {
		replay = reads.compilerReplay(c.compiler.disk)
	}
	for _, receipt := range c.compilerAssertions {
		if !receipt.verifyBarrierWorld(replay) {
			return false, nil
		}
	}
	for _, lease := range c.typeCacheLeases {
		if !lease.verifyBarrierWorld(replay) {
			return false, nil
		}
	}
	return c.verifyCapturedOperations(reads), nil
}

type governanceConfigHost struct {
	root string
	fs   vfs.FS
}

func (h governanceConfigHost) FS() vfs.FS                  { return h.fs }
func (h governanceConfigHost) GetCurrentDirectory() string { return h.root }

var governanceIgnored = map[string]bool{".astrale": true, ".dist": true, ".domain-studio": true, ".git": true, ".history": true, ".output": true, ".turbo": true, ".wrangler": true, "coverage": true, "dist": true, "dist-client": true, "node_modules": true}
var governanceExtensions = map[string]bool{".cjs": true, ".cts": true, ".js": true, ".jsx": true, ".mjs": true, ".mts": true, ".ts": true, ".tsx": true}
var governanceTestPath = regexp.MustCompile(`\.(?:test|spec|bench|perf)\.[cm]?[jt]sx?$`)

func governanceWorkspacePattern(pattern string) *regexp.Regexp {
	parts := strings.Split(strings.TrimSuffix(pattern, "/"), "*")
	for i := range parts {
		parts[i] = regexp.QuoteMeta(parts[i])
	}
	return regexp.MustCompile("^" + strings.Join(parts, "[^/]*") + "$")
}
func governanceValidWorkspacePattern(s string) bool {
	return len(s) > 0 && len(s) <= 512 && !strings.HasPrefix(s, "/") && !strings.Contains(s, "\\") && !containsString(strings.Split(s, "/"), "..")
}
func governanceWorkspacePatterns(manifest map[string]any, pnpm string) []string {
	var raw []any
	switch value := manifest["workspaces"].(type) {
	case []any:
		raw = value
	case map[string]any:
		raw, _ = value["packages"].([]any)
	}
	out := []string{}
	for _, v := range raw {
		if s, ok := v.(string); ok && governanceValidWorkspacePattern(s) {
			out = append(out, s)
		}
	}
	inPackages := false
	list := regexp.MustCompile(`^\s+-\s+(.+?)\s*$`)
	comment := regexp.MustCompile(`\s+#.*$`)
	for _, line := range strings.Split(pnpm, "\n") {
		line = comment.ReplaceAllString(strings.TrimSuffix(line, "\r"), "")
		if regexp.MustCompile(`^packages:\s*\[\s*\]\s*$`).MatchString(line) {
			inPackages = false
			continue
		}
		if regexp.MustCompile(`^packages:\s*$`).MatchString(line) {
			inPackages = true
			continue
		}
		if inPackages && len(line) > 0 && line[0] != ' ' && line[0] != '\t' {
			break
		}
		if !inPackages {
			continue
		}
		m := list.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		s := m[1]
		if len(s) >= 2 && ((s[0] == '\'' && s[len(s)-1] == '\'') || (s[0] == '"' && s[len(s)-1] == '"')) {
			s = s[1 : len(s)-1]
		}
		if governanceValidWorkspacePattern(s) {
			out = append(out, s)
		}
	}
	return out
}
func captureGovernedProject(requestedRoot string, policy governancePolicy) (*governedProject, error) {
	return captureGovernedProjectCached(requestedRoot, policy, nil)
}
func captureGovernedProjectCached(requestedRoot string, policy governancePolicy, cache map[string]*governedFile) (*governedProject, error) {
	return captureGovernedProjectAuthority(requestedRoot, policy, cache, nil, nil)
}
func captureGovernedProjectAuthority(requestedRoot string, policy governancePolicy, cache map[string]*governedFile, capture *governanceCapture, authority *governanceCompiledPolicy) (*governedProject, error) {
	started := time.Now()
	policy.Layers = append([]governanceLayer{}, policy.Layers...)
	policy.RootFiles = append([]governanceRoot{}, policy.RootFiles...)
	requestedRoot, err := filepath.Abs(requestedRoot)
	if err != nil {
		return nil, err
	}
	if capture == nil {
		capture = &governanceCapture{observations: map[string]governanceObservation{}}
	}
	m, err := capture.lstat(requestedRoot)
	if err != nil {
		return nil, fmt.Errorf("Cannot resolve Domain project root %s.", requestedRoot)
	}
	if m.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("Domain project root must not be a symbolic link: %s.", requestedRoot)
	}
	root, err := filepath.EvalSymlinks(requestedRoot)
	if err != nil {
		return nil, err
	}
	capture.remember(requestedRoot, "realpath", root)
	capture.root = root
	project := &governedProject{Root: root, Policy: policy, FilesByPath: map[string]*governedFile{}, Disabled: map[string]string{}, capture: capture, compilerOptions: &core.CompilerOptions{Module: core.ModuleKindNodeNext, ModuleResolution: core.ModuleResolutionKindNodeNext}, compilerValid: true, resolvers: map[bool]*governanceResolver{}}
	defer func() { project.stats.phase("governed-capture-inclusive", started) }()
	var ignore func(string) bool
	if authority == nil {
		ignore, err = governanceConfigure(project)
		if err != nil {
			return nil, err
		}
	} else {
		ignore = governanceAdmittedIgnore(authority.IgnorePatternUnits)
		for _, disabled := range authority.Disabled {
			project.Disabled[disabled.RuleID] = disabled.Reason
		}
	}
	entries, err := capture.directory(root)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		project.RootEntries = append(project.RootEntries, entry.Name())
	}
	pkgBytes, err := capture.optional(filepath.Join(root, "package.json"), 1024*1024)
	if err != nil {
		return nil, err
	}
	manifest := map[string]any{}
	if pkgBytes != nil {
		if err := json.Unmarshal(pkgBytes, &manifest); err != nil || manifest == nil {
			return nil, fmt.Errorf("Cannot parse Domain package manifest %s.", filepath.Join(root, "package.json"))
		}
	}
	configPath := filepath.Join(root, "tsconfig.json")
	configBytes, err := capture.optional(configPath, 1024*1024)
	if err != nil {
		return nil, err
	}
	if configBytes != nil {
		_, errors := options.ParseConfigFileTextToJson(configPath, tspath.Path(configPath), strings.TrimPrefix(strings.ToValidUTF8(string(configBytes), "�"), "\ufeff"))
		if len(errors) > 0 {
			return nil, fmt.Errorf("Cannot parse Domain TypeScript configuration %s: %s", configPath, governanceDiagnosticText(errors[0]))
		}
		disk := newAuthoredCompilerDisk()
		capture.compiler = governanceNewCompilerInputFS(disk)
		parsed, _ := options.GetParsedCommandLineOfConfigFile(configPath, nil, nil, governanceConfigHost{root, capture.compiler}, nil)
		if parsed != nil {
			project.compilerOptions = parsed.CompilerOptions()
			project.verbatim = parsed.CompilerOptions().VerbatimModuleSyntax == core.TSTrue
			for _, e := range parsed.Errors {
				if e.Code() != 18003 {
					project.compilerValid = false
				}
			}
		} else {
			project.compilerValid = false
		}
	}
	pnpm, err := capture.optional(filepath.Join(root, "pnpm-workspace.yaml"), 1024*1024)
	if err != nil {
		return nil, err
	}
	workspace := governanceWorkspacePatterns(manifest, string(pnpm))
	paths := []string{}
	tooling := map[string]bool{}
	for _, r := range project.Policy.RootFiles {
		if r.Role == "tooling" {
			tooling[r.SourcePath] = true
		}
	}
	var collect func(string, int) error
	collect = func(directory string, depth int) error {
		entries, err := capture.directory(directory)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if !utf8.ValidString(entry.Name()) {
				return fmt.Errorf("Cannot read Domain project at %s.", root)
			}
			absolute := filepath.Join(directory, entry.Name())
			logical, _ := filepath.Rel(root, absolute)
			logical = filepath.ToSlash(logical)
			if entry.IsDir() && entry.Name() == ".spec" {
				return fmt.Errorf("Domain projects cannot own .spec directories; Kernel is the specification owner (%s).", logical)
			}
			if ignore(logical) {
				continue
			}
			if entry.Type()&os.ModeSymlink != 0 {
				if !governanceIgnored[entry.Name()] {
					return fmt.Errorf("Domain compilation scope contains symbolic link %s.", logical)
				}
				continue
			}
			if entry.IsDir() {
				if governanceIgnored[entry.Name()] {
					continue
				}
				pruned := false
				underLayer := false
				for _, layer := range project.Policy.Layers {
					p := strings.TrimSuffix(layer.SourcePath, "/")
					if logical == p || strings.HasPrefix(logical, p+"/") {
						underLayer = true
					}
				}
				if !underLayer {
					for _, pattern := range workspace {
						if governanceWorkspacePattern(pattern).MatchString(logical) {
							manifestPath := filepath.Join(absolute, "package.json")
							meta, e := capture.lstat(manifestPath)
							if os.IsNotExist(e) {
								continue
							}
							if e != nil {
								return e
							}
							if meta.Mode()&os.ModeSymlink != 0 {
								return fmt.Errorf("Workspace package manifest must not be a symbolic link: %s/package.json.", logical)
							}
							if !meta.Mode().IsRegular() {
								continue
							}
							bytes, e := capture.optional(manifestPath, 1024*1024)
							if e != nil {
								return e
							}
							var object map[string]any
							if e = json.Unmarshal(bytes, &object); e != nil || object == nil {
								return fmt.Errorf("Cannot parse Domain package manifest %s.", manifestPath)
							}
							pruned = true
							break
						}
					}
				}
				if pruned {
					continue
				}
				if depth >= 32 {
					return fmt.Errorf("Domain source tree exceeds maximum depth 32 at %s.", absolute)
				}
				if err := collect(absolute, depth+1); err != nil {
					return err
				}
				continue
			}
			if !entry.Type().IsRegular() || !governanceExtensions[filepath.Ext(entry.Name())] || tooling[logical] {
				continue
			}
			paths = append(paths, absolute)
			if len(paths) > 20000 {
				return fmt.Errorf("Domain source tree exceeds maximum file count 20000.")
			}
		}
		return nil
	}
	if err := collect(root, 0); err != nil {
		return nil, err
	}
	sort.Slice(paths, func(i, j int) bool { return governanceJSStringLess(paths[i], paths[j]) })
	var total int64
	for _, absolute := range paths {
		meta, err := capture.lstat(absolute)
		if err != nil {
			return nil, err
		}
		if meta.Size() > 2*1024*1024 {
			return nil, fmt.Errorf("Domain source %s is %d bytes; maximum is 2097152.", strings.TrimPrefix(absolute, root+string(filepath.Separator)), meta.Size())
		}
		total += meta.Size()
	}
	if total > 128*1024*1024 {
		return nil, fmt.Errorf("Domain source snapshot is %d bytes; maximum is 134217728.", total)
	}
	failures := []string{}
	for _, absolute := range paths {
		bytes, err := capture.read(absolute)
		if err != nil {
			return nil, err
		}
		logical, _ := filepath.Rel(root, absolute)
		logical = filepath.ToSlash(logical)
		if !utf8.Valid(bytes) {
			return nil, fmt.Errorf("Domain source %s is not valid UTF-8.", logical)
		}
		file := &governedFile{Path: logical, AbsolutePath: absolute, Text: string(bytes), Role: "production"}
		for _, layer := range project.Policy.Layers {
			if strings.HasPrefix(logical, layer.SourcePath) {
				file.Layer = layer.ID
				remainder := strings.TrimPrefix(logical, layer.SourcePath)
				segments := strings.Split(remainder, "/")
				if len(segments) >= 2 && segments[0] != "" && segments[0] != "__tests__" {
					file.Submodule = segments[0]
					if layer.ID == "schema" && segments[0] == "modules" && len(segments) >= 3 && segments[1] != "" {
						file.Submodule = "modules/" + segments[1]
					}
				}
				break
			}
		}
		if file.Layer == "tests" {
			file.Role = "system-test"
		} else if containsString(strings.Split(logical, "/"), "__tests__") || governanceTestPath.MatchString(logical) {
			file.Role = "focused-test"
		}
		kind := core.ScriptKindTS
		if strings.HasSuffix(logical, ".tsx") || strings.HasSuffix(logical, ".jsx") {
			kind = core.ScriptKindTSX
		} else if strings.HasSuffix(logical, ".js") || strings.HasSuffix(logical, ".mjs") || strings.HasSuffix(logical, ".cjs") {
			kind = core.ScriptKindJS
		}
		project.stats.SourceReads++
		project.stats.SourceBytes += len(bytes)
		if previous := cache[logical]; previous != nil && previous.AbsolutePath == absolute && previous.Text == file.Text {
			file.Source = previous.Source
			file.coordinates = previous.coordinates
			file.authored = previous.authored
			project.stats.ParseReuses++
		} else {
			parseStarted := time.Now()
			file.Source = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: absolute}, file.Text, kind)
			ast.SetParentInChildren(file.Source.AsNode())
			file.coordinates = indexSourceCoordinates(file.Text)
			project.stats.phase("governed-parse", parseStarted)
			project.stats.Parses++
		}
		file.Imports = governanceCollectImports(file.Source, project.verbatim)
		for _, diagnostic := range file.Source.Diagnostics() {
			pos := diagnostic.Pos()
			lines := scanner.GetECMALineStarts(file.Source)
			line := scanner.ComputeLineOfPosition(lines, pos)
			failures = append(failures, fmt.Sprintf("%s:%d:%d: %s", logical, line+1, file.coordinates.utf16(pos)-file.coordinates.utf16(int(lines[line]))+1, governanceDiagnosticText(diagnostic)))
		}
		project.Files = append(project.Files, file)
		project.FilesByPath[logical] = file
	}
	if len(failures) > 0 {
		return nil, fmt.Errorf("Domain project contains TypeScript syntax errors:\n%s", strings.Join(failures[:min(20, len(failures))], "\n"))
	}
	hash := sha256.New()
	for _, file := range project.Files {
		for _, s := range []string{file.Path, file.Text} {
			var length [8]byte
			binary.BigEndian.PutUint64(length[:], uint64(len(s)))
			hash.Write(length[:])
			hash.Write([]byte(s))
		}
	}
	project.GovernanceDigest = hex.EncodeToString(hash.Sum(nil))
	return project, nil
}
func governanceDiagnosticText(d *ast.Diagnostic) string { return d.String() }

// SDK Array.sort compares UTF-16 code units, so astral/BMP path order cannot
// be replaced by UTF-8 byte order when sealing digests and duplicate owners.
func governanceJSStringLess(left, right string) bool {
	a := utf16.Encode([]rune(left))
	b := utf16.Encode([]rune(right))
	for i := 0; i < min(len(a), len(b)); i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return len(a) < len(b)
}
