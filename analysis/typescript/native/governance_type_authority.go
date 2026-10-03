package main

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"context"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
	compiler "github.com/microsoft/typescript-go/shim/compiler"
	core "github.com/microsoft/typescript-go/shim/core"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	options "github.com/microsoft/typescript-go/shim/tsoptions"
	tspath "github.com/microsoft/typescript-go/shim/tspath"
	"github.com/samchon/ttsc/packages/ttsc/driver"
	"path/filepath"
	"strings"
	"time"
)

type governanceTypeAuthority struct {
	project           *governedProject
	configured        bool
	parsed            *options.ParsedCommandLine
	roots             map[string]bool
	program           *driver.Program
	generationBroker  *governanceGenerationBroker
	opened            bool
	cells             map[governanceTypeDemandKey]governanceTypeDemandValue
	validated         map[*governanceTypeReceipt]bool
	validationSeen    map[*governanceTypeReceipt]bool
	typeSourceBase    map[string]governanceTypeSource
	typeSourceFaithful bool
	typeSourceForward map[string][]string
}

func (owner *governanceTypeAuthority) configuration() {
	if owner.configured {
		return
	}
	owner.configured = true
	owner.roots = map[string]bool{}
	project := owner.project
	if project.capture.compiler == nil {
		disk := newAuthoredCompilerDisk()
		project.capture.compiler = governanceNewCompilerInputFS(disk)
	}
	fs := project.capture.compiler
	root := project.Root
	for {
		path := filepath.Join(root, "tsconfig.json")
		if fs.FileExists(path) {
			text, ok := fs.ReadFile(path)
			if !ok {
				return
			}
			_, errors := options.ParseConfigFileTextToJson(path, tspath.Path(path), strings.TrimPrefix(text, "\ufeff"))
			if len(errors) > 0 {
				return
			}
			parsed, _ := options.GetParsedCommandLineOfConfigFile(path, &core.CompilerOptions{NoEmit: core.TSTrue}, nil, governanceConfigHost{project.Root, fs}, nil)
			owner.parsed = parsed
			if parsed != nil {
				for _, name := range parsed.FileNames() {
					owner.roots[filepath.Clean(name)] = true
				}
			}
			return
		}
		parent := filepath.Dir(root)
		if parent == root {
			return
		}
		root = parent
	}
}
func governanceLiteralPropertyNames(expression *ast.Node) ([]string, bool) {
	if expression == nil {
		return nil, false
	}
	if expression.Kind == ast.KindParenthesizedExpression {
		return governanceLiteralPropertyNames(expression.AsParenthesizedExpression().Expression)
	}
	if expression.Kind == ast.KindConditionalExpression {
		c := expression.AsConditionalExpression()
		left, lok := governanceLiteralPropertyNames(c.WhenTrue)
		right, rok := governanceLiteralPropertyNames(c.WhenFalse)
		if !lok || !rok {
			return nil, false
		}
		seen := map[string]bool{}
		out := []string{}
		for _, name := range append(left, right...) {
			if !seen[name] {
				seen[name] = true
				out = append(out, name)
			}
		}
		return out, true
	}
	if expression.Kind != ast.KindObjectLiteralExpression {
		return nil, false
	}
	out := []string{}
	seen := map[string]bool{}
	for _, property := range expression.AsObjectLiteralExpression().Properties.Nodes {
		if property.Kind == ast.KindSpreadAssignment {
			return nil, false
		}
		key := property.Name()
		name := ""
		ok := false
		if key != nil {
			switch key.Kind {
			case ast.KindIdentifier, ast.KindNumericLiteral:
				name = key.Text()
				ok = true
			case ast.KindStringLiteral:
				name, ok = authored.StaticText(key)
			case ast.KindComputedPropertyName:
				expression := key.AsComputedPropertyName().Expression
				if expression.Kind == ast.KindStringLiteral || expression.Kind == ast.KindNoSubstitutionTemplateLiteral {
					name, ok = authored.StaticText(expression)
				}
			}
		}
		if !ok {
			return nil, false
		}
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	return out, true
}
func (owner *governanceTypeAuthority) closed(file *sourcepolicy.File, expression *ast.Node) sourcepolicy.NamesObservation {
	owner.project.stats.LiteralCells++
	names, ok := governanceLiteralPropertyNames(expression)
	if !ok {
		return sourcepolicy.NamesObservation{Known: true}
	}
	owner.configuration()
	if owner.roots[owner.project.FilesByPath[file.Path].AbsolutePath] {
		return sourcepolicy.NamesObservation{Known: true, Names: names}
	}
	return sourcepolicy.NamesObservation{Known: true}
}
func (owner *governanceTypeAuthority) open() {
	if owner.opened {
		return
	}
	started := time.Now()
	defer func() { owner.project.stats.phase("native-program-and-checker", started) }()
	owner.opened = true
	owner.configuration()
	if owner.parsed == nil {
		return
	}
	fs := owner.project.capture.compiler
	overlay := driver.NewOverlayFS(fs)
	for _, file := range owner.project.Files {
		overlay.Set(file.AbsolutePath, file.Text)
	}
	host := driver.DefaultHost(owner.project.Root, overlay)
	var program *compiler.Program
	var err error
	if generation := owner.project.programGeneration; generation != nil {
		broker := generation.broker
		proposalStarted := time.Now()
		candidate, reused := generation.propose(owner.project)
		owner.project.stats.phase("native-program-update-proposal", proposalStarted)
		if reused {
			owner.project.borrowedGeneration = generation
			program = candidate
			host = broker
			owner.generationBroker = broker
		}
	}
	if program == nil {
		broker := &governanceGenerationBroker{host}
		program, _, err = driver.CreateProgramFromConfig(owner.parsed, broker)
		host = broker
		owner.generationBroker = broker
	}
	if program == nil || err != nil {
		return
	}
	owner.project.stats.CompilerPrograms++
	check, release := program.GetTypeChecker(context.Background())
	owner.program = &driver.Program{TSProgram: program, ParsedConfig: owner.parsed, Checker: check, Host: host, FS: overlay}
	owner.project.typeRelease = release
}
func (owner *governanceTypeAuthority) compilerNode(file *sourcepolicy.File, expression *ast.Node) (*ast.Node, bool) {
	owner.open()
	if owner.program == nil {
		return nil, true
	}
	captured := owner.project.FilesByPath[file.Path]
	source := owner.program.SourceFile(captured.AbsolutePath)
	if source == nil {
		return nil, true
	}
	if source.Text() != captured.Text {
		owner.project.familyResidual = append(owner.project.familyResidual, "Native demanded type source bytes disagree with captured authored source")
		return nil, false
	}
	start := scanner.GetTokenPosOfNode(expression, file.Source, false)
	end := expression.End()
	var match *ast.Node
	var visit func(*ast.Node)
	visit = func(node *ast.Node) {
		nodeStart := scanner.GetTokenPosOfNode(node, source, false)
		if nodeStart > start || node.End() < end {
			return
		}
		if nodeStart == start && node.End() == end {
			match = node
		}
		node.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
	}
	visit(source.AsNode())
	if match == nil || !ast.IsExpressionNode(match) {
		return nil, true
	}
	return match, true
}
func (owner *governanceTypeAuthority) expression(file *sourcepolicy.File, expression *ast.Node) (*ast.Node, *checker.Type, bool) {
	match, known := owner.compilerNode(file, expression)
	if match == nil {
		return nil, nil, known
	}
	started := time.Now()
	typ := owner.program.Checker.GetTypeAtLocation(match)
	owner.project.stats.phase("type-at-location", started)
	return match, typ, true
}
func (owner *governanceTypeAuthority) propertyNames(typ *checker.Type) ([]string, bool) {
	if typ.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsNever|checker.TypeFlagsNull|checker.TypeFlagsUndefined) != 0 {
		return nil, false
	}
	if typ.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		names := []string{}
		seen := map[string]bool{}
		for _, member := range typ.Types() {
			items, ok := owner.propertyNames(member)
			if !ok {
				return nil, false
			}
			for _, name := range items {
				if !seen[name] {
					seen[name] = true
					names = append(names, name)
				}
			}
		}
		return names, true
	}
	apparent := owner.program.Checker.GetApparentType(typ)
	if apparent.Flags()&checker.TypeFlagsObject == 0 {
		return nil, false
	}
	for _, info := range checker.Checker_getIndexInfosOfType(owner.program.Checker, apparent) {
		if info.KeyType().IsString() || info.KeyType().Flags()&checker.TypeFlagsNumberLike != 0 {
			return nil, false
		}
	}
	names := []string{}
	for _, symbol := range checker.Checker_getPropertiesOfType(owner.program.Checker, apparent) {
		names = append(names, symbol.Name)
	}
	return names, true
}
func (owner *governanceTypeAuthority) names(file *sourcepolicy.File, expression *ast.Node) (observed sourcepolicy.NamesObservation) {
	programBefore := owner.project.stats.PhaseNanoseconds["native-program-and-checker"]
	startedProfile := time.Now()
	defer func() {
		owner.typeRequest("property-names", file, expression, observed.Known, observed.Names, "", startedProfile, programBefore)
	}()
	started := time.Now()
	defer func() { owner.project.stats.phase("type-cell-inclusive", started) }()
	owner.project.stats.TypeCells++
	if names, ok := governanceEmptyConditionalNames(expression); ok {
		owner.configuration()
		owner.project.stats.LiteralCells++
		if owner.roots[owner.project.FilesByPath[file.Path].AbsolutePath] {
			return sourcepolicy.NamesObservation{Known: true, Names: names}
		}
	}
	if value, ok := owner.lookupTypeDemand("property-names", file, expression); ok {
		return value.names
	}
	defer func() {
		if observed.Known && !owner.literalFidelity() {
			observed = sourcepolicy.NamesObservation{Known: false}
		}
		if observed.Known {
			owner.storeTypeDemand("property-names", file, expression, governanceTypeDemandValue{names: observed})
		}
	}()
	match, known := owner.compilerNode(file, expression)
	if known && match != nil && owner.constantUnknownCallNames(match) {
		owner.project.stats.phase("type-constant-unknown-call-quotient", started)
		return sourcepolicy.NamesObservation{Known: true}
	}
	_, typ, known := owner.expression(file, expression)
	if !known {
		return sourcepolicy.NamesObservation{Known: false}
	}
	if typ == nil {
		return sourcepolicy.NamesObservation{Known: true}
	}
	projectionStarted := time.Now()
	names, ok := owner.propertyNames(typ)
	owner.project.stats.phase("type-property-names", projectionStarted)
	if !ok {
		return sourcepolicy.NamesObservation{Known: true}
	}
	return sourcepolicy.NamesObservation{Known: true, Names: names}
}
func (owner *governanceTypeAuthority) collectionKind(file *sourcepolicy.File, expression *ast.Node) (observed sourcepolicy.KindObservation) {
	programBefore := owner.project.stats.PhaseNanoseconds["native-program-and-checker"]
	startedProfile := time.Now()
	defer func() {
		owner.typeRequest("collection-brand-kind", file, expression, observed.Known, nil, observed.Kind, startedProfile, programBefore)
	}()
	started := time.Now()
	defer func() { owner.project.stats.phase("type-cell-inclusive", started) }()
	owner.project.stats.TypeCells++
	if value, ok := owner.lookupTypeDemand("collection-brand-kind", file, expression); ok {
		return value.kind
	}
	defer func() {
		if observed.Known && !owner.literalFidelity() {
			observed = sourcepolicy.KindObservation{Known: false}
		}
		if observed.Known {
			owner.storeTypeDemand("collection-brand-kind", file, expression, governanceTypeDemandValue{kind: observed})
		}
	}()
	node, typ, known := owner.expression(file, expression)
	if !known {
		return sourcepolicy.KindObservation{Known: false}
	}
	if typ == nil {
		return sourcepolicy.KindObservation{Known: true}
	}
	projectionStarted := time.Now()
	defer func() { owner.project.stats.phase("type-collection-brand-projection", projectionStarted) }()
	kinds := map[string]bool{}
	var inspect func(*checker.Type)
	inspect = func(candidate *checker.Type) {
		if candidate.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
			for _, member := range candidate.Types() {
				inspect(member)
			}
			return
		}
		for _, property := range checker.Checker_getPropertiesOfType(owner.program.Checker, candidate) {
			brand := false
			for _, declaration := range property.Declarations {
				if declaration.Kind != ast.KindPropertySignature || declaration.Parent == nil || declaration.Parent.Kind != ast.KindInterfaceDeclaration || declaration.Parent.Name().Text() != "CollectionQueryDefinition" {
					continue
				}
				source := ast.GetSourceFileOfNode(declaration)
				brand = brand || source != nil && strings.Contains(filepath.ToSlash(source.FileName()), "/node_modules/@astrale-os/sdk/")
			}
			if !brand {
				continue
			}
			propertyType := checker.Checker_getTypeOfSymbolAtLocation(owner.program.Checker, property, node)
			kind := owner.program.Checker.GetPropertyOfType(propertyType, "kind")
			if kind == nil {
				continue
			}
			kindType := checker.Checker_getTypeOfSymbolAtLocation(owner.program.Checker, kind, node)
			if kindType.Flags()&checker.TypeFlagsStringLiteral == 0 {
				continue
			}
			value, ok := kindType.AsLiteralType().Value().(string)
			if ok && (value == "node" || value == "edge") {
				kinds[value] = true
			}
		}
	}
	inspect(typ)
	if len(kinds) == 1 {
		for kind := range kinds {
			return sourcepolicy.KindObservation{Known: true, Kind: kind}
		}
	}
	return sourcepolicy.KindObservation{Known: true}
}
func governanceInstallTypeAuthority(project *governedProject, shared *sourcepolicy.Project) {
	owner := &governanceTypeAuthority{project: project}
	project.typeOwner = owner
	shared.ClosedLiteralPropertyNames = owner.closed
	shared.ExpressionPropertyNames = owner.names
	shared.QueryCollectionKind = owner.collectionKind
}

func (owner *governanceTypeAuthority) typeRequest(operation string, file *sourcepolicy.File, node *ast.Node, known bool, names []string, kind string, started time.Time, programBefore int64) {
	start := scanner.GetTokenPosOfNode(node, file.Source, false)
	text := file.Source.Text()[start:node.End()]
	owner.project.stats.TypeRequests = append(owner.project.stats.TypeRequests, governanceTypeRequest{Operation: operation, Path: file.Path, Start: start, End: node.End(), Expression: text, Known: known, Names: names, Kind: kind, ElapsedNanoseconds: time.Since(started).Nanoseconds(), ProgramNanoseconds: owner.project.stats.PhaseNanoseconds["native-program-and-checker"] - programBefore})
}
