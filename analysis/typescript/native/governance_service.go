package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
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
	Runtime          any                           `json:"runtime,omitempty"`
	Requirements     []governanceIntrinsic         `json:"requirements,omitempty"`
	Complete         bool                          `json:"complete"`
	Root             string                        `json:"root"`
	GovernanceDigest string                        `json:"governanceDigest"`
	InputCertificate string                        `json:"inputCertificate"`
	Files            []governanceFileSummary       `json:"files"`
	Outcomes         []governanceOutcome           `json:"outcomes"`
	Residual         []string                      `json:"residual"`
	Observations     []governanceObservation       `json:"observations"`
	PhaseCounters    governancePhaseCounters       `json:"phaseCounters"`
	Resolutions      []governanceResolutionSummary `json:"resolutions,omitempty"`
	Imports          []governanceImportSummary     `json:"imports,omitempty"`
	Authored         []governanceAuthoredSummary   `json:"authored,omitempty"`
}
type governanceImportSummary struct {
	Path      string                     `json:"path"`
	Specifier string                     `json:"specifier"`
	TypeOnly  bool                       `json:"typeOnly"`
	Dynamic   bool                       `json:"dynamic"`
	Namespace string                     `json:"namespace,omitempty"`
	Bindings  []governanceBindingSummary `json:"bindings"`
	Location  *decisionLocation          `json:"location"`
}
type governanceBindingSummary struct {
	Imported string `json:"imported"`
	Local    string `json:"local"`
}
type governanceResolutionSummary struct {
	Path           string `json:"path"`
	Specifier      string `json:"specifier"`
	CompilerTarget string `json:"compilerTarget"`
	PackageTarget  string `json:"packageTarget"`
}
type governanceFileSummary struct {
	Path      string `json:"path"`
	Role      string `json:"role"`
	Layer     string `json:"layer,omitempty"`
	Submodule string `json:"submodule,omitempty"`
}
type governancePhaseCounters struct {
	SourceReads      int `json:"sourceReads"`
	SourceBytes      int `json:"sourceBytes"`
	Parses           int `json:"parses"`
	ParseReuses      int `json:"parseReuses"`
	RuleEvaluations  int `json:"ruleEvaluations"`
	TypeCells        int `json:"typeCells"`
	LiteralCells     int `json:"literalCells"`
	CompilerPrograms int `json:"compilerPrograms"`
}
type governanceSession struct {
	productsSession  *governanceProductsSession
	policySuspension *governancePolicySuspension
	parseCache       map[string]*governedFile
	root             string
	generation       int
	staged           *governanceCandidate
}
type governanceCandidate struct {
	token, reportDigest, inputCertificate string
	generation                            int
	capture                               *governanceCapture
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
	if session.parseCache == nil {
		session.parseCache = map[string]*governedFile{}
	}
	project, err := captureGovernedProjectCached(root, *params.PolicySource, session.parseCache)
	if err != nil {
		return nil, product, err
	}
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
	}
	product.Root = project.Root
	product.GovernanceDigest = project.GovernanceDigest
	product.InputCertificate = project.capture.certificate()
	for _, file := range project.Files {
		product.Files = append(product.Files, governanceFileSummary{file.Path, file.Role, file.Layer, file.Submodule})
	}
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
		out, _ := governanceEvaluate(project, rule.ID)
		product.Outcomes = append(product.Outcomes, out)
	}
	for _, row := range project.capture.observations {
		product.Observations = append(product.Observations, row)
	}
	product.Residual = append(product.Residual, project.familyResidual...)
	product.InputCertificate = project.capture.certificate()
	product.Residual = append(product.Residual, "Canonical full policy compilation and whole LintResult assembly/suppression are not qualified.")
	product.PhaseCounters = project.stats
	if proofState != nil {
		product.Requirements = proofState.Requirements
	}
	return project, product, nil
}

// Stage is a private composition boundary for a future qualified whole-report
// assembler. The public server below never calls it for partial rule products.
func (session *governanceSession) stage(project *governedProject, reportJSON string) *governanceCandidate {
	session.generation++
	digest := sha256.Sum256([]byte(reportJSON))
	reportDigest := hex.EncodeToString(digest[:])
	input := project.capture.certificate()
	token := governanceHash([]byte(fmt.Sprintf("%d\000%s\000%s", session.generation, input, reportDigest)))
	candidate := &governanceCandidate{token, reportDigest, input, session.generation, project.capture}
	session.staged = candidate
	return candidate
}
func (session *governanceSession) seal(token, reportDigest string) (map[string]any, error) {
	candidate := session.staged
	session.staged = nil
	if candidate == nil || candidate.token != token || candidate.reportDigest != reportDigest {
		return map[string]any{"status": "retry"}, nil
	}
	same, err := candidate.capture.Verify()
	if err != nil {
		return nil, err
	}
	if !same {
		return map[string]any{"status": "retry"}, nil
	}
	return map[string]any{"status": "committed", "token": token, "reportDigest": reportDigest, "generation": candidate.generation, "inputCertificate": candidate.inputCertificate}, nil
}
func runGovernanceCheck() int {
	var params governancePrepare
	if err := json.NewDecoder(os.Stdin).Decode(&params); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	session := governanceSession{}
	project, product, err := session.prepareSource(params)
	if err != nil {
		json.NewEncoder(os.Stdout).Encode(map[string]any{"error": map[string]string{"code": "LINTER_PROJECT_INVALID", "message": err.Error()}})
		return 0
	}
	if project != nil {
		var runtimeOptions struct {
			DebugRuntime bool `json:"debugRuntime"`
		}
		if len(params.Options) > 0 {
			json.Unmarshal(params.Options, &runtimeOptions)
		}
		if runtimeOptions.DebugRuntime {
			product.Runtime = governanceProbeRuntime(project)
		}
		product.Authored = governanceProbeAuthoring(project, params.Options)
		for _, file := range project.Files {
			for _, imp := range file.Imports {
				importRow := governanceImportSummary{Path: file.Path, Specifier: imp.Specifier, TypeOnly: imp.TypeOnly, Dynamic: imp.Dynamic, Namespace: imp.Namespace, Bindings: []governanceBindingSummary{}, Location: governanceLocation(file, imp.Node)}
				for _, binding := range imp.Bindings {
					importRow.Bindings = append(importRow.Bindings, governanceBindingSummary{binding.Imported, binding.Local})
				}
				product.Imports = append(product.Imports, importRow)
				compiler := project.resolveImport(file, imp.Specifier, false)
				packaged := project.resolveImport(file, imp.Specifier, true)
				row := governanceResolutionSummary{Path: file.Path, Specifier: imp.Specifier}
				if compiler.IsResolved() {
					row.CompilerTarget = compiler.ResolvedFileName
				}
				if packaged.IsResolved() {
					row.PackageTarget = packaged.ResolvedFileName
				}
				product.Resolutions = append(product.Resolutions, row)
			}
		}
		product.InputCertificate = project.capture.certificate()
	}
	json.NewEncoder(os.Stdout).Encode(product)
	return 0
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
	session := governanceSession{root: root}
	encoder := json.NewEncoder(os.Stdout)
	encoder.Encode(map[string]any{"service": "astrale.lint-decision", "protocol": 1, "contractRevision": 1})
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
			session.staged = nil
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
		case "capture-probes":
			result, err = session.captureProbes(request.Params)
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
					result, err = session.seal(params.Token, params.ReportDigest)
				}
			}
		default:
			err = fmt.Errorf("Unsupported decision method %s.", request.Method)
		}
		if err != nil {
			encoder.Encode(map[string]any{"id": request.ID, "error": map[string]string{"code": "LINTER_PROJECT_INVALID", "message": err.Error()}})
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
