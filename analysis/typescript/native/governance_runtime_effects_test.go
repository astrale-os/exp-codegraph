package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	ast "github.com/microsoft/typescript-go/shim/ast"
	"testing"
)

func TestGovernanceRuntimeEffectsActualBindingsAndAdmission(t *testing.T) {
	root := t.TempDir()
	text := `declare function opaque(value: object): void;
const object={x:0};const alias=object;const clean={};const cleanAlias=clean;
function mutate(p:{x:number}){p.x=1;}
mutate(object);opaque(object);
delete object.x;
opaque(delete object.x);
class Hidden { field=(alias.x=2); method(){alias.x=3;} }
type HiddenType = typeof opaque;
`
	governanceWrite(t, root, "mutations/source.ts", text)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022"},"include":["mutations/**/*.ts"]}`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		t.Fatal(identity.Reason)
	}
	defer project.typeRelease()
	owner := governanceNewRuntimeAuthority(identity)
	file := owner.ByPath["mutations/source.ts"]
	var object, parameter, clean *ast.Node
	var calls, deletes []*ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclaration && node.Name().Text() == "object" {
			object = node.Name()
		}
		if node.Kind == ast.KindVariableDeclaration && node.Name().Text() == "clean" {
			clean = node.Name()
		}
		if node.Kind == ast.KindParameter && node.Name().Text() == "p" {
			parameter = node.Name()
		}
		if node.Kind == ast.KindCallExpression {
			calls = append(calls, node)
		}
		if node.Kind == ast.KindDeleteExpression {
			deletes = append(deletes, node)
		}
		return true
	})
	if object == nil || parameter == nil || len(calls) != 3 || len(deletes) != 2 {
		t.Fatal("fixture inventory")
	}
	symbol := owner.Symbol(file, object)
	param := owner.Symbol(file, parameter)
	if !symbol.Known || symbol.Key == "" || !param.Known || param.Key == "" {
		t.Fatal("actual compiler binding missing")
	}
	call := owner.Call(file, calls[0])
	if !call.Known || !call.BodyPresent || call.Dynamic || len(call.Bindings) != 1 || call.Bindings[0].Parameter != param.Key {
		t.Fatalf("actual argument parameter binding=%#v", call)
	}
	external := owner.Call(file, calls[1])
	if !external.Known || external.BodyPresent || external.Dynamic {
		t.Fatalf("actual declaration-only target=%#v", external)
	}
	if admitted, known := owner.CandidateAdmitted(file, deletes[0], "delete"); admitted || !known {
		t.Fatal("standalone delete must remain omitted")
	}
	if admitted, known := owner.CandidateAdmitted(file, deletes[1], "delete"); !admitted || !known {
		t.Fatal("actual call-argument delete omitted")
	}
	core := observabledecision.NewNativeEffectCore(owner.Files, owner.EffectAuthority())
	mutation := core.Proof("mutation", symbol.Key, "")
	escape := core.Proof("escape", symbol.Key, "")
	if !mutation.Known || mutation.Effect != "other" || !escape.Known || escape.Effect != "other" {
		t.Fatalf("actual effects mutation=%#v escape=%#v", mutation, escape)
	}
	cleanProof := core.Proof("mutation", owner.Symbol(file, clean).Key, "")
	if !cleanProof.Known || cleanProof.Effect != "none" || cleanProof.VirtualSteps < 1 {
		t.Fatalf("negative alias closure authority=%#v", cleanProof)
	}
	corrupt := file
	corrupt.Text += " "
	if owner.Symbol(corrupt, object).Known {
		t.Fatal("different captured bytes accepted")
	}
}

func TestGovernanceRuntimeScopedProofsMirrorSelectedExecutionGuards(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", `declare function opaque(x: unknown): unknown;
const object={selected:'id',untouched:opaque(1)};
function harmless(){opaque(1);return 'id'}
function recursive(){return recursive()}
async function asynchronous(){return 'id'}
function expression(flag:boolean){return flag?'a':'b'}
function exception(){try{return 'a'}catch{return 'b'}}
function nested(){class Hidden{};return 'id'}
`)
	governanceWrite(t, root, "tsconfig.json", `{"include":["mutations/**/*.ts"]}`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		t.Fatal(identity.Reason)
	}
	defer project.typeRelease()
	owner := governanceNewRuntimeAuthority(identity)
	file := owner.ByPath["mutations/source.ts"]
	functions := map[string]*ast.Node{}
	var object *ast.Node
	walk(file.Source.AsNode(), func(node *ast.Node) bool {
		if node.Kind == ast.KindFunctionDeclaration && node.Body() != nil {
			functions[node.Name().Text()] = node
		}
		if node.Kind == ast.KindObjectLiteralExpression {
			object = node
		}
		return true
	})
	for name, reason := range map[string]string{"harmless": "", "recursive": "VALUE_RECURSION", "asynchronous": "VALUE_EXECUTION_UNSUPPORTED", "expression": "", "exception": "VALUE_CONTROL_FLOW_INCOMPLETE", "nested": "VALUE_CONTROL_FLOW_INCOMPLETE"} {
		proof := owner.ScopedEffects(observabledecision.EffectRequest{Path: file.Path, Operation: "invoke-function", Node: functions[name]})
		if proof.Reason != reason || proof.Pure != (reason == "") {
			t.Fatalf("%s=%#v", name, proof)
		}
	}
	proof := owner.ScopedEffects(observabledecision.EffectRequest{Path: file.Path, Operation: "object-initializer-effects", Node: object})
	if !proof.Pure {
		t.Fatalf("unselected properties cannot poison object lookup: %#v", proof)
	}
}
