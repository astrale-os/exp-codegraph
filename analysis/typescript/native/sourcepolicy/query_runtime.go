package sourcepolicy

import (
	runtime "astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"strings"
)

// RuntimeQueryInput receives observation and identity products from the SAME
// captured native authority. CompleteInventory is separate from supported
// selected observation proofs; a selected-demand pilot cannot establish it.
type RuntimeQueryInput struct {
	Product           runtime.QueryProduct
	CallIdentity      func(*File, *ast.Node) (string, bool)
	CompleteInventory bool
}

func qmRuntimeValue(value runtime.DemandOutcome) qmEpistemic {
	return qmEpistemic{state: value.Kind, count: value.Count, reason: runtime.PublicQueryReason(value)}
}
func EvaluateRuntimeQueries(project *Project, input RuntimeQueryInput) Result {
	w := qmWriter{project: project}
	observations := []qmObservation{}
	for _, value := range input.Product.Observations {
		if value.ConstructorIdentity == "astrale.sdk.defineCollectionQuery" {
			continue
		}
		file := project.FilesByPath[value.Path]
		if file == nil {
			w.residual("QRY-CANON", nil, nil, "Runtime query source is not a current admitted source.")
			w.residual("QRY-SINGLE", nil, nil, "Runtime query source is not a current admitted source.")
			continue
		}
		node := file.runtimeCall(value.Start, value.End, false)
		if node == nil {
			for _, rule := range []string{"QRY-CANON", "QRY-SINGLE"} {
				w.residual(rule, file, file.Source.AsNode(), "Runtime query observation does not anchor to the current captured AST.")
			}
			continue
		}
		subject, known := "", false
		if input.CallIdentity != nil {
			subject, known = input.CallIdentity(file, node)
		}
		if !known {
			for _, rule := range []string{"QRY-CANON", "QRY-SINGLE"} {
				w.residual(rule, file, node, "Certified compiler membership, universe, and body-call identity authority unavailable.")
			}
			continue
		}
		shape := value.ProjectorShape
		if value.Ownership.Kind != "known" {
			value.CanonicalRequestCount.Message = value.Ownership.Message
			value.CanonicalRequestCount.Reason = value.Ownership.Message
			value.CanonicalRequestCount.Reasons = nil
		}
		observations = append(observations, qmObservation{file: file, node: node, subject: subject, identity: value.Ownership.Kind, shape: &shape, shapeProof: qmRuntimeValue(value.ProjectorProof), build: qmRuntimeValue(value.BuildCallbackCount), project: qmRuntimeValue(value.ProjectCallbackCount), request: qmRuntimeValue(value.CanonicalRequestCount)})
	}
	failures := []string{}
	for _, failure := range input.Product.DiscoveryFailures {
		failures = append(failures, failure.Path+": "+failure.Reason)
	}
	failures = append(failures, input.Product.InventoryReasons...)
	if len(failures) > 0 {
		unique := []string{}
		seen := map[string]bool{}
		for _, failure := range failures {
			if !seen[failure] {
				seen[failure] = true
				unique = append(unique, failure)
			}
		}
		reason := strings.Join(unique, "; ")
		observations = append(observations, qmObservation{subject: "codegraph:query-call-inventory", identity: "unknown", request: qmEpistemic{state: "unknown", reason: "Query call discovery is incomplete: " + reason}})
	}
	w.decideQueries("QRY-CANON", observations)
	w.decideQueries("QRY-SINGLE", observations)
	for _, file := range project.Files {
		if file.Role == "production" && file.Layer == "queries" {
			w.projector("QRY-CANON", file, "defineCompositeQuery", "Composite Query")
		}
	}
	if !input.CompleteInventory || len(input.Product.Residual) > 0 {
		for _, rule := range []string{"QRY-CANON", "QRY-SINGLE"} {
			w.residual(rule, nil, nil, "Complete legacy-compatible runtime query discovery and current compiler membership are not yet established.")
		}
	}
	return w.out
}
