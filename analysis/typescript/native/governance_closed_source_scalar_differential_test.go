package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"astrale-typespec-v2-native-analysis/sourcepolicy"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

type scalarDifferentialRequest struct {
	Request     governanceClosedSourceRequest `json:"request"`
	Initializer string                        `json:"initializer,omitempty"`
}
type scalarDifferentialCase struct {
	ID, Root string
	Requests []scalarDifferentialRequest
}
type scalarDifferentialInput struct {
	Policy governancePolicy
	Cases  []scalarDifferentialCase
}

// Both controls borrow genuine, separately captured compiler authorities. The
// original helper selects the actual declaration initializer, independently of
// the transport's span walk; this does not qualify policy-lane or seal behavior.
func originalScalar(t *testing.T, project *governedProject, input scalarDifferentialRequest) governanceClosedSourceAnswer {
	t.Helper()
	request := input.Request
	file := project.FilesByPath[request.Path]
	if file == nil {
		t.Fatalf("original file missing: %s", request.Path)
	}
	answer := governanceClosedSourceAnswer{Status: "known"}
	specifier := jsstring.FromUnits(request.SpecifierUnits)
	if request.Operation == "resolve" {
		value := project.resolveImport(file, specifier.WTF8(), request.PackageOnly)
		if value.IsResolved() {
			answer.Resolution = &governanceClosedSourceResolution{ResolvedPath: jsstring.JSONText(value.ResolvedFileName)}
		}
		return answer
	}
	if request.Operation == "package-mapping" {
		answer.Mapping = project.packageImportMappingKind(file, specifier.WTF8())
		return answer
	}
	var expression *ast.Node
	walkFile(file.Source, func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && node.Name() != nil && node.Name().Text() == input.Initializer {
			expression = node.AsVariableDeclaration().Initializer
		}
		return true
	})
	if expression == nil {
		t.Fatalf("original initializer missing: %s/%s", request.Path, input.Initializer)
	}
	if file.coordinates.utf16(scanner.GetTokenPosOfNode(expression, file.Source, false)) != request.Start || file.coordinates.utf16(expression.End()) != request.End {
		t.Fatalf("SDK/native initializer range differs: %#v", request)
	}
	shared := governanceSharedProject(project).FilesByPath[file.Path]
	if request.Operation == "collection" {
		observed := project.typeOwner.collectionKind(shared, expression)
		if !observed.Known {
			answer.Status = "unavailable"
		} else if observed.Kind != "" {
			answer.Kind = &observed.Kind
		}
		return answer
	}
	var observed sourcepolicy.NamesObservation
	if request.Operation == "names" {
		observed = project.typeOwner.names(shared, expression)
	} else {
		observed = project.typeOwner.closed(shared, expression)
	}
	if !observed.Known {
		answer.Status = "unavailable"
		return answer
	}
	if observed.Names != nil {
		answer.Names = []jsstring.JSONText{}
		for _, name := range observed.Names {
			answer.Names = append(answer.Names, jsstring.JSONText(name))
		}
	}
	return answer
}

func scalarNameUnits(t *testing.T, names []jsstring.JSONText) [][]uint16 {
	t.Helper()
	if names == nil {
		return nil
	}
	units := [][]uint16{}
	for _, name := range names {
		value, err := jsstring.FromCompilerText(string(name))
		if err != nil {
			t.Fatalf("invalid original compiler property-name encoding: %v", err)
		}
		units = append(units, value.Units())
	}
	return units
}

func TestClosedSourceScalarDifferential(t *testing.T) {
	var input scalarDifferentialInput
	inputPath := os.Getenv("ASTRALE_SCALAR_DIFFERENTIAL_INPUT")
	outputPath := os.Getenv("ASTRALE_SCALAR_DIFFERENTIAL_OUTPUT")
	if inputPath != "" {
		if outputPath == "" {
			t.Fatal("shared scalar fixture has no output path")
		}
		bytes, err := os.ReadFile(inputPath)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(bytes, &input); err != nil {
			t.Fatal(err)
		}
		if len(input.Cases) == 0 {
			t.Fatal("shared scalar fixture has no cases")
		}
	} else {
		// Default unit remains meaningful without an external artifact or skip:
		// an empty inferred object is known [], while its identifier is not a
		// closed literal. Leading astral trivia exercises the UTF16 anchor.
		root := t.TempDir()
		governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"noLib":true},"include":["mutations/**/*.ts"]}`)
		governanceWrite(t, root, "mutations/source.ts", "//😀\nconst patch={}; const operand=patch;")
		project, err := captureGovernedProject(root, governanceTestPolicy())
		if err != nil {
			t.Fatal(err)
		}
		file := project.FilesByPath["mutations/source.ts"]
		var node *ast.Node
		walkFile(file.Source, func(candidate *ast.Node) bool {
			if candidate.Kind == ast.KindVariableDeclaration && candidate.Name() != nil && candidate.Name().Text() == "operand" {
				node = candidate.AsVariableDeclaration().Initializer
			}
			return true
		})
		if node == nil {
			t.Fatal("default actual initializer missing")
		}
		input.Policy = governanceTestPolicy()
		sample := scalarDifferentialCase{ID: "default-empty", Root: root}
		for _, operation := range []string{"closed", "names"} {
			sample.Requests = append(sample.Requests, scalarDifferentialRequest{Initializer: "operand", Request: governanceClosedSourceRequest{Path: file.Path, Operation: operation, Start: file.coordinates.utf16(scanner.GetTokenPosOfNode(node, file.Source, false)), End: file.coordinates.utf16(node.End())}})
		}
		input.Cases = []scalarDifferentialCase{sample}
	}
	rows := []map[string]any{}
	for _, sample := range input.Cases {
		t.Run(sample.ID, func(t *testing.T) {
			original, err := captureGovernedProject(sample.Root, input.Policy)
			if err != nil {
				t.Fatal(err)
			}
			current, err := captureGovernedProject(sample.Root, input.Policy)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if original.typeRelease != nil {
					original.typeRelease()
					original.typeRelease = nil
				}
			}()
			state := &governanceProductsSession{Project: current, Token: "scalar-" + sample.ID, Generation: "1", Prepare: governancePrepare{Options: json.RawMessage(`{"generic":false,"sourcePolicyOwnerRevision":2}`)}}
			session := governanceSession{productsSession: state}
			defer session.discardProducts()
			frame, err := session.closedSourceHandoff(false)
			if err != nil {
				t.Fatal(err)
			}
			if frame.(map[string]any)["status"] != "source" {
				t.Fatalf("actual handoff unavailable: %#v", frame)
			}
			governanceSourceObservationFixture(t, &session)
			results := []map[string]any{}
			for _, probe := range sample.Requests {
				direct := originalScalar(t, original, probe)
				request := probe.Request
				request.Generation = state.Generation
				request.Token = state.Token
				request.SourceSnapshotDigest = current.GovernanceDigest
				actual, err := session.observeClosedSource(request)
				if err != nil {
					t.Fatal(err)
				}
				results = append(results, map[string]any{"request": request, "direct": direct, "actual": actual, "directNameUnits": scalarNameUnits(t, direct.Names), "actualNameUnits": scalarNameUnits(t, actual.Names)})
				same := direct.Status == actual.Status
				switch request.Operation {
				case "closed", "names":
					same = same && reflect.DeepEqual(direct.Names, actual.Names)
				case "collection":
					same = same && reflect.DeepEqual(direct.Kind, actual.Kind)
				case "package-mapping":
					same = same && direct.Mapping == actual.Mapping
				case "resolve":
					same = same && reflect.DeepEqual(direct.Resolution, actual.Resolution)
				}
				if !same || (actual.Status == "unavailable" && (direct.Status != "unavailable" || actual.Reason == "")) {
					t.Errorf("original/native transport differs: request=%#v direct=%#v actual=%#v", request, direct, actual)
				}
				if inputPath == "" && (actual.Status != "known" || (request.Operation == "closed" && actual.Names != nil) || (request.Operation == "names" && (actual.Names == nil || len(actual.Names) != 0))) {
					t.Errorf("default null/empty projection changed: %#v", actual)
				}
			}
			rows = append(rows, map[string]any{"id": sample.ID, "frame": frame, "results": results, "originalCapture": original.capture.observations, "currentCapture": current.capture.observations})
		})
	}
	if outputPath != "" {
		bytes, err := json.MarshalIndent(map[string]any{"cases": rows}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(outputPath, append(bytes, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fmt.Printf("SCALAR_DIFFERENTIAL_CASES=%d\n", len(rows))
}
