package observabledecision

import (
	"reflect"
	"testing"

	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
)

func objectPropertySubject(t *testing.T, file CapturedFile) *ast.Node {
	t.Helper()
	var subject *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindVariableDeclaration && node.Name() != nil && node.Name().Kind == ast.KindIdentifier && node.Name().Text() == "subject" {
			subject = node.AsVariableDeclaration().Initializer
			for subject != nil && subject.Kind == ast.KindParenthesizedExpression {
				subject = subject.AsParenthesizedExpression().Expression
			}
		}
	})
	if subject == nil || subject.Kind != ast.KindObjectLiteralExpression {
		t.Fatal("actual object subject missing")
	}
	return subject
}

// These compare the changed constructor boundary and subsequent property proofs,
// including ordered authority calls. They do not replace whole native/runtime
// qualification: the resolver/effect callbacks are explicit fixture premises.
func TestObjectPropertiesMatchOriginalBuilderAndKeySummary(t *testing.T) {
	for _, text := range []string{
		`const subject={};`,
		`const subject={key:'first', other:'other', key:current};`,
		`const subject={key:'first', ...spread, key:current};`,
		`const subject={key:'first', ...unknown, later:current};`,
		`const subject={key:'first', ...[], later:current};`,
		`const subject={key:'first', [dynamic]:current, later:'later'};`,
		`const subject={key:'first', get key(){return 'getter';}, later:current};`,
		`const subject={key:'first', key:'blocked', later:current};`,
		`const subject={current, method(){return current;}, 7:'number', '\u006bey':current, '\uD800':'surrogate'};`,
		`const subject={key:{nested:current}, ...{key:current}, absent:undefined};`,
	} {
		t.Run(text, func(t *testing.T) {
			file, _ := structuralFixture(text)
			subject := objectPropertySubject(t, file)
			spreadFile := captured("helper.ts", `const subject={key:'spread', fromSpread:'present'};`)
			spreadFile.Source = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: spreadFile.AbsolutePath}, spreadFile.Text, core.ScriptKindTS)
			ast.SetParentInChildren(spreadFile.Source.AsNode())
			spreadSubject := objectPropertySubject(t, spreadFile)
			for _, admission := range []string{"normal", "deny", "unavailable"} {
				for _, current := range []string{"left", "right"} {
					for _, limits := range []Limits{{}, {MaximumSteps: 1}, {MaximumSteps: 4}, {MaximumDepth: 1}} {
						type row struct {
							Proofs     []NativeDemandProof
							Admissions []*ast.Node
							Effects    []EffectRequest
						}
						var rows [2]row
						for mode := range rows {
							context := fixtureContext([]CapturedFile{file, spreadFile})
							context.ExpressionAdmitted = func(_ string, node *ast.Node) (bool, bool) {
								rows[mode].Admissions = append(rows[mode].Admissions, node)
								if node.Kind == ast.KindStringLiteral && node.Text() == "blocked" {
									if admission == "deny" {
										return false, true
									}
									if admission == "unavailable" {
										return false, false
									}
								}
								return true, true
							}
							originalEffect := context.Effect
							context.Effect = func(request EffectRequest) EffectSummary {
								rows[mode].Effects = append(rows[mode].Effects, request)
								out := originalEffect(request)
								out.VirtualSteps = 1
								out.ChargeKey = request.Operation
								return out
							}
							observer := newDemandObserver(context)
							environment := map[string]demandValue{"current": demandKnown("string", current)}
							// Both sides use the SAME owned helper AST. Spreads retain its module,
							// node and environment instead of borrowing the receiving object's path.
							environment["spread"] = observer.run().objectLiteral(spreadFile.Path, spreadSubject, nil)
							environment["unknown"] = demandUnknown("fixture unknown spread")
							makeValue := func(run *demandRun) (demandValue, NativeValueSummary) {
								if mode == 0 {
									value, keys := originalObjectLiteral(run, file.Path, subject, environment)
									summary := valueSummary(value)
									if value.kind == "object" {
										summary.Properties = keys
									}
									return value, summary
								}
								value := run.objectLiteral(file.Path, subject, environment)
								return value, valueSummary(value)
							}
							run := observer.run()
							run.limits = normalizedLimits(limits)
							value, summary := makeValue(run)
							if value.kind == "object" && value.properties == nil {
								t.Fatal("production object lacks its single property representation")
							}
							rows[mode].Proofs = append(rows[mode].Proofs, NativeDemandProof{Outcome: run.finish(value, ""), Value: summary})
							for _, key := range []string{"key", "later", "fromSpread", "current", "method", "7", string([]byte{0xed, 0xa0, 0x80}), "missing"} {
								run = observer.run()
								run.limits = normalizedLimits(limits)
								value, _ = makeValue(run)
								selected := run.propertyAt(value, key, 0)
								rows[mode].Proofs = append(rows[mode].Proofs, NativeDemandProof{Outcome: run.finish(selected, ""), Value: valueSummary(selected)})
							}
						}
						if !reflect.DeepEqual(rows[0], rows[1]) {
							t.Fatalf("constructor/proof/read/steps/order differ admission=%s current=%s limits=%#v: old=%#v current=%#v", admission, current, limits, rows[0], rows[1])
						}
					}
				}
			}
		})
	}
}

func TestObjectPublicPlansKeepFreshValuesAndDetachedProofs(t *testing.T) {
	file, _ := structuralFixture(`const make=(value)=>({key:'first',...{key:value},nested:{key:value}});const left='left';const right='right';`)
	var function, left, right *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindArrowFunction {
			function = node
		}
		if node.Kind == ast.KindStringLiteral && node.Text() == "left" {
			left = node
		}
		if node.Kind == ast.KindStringLiteral && node.Text() == "right" {
			right = node
		}
	})
	if function == nil || left == nil || right == nil {
		t.Fatal("actual invocation fixture missing")
	}
	reader := NewNativeValueReader(fixtureContext([]CapturedFile{file}))
	for _, input := range []*ast.Node{left, right, left} {
		plan := reader.Expression(file.Path, function).Invoke(reader.Expression(file.Path, input))
		summary := plan.Resolve(Limits{})
		if summary.Outcome.Kind != "known" || summary.Value.Kind != "object" || !summary.Value.Complete || !reflect.DeepEqual(summary.Value.Properties, []string{"key", "nested"}) {
			t.Fatalf("actual object summary missing: %#v", summary)
		}
		first := plan.Property("key").Resolve(Limits{})
		if first.Outcome.Kind != "known" || first.Value.Literal != input.Text() || len(first.Outcome.Reads) == 0 {
			t.Fatalf("fresh current property missing: %#v", first)
		}
		pristine := plan.Property("key").Resolve(Limits{})
		summary.Value.Properties[0] = "caller mutation"
		first.Value.Literal = "caller mutation"
		first.Outcome.Reads[0].Fingerprint = "caller mutation"
		if again := plan.Property("key").Resolve(Limits{}); !reflect.DeepEqual(again, pristine) {
			t.Fatal("public proof mutation changed subsequent property demand")
		}
		nested := plan.Property("nested").Property("key").Resolve(Limits{})
		if nested.Outcome.Kind != "known" || nested.Value.Literal != input.Text() {
			t.Fatalf("nested current value changed: %#v", nested)
		}
		missing := plan.Property("missing").Resolve(Limits{})
		if missing.Outcome.Kind != "known" || missing.Value.Kind != "undefined" {
			t.Fatalf("complete-object absence changed: %#v", missing)
		}
	}
	arrays, _ := structuralFixture(`const subject=[];`)
	var array *ast.Node
	visitStructuralNodes(arrays.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindArrayLiteralExpression {
			array = node
		}
	})
	if array == nil {
		t.Fatal("array fixture missing")
	}
	arrayReader := NewNativeValueReader(fixtureContext([]CapturedFile{arrays}))
	summary := arrayReader.Expression(arrays.Path, array).Resolve(Limits{})
	if summary.Value.Kind != "object" || summary.Value.Complete || !reflect.DeepEqual(summary.Value.Properties, []string{}) {
		t.Fatalf("incomplete array summary changed: %#v", summary)
	}
	missing := arrayReader.Expression(arrays.Path, array).Property("missing").Resolve(Limits{})
	if missing.Outcome.Kind != "unknown" || missing.Outcome.Reason != "VALUE_PROPERTY_INCOMPLETE" {
		t.Fatalf("array absence became known: %#v", missing)
	}
}

func TestObjectPropertiesRetainCurrentLazyEnvironment(t *testing.T) {
	file, _ := structuralFixture(`const subject={key:current};`)
	subject := objectPropertySubject(t, file)
	var rows [2]NativeDemandProof
	for mode := range rows {
		observer := newDemandObserver(fixtureContext([]CapturedFile{file}))
		environment := map[string]demandValue{"current": demandKnown("string", "before construction")}
		run := observer.run()
		var value demandValue
		if mode == 0 {
			value, _ = originalObjectLiteral(run, file.Path, subject, environment)
		} else {
			value = run.objectLiteral(file.Path, subject, environment)
		}
		reference, present := value.properties["key"]
		if !present || reference.kind != "reference" || reference.node == nil || reference.module != file.Path {
			t.Fatal("actual lazy property reference missing")
		}
		environment["current"] = demandKnown("string", "after construction")
		selected := run.propertyAt(value, "key", 0)
		rows[mode] = NativeDemandProof{Outcome: run.finish(selected, ""), Value: valueSummary(selected)}
		if rows[mode].Outcome.Kind != "known" || rows[mode].Value.Literal != "after construction" {
			t.Fatalf("property captured a stale evaluated value: %#v", rows[mode])
		}
	}
	if !reflect.DeepEqual(rows[0], rows[1]) {
		t.Fatal("lazy current environment changed original reads/steps/value")
	}
}

func TestObjectAlternativeSummariesDoNotBecomePropertyCarriers(t *testing.T) {
	file, _ := structuralFixture(`const subject=condition ? {key:'left'} : {key:'right'};`)
	var conditional *ast.Node
	visitStructuralNodes(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindConditionalExpression {
			conditional = node
		}
	})
	if conditional == nil {
		t.Fatal("actual alternative object fixture missing")
	}
	reader := NewNativeValueReader(fixtureContext([]CapturedFile{file}))
	plan := reader.Expression(file.Path, conditional)
	summary := plan.Resolve(Limits{})
	// finish collapses identical OBJECT SUMMARIES, not the private object values.
	// That temporary scalar projection must never be used as a property carrier.
	if summary.Outcome.Kind != "known" || len(summary.Outcome.Values) != 1 || summary.Outcome.Values[0].Kind != "object" || !reflect.DeepEqual(summary.Outcome.Values[0].Properties, []string{"key"}) {
		t.Fatalf("projected object alternatives changed: %#v", summary)
	}
	selected := plan.Property("key").Resolve(Limits{})
	if selected.Outcome.Kind != "ambiguous" || len(selected.Outcome.Values) != 2 || selected.Outcome.Values[0].Literal != "left" || selected.Outcome.Values[1].Literal != "right" {
		t.Fatalf("summary collapsed lazy property alternatives: %#v", selected)
	}
}
