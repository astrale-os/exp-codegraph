package observabledecision

import (
	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	"testing"
)

// These fixture authorities isolate the reusable effect algorithm. Production
// canonical binding, call, and compiler-membership capture remain separate.
func effectFixture(text string) (*NativeEffectCore, *CapturedFile) {
	file := captured("effects.ts", text)
	file.Source = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: file.AbsolutePath}, text, core.ScriptKindTS)
	authority := NativeEffectAuthority{MembershipComplete: true, MembershipReads: []SemanticRead{{Kind: "compiler-membership", Fingerprint: "fixture-complete"}}}
	authority.CandidateAdmitted = func(_ CapturedFile, _ *ast.Node, _ string) (bool, bool) { return true, true }
	authority.Symbol = func(_ CapturedFile, node *ast.Node) NativeEffectSymbol {
		if node.Kind == ast.KindIdentifier {
			return NativeEffectSymbol{Known: true, Key: node.Text()}
		}
		if ast.IsFunctionLike(node) {
			return NativeEffectSymbol{Known: true, Key: "local-function"}
		}
		return NativeEffectSymbol{Known: true}
	}
	authority.Call = func(_ CapturedFile, node *ast.Node) NativeEffectCall {
		call := node.AsCallExpression()
		if call.Expression.Kind == ast.KindIdentifier && call.Expression.Text() == "inspect" {
			return NativeEffectCall{Known: true, BodyPresent: true, Bindings: []NativeEffectBinding{{Argument: call.Arguments.Nodes[0], Parameter: "parameter"}}}
		}
		return NativeEffectCall{Known: true}
	}
	authority.DeleteAdmitted = func(_ CapturedFile, node *ast.Node) (bool, bool) {
		return node.Parent.Kind == ast.KindCallExpression, true
	}
	return NewNativeEffectCore([]CapturedFile{file}, authority), &file
}
func TestNativeEffectsAliasMutationAndEscapeClosures(t *testing.T) {
	core, _ := effectFixture(`const object={}; const alias=object; alias.x=1; const quiet={}; opaque(alias);`)
	mutation := core.Proof("mutation", "object", "")
	escape := core.Proof("escape", "object", "")
	quiet := core.Proof("escape", "quiet", "")
	if !mutation.Known || mutation.Effect != "other" || mutation.VirtualSteps != 1 {
		t.Fatalf("alias mutation: %+v", mutation)
	}
	if !escape.Known || escape.Effect != "other" || escape.VirtualSteps != 1 {
		t.Fatalf("alias escape: %+v", escape)
	}
	if !quiet.Known || quiet.Effect != "none" || quiet.VirtualSteps != 0 || len(quiet.Reads) < 3 {
		t.Fatalf("negative isolated binding: %+v", quiet)
	}
}
func TestNativeEffectsParameterBindingAndLocalWrites(t *testing.T) {
	core, _ := effectFixture(`const object={}; inspect(object); function inspect(parameter){parameter.x=1;} function local(){const localValue={}; localValue.x=1;}`)
	proof := core.Proof("mutation", "object", "")
	if !proof.Known || proof.Effect != "other" || proof.VirtualSteps != 1 {
		t.Fatalf("parameter mutation: %+v", proof)
	}
	escape := core.Proof("escape", "object", "")
	if !escape.Known || escape.Effect != "none" || escape.VirtualSteps != 1 {
		t.Fatalf("modeled body is not escape: %+v", escape)
	}
	local := core.Proof("mutation", "localValue", "local-function")
	if !local.Known || local.Effect != "local" {
		t.Fatalf("same-owner mutation: %+v", local)
	}
}
func TestNativeEffectsCaptureAndNegativeAuthorityAreRequired(t *testing.T) {
	core, file := effectFixture(`const object={}; unrelated.x=1;`)
	original := core.authority.Symbol
	core.authority.Symbol = func(file CapturedFile, node *ast.Node) NativeEffectSymbol {
		if node.Kind == ast.KindIdentifier && node.Text() == "unrelated" {
			return NativeEffectSymbol{}
		}
		return original(file, node)
	}
	if core.Proof("mutation", "object", "").Known {
		t.Fatal("unresolved potential alias cannot be ignored")
	}
	matches := 0
	core.authority.Match = func(_ CapturedFile, node *ast.Node, symbol string) (bool, bool, []SemanticRead) {
		matches++
		return node.Text() == symbol, true, []SemanticRead{{Kind: "binding-comparison", Name: node.Text(), Fingerprint: symbol}}
	}
	proof := core.Proof("mutation", "object", "")
	if !proof.Known || proof.Effect != "none" {
		t.Fatalf("certified negative comparison: %+v", proof)
	}
	comparisonRead := false
	for _, read := range proof.Reads {
		comparisonRead = comparisonRead || read.Kind == "binding-comparison" && read.Name == "unrelated" && read.Fingerprint == "object"
	}
	if matches == 0 || !comparisonRead {
		t.Fatal("later Match authority lost original callbacks/negative reads", matches, proof)
	}
	damaged := *file
	damaged.Text += " "
	invalid := NewNativeEffectCore([]CapturedFile{damaged}, core.authority)
	if invalid.Proof("mutation", "object", "").Known {
		t.Fatal("AST not captured from supplied bytes")
	}
	core.authority.MembershipComplete = false
	if core.Proof("mutation", "object", "").Known {
		t.Fatal("governed set cannot substitute compiler membership")
	}
}
func TestNativeEffectsLegacyDeleteAdmission(t *testing.T) {
	core, _ := effectFixture(`const object={}; delete object.x; const admitted={}; opaque(delete admitted.x);`)
	if result := core.Proof("mutation", "object", ""); !result.Known || result.Effect != "none" {
		t.Fatalf("standalone delete is not legacy admitted: %+v", result)
	}
	if result := core.Proof("mutation", "admitted", ""); !result.Known || result.Effect != "other" {
		t.Fatalf("argument delete must be observed: %+v", result)
	}
}

func TestNativeDemandEffectsPreserveImmutableEscapesAndRejectAliasedObjectWrites(t *testing.T) {
	for _, fixture := range []struct{ text, want string }{
		{`import {defineQuery} from '@astrale-os/sdk/query'; const id='issues.immutable'; const alias=id; opaque(alias); export const query=defineQuery()(() => ({id}));`, "known"},
		{`import {defineQuery} from '@astrale-os/sdk/query'; const object={id:'issues.changed'}; const alias=object; alias.id='changed'; export const query=defineQuery()(() => ({id:object.id}));`, "unknown"},
		{`import {defineQuery} from '@astrale-os/sdk/query'; const unrelated={}; opaque(unrelated); unrelated.x=1; export const query=defineQuery()(() => ({id:'issues.isolated'}));`, "known"},
	} {
		core, file := effectFixture(fixture.text)
		context := fixtureContext([]CapturedFile{*file})
		context.Effect = core.DemandEffects(func(request EffectRequest) EffectSummary {
			if request.Operation == "module-effects" {
				t.Fatal("blanket module purity must not be requested")
			}
			// This fixture separately certifies the selected straight-line body and
			// lazy object initializer; it does not certify production call provenance.
			return EffectSummary{Pure: true, ChargeKey: request.Path + ":" + request.Operation}
		})
		product := ObserveQueriesAndIDs(context)
		observation := onlyObservation(t, product)
		if observation.ID.Kind != fixture.want {
			t.Fatalf("outcome want %s: %+v", fixture.want, observation.ID)
		}
		if fixture.want == "unknown" && observation.ID.Reason != "VALUE_MUTATION_UNSUPPORTED" {
			t.Fatalf("mutation reason: %+v", observation.ID)
		}
	}
}
