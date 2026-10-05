package main

import (
	"astrale-typespec-v2-native-analysis/observabledecision"
	"fmt"
	"strings"
	"testing"
)

// Actual original compiler/import/effect/call identity owners, not a mocked
// Resolve or an already-authored QueryProduct. Public end-to-end fixture tests
// remain a separate root gate, including the genuine portable same-SDK oracle.
func TestFastRuntimeQueryArityUsesCurrentCompilerAndWholeReducer(t *testing.T) {
	cases := []struct {
		name, call, constructor, status string
		curried, callable               bool
		parameters                      int
	}{
		{"collectionOne", `defineCollectionQuery()((D: any)=>({id:'one'}))`, "defineCollectionQuery", "pass", true, true, 1},
		{"collectionZero", `(defineCollectionQuery() as (...args:any[])=>any)()`, "defineCollectionQuery", "fail", false, false, 0},
		{"collectionTwo", `(defineCollectionQuery() as (...args:any[])=>any)((D:any)=>({id:'two'}),0)`, "defineCollectionQuery", "fail", false, true, 1},
		{"queryTwo", `(defineQuery() as (...args:any[])=>any)((D:any)=>({id:'query-two'}),0)`, "defineQuery", "fail", false, true, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := governanceTempDir(t)
			governanceWrite(t, root, "package.json", `{"name":"@local/query-arity","private":true,"type":"module"}`)
			governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"noLib":true,"types":[]},"include":["queries/**/*.ts"]}`)
			governanceWrite(t, root, "node_modules/@astrale-os/sdk/package.json", `{"name":"@astrale-os/sdk","types":"index.d.ts"}`)
			governanceWrite(t, root, "node_modules/@astrale-os/sdk/index.d.ts", `export {defineQuery,defineCollectionQuery} from './dist/application/query/define';`)
			governanceWrite(t, root, "node_modules/@astrale-os/sdk/dist/application/query/define.d.ts", `export declare function defineQuery(): (projector:(domain:any)=>unknown)=>unknown;export declare function defineCollectionQuery(): (projector:(domain:any)=>unknown)=>unknown;`)
			text := `import {defineQuery,defineCollectionQuery} from '@astrale-os/sdk';export const q=` + c.call + `;`
			governanceWrite(t, root, "queries/cases.ts", text)
			policy := governanceTestPolicy()
			policy.Layers = append(policy.Layers, governanceLayer{ID: "queries", SourcePath: "queries/"})
			project, err := captureGovernedProject(root, policy)
			if err != nil {
				t.Fatal(err)
			}
			governanceSharedProject(project)
			identity := governanceBuildRuntimeIdentity(project)
			if !identity.Complete {
				t.Fatal(identity.Reason)
			}
			t.Cleanup(func() {
				if project.typeRelease != nil {
					project.typeRelease()
					project.typeRelease = nil
				}
			})
			authority := governanceNewRuntimeAuthority(identity)
			context := authority.DemandContext(observabledecision.Limits{MaximumDepth: 64, MaximumSteps: 4096, MaximumAlternatives: 32})
			product := observabledecision.NewRuntimeDecisionGraph(context).Resume()
			queries := product.Queries
			if !queries.InventoryKnown || len(queries.Residual) != 0 || len(queries.DiscoveryFailures) != 0 || len(queries.Observations) != 1 {
				t.Fatalf("nonvacuous actual compiler query inventory: %+v", queries)
			}
			observation := queries.Observations[0]
			if observation.Ownership.Kind != "known" || observation.ConstructorIdentity != "astrale.sdk."+c.constructor || observation.ProjectorProof.Kind != "known" {
				t.Fatalf("actual constructor/shape authority: %+v", observation)
			}
			expectedShape := observabledecision.DemandShape{Curried: c.curried, Callable: c.callable, ParameterCount: c.parameters}
			if observation.ProjectorShape != expectedShape {
				t.Fatalf("original portable arity shape: want%+v got%+v", expectedShape, observation.ProjectorShape)
			}
			if c.constructor == "defineCollectionQuery" {
				for _, count := range []observabledecision.DemandOutcome{observation.CanonicalRequestCount, observation.BuildCallbackCount, observation.ProjectCallbackCount} {
					if count.Kind != "known" || count.Count != 1 {
						t.Fatalf("original collection counts lost: %+v", count)
					}
				}
			}
			// Exact production adapter/reducer: this used to silently skip collection
			// observations even with known, complete actual current membership.
			joined := governanceProjectRuntimeProductsExceptReady(project, identity, product, nil).(map[string]any)
			decisions := joined["decisions"].([]governanceOutcome)
			var canonical *governanceOutcome
			for i := range decisions {
				if decisions[i].Rule == "QRY-CANON" {
					canonical = &decisions[i]
				}
			}
			if canonical == nil || canonical.Status != c.status {
				t.Fatalf("whole native reducer must retain arity finding: want%s got%+v", c.status, canonical)
			}
			if c.status == "pass" {
				if len(canonical.Findings) != 0 {
					t.Fatal("positive collection finding", canonical.Findings)
				}
			} else {
				if len(canonical.Findings) != 1 {
					t.Fatalf("one original arity rejection: %+v", canonical)
				}
				finding := canonical.Findings[0]
				expected := fmt.Sprintf("Query %s must use a curried constructor with one synchronous, non-generator Domain projector accepting at most one parameter.", observation.SubjectID)
				if finding.Kind != "violation" || finding.Evidence != expected || finding.Location == nil || finding.Location.Path != "queries/cases.ts" || finding.Location.Offset != observation.Start || finding.Location.Length != observation.End-observation.Start {
					t.Fatalf("original arity evidence/order/source location: expected%q got%+v", expected, finding)
				}
			}
			valid, err := project.capture.Verify()
			if err != nil || !valid {
				t.Fatalf("current captured authority did not seal: %v %v", valid, err)
			}
			governanceWrite(t, root, "queries/cases.ts", strings.Replace(text, ";export const", "; /* late real edit */ export const", 1))
			valid, err = project.capture.Verify()
			if err != nil || valid {
				t.Fatalf("old authority accepted real changed source: %v %v", valid, err)
			}
		})
	}
}
