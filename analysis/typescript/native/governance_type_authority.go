package main

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"context"
	ast "github.com/microsoft/typescript-go/shim/ast"
	checker "github.com/microsoft/typescript-go/shim/checker"
	core "github.com/microsoft/typescript-go/shim/core"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	options "github.com/microsoft/typescript-go/shim/tsoptions"
	tspath "github.com/microsoft/typescript-go/shim/tspath"
	"github.com/samchon/ttsc/packages/ttsc/driver"
	"path/filepath"
	"strings"
)

type governanceTypeAuthority struct {
	project    *governedProject
	configured bool
	parsed     *options.ParsedCommandLine
	roots      map[string]bool
	program    *driver.Program
	opened     bool
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
	program, _, err := driver.CreateProgramFromConfig(owner.parsed, host)
	if program == nil || err != nil {
		return
	}
	owner.project.stats.CompilerPrograms++
	check, release := program.GetTypeChecker(context.Background())
	owner.program = &driver.Program{TSProgram: program, ParsedConfig: owner.parsed, Checker: check, Host: host, FS: overlay}
	owner.project.typeRelease = release
}
func (owner *governanceTypeAuthority) expression(file *sourcepolicy.File, expression *ast.Node) (*ast.Node, *checker.Type, bool) {
	owner.open()
	if owner.program == nil {
		return nil, nil, true
	}
	captured := owner.project.FilesByPath[file.Path]
	source := owner.program.SourceFile(captured.AbsolutePath)
	if source == nil {
		return nil, nil, true
	}
	if source.Text() != captured.Text {
		owner.project.familyResidual = append(owner.project.familyResidual, "Native demanded type source bytes disagree with captured authored source")
		return nil, nil, false
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
		return nil, nil, true
	}
	return match, owner.program.Checker.GetTypeAtLocation(match), true
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
func (owner *governanceTypeAuthority) names(file *sourcepolicy.File, expression *ast.Node) sourcepolicy.NamesObservation {
	owner.project.stats.TypeCells++
	_, typ, known := owner.expression(file, expression)
	if !known {
		return sourcepolicy.NamesObservation{Known: false}
	}
	if typ == nil {
		return sourcepolicy.NamesObservation{Known: true}
	}
	names, ok := owner.propertyNames(typ)
	if !ok {
		return sourcepolicy.NamesObservation{Known: true}
	}
	return sourcepolicy.NamesObservation{Known: true, Names: names}
}
func (owner *governanceTypeAuthority) collectionKind(file *sourcepolicy.File, expression *ast.Node) sourcepolicy.KindObservation {
	owner.project.stats.TypeCells++
	node, typ, known := owner.expression(file, expression)
	if !known {
		return sourcepolicy.KindObservation{Known: false}
	}
	if typ == nil {
		return sourcepolicy.KindObservation{Known: true}
	}
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
