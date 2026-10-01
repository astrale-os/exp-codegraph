package sourcepolicy_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf16"

	js "astrale-typespec-v2-native-analysis/jsstring"
	policy "astrale-typespec-v2-native-analysis/sourcepolicy"
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

type familyImport struct {
	Specifier      string
	TypeOnly       bool
	Offset, Length int
}
type familyFile struct {
	Path, Text, Role, Layer, Submodule string
	Imports                            []familyImport
}
type familyAdmission struct {
	Units    []uint16
	Accepted bool
}
type familyInput struct {
	Files             []familyFile
	Resolutions       map[string]map[string]*string
	CompositionPaths  map[string]bool
	ApplicationPath   string
	StepAdmissionRows []familyAdmission
	StepAdmissions    map[string]bool
}
type familyLocation struct {
	Path                         string
	Line, Column, Offset, Length int
}
type familyRow struct {
	Rule, Kind    string
	EvidenceUnits []uint16
	Location      familyLocation
}

func at(text string, pos int) int { return len(utf16.Encode([]rune(text[:pos]))) }
func familyLoc(file *policy.File, node *ast.Node) familyLocation {
	start := scanner.GetTokenPosOfNode(node, file.Source, false)
	lines := scanner.GetECMALineStarts(file.Source)
	line := scanner.ComputeLineOfPosition(lines, start)
	offset := at(file.Source.Text(), start)
	return familyLocation{file.Path, line + 1, offset - at(file.Source.Text(), int(lines[line])) + 1, offset, max(1, at(file.Source.Text(), node.End())-offset)}
}
func loadFamilyInput(t *testing.T) familyInput {
	t.Helper()
	data, err := os.ReadFile("testdata/families.input.json")
	if err != nil {
		t.Fatal(err)
	}
	var input familyInput
	if err = json.Unmarshal(data, &input); err != nil {
		t.Fatal(err)
	}
	return input
}
func familyProject(t *testing.T, input familyInput) *policy.Project {
	t.Helper()
	project := &policy.Project{Files: []*policy.File{}, FilesByPath: map[string]*policy.File{}, CompositionPaths: input.CompositionPaths, ApplicationPath: input.ApplicationPath}
	for _, raw := range input.Files {
		kind := core.ScriptKindTS
		if strings.HasSuffix(raw.Path, "x") {
			kind = core.ScriptKindTSX
		}
		file := &policy.File{Path: raw.Path, Role: raw.Role, Layer: raw.Layer, Submodule: raw.Submodule, Source: parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: filepath.Join("/private/fixture", raw.Path)}, raw.Text, kind)}
		ast.SetParentInChildren(file.Source.AsNode())
		nodes := map[[2]int]*ast.Node{}
		var walk func(*ast.Node)
		walk = func(node *ast.Node) {
			switch node.Kind {
			case ast.KindImportDeclaration, ast.KindExportDeclaration, ast.KindImportType, ast.KindCallExpression:
				position := familyLoc(file, node)
				nodes[[2]int{position.Offset, position.Length}] = node
			}
			node.ForEachChild(func(child *ast.Node) bool { walk(child); return false })
		}
		walk(file.Source.AsNode())
		for _, imp := range raw.Imports {
			node := nodes[[2]int{imp.Offset, imp.Length}]
			if node == nil {
				t.Fatalf("Original import join missing %s %d+%d", raw.Path, imp.Offset, imp.Length)
			}
			file.Imports = append(file.Imports, policy.Import{Specifier: imp.Specifier, TypeOnly: imp.TypeOnly, Node: node})
		}
		project.Files = append(project.Files, file)
		project.FilesByPath[file.Path] = file
	}
	project.Resolve = func(file *policy.File, imp policy.Import) policy.Resolution {
		value, known := input.Resolutions[file.Path][imp.Specifier]
		if !known {
			return policy.Resolution{}
		}
		if value == nil {
			return policy.Resolution{Known: true}
		}
		target := project.FilesByPath[*value]
		if target == nil {
			t.Fatalf("Supplied positive target absent from owned fixture: %s", *value)
		}
		return policy.Resolution{Known: true, Target: target}
	}
	if len(input.StepAdmissionRows) > 0 {
		admissions := map[js.String]bool{}
		for _, row := range input.StepAdmissionRows {
			admissions[js.FromUnits(row.Units)] = row.Accepted
		}
		project.AcceptStepIDUnits = func(units []uint16) (bool, error) {
			value, known := admissions[js.FromUnits(units)]
			if !known {
				return false, fmt.Errorf("Canonical supplied unit admission missing")
			}
			return value, nil
		}
	}
	project.AcceptStepID = func(id string) (bool, error) {
		value, known := input.StepAdmissions[id]
		if !known {
			return false, fmt.Errorf("Canonical supplied admission missing")
		}
		return value, nil
	}
	return project
}
func familyRows(t *testing.T, project *policy.Project) []familyRow {
	t.Helper()
	out := []familyRow{}
	for _, result := range []policy.Result{policy.EvaluateWorkflows(project), policy.EvaluateActions(project), policy.EvaluateProviders(project), policy.EvaluateMigrations(project), policy.EvaluateViews(project)} {
		if len(result.Residual) != 0 {
			t.Fatalf("Missing predicate authority: %#v", result.Residual)
		}
		for _, row := range result.Evidence {
			value, err := js.FromCompilerText(row.Evidence)
			if err != nil {
				t.Fatal(err)
			}
			out = append(out, familyRow{row.Rule, row.Kind, value.Units(), familyLoc(row.File, row.Node)})
		}
	}
	return out
}

// Independent entire-evidence oracle generated by the original frozen SDK's
// actual 11 verifiers. Membership/resolution/acceptStepId are explicitly supplied
// test authorities; this is not native service capture or full-report proof.
func TestNativeFamiliesPinnedSDKOracle(t *testing.T) {
	project := familyProject(t, loadFamilyInput(t))
	data, err := os.ReadFile("testdata/families.oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected []familyRow
	if err = json.Unmarshal(data, &expected); err != nil {
		t.Fatal(err)
	}
	actual := familyRows(t, project)
	if !reflect.DeepEqual(actual, expected) {
		left, _ := json.MarshalIndent(actual, "", " ")
		right, _ := json.MarshalIndent(expected, "", " ")
		t.Fatalf("Entire ordered evidence differs:\nactual=%s\nSDK=%s", left, right)
	}
}

func TestNativeFamiliesMissingAuthorityIsResidual(t *testing.T) {
	input := loadFamilyInput(t)
	project := familyProject(t, input)
	project.AcceptStepID = nil
	project.AcceptStepIDUnits = nil
	result := policy.EvaluateWorkflows(project)
	if len(result.Residual) == 0 {
		t.Fatal("Missing canonical predicate falsely decided")
	}
	project = familyProject(t, input)
	project.AcceptStepIDUnits = nil
	project.AcceptStepID = func(string) (bool, error) { return false, fmt.Errorf("cancelled intrinsic wave") }
	if len(policy.EvaluateWorkflows(project).Residual) == 0 {
		t.Fatal("Failed canonical predicate falsely decided")
	}
	project = familyProject(t, input)
	project.Resolve = nil
	if len(policy.EvaluateActions(project).Residual) == 0 || len(policy.EvaluateMigrations(project).Residual) == 0 {
		t.Fatal("Unavailable resolution became an empty negative graph")
	}
	project = familyProject(t, input)
	project.CompositionPaths = nil
	if len(policy.EvaluateActions(project).Residual) == 0 {
		t.Fatal("Unavailable composition policy became no governed roots")
	}
}

func TestNativeFamiliesCapturedProjectAndRegistrationStayOwned(t *testing.T) {
	input := loadFamilyInput(t)
	old := familyProject(t, input)
	oldRows := familyRows(t, old)
	changed := loadFamilyInput(t)
	for i := range changed.Files {
		if changed.Files[i].Path == "functions/steps/steps.ts" {
			changed.Files[i].Text = strings.Replace(changed.Files[i].Text, "step.run('dup',()=>2)", "step.run('new',()=>2)", 1)
		}
	}
	changed.StepAdmissions["new"] = true
	changed.StepAdmissionRows = append(changed.StepAdmissionRows, familyAdmission{Units: []uint16{110, 101, 119}, Accepted: true})
	current := familyProject(t, changed)
	newRows := familyRows(t, current)
	if reflect.DeepEqual(oldRows, newRows) {
		t.Fatal("Real ID edit did not change observations")
	}
	if !reflect.DeepEqual(familyRows(t, old), oldRows) {
		t.Fatal("New capture changed old project evidence or duplicate registry leaked")
	}
	if !reflect.DeepEqual(familyRows(t, current), newRows) {
		t.Fatal("Repeated same capture retained prior invocation registry")
	}
}
