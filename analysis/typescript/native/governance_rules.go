package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"strings"
	"time"
)

type governanceEvidence struct {
	Rule            string            `json:"rule"`
	Kind            string            `json:"kind"`
	Evidence        string            `json:"evidence"`
	Location        *decisionLocation `json:"location,omitempty"`
	AmbiguityReason string            `json:"ambiguityReason,omitempty"`
}

func (e governanceEvidence) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Rule            string            `json:"rule"`
		Kind            string            `json:"kind"`
		Evidence        jsstring.JSONText `json:"evidence"`
		Location        *decisionLocation `json:"location,omitempty"`
		AmbiguityReason string            `json:"ambiguityReason,omitempty"`
	}{e.Rule, e.Kind, jsstring.JSONText(e.Evidence), e.Location, e.AmbiguityReason})
}

type governanceOutcome struct {
	Rule         string               `json:"rule"`
	Revision     string               `json:"revision"`
	Status       string               `json:"status"`
	Findings     []governanceEvidence `json:"findings"`
	SubjectCount int                  `json:"subjectCount"`
}

var governanceRevisions = map[string]string{
	"ROOT-COMPOSE":      "e4fed1eea4ff1ffdf57082a474cdcf7c0c83bb88268e189662594c8bdcadb47a",
	"ROOT-FACADE":       "df8b0fbb009121f498b3bbf2fca2eeb42da3b0c8c4aea89995e09b7e24efb486",
	"DOM-PUBLIC-DEPS":   "32b41eefe565343a4c5d18ef2c22c428912c71771bfda4b6da52d3c1f62bbbf5",
	"FNC-XDOM-DECLARED": "269e22202a0fbec5ec4afc3579ca504eed457f44046b99e64a38d08634294909",
	"FNC-XDOM-REQ":      "a646c9931bb8b5a011a2cf7431f362fcb0e63be49dfc4c1bc0eba77a8aca8fdb",
	"DEP-ALLOWLIST":     "9c89a0fa0f648026b2f2c8befbbfa4c4714496f91a644a1faa9aeb8c9a3e2903",
	"IMP-ALIAS-CFG":     "c28fb835daba008c01fdf0f6555817a358da85d5a697775c029e8a051c28f0ab",
	"QLT-TYPED-COORD":   "4e0b929414b7526cd4cf2e755a9664eaf03845d79e650abcae7b1e2f4f4b67ce",
	"QLT-CANON-VALUES":  "2e236d7a521c771be8eace5689d10a52ae390f5d1071add401d749679d22b023",
	"NODE-INHERITED":    "0687b60d058bceb2c9833c6279c0e41543ea0e4d3b4a086ee95e8cb9c2275ef4",
	"QLT-DEF-IDS":       "0c51a2194d039facdb5833a288b4ec2eadea94bbd0afb02bd1065994592c6c07",
	"TST-NO-PROD-IMP":   "3862d665297486d32b225626f39a1cd8344b3f3bf93a2883e19dc4c94412574a",
	"MOD-REQUIRED":      "7792b445dee5c0b0184e3bc00e4bfeba2c5f25db921f9d825a5adfe0c9aba48f",
	"MOD-GOVERNED":      "2fbff878449c8554ae5f9936166c927f7030c79c4a466086b671060cebabda13",
	"IMP-STATIC":        "41f0234cf5774884aaa5b3c4d23deb79e7bc524e964b60ec9d5bd4539d11ec9c",
	"IMP-SDK-BOUNDARY":  "6e00f5e402015af4dbd7ddcd289d0b55a5cd2c145856056c0cb43a2035ebcf4a",
}

func governanceLocation(file *governedFile, node *ast.Node) *decisionLocation {
	start := scanner.GetTokenPosOfNode(node, file.Source, false)
	lines := scanner.GetECMALineStarts(file.Source)
	line := scanner.ComputeLineOfPosition(lines, start)
	offset := file.coordinates.utf16(start)
	return &decisionLocation{file.Path, line + 1, offset - file.coordinates.utf16(int(lines[line])) + 1, offset, max(1, file.coordinates.utf16(node.End())-offset)}
}
func governanceViolation(rule string, file *governedFile, node *ast.Node, message string) governanceEvidence {
	e := governanceEvidence{Rule: rule, Kind: "violation", Evidence: message}
	if file != nil && node != nil {
		e.Location = governanceLocation(file, node)
	}
	return e
}
func governanceStaticEvidence(file *governedFile) []governanceEvidence {
	out := []governanceEvidence{}
	emit := func(node *ast.Node, message string) {
		out = append(out, governanceViolation("IMP-STATIC", file, node, message))
	}
	var visit func(*ast.Node)
	visit = func(node *ast.Node) {
		switch node.Kind {
		case ast.KindImportEqualsDeclaration:
			emit(node, "Production dependency uses import-equals instead of analyzable ESM.")
		case ast.KindImportType:
			arg := node.AsImportTypeNode().Argument
			if arg == nil || arg.Kind != ast.KindLiteralType || !governanceLiteral(arg.AsLiteralTypeNode().Literal) {
				emit(node, "Production dependency uses a nonliteral dynamic import.")
			}
		case ast.KindCallExpression:
			c := node.AsCallExpression()
			if c.Expression.Kind == ast.KindImportKeyword {
				if c.Arguments == nil || len(c.Arguments.Nodes) != 1 || !governanceLiteral(c.Arguments.Nodes[0]) {
					emit(node, "Production dependency uses a nonliteral dynamic import.")
				}
			} else if c.Expression.Kind == ast.KindIdentifier && c.Expression.Text() == "require" && !governanceLocallyOwned(c.Expression, false) && !governanceLocallyOwned(c.Expression, true) {
				emit(node, "Production dependency uses require instead of analyzable ESM.")
			}
		}
		node.ForEachChild(func(child *ast.Node) bool { visit(child); return false })
	}
	visit(file.Source.AsNode())
	return out
}
func governanceEvaluate(project *governedProject, rule string) (governanceOutcome, bool) {
	started := time.Now()
	defer func() { project.stats.phase("rule-dispatch-inclusive", started) }()
	project.stats.RuleEvaluations++
	if out, ok := governanceCombinedFamily(project, rule); ok {
		return out, true
	}
	if rule == "ROOT-COMPOSE" {
		return governanceRootCompose(project), true
	}
	if rule == "ROOT-FACADE" {
		return governanceRootFacade(project), true
	}
	if rule == "DOM-PUBLIC-DEPS" {
		return governancePublicDependencies(project), true
	}
	if rule == "FNC-XDOM-DECLARED" || rule == "FNC-XDOM-REQ" {
		return governanceFunctionDependencies(project, rule), true
	}
	if rule == "DEP-ALLOWLIST" {
		return governanceDependencyAllowlist(project), true
	}
	if rule == "IMP-ALIAS-CFG" {
		return governanceAliasConfiguration(project), true
	}
	if rule == "QLT-TYPED-COORD" || rule == "QLT-CANON-VALUES" || rule == "NODE-INHERITED" {
		return governanceGlobalSyntax(project, rule), true
	}
	if rule == "QLT-DEF-IDS" {
		return governanceDefinitionIDs(project), true
	}
	if _, ok := sourcepolicy.Revisions[rule]; ok {
		return governanceSourceFamily(project, rule), true
	}
	revision, ok := governanceRevisions[rule]
	if !ok {
		return governanceOutcome{}, false
	}
	out := governanceOutcome{Rule: rule, Revision: revision, Status: "pass", Findings: []governanceEvidence{}}
	if rule == "MOD-REQUIRED" {
		out.SubjectCount = 1
		for _, layer := range project.Policy.Layers {
			if layer.Required && !containsString(project.RootEntries, strings.TrimSuffix(layer.SourcePath, "/")) {
				out.Findings = append(out.Findings, governanceViolation(rule, nil, nil, fmt.Sprintf("Required layer %s is missing at %s.", layer.ID, layer.SourcePath)))
			}
		}
		for _, root := range project.Policy.RootFiles {
			if root.Required && !containsString(project.RootEntries, root.SourcePath) {
				out.Findings = append(out.Findings, governanceViolation(rule, nil, nil, fmt.Sprintf("Required root file %s is missing.", root.SourcePath)))
			}
		}
	} else {
		for _, file := range project.Files {
			if file.Role != "production" {
				continue
			}
			out.SubjectCount++
			switch rule {
			case "MOD-GOVERNED":
				governed := file.Layer != ""
				for _, root := range project.Policy.RootFiles {
					governed = governed || root.SourcePath == file.Path
				}
				if governed {
					continue
				}
				message := fmt.Sprintf("Production source %s is outside every declared layer and governed root. Move Domain source into a declared layer; exclude a directory that is not Domain source, such as mockups, with an \"ignore\" glob in astrale.lint.json.", file.Path)
				var anchor *ast.Node
				if file.Source.Statements != nil && len(file.Source.Statements.Nodes) > 0 {
					anchor = file.Source.Statements.Nodes[0]
				}
				out.Findings = append(out.Findings, governanceViolation(rule, file, anchor, message))
			case "TST-NO-PROD-IMP":
				for _, imp := range file.Imports {
					target := project.resolveProjectImport(file, imp.Specifier)
					if target != nil && target.Role != "production" {
						out.Findings = append(out.Findings, governanceViolation(rule, file, imp.Node, fmt.Sprintf("Production source %s imports test artifact %s.", file.Path, target.Path)))
					}
				}
			case "IMP-STATIC":
				out.Findings = append(out.Findings, governanceStaticEvidence(file)...)
			case "IMP-SDK-BOUNDARY":
				for _, imp := range file.Imports {
					s := imp.Specifier
					if s == "@astrale-os/kernel-core" || strings.HasPrefix(s, "@astrale-os/kernel-core/") || s == "@astrale-os/kernel-dsl" || strings.HasPrefix(s, "@astrale-os/kernel-dsl/") {
						out.Findings = append(out.Findings, governanceViolation(rule, file, imp.Node, fmt.Sprintf("Domain source imports %s directly; use the matching @astrale-os/sdk semantic subpath.", s)))
					}
				}
			}
		}
	}
	if len(out.Findings) > 0 {
		out.Status = "fail"
	}
	return out, true
}
