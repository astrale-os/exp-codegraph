package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type governanceRevision struct {
	ID       string `json:"id"`
	Revision string `json:"revision"`
}
type governancePrepare struct {
	ProjectionMode   string               `json:"projectionMode,omitempty"`
	Root             string               `json:"root"`
	BasePolicyDigest string               `json:"basePolicyDigest"`
	RuleRevisions    []governanceRevision `json:"ruleRevisions"`
	PolicySource     *governancePolicy    `json:"policySource"`
	Options          json.RawMessage      `json:"options"`
	Changed          []string             `json:"changed,omitempty"`
}
type governanceProduct struct {
	Requirements     []governanceIntrinsic   `json:"requirements,omitempty"`
	Complete         bool                    `json:"complete"`
	Root             string                  `json:"root"`
	GovernanceDigest string                  `json:"governanceDigest"`
	InputCertificate string                  `json:"inputCertificate"`
	Files            []governanceFileSummary `json:"files"`
	Outcomes         []governanceOutcome     `json:"outcomes"`
	Residual         []string                `json:"residual"`
	Observations     []governanceObservation `json:"observations"`
	PhaseCounters    governancePhaseCounters `json:"phaseCounters"`
}
type governanceFileSummary struct {
	Path      string `json:"path"`
	Role      string `json:"role"`
	Layer     string `json:"layer,omitempty"`
	Submodule string `json:"submodule,omitempty"`
}
type governancePhaseCounters struct {
	TypeRequests               []governanceTypeRequest `json:"typeRequests,omitempty"`
	PhaseNanoseconds           map[string]int64        `json:"phaseNanoseconds,omitempty"`
	FamilyEvaluations          int                     `json:"familyEvaluations"`
	SourceReads                int                     `json:"sourceReads"`
	SourceBytes                int                     `json:"sourceBytes"`
	Parses                     int                     `json:"parses"`
	ParseReuses                int                     `json:"parseReuses"`
	RuleEvaluations            int                     `json:"ruleEvaluations"`
	TypeCells                  int                     `json:"typeCells"`
	LiteralCells               int                     `json:"literalCells"`
	TypeCacheHits              int                     `json:"typeCacheHits"`
	TypeCacheMisses            int                     `json:"typeCacheMisses"`
	TypeCacheReplayNanoseconds int64                   `json:"typeCacheReplayNanoseconds"`
	CompilerPrograms           int                     `json:"compilerPrograms"`
}
type governanceSession struct {
	// Last acknowledged fact metadata only; never retains a captured Program.
	semanticPublished generationState
	genericProducer   *governanceOwnedProcess
	ownedSignals      *governanceOwnedSessionSignals
	policyLane        *governancePolicyLane
	sealedDecisions   *governanceSealedDecisions
	programGeneration *governanceProgramGeneration
	typeDemandCache   *governanceTypeDemandCache
	productsSession   *governanceProductsSession
	policySuspension  *governancePolicySuspension
	parseCache        map[string]*governedFile
	root              string
	generation        int
}

// Every project, retained lease and generation callback borrows this stable heap
// owner. Moving a session moves only its sole owning pointer; the actor being
// retired clears its pointer rather than relocating the borrowed cache object.
func (session *governanceSession) typeDemandOwner() *governanceTypeDemandCache {
	if session.typeDemandCache == nil {
		session.typeDemandCache = &governanceTypeDemandCache{}
	}
	return session.typeDemandCache
}

func (session *governanceSession) prepareSource(params governancePrepare) (*governedProject, governanceProduct, error) {
	product := governanceProduct{Complete: false, Outcomes: []governanceOutcome{}, Residual: []string{}, Files: []governanceFileSummary{}, Observations: []governanceObservation{}}
	if params.PolicySource == nil {
		product.Residual = append(product.Residual, "Native canonical policy source authority unavailable.")
		return nil, product, nil
	}
	root := params.Root
	if root == "" {
		root = session.root
	}
	project, err := captureGovernedProjectCached(root, *params.PolicySource, session.parseCache)
	if err != nil {
		return nil, product, err
	}
	session.parseCache = project.FilesByPath
	project.typeDemandCache = session.typeDemandOwner()
	// Developer-only finite source oracle: supplied answers are the canonical
	// SDK leaf observations, never compiler type cells or runtime authored code.
	var proof struct {
		SourceProof *struct {
			NeutralClassIconSVG *string                     `json:"neutralClassIconSVG"`
			Answers             []governanceIntrinsicAnswer `json:"answers"`
		} `json:"sourceProof"`
	}
	if len(params.Options) > 0 {
		if err := json.Unmarshal(params.Options, &proof); err != nil {
			return nil, product, err
		}
	}
	var proofState *governanceProductsSession
	if proof.SourceProof != nil {
		proofState = &governanceProductsSession{Project: project, Answers: map[string]governanceIntrinsicAnswer{}}
		for _, answer := range proof.SourceProof.Answers {
			proofState.Answers[answer.ID] = answer
		}
		proofState.installLeaves(proof.SourceProof.NeutralClassIconSVG)
		project.sourceProofState = proofState
	}
	product.Root = project.Root
	product.GovernanceDigest = project.GovernanceDigest
	product.InputCertificate = project.capture.certificate()
	for _, file := range project.Files {
		product.Files = append(product.Files, governanceFileSummary{file.Path, file.Role, file.Layer, file.Submodule})
	}
	sourceOwnerRequired := false
	for _, rule := range params.RuleRevisions {
		revision, ok := governanceRevisions[rule.ID]
		if !ok {
			product.Residual = append(product.Residual, "Native rule implementation unavailable: "+rule.ID)
			continue
		}
		if revision != rule.Revision {
			product.Residual = append(product.Residual, "Native rule revision differs: "+rule.ID)
			continue
		}
		// Default prepare is an unsupported partial adapter, not a Source49 owner.
		// Keep revision diagnostics in request order before reporting that boundary.
		if rule.ID != "QRY-CANON" && rule.ID != "QRY-SINGLE" && rule.ID != "QLT-DEF-IDS" {
			sourceOwnerRequired = true
			continue
		}
		out, _ := governanceEvaluate(project, rule.ID)
		product.Outcomes = append(product.Outcomes, out)
	}
	for _, row := range project.capture.observations {
		product.Observations = append(product.Observations, row)
	}
	product.Residual = append(product.Residual, project.familyResidual...)
	if sourceOwnerRequired {
		product.Residual = append(product.Residual, "Native source-family evaluation requires the SDK source-policy owner.")
	}
	product.InputCertificate = project.capture.certificate()
	product.Residual = append(product.Residual, "Canonical full policy compilation and whole LintResult assembly/suppression are not qualified.")
	product.PhaseCounters = project.stats
	if proofState != nil {
		product.Requirements = proofState.Requirements
	}
	return project, product, nil
}

func runDecisionServe(arguments []string) int {
	root := ""
	if len(arguments) == 2 && arguments[0] == "--cwd" {
		root = arguments[1]
	} else if len(arguments) != 0 {
		fmt.Fprintln(os.Stderr, "decision-serve expects --cwd ROOT")
		return 2
	}
	if root == "" {
		root, _ = os.Getwd()
	}
	root, _ = filepath.Abs(root)
	session := governanceSession{root: root, ownedSignals: governanceNewOwnedSessionSignals()}
	encoder := json.NewEncoder(os.Stdout)
	defer session.ownedSignals.stop()
	encoder.Encode(map[string]any{"service": "astrale.lint-decision", "protocol": 1, "contractRevision": 1, "semanticReaderRevision": 1})
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 64*1024*1024)
	for scanner.Scan() {
		var request struct {
			ID     int             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			return 2
		}
		var result any
		var err error
		switch request.Method {
		case "prepare":
			session.discardProducts()
			var params governancePrepare
			err = json.Unmarshal(request.Params, &params)
			if err == nil {
				if params.ProjectionMode == "sdk-rule-products" {
					session.productsSession = &governanceProductsSession{Prepare: params}
					requestedRoot := params.Root
					if requestedRoot == "" {
						requestedRoot = session.root
					}
					result, err = session.captureConfiguration(requestedRoot)
					break
				}
				var product governanceProduct
				_, product, err = session.prepareSource(params)
				if err != nil {
					product.Residual = append(product.Residual, "Native capture error requires legacy qualification: "+err.Error())
					err = nil
				}
				result = map[string]any{"status": "partial", "residual": product.Residual}
			}
		case "capture-owned-generic":
			result, err = session.captureOwnedGeneric(request.Params)
		case "capture-probes":
			result, err = session.captureProbes(request.Params)
		case "semantic-open":
			result, err = session.openSemanticProjection(request.Params)
		case "semantic-request":
			result, err = session.requestSemanticProjection(request.Params)
		case "continue":
			result, err = session.continueProducts(request.Params)
		case "seal":
			var params struct {
				Token          string `json:"token"`
				ReportDigest   string `json:"reportDigest"`
				ProductsDigest string `json:"productsDigest"`
			}
			err = json.Unmarshal(request.Params, &params)
			if err == nil {
				if params.ProductsDigest != "" {
					result, err = session.sealProducts(params.Token, params.ProductsDigest, params.ReportDigest)
				} else {
					result = map[string]any{"status": "retry"}
				}
			}
		default:
			err = fmt.Errorf("Unsupported decision method %s.", request.Method)
		}
		if err != nil {
			code := "LINTER_PROJECT_INVALID"
			if _, ok := err.(*governanceSemanticBudgetError); ok {
				code = "LINTER_SEMANTIC_FAILED"
			}
			encoder.Encode(map[string]any{"id": request.ID, "error": map[string]string{"code": code, "message": err.Error()}})
		} else {
			encoder.Encode(map[string]any{"id": request.ID, "result": result})
		}
	}
	session.discardProducts()
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(os.Stderr, strings.TrimSpace(err.Error()))
		return 2
	}
	return 0
}
