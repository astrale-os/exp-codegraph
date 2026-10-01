package observabledecision

import "strings"

func legacyValueMessage(code string) string {
	switch code {
	case "VALUE_STEP_LIMIT":
		return "Bounded value evaluation exceeded its step limit."
	case "VALUE_DEPTH_LIMIT":
		return "Bounded value evaluation exceeded its depth limit."
	case "VALUE_ALTERNATIVE_LIMIT":
		return "Bounded value evaluation exceeded its alternative limit."
	case "VALUE_MUTATION_UNSUPPORTED":
		return "Writes to this binding or an object alias prevent an initializer-only value proof."
	case "VALUE_CONTROL_FLOW_INCOMPLETE":
		return "The function control flow is incomplete in this snapshot."
	case "VALUE_ASSIGNMENT_UNSUPPORTED":
		return "Assignment operands do not prove the effective assigned value."
	case "VALUE_RELATION_MISSING":
		return "A required value relation is unavailable."
	case "DEFINITION_ID_EXTERNAL":
		return "The definition ID has an external value whose string is unavailable."
	case "VALUE_ESCAPE_UNSUPPORTED":
		return "This value was passed to an unmodeled call that may mutate it."
	case "noncallable value":
		return "The resolved value is not an inspectable function."
	case "async function invocation", "generator invocation":
		return "The function is not proved to produce a synchronous value."
	case "property receiver unavailable":
		return "The receiver has no inspectable object properties."
	}
	return ""
}
func PublicQueryReason(value DemandOutcome) string {
	if len(value.Reasons) > 0 && value.Kind == "unknown" {
		parts := []string{}
		for _, reason := range value.Reasons {
			message := reason.Message
			if reason.Code == "VALUE_STEP_LIMIT" || reason.Code == "VALUE_DEPTH_LIMIT" || reason.Code == "VALUE_ALTERNATIVE_LIMIT" {
				message = "analysis budget exhausted: " + message
			}
			parts = append(parts, message)
		}
		return strings.Join(parts, "; ")
	}

	if value.Kind == "ambiguous" {
		return "value has multiple possible origins"
	}
	message := value.Message
	if message == "" {
		message = legacyValueMessage(value.Reason)
	}
	if message == "" {
		return value.Reason
	}
	switch value.Reason {
	case "VALUE_STEP_LIMIT", "VALUE_DEPTH_LIMIT", "VALUE_ALTERNATIVE_LIMIT":
		return "analysis budget exhausted: " + message
	}
	return message
}
func PublicDefinitionReason(value DemandOutcome) string {
	if value.Kind == "ambiguous" {
		return "the projector has multiple possible IDs."
	}
	return PublicQueryReason(value)
}
