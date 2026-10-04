package module

import "github.com/microsoft/typescript-go/internal/ast"

// Forward the exact pinned compiler constants; no private numeric flag model.
const IdentityValueMemberFlags = ast.CheckFlagsMapped | ast.CheckFlagsInstantiated | ast.CheckFlagsReadonly

const (
	FlowFlagsAssignment = ast.FlowFlagsAssignment
	FlowFlagsReferenced = ast.FlowFlagsReferenced
	FlowFlagsShared     = ast.FlowFlagsShared
)
