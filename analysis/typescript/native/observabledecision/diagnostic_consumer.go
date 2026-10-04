package observabledecision

import (
	"encoding/json"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"os"
	"runtime/debug"
)

var DiagnosticParameterKeys = map[string]bool{}
var DiagnosticSubject string
var DiagnosticRequest EffectRequest
var DiagnosticProofKind, DiagnosticProofSymbol, DiagnosticLocalOwner string

func DiagnosticEvent(kind string, path string, node *ast.Node, extra map[string]any) {
	output := os.Getenv("ASTRALE_DIAGNOSTIC_CONSUMER_TRACE")
	if output == "" {
		return
	}
	row := map[string]any{"event": kind, "path": path, "subject": DiagnosticSubject, "operation": DiagnosticRequest.Operation, "requestPath": DiagnosticRequest.Path, "proofKind": DiagnosticProofKind, "proofSymbol": DiagnosticProofSymbol, "localOwner": DiagnosticLocalOwner}
	if node != nil {
		row["pos"] = node.Pos()
		row["end"] = node.End()
	}
	if DiagnosticRequest.Node != nil {
		row["requestPos"] = DiagnosticRequest.Node.Pos()
		row["requestEnd"] = DiagnosticRequest.Node.End()
	}
	for k, v := range extra {
		row[k] = v
	}
	if path == "views/salary/use-salaries.ts" && node != nil && node.Pos() == 4773 {
		row["stack"] = string(debug.Stack())
	}
	bytes, err := json.Marshal(row)
	if err != nil {
		return
	}
	f, err := os.OpenFile(output, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	defer f.Close()
	f.Write(append(bytes, '\n'))
}
