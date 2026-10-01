package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"astrale-typespec-v2-native-analysis/observabledecision"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"encoding/json"
	"fmt"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
	"strconv"
	"strings"
	"time"
)

// Continuations retain the original capture. Canonical leaf answers are inputs
// to private computation, never evidence that an incomplete report is final.
type governanceImplementation struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}
type governanceImplementationContract struct {
	RuleID         string                   `json:"ruleId"`
	RuleRevision   string                   `json:"ruleRevision"`
	RequiredFacts  json.RawMessage          `json:"requiredFacts"`
	Implementation governanceImplementation `json:"implementation"`
}
type governanceIntrinsic struct {
	ID     string     `json:"id"`
	Kind   string     `json:"kind"`
	Units  []uint16   `json:"units,omitempty"`
	Values [][]uint16 `json:"values,omitempty"`
}
type governanceIntrinsicAnswer struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	Accepted *bool   `json:"accepted,omitempty"`
	Groups   [][]int `json:"groups,omitempty"`
}
type governanceProductsSession struct {
	GenericSpeculative     bool
	JoinedCaptures         []*governanceCapture
	LeafInputs             map[string]governanceIntrinsic
	ReplayAnswers          map[string]governanceIntrinsicAnswer
	ReplayExpected         *governanceCapture
	replayCertificateOwner *governanceCapture
	replayCertificate      string
	NeutralLeaf            string
	RuntimeGraph           *observabledecision.RuntimeDecisionGraph
	RuntimeIdentity        *governanceRuntimeIdentity
	RuntimeReady           map[string]governanceOutcome
	RuleReady              map[string]governanceOutcome
	GenericEngine          *governanceGenericEngine
	GenericProduct         *governanceGenericProduct
	RulePending            bool
	ActiveFamily           string
	FamilyMissing          map[string]map[string]bool
	GenericSuspended       bool
	Prepare                governancePrepare
	Project                *governedProject
	Token                  string
	Contracts              []governanceImplementationContract
	Requirements           []governanceIntrinsic
	Answers                map[string]governanceIntrinsicAnswer
	ProductsDigest         string
	InputCertificate       string
	Generation             string
}

func (session *governanceSession) discardProducts() {
	session.drainPolicyLane()
	if state := session.productsSession; state != nil && state.Project != nil {
		session.retireProgramProposal(state.Project)
	}
	if state := session.productsSession; state != nil && state.Project != nil && state.Project.typeRelease != nil {
		state.Project.typeRelease()
		state.Project.typeRelease = nil
	}
	session.productsSession = nil
	session.policySuspension = nil
}
func (state *governanceProductsSession) require(value governanceIntrinsic) {
	if state.LeafInputs == nil {
		state.LeafInputs = map[string]governanceIntrinsic{}
	}
	state.LeafInputs[value.ID] = value
	if state.ActiveFamily != "" {
		if state.FamilyMissing == nil {
			state.FamilyMissing = map[string]map[string]bool{}
		}
		if state.FamilyMissing[state.ActiveFamily] == nil {
			state.FamilyMissing[state.ActiveFamily] = map[string]bool{}
		}
		state.FamilyMissing[state.ActiveFamily][value.ID] = true
	}
	for _, old := range state.Requirements {
		if old.ID == value.ID {
			return
		}
	}
	state.Requirements = append(state.Requirements, value)
}
func governanceIntrinsicID(kind string, value any) string {
	bytes, _ := json.Marshal(value)
	return governanceHash(append([]byte(kind+":"), bytes...))
}
func (state *governanceProductsSession) installLeaves(neutral *string) {
	state.NeutralLeaf = string(stableJSON(neutral))
	project := governanceSharedProject(state.Project)
	project.NeutralClassIconSVG = neutral
	project.AcceptStepIDUnits = func(units []uint16) (bool, error) {
		id := governanceIntrinsicID("accept-step-id", units)
		if answer, ok := state.Answers[id]; ok && answer.Kind == "accept-step-id" && answer.Accepted != nil {
			return *answer.Accepted, nil
		}
		state.require(governanceIntrinsic{ID: id, Kind: "accept-step-id", Units: append([]uint16(nil), units...)})
		return false, fmt.Errorf("canonical step-ID observation pending")
	}
	project.LocaleOrder = func(values []string) sourcepolicy.OrderObservation {
		matrix := make([][]uint16, 0, len(values))
		for _, value := range values {
			decoded, err := jsstring.FromCompilerText(value)
			if err != nil {
				return sourcepolicy.OrderObservation{}
			}
			matrix = append(matrix, decoded.Units())
		}
		id := governanceIntrinsicID("locale-sort", matrix)
		if answer, ok := state.Answers[id]; ok && answer.Kind == "locale-sort" {
			return sourcepolicy.OrderObservation{Known: true, Groups: answer.Groups}
		}
		state.require(governanceIntrinsic{ID: id, Kind: "locale-sort", Values: matrix})
		return sourcepolicy.OrderObservation{}
	}
}
func (session *governanceSession) continueProducts(raw json.RawMessage) (any, error) {
	return session.continueProductsOwned(raw, true)
}

func (session *governanceSession) continueProductsOwned(raw json.RawMessage, forkGeneric bool) (any, error) {
	var params struct {
		Token                   string                             `json:"token"`
		Kind                    string                             `json:"kind"`
		Policy                  governanceCompiledPolicy           `json:"policy"`
		ImplementationContracts []governanceImplementationContract `json:"implementationContracts"`
		LeafAuthority           struct {
			NeutralClassIconSVG *string `json:"neutralClassIconSVG"`
		} `json:"leafAuthority"`
		Answers []governanceIntrinsicAnswer `json:"answers"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, err
	}
	if params.Kind == "generic-engine" || params.Kind == "generic" || params.Kind == "generic-retire" {
		return session.continueGeneric(raw)
	}
	state := session.productsSession
	if state == nil {
		return map[string]any{"status": "retry"}, nil
	}
	switch params.Kind {
	case "policy":
		if state.Project != nil || session.policySuspension == nil || params.Token != session.policySuspension.Token {
			return map[string]any{"status": "retry"}, nil
		}
		if forkGeneric && governanceGenericEnabled(state.Prepare.Options) {
			return session.startPolicyLane(raw)
		}
		project, err := session.continuePolicy(params.Token, params.Policy)
		if err != nil {
			session.discardProducts()
			return map[string]any{"status": "partial", "residual": []string{"Captured canonical policy could not be admitted: " + err.Error()}}, nil
		}
		state.Project = project
		project.sourceProofState = state
		state.Token = params.Token
		state.Generation = strconv.Itoa(session.generation)
		state.Contracts = params.ImplementationContracts
		state.Answers = map[string]governanceIntrinsicAnswer{}
		state.installLeaves(params.LeafAuthority.NeutralClassIconSVG)
		session.proposeSealedDecisions(state)
	case "intrinsics":
		if state.Project == nil || state.Token != params.Token || state.ProductsDigest != "" {
			return map[string]any{"status": "retry"}, nil
		}
		expected := map[string]governanceIntrinsic{}
		for _, requirement := range state.Requirements {
			expected[requirement.ID] = requirement
		}
		if len(params.Answers) != len(expected) {
			return nil, fmt.Errorf("incomplete canonical intrinsic answer batch")
		}
		seen := map[string]bool{}
		for _, answer := range params.Answers {
			requirement, ok := expected[answer.ID]
			if !ok || seen[answer.ID] || requirement.Kind != answer.Kind {
				return nil, fmt.Errorf("unexpected canonical intrinsic answer")
			}
			seen[answer.ID] = true
			session.observeSealedLeaf(state, answer)
			if answer.Kind == "accept-step-id" && answer.Accepted == nil {
				return nil, fmt.Errorf("missing canonical step-ID answer")
			}
			if answer.Kind == "locale-sort" && !governanceValidOrder(answer.Groups, len(requirement.Values)) {
				return nil, fmt.Errorf("invalid canonical locale permutation")
			}
			state.Answers[answer.ID] = answer
		}
		state.Requirements = nil
		state.ReplayAnswers = nil
		for family, missing := range state.FamilyMissing {
			for id := range missing {
				if seen[id] {
					delete(state.Project.familyProducts, family)
					delete(state.FamilyMissing, family)
					break
				}
			}
		}
		state.Project.familyResidual = nil
	default:
		return nil, fmt.Errorf("unsupported native continuation kind %s", params.Kind)
	}
	return session.evaluateProducts()
}
func governanceValidOrder(groups [][]int, count int) bool {
	seen := make([]bool, count)
	total := 0
	for _, group := range groups {
		if len(group) == 0 {
			return false
		}
		previous := -1
		for _, index := range group {
			if index < 0 || index >= count || seen[index] || index <= previous {
				return false
			}
			seen[index] = true
			previous = index
			total++
		}
	}
	return total == count
}

type governanceRuleFinding struct {
	Kind            string            `json:"kind"`
	Evidence        jsstring.JSONText `json:"evidence"`
	Location        *decisionLocation `json:"location,omitempty"`
	AmbiguityReason string            `json:"ambiguityReason,omitempty"`
}
type governanceRuleDecision struct {
	Status   string                  `json:"status"`
	Findings []governanceRuleFinding `json:"findings,omitempty"`
}
type governanceRuleProduct struct {
	RuleID         string                   `json:"ruleId"`
	RuleRevision   string                   `json:"ruleRevision"`
	Implementation governanceImplementation `json:"implementation"`
	Decision       governanceRuleDecision   `json:"decision"`
}
type governanceCapturedAuthority struct {
	Path       string `json:"path"`
	Revision   string `json:"revision"`
	Length     int    `json:"length"`
	LineStarts []int  `json:"lineStarts"`
}
type governanceSuppressionComment struct {
	Text       jsstring.JSONText `json:"text"`
	LinePrefix jsstring.JSONText `json:"linePrefix"`
	Location   *decisionLocation `json:"location"`
}

func governanceSuppressionComments(project *governedProject) []governanceSuppressionComment {
	out := []governanceSuppressionComment{}
	for _, file := range project.Files {
		scan := scanner.GetScannerForSourceFile(file.Source, 0)
		scan.SetSkipTrivia(false)
		scan.ResetPos(0)
		lines := scanner.GetECMALineStarts(file.Source)
		for kind := scan.Scan(); kind != ast.KindEndOfFile; kind = scan.Scan() {
			if kind != ast.KindSingleLineCommentTrivia && kind != ast.KindMultiLineCommentTrivia {
				continue
			}
			start, end := scan.TokenStart(), scan.TokenEnd()
			text := file.Text[start:end]
			if !strings.Contains(text, "astrale-disable-next-line") {
				continue
			}
			line := scanner.ComputeLineOfPosition(lines, start)
			offset := file.coordinates.utf16(start)
			location := &decisionLocation{file.Path, line + 1, offset - file.coordinates.utf16(int(lines[line])) + 1, offset, max(1, file.coordinates.utf16(end)-offset)}
			out = append(out, governanceSuppressionComment{jsstring.JSONText(text), jsstring.JSONText(file.Text[int(lines[line]):start]), location})
		}
	}
	return out
}
func (session *governanceSession) evaluateProducts() (any, error) {
	state := session.productsSession
	project := state.Project
	residual := governanceLiteralResidual(project)
	if project.capture.probeInconsistent {
		residual = append(residual, "Captured generic I/O observations changed or exceeded authority bounds.")
	}
	products := []governanceRuleProduct{}
	disabled := map[string]bool{}
	for id := range project.Disabled {
		disabled[id] = true
	}
	seen := map[string]bool{}
	var options struct {
		Generic *bool `json:"generic"`
	}
	if err := json.Unmarshal(state.Prepare.Options, &options); err != nil && len(state.Prepare.Options) > 0 {
		return nil, err
	}
	genericEnabled := options.Generic == nil || *options.Generic
	runtimeOutcomes := map[string]governanceOutcome{}
	runtimeEvaluated := false
	if len(state.Contracts) != len(governanceRevisions) {
		residual = append(residual, "Canonical whole implementation contract inventory unavailable.")
	}
	for _, contract := range state.Contracts {
		if seen[contract.RuleID] {
			return nil, fmt.Errorf("duplicate canonical implementation contract")
		}
		seen[contract.RuleID] = true
		if _, known := governanceRevisions[contract.RuleID]; !known {
			return nil, fmt.Errorf("unknown canonical implementation contract")
		}
		expectedID := "astrale.sdk.typescript-source"
		if contract.RuleID == "QRY-CANON" || contract.RuleID == "QRY-SINGLE" || contract.RuleID == "QLT-DEF-IDS" {
			expectedID = "astrale.sdk.codegraph"
		}
		if contract.Implementation.ID != expectedID || contract.Implementation.Version != "1" {
			return nil, fmt.Errorf("canonical implementation identity differs for %s", contract.RuleID)
		}
		if disabled[contract.RuleID] {
			continue
		}
		if contract.Implementation.ID == "astrale.sdk.codegraph" && !runtimeEvaluated {
			runtimeEvaluated = true
			observed := state.resumeRuntimeProducts()
			outcomes, ok := observed["decisions"].([]governanceOutcome)
			if !ok {
				residual = append(residual, "Native runtime observation authority unavailable: "+fmt.Sprint(observed["reason"]))
			}
			for _, outcome := range outcomes {
				runtimeOutcomes[outcome.Rule] = outcome
			}
		}
		revision, ok := governanceRevisions[contract.RuleID]
		if !ok || revision != contract.RuleRevision {
			residual = append(residual, "Native source revision authority unavailable: "+contract.RuleID)
			continue
		}
		var out governanceOutcome
		if contract.Implementation.ID == "astrale.sdk.codegraph" {
			var known bool
			out, known = runtimeOutcomes[contract.RuleID]
			if !known {
				residual = append(residual, "Native runtime rule observation unavailable: "+contract.RuleID)
				continue
			}
		} else {
			if state.RuleReady == nil {
				state.RuleReady = map[string]governanceOutcome{}
			}
			if ready, ok := state.RuleReady[contract.RuleID]; ok {
				out = ready
			} else {
				state.RulePending = false
				out, _ = governanceEvaluate(project, contract.RuleID)
				if out.Status != "residual" && !state.RulePending {
					state.RuleReady[contract.RuleID] = out
				}
			}
		}
		if out.Status == "residual" {
			residual = append(residual, "Native selected rule observation is incomplete: "+contract.RuleID)
			continue
		}
		decision := governanceRuleDecision{Status: out.Status}
		for _, finding := range out.Findings {
			kind := "indeterminate"
			if finding.Kind == "violation" {
				kind = "fail"
			}
			decision.Findings = append(decision.Findings, governanceRuleFinding{kind, jsstring.JSONText(finding.Evidence), finding.Location, finding.AmbiguityReason})
		}
		products = append(products, governanceRuleProduct{contract.RuleID, contract.RuleRevision, contract.Implementation, decision})
	}
	if len(state.Requirements) > 0 {
		return map[string]any{"status": "intrinsics", "token": state.Token, "requirements": state.Requirements}, nil
	}
	residual = append(residual, project.familyResidual...)
	if len(residual) > 0 {
		session.discardProducts()
		return map[string]any{"status": "partial", "residual": residual}, nil
	}
	if genericEnabled && state.GenericProduct == nil {
		state.GenericSuspended = true
		return state.genericSuspension(), nil
	}
	files := []governanceCapturedAuthority{}
	for _, file := range project.Files {
		starts := []int{}
		for _, start := range scanner.GetECMALineStarts(file.Source) {
			starts = append(starts, file.coordinates.utf16(int(start)))
		}
		files = append(files, governanceCapturedAuthority{file.Path, governanceHash([]byte(file.Text)), file.coordinates.utf16(len(file.Text)), starts})
	}
	envelope := struct {
		Root                 string                         `json:"root"`
		PolicyDigest         string                         `json:"policyDigest"`
		SourceSnapshotDigest string                         `json:"sourceSnapshotDigest"`
		Files                []governanceCapturedAuthority  `json:"files"`
		Products             []governanceRuleProduct        `json:"products"`
		SuppressionComments  []governanceSuppressionComment `json:"suppressionComments"`
		Generic              any                            `json:"generic"`
		GenericEngine        *governanceGenericEngine       `json:"genericEngine,omitempty"`
	}{project.Root, project.policyDigest, project.GovernanceDigest, files, products, governanceSuppressionComments(project), map[string]string{"status": "disabled"}, nil}
	if genericEnabled {
		envelope.Generic = state.GenericProduct
		envelope.GenericEngine = state.GenericEngine
	}
	bytes, err := json.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	if len(bytes) > 32*1024*1024 {
		session.discardProducts()
		return map[string]any{"status": "partial", "residual": []string{"Native product payload exceeds canonical consumer admission bound."}}, nil
	}
	state.ProductsDigest = governanceHash(bytes)
	state.InputCertificate = state.currentCertificate()
	result := map[string]any{"status": "products", "contractRevision": 1, "token": state.Token, "generation": state.Generation, "inputCertificate": state.InputCertificate, "governanceDigest": project.GovernanceDigest, "basePolicyDigest": state.Prepare.BasePolicyDigest, "policyDigest": project.policyDigest, "productsDigest": state.ProductsDigest, "productsJSON": string(bytes)}
	var debug struct {
		DebugPhaseCounters bool `json:"debugPhaseCounters"`
	}
	if len(state.Prepare.Options) > 0 {
		json.Unmarshal(state.Prepare.Options, &debug)
	}
	if debug.DebugPhaseCounters {
		result["phaseCounters"] = project.stats
		if state.RuntimeGraph != nil {
			result["runtimeDecisionCounters"] = map[string]int{"queryEvaluations": state.RuntimeGraph.QueryEvaluations, "definitionEvaluations": state.RuntimeGraph.DefinitionEvaluations, "readyPublicJoins": len(state.RuntimeReady)}
		}
	}
	return result, nil
}
func (session *governanceSession) sealProducts(token, productsDigest, reportDigest string) (any, error) {
	state := session.productsSession
	if state == nil || state.ProductsDigest == "" || state.Token != token || state.ProductsDigest != productsDigest || len(reportDigest) != 64 {
		return map[string]any{"status": "retry"}, nil
	}
	defer session.discardProducts()
	started := time.Now()
	reads := &governanceBarrierReads{}
	valid, err := state.Project.capture.verifyWithin(reads)
	if err != nil {
		return nil, err
	}
	if !valid {
		session.programGeneration = nil
		session.sealedDecisions = nil
		return map[string]any{"status": "retry"}, nil
	}
	for _, capture := range state.JoinedCaptures {
		valid, err = capture.verifyWithin(reads)
		if err != nil {
			return nil, err
		}
		if !valid {
			session.programGeneration = nil
			session.sealedDecisions = nil
			return map[string]any{"status": "retry"}, nil
		}
	}
	if state.ReplayExpected != nil {
		valid, err = state.ReplayExpected.verifyWithin(reads)
		if err != nil {
			session.sealedDecisions = nil
			return nil, err
		}
		if !valid {
			session.programGeneration = nil
			session.sealedDecisions = nil
			return map[string]any{"status": "retry"}, nil
		}
	}
	state.Project.stats.phase("final-uncached-seal", started)
	// A replay keeps its complete old expected closure. A fresh evaluation
	// replaces it only after its own capture has passed the original barrier.
	if state.ReplayExpected == nil {
		if state.Project.typeRelease != nil {
			state.Project.typeRelease()
			state.Project.typeRelease = nil
		}
		if state.Project.typeOwner != nil && state.Project.typeOwner.program != nil {
			session.programGeneration = governanceRetainProgramGeneration(state.Project, state.Project.typeOwner.generationBroker)
		}
		session.retainSealedDecisions(state)
		state.Project.borrowedGeneration = nil
	}
	result := map[string]any{"status": "committed", "token": token, "generation": state.Generation, "inputCertificate": state.InputCertificate, "productsDigest": productsDigest, "reportDigest": reportDigest}
	var debug struct {
		DebugPhaseCounters bool `json:"debugPhaseCounters"`
	}
	json.Unmarshal(state.Prepare.Options, &debug)
	if debug.DebugPhaseCounters {
		result["phaseCounters"] = state.Project.stats
	}
	return result, nil
}

// Every authored literal used by the shared text owner must be representable.
// Module filesystem encoding for lone surrogates is a separate authority gap;
// it cannot be hidden as an unresolved import after replacement-character loss.
func governanceLiteralResidual(project *governedProject) []string {
	residual := []string{}
	for _, file := range project.Files {
		invalid := false
		walk(file.Source.AsNode(), func(node *ast.Node) bool {
			if governanceLiteral(node) {
				if _, err := jsstring.FromNode(node); err != nil {
					invalid = true
				}
			}
			return true
		})
		if invalid {
			residual = append(residual, "Captured authored literal decoding authority unavailable: "+file.Path)
		}
		for _, imp := range file.Imports {
			var literal *ast.Node
			switch imp.Node.Kind {
			case ast.KindImportDeclaration:
				literal = imp.Node.AsImportDeclaration().ModuleSpecifier
			case ast.KindExportDeclaration:
				literal = imp.Node.AsExportDeclaration().ModuleSpecifier
			case ast.KindImportType:
				argument := imp.Node.AsImportTypeNode().Argument
				if argument != nil && argument.Kind == ast.KindLiteralType {
					literal = argument.AsLiteralTypeNode().Literal
				}
			case ast.KindCallExpression:
				call := imp.Node.AsCallExpression()
				if call.Arguments != nil && len(call.Arguments.Nodes) == 1 {
					literal = call.Arguments.Nodes[0]
				}
			}
			if literal == nil {
				continue
			}
			value, err := jsstring.FromNode(literal)
			if err != nil {
				continue
			}
			units := value.Units()
			for index := 0; index < len(units); index++ {
				unit := units[index]
				if unit >= 0xd800 && unit <= 0xdbff {
					if index+1 < len(units) && units[index+1] >= 0xdc00 && units[index+1] <= 0xdfff {
						index++
						continue
					}
					residual = append(residual, "Lone-surrogate module filesystem encoding authority unavailable: "+file.Path)
					break
				}
				if unit >= 0xdc00 && unit <= 0xdfff {
					residual = append(residual, "Lone-surrogate module filesystem encoding authority unavailable: "+file.Path)
					break
				}
			}
		}
	}
	return residual
}
