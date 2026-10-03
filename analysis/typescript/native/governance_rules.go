package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"encoding/json"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"time"
)

type decisionLocation struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
}
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

// These semantic evaluators now belong to the SDK closed-source owner. Their
// revisions remain registered; an unavailable native evaluator is never a pass.
func governanceSDKOnlyFamily(rule string) bool {
	switch rule {
	case "FNC-INT-TYPES", "FNC-STEP-IDS", "FNC-NO-NEST", "FNC-ONE-IMPL", "MIG-EXACT-REVS", "MIG-DEDICATED-CTX", "PRV-XDOM-TYPED", "PRV-XDOM-REQ", "PRV-NO-DOMAIN", "VIW-SCHEMA-DECL", "VIW-NO-COMPOSE", "SCH-ONE-DECL", "SCH-ICON-REQUIRED", "SCH-ICON-NEUTRAL", "SCH-EXACT-TYPES", "SCH-DECL-ONLY", "SCH-STATE-RELATION", "SCH-STATE-PURE", "SCH-STATE-SOURCE", "MUT-PLAN-REQ", "MUT-LOCAL-ALIAS", "MUT-STATE-INITIAL", "MUT-STATE-ATOMIC", "MUT-CANON", "MUT-FRAGMENTS", "MUT-PURE", "ROOT-COMPOSE", "ROOT-FACADE", "DOM-PUBLIC-DEPS", "FNC-XDOM-DECLARED", "FNC-XDOM-REQ", "DEP-ALLOWLIST", "IMP-ALIAS-CFG", "QLT-TYPED-COORD", "QLT-CANON-VALUES", "NODE-INHERITED", "RUL-SYNC", "RUL-PURE", "INT-PURE", "UI-NO-DOMAIN", "UTL-PUBLIC-DEPS", "MOD-REQUIRED", "MOD-GOVERNED", "TST-NO-PROD-IMP", "IMP-STATIC", "IMP-SDK-BOUNDARY":
		return true
	}
	return false
}

func governanceEvaluate(project *governedProject, rule string) (governanceOutcome, bool) {
	if governanceSDKOnlyFamily(rule) {
		return governanceOutcome{}, false
	}
	started := time.Now()
	defer func() { project.stats.phase("rule-dispatch-inclusive", started) }()
	project.stats.RuleEvaluations++
	if out, ok := governanceCombinedFamily(project, rule); ok {
		return out, true
	}
	if rule == "QLT-DEF-IDS" {
		return governanceDefinitionIDs(project), true
	}
	return governanceOutcome{}, false
}
