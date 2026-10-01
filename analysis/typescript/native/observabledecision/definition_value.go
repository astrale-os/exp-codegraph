package observabledecision

// Definition IDs map the original proof, rather than reclassifying its candidates.
// Every non-string maps to undefined, but an external value may itself be a string.
func (r *demandRun) finishDefinitionID(value demandValue) DemandOutcome {
	out := r.finish(value, "")
	if out.Kind == "unsupported" {
		return out
	}
	_, original, reasons := r.projected(value)
	if out.Kind == "unknown" {
		original = out.Candidates
		if len(original) == 0 {
			_, original, _ = r.projected(value)
		}
	}
	projected := make([]NativeValueSummary, 0, len(original))
	external := false
	for _, candidate := range original {
		if candidate.Kind == "external" || candidate.Kind == "constructor" || candidate.Kind == "query-namespace" {
			external = true
			continue
		}
		if candidate.Kind == "string" {
			projected = append(projected, NativeValueSummary{Kind: "string", Literal: candidate.Literal})
		} else {
			projected = append(projected, NativeValueSummary{Kind: "undefined"})
		}
	}
	if external {
		if out.Kind != "unknown" {
			out.Reasons = nil
			if out.Kind == "ambiguous" {
				out.Reasons = reasons
			}
		}
		out.Kind = "unknown"
		out.Values = nil
		out.Candidates = projected
		out.Reasons = append(out.Reasons, DemandReason{Code: "DEFINITION_ID_EXTERNAL", Message: legacyValueMessage("DEFINITION_ID_EXTERNAL")})
		out.Reason = out.Reasons[0].Code
		out.Message = out.Reasons[0].Message
		return out
	}
	if out.Kind == "unknown" {
		out.Candidates = projected
		return out
	}
	out.Values = projected
	same := len(projected) > 0
	for _, candidate := range projected {
		if candidate.Kind != projected[0].Kind || candidate.Literal != projected[0].Literal {
			same = false
		}
	}
	if same {
		out.Kind = "known"
		out.Reasons = nil
		out.Reason = ""
		out.Message = ""
		out.StringPresent = projected[0].Kind == "string"
		out.String = projected[0].Literal
	}
	return out
}
