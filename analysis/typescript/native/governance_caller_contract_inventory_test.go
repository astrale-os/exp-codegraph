package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Exercise the real dispatcher, including JSON admission, configuration capture,
// source phase, continuation ownership and the final uncached seal barrier.
func TestCallerContractServiceProcess(t *testing.T) {
	if os.Getenv("CODEGRAPH_CALLER_CONTRACT_SERVICE_TEST") == "1" {
		os.Exit(runDecisionServe(nil))
	}
}

type callerContractService struct {
	t       *testing.T
	encoder *json.Encoder
	decoder *json.Decoder
	id      int
}

func callerContractProcess(t *testing.T, root string) *callerContractService {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCallerContractServiceProcess$")
	command.Dir = root
	command.Env = append(os.Environ(), "CODEGRAPH_CALLER_CONTRACT_SERVICE_TEST=1")
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		input.Close()
		if err := command.Wait(); err != nil {
			t.Error("decision service did not close normally", err)
		}
		cancel()
	})
	service := &callerContractService{t: t, encoder: json.NewEncoder(input), decoder: json.NewDecoder(output)}
	var hello map[string]any
	if err := service.decoder.Decode(&hello); err != nil || hello["service"] != "astrale.lint-decision" {
		t.Fatal("real decision service handshake", hello, err)
	}
	return service
}

func (service *callerContractService) request(method string, params any) (map[string]any, bool) {
	service.t.Helper()
	service.id++
	if err := service.encoder.Encode(map[string]any{"id": service.id, "method": method, "params": params}); err != nil {
		service.t.Fatal(err)
	}
	var frame struct {
		ID     int
		Result map[string]any
		Error  map[string]string
	}
	if err := service.decoder.Decode(&frame); err != nil || frame.ID != service.id {
		service.t.Fatal("decision response", frame, err)
	}
	return frame.Result, frame.Error != nil
}

func callerContracts(t *testing.T, retired bool) []map[string]any {
	t.Helper()
	ids := []string{}
	for id := range governanceRevisions {
		if !retired || (id != "MIG-EXACT-REVS" && id != "MIG-DEDICATED-CTX") {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	contracts := []map[string]any{}
	for _, id := range ids {
		identity := "astrale.sdk.typescript-source"
		if id == "QRY-CANON" || id == "QRY-SINGLE" || id == "QLT-DEF-IDS" {
			identity = "astrale.sdk.codegraph"
		}
		contracts = append(contracts, map[string]any{"ruleId": id, "ruleRevision": governanceRevisions[id],
			"requiredFacts": []string{"captured-source"}, "implementation": map[string]any{"id": identity, "version": "1"}})
	}
	return contracts
}

func callerPrepare(root string, contracts []map[string]any, offered bool) map[string]any {
	revisions := []map[string]string{}
	for _, contract := range contracts {
		revisions = append(revisions, map[string]string{"id": contract["ruleId"].(string), "revision": contract["ruleRevision"].(string)})
	}
	// The old SDK's 109-rule catalog is larger than either implementation inventory.
	for len(revisions) < 109 {
		id := "CATALOG-ONLY-" + strconv.Itoa(len(revisions))
		revisions = append(revisions, map[string]string{"id": id, "revision": governanceHash([]byte(id))})
	}
	prepare := map[string]any{"root": root, "projectionMode": "sdk-rule-products", "basePolicyDigest": "canonical",
		"policySource": governanceTestPolicy(), "ruleRevisions": revisions,
		"options": map[string]any{"generic": false, "sourcePolicyOwnerRevision": 3}}
	if offered {
		prepare["implementationContracts"] = contracts
	}
	return prepare
}

func callerSourcePhase(t *testing.T, service *callerContractService, prepare map[string]any, repeated any, generic bool, disabled []governanceDisabledRule) map[string]any {
	t.Helper()
	configuration, rejected := service.request("prepare", prepare)
	if rejected || configuration["status"] != "configuration" {
		t.Fatal("initial caller authority", configuration, rejected)
	}
	continuation := map[string]any{"token": configuration["token"], "kind": "policy",
		"policy": governanceCompiledPolicy{Source: governanceTestPolicy(), Digest: "canonical", Disabled: disabled}}
	if repeated != nil {
		continuation["implementationContracts"] = repeated
	}
	frame, rejected := service.request("continue", continuation)
	if generic && !rejected {
		if frame["status"] != "generic" {
			t.Fatal("private policy owner was bypassed", frame)
		}
		frame, rejected = service.request("continue", map[string]any{"kind": "generic-retire", "token": frame["token"]})
	}
	if rejected || frame["status"] != "source" {
		t.Fatal("caller source handoff", frame, rejected)
	}
	projection, rejected := service.request("continue", map[string]any{"kind": "source-open", "token": frame["token"],
		"generation": frame["generation"], "sourceSnapshotDigest": frame["sourceSnapshotDigest"]})
	if rejected || projection["status"] != "source-projection" {
		t.Fatal("caller source projection", projection, rejected)
	}
	return projection
}

func TestCallerContractInventoryOwnsCompleteSourceProducts(t *testing.T) {
	for _, scenario := range []string{"retired-50", "opaque-new-rule", "repeated-canonical", "private-policy-owner", "disabled", "legacy-52"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "index.ts", "export const value = 1\n")
			contracts := callerContracts(t, scenario != "legacy-52")
			if scenario != "legacy-52" && len(contracts) != 50 {
				t.Fatal("retired inventory fixture", len(contracts))
			}
			if scenario == "opaque-new-rule" {
				contracts = append(contracts, map[string]any{"ruleId": "APPLICATION-CUSTOM-ONE", "ruleRevision": governanceHash([]byte("custom rule revision")),
					"requiredFacts": []string{"custom-source", "custom-proof"}, "implementation": map[string]any{"id": "application.policy.reducer", "version": "v17"}})
			}
			offered := scenario != "legacy-52"
			prepare := callerPrepare(root, contracts, offered)
			generic := scenario == "private-policy-owner"
			if generic {
				prepare["options"].(map[string]any)["generic"] = true
			}
			var repeated any
			if scenario == "repeated-canonical" || !offered {
				repeated = contracts
			}
			if scenario == "repeated-canonical" {
				encoded, _ := json.Marshal(contracts)
				repeated = json.RawMessage(strings.ReplaceAll(string(encoded), `["captured-source"]`, `[ "captured-\u0073ource" ]`))
			}
			disabled := []governanceDisabledRule{}
			if scenario == "disabled" {
				disabled = append(disabled, governanceDisabledRule{contracts[0]["ruleId"].(string), "caller configuration"})
			}
			service := callerContractProcess(t, root)
			projection := callerSourcePhase(t, service, prepare, repeated, generic, disabled)
			decisions := []map[string]any{}
			for _, contract := range contracts {
				if len(disabled) != 0 && contract["ruleId"] == disabled[0].RuleID {
					continue
				}
				decisions = append(decisions, map[string]any{"id": contract["ruleId"], "decision": map[string]any{"status": "pass", "findings": []any{}}})
			}
			result, rejected := service.request("continue", map[string]any{"kind": "source-complete", "token": projection["token"],
				"generation": projection["generation"], "sourceSnapshotDigest": projection["sourceSnapshotDigest"], "decisions": decisions})
			if generic {
				if rejected || result["status"] != "generic" {
					t.Fatal("private owner lost the offered inventory or bypassed the required generic product", result, rejected)
				}
				return // A source verdict never fabricates the outstanding generic engine's product.
			}
			if rejected || result["status"] != "products" {
				t.Fatal("complete caller inventory", result, rejected)
			}
			var products struct{ Products []governanceRuleProduct }
			if err := json.Unmarshal([]byte(result["productsJSON"].(string)), &products); err != nil {
				t.Fatal(err)
			}
			if len(products.Products) != len(decisions) {
				t.Fatal("declared coverage changed", products.Products)
			}
			index := 0
			for _, contract := range contracts {
				if len(disabled) != 0 && contract["ruleId"] == disabled[0].RuleID {
					continue
				}
				actual := products.Products[index]
				var expected governanceImplementationContract
				encoded, _ := json.Marshal(contract)
				json.Unmarshal(encoded, &expected)
				if actual.RuleID != expected.RuleID || actual.RuleRevision != expected.RuleRevision || !reflect.DeepEqual(actual.Implementation, expected.Implementation) {
					t.Fatal("caller identity/revision was substituted", actual, expected)
				}
				index++
			}
			sealed, rejected := service.request("seal", map[string]any{"token": result["token"], "productsDigest": result["productsDigest"], "reportDigest": governanceHash([]byte("caller final report"))})
			if rejected || sealed["status"] != "committed" {
				t.Fatal("caller capture seal", sealed, rejected)
			}
		})
	}
}

func TestCallerInventoryPreservesTheFinalCaptureBarrier(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "index.ts", "export const value = 1\n")
	contracts := callerContracts(t, true)
	service := callerContractProcess(t, root)
	complete := func() map[string]any {
		projection := callerSourcePhase(t, service, callerPrepare(root, contracts, true), nil, false, nil)
		decisions := []map[string]any{}
		for _, contract := range contracts {
			decisions = append(decisions, map[string]any{"id": contract["ruleId"], "decision": map[string]any{"status": "pass", "findings": []any{}}})
		}
		result, rejected := service.request("continue", map[string]any{"kind": "source-complete", "token": projection["token"],
			"generation": projection["generation"], "sourceSnapshotDigest": projection["sourceSnapshotDigest"], "decisions": decisions})
		if rejected || result["status"] != "products" {
			t.Fatal("caller source products", result, rejected)
		}
		return result
	}
	first := complete()
	governanceWrite(t, root, "index.ts", "export const value = 2\n")
	seal := func(frame map[string]any) (map[string]any, bool) {
		return service.request("seal", map[string]any{"token": frame["token"], "productsDigest": frame["productsDigest"], "reportDigest": governanceHash([]byte("caller final report"))})
	}
	if result, rejected := seal(first); rejected || result["status"] != "retry" {
		t.Fatal("offered inventory bypassed changed capture", result, rejected)
	}
	current := complete()
	if result, rejected := seal(first); rejected || result["status"] != "retry" {
		t.Fatal("old offered capture sealed a new owner", result, rejected)
	}
	if result, rejected := seal(current); rejected || result["status"] != "committed" {
		t.Fatal("fresh caller capture did not recover", result, rejected)
	}
}

func TestCallerEmptyInventoryDoesNotInventAvailableRules(t *testing.T) {
	for _, scenario := range []string{"empty", "required-rule", "disabled", "repeated-empty"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "index.ts", "export const value = 1\n")
			prepare := callerPrepare(root, []map[string]any{}, true)
			catalog := prepare["ruleRevisions"].([]map[string]string)
			if len(catalog) != 109 {
				t.Fatal("catalog is not the implementation inventory", len(catalog))
			}
			if scenario == "required-rule" {
				prepare["options"].(map[string]any)["requiredRuleIds"] = []string{catalog[0]["id"]}
			}
			disabled := []governanceDisabledRule{}
			if scenario == "disabled" {
				disabled = append(disabled, governanceDisabledRule{catalog[0]["id"], "caller configuration"})
			}
			service := callerContractProcess(t, root)
			configuration, rejected := service.request("prepare", prepare)
			if rejected || configuration["status"] != "configuration" {
				t.Fatal("explicit empty implementation authority", configuration, rejected)
			}
			continuation := map[string]any{"token": configuration["token"], "kind": "policy",
				"policy": governanceCompiledPolicy{Source: governanceTestPolicy(), Digest: "canonical", Disabled: disabled}}
			// Even a valid catalog member cannot be added after the initial offer.
			continuation["implementationContracts"] = []map[string]any{{"ruleId": catalog[0]["id"], "ruleRevision": catalog[0]["revision"],
				"requiredFacts": []string{}, "implementation": map[string]string{"id": "caller.reducer", "version": "v1"}}}
			if result, rejected := service.request("continue", continuation); !rejected {
				t.Fatal("empty inventory gained a later implementation", result)
			}
			delete(continuation, "implementationContracts")
			if scenario == "repeated-empty" {
				continuation["implementationContracts"] = []any{}
			}
			frame, rejected := service.request("continue", continuation)
			if rejected || frame["status"] != "source" {
				t.Fatal("empty inventory source handoff", frame, rejected)
			}
			result, rejected := service.request("continue", map[string]any{"kind": "source-open", "token": frame["token"],
				"generation": frame["generation"], "sourceSnapshotDigest": frame["sourceSnapshotDigest"]})
			if rejected || result["status"] != "products" {
				t.Fatal("empty inventory products", result, rejected)
			}
			var products struct{ Products []governanceRuleProduct }
			if err := json.Unmarshal([]byte(result["productsJSON"].(string)), &products); err != nil || products.Products == nil || len(products.Products) != 0 {
				t.Fatal("catalog or required rules invented an available decision", products, err)
			}
			if extra, rejected := service.request("continue", map[string]any{"kind": "source-complete", "token": frame["token"],
				"generation": frame["generation"], "sourceSnapshotDigest": frame["sourceSnapshotDigest"],
				"decisions": []map[string]any{{"id": catalog[0]["id"], "decision": map[string]any{"status": "pass"}}}}); !rejected {
				t.Fatal("catalog member fabricated a source decision", extra)
			}
			sealed, rejected := service.request("seal", map[string]any{"token": result["token"], "productsDigest": result["productsDigest"], "reportDigest": governanceHash([]byte("empty caller report"))})
			if rejected || sealed["status"] != "committed" {
				t.Fatal("empty inventory lost its captured publication owner", sealed, rejected)
			}
		})
	}
}

func TestCallerContractInitialOfferRejectsInvalidAuthority(t *testing.T) {
	for _, scenario := range []string{"null", "object", "duplicate-contract", "duplicate-catalog", "catalog-missing", "revision", "malformed-revision", "required-facts-null", "required-facts-object", "required-fact-number", "required-fact-null", "required-fact-empty", "identity-empty", "version-empty", "unknown-contract-field", "owner-revision"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "index.ts", "export {}\n")
			contracts := callerContracts(t, true)
			prepare := callerPrepare(root, contracts, true)
			switch scenario {
			case "null":
				prepare["implementationContracts"] = nil
			case "object":
				prepare["implementationContracts"] = map[string]any{}
			case "duplicate-contract":
				prepare["implementationContracts"] = append(contracts, contracts[0])
			case "duplicate-catalog":
				rules := prepare["ruleRevisions"].([]map[string]string)
				prepare["ruleRevisions"] = append(rules, rules[0])
			case "catalog-missing":
				prepare["ruleRevisions"] = prepare["ruleRevisions"].([]map[string]string)[1:]
			case "revision":
				contracts[0]["ruleRevision"] = governanceHash([]byte("foreign revision"))
			case "malformed-revision":
				contracts[0]["ruleRevision"] = "bad"
			case "required-facts-null":
				contracts[0]["requiredFacts"] = nil
			case "required-facts-object":
				contracts[0]["requiredFacts"] = map[string]any{}
			case "required-fact-number":
				contracts[0]["requiredFacts"] = []any{1}
			case "required-fact-null":
				contracts[0]["requiredFacts"] = []any{nil}
			case "required-fact-empty":
				contracts[0]["requiredFacts"] = []string{""}
			case "identity-empty":
				contracts[0]["implementation"].(map[string]any)["id"] = ""
			case "version-empty":
				contracts[0]["implementation"].(map[string]any)["version"] = ""
			case "unknown-contract-field":
				contracts[0]["foreign"] = true
			case "owner-revision":
				prepare["options"].(map[string]any)["sourcePolicyOwnerRevision"] = 2
			}
			service := callerContractProcess(t, root)
			if result, rejected := service.request("prepare", prepare); !rejected {
				t.Fatal("invalid initial inventory was silently admitted", result)
			}
			// Invalid input cannot poison a subsequent correctly admitted capture.
			valid := callerPrepare(root, callerContracts(t, true), true)
			if result, rejected := service.request("prepare", valid); rejected || result["status"] != "configuration" {
				t.Fatal("valid capture did not recover", result, rejected)
			}
		})
	}
}

func TestCallerContinuationCannotReplaceInitialInventory(t *testing.T) {
	for _, scenario := range []string{"null", "missing-contract", "extra-contract", "reordered", "required-facts", "implementation", "version", "revision"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "index.ts", "export {}\n")
			contracts := callerContracts(t, true)
			service := callerContractProcess(t, root)
			configuration, rejected := service.request("prepare", callerPrepare(root, contracts, true))
			if rejected {
				t.Fatal("valid initial authority")
			}
			var repeated any = callerContracts(t, true)
			rows := repeated.([]map[string]any)
			switch scenario {
			case "null":
				repeated = nil
			case "missing-contract":
				repeated = rows[1:]
			case "extra-contract":
				repeated = append(rows, rows[0])
			case "reordered":
				rows[0], rows[1] = rows[1], rows[0]
			case "required-facts":
				rows[0]["requiredFacts"] = []string{"different-fact"}
			case "implementation":
				rows[0]["implementation"].(map[string]any)["id"] = "another.policy.owner"
			case "version":
				rows[0]["implementation"].(map[string]any)["version"] = "2"
			case "revision":
				rows[0]["ruleRevision"] = governanceHash([]byte("different revision"))
			}
			continuation := map[string]any{"kind": "policy", "token": configuration["token"],
				"policy": governanceCompiledPolicy{Source: governanceTestPolicy(), Digest: "canonical"}, "implementationContracts": repeated}
			if result, rejected := service.request("continue", continuation); !rejected {
				t.Fatal("continuation changed its initial authority", result)
			}
			delete(continuation, "implementationContracts")
			if result, rejected := service.request("continue", continuation); rejected || result["status"] != "source" {
				t.Fatal("rejected continuation poisoned the original offer", result, rejected)
			}
		})
	}
}

func TestCallerCompletionCannotOmitOrReplaceDeclaredDecision(t *testing.T) {
	for _, scenario := range []string{"missing", "duplicate", "foreign", "reordered", "generation", "digest"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			governanceWrite(t, root, "index.ts", "export {}\n")
			contracts := callerContracts(t, true)
			service := callerContractProcess(t, root)
			projection := callerSourcePhase(t, service, callerPrepare(root, contracts, true), nil, false, nil)
			decisions := []map[string]any{}
			for _, contract := range contracts {
				decisions = append(decisions, map[string]any{"id": contract["ruleId"], "decision": map[string]any{"status": "pass", "findings": []any{}}})
			}
			payload := map[string]any{"kind": "source-complete", "token": projection["token"], "generation": projection["generation"], "sourceSnapshotDigest": projection["sourceSnapshotDigest"], "decisions": decisions}
			switch scenario {
			case "missing":
				payload["decisions"] = decisions[1:]
			case "duplicate":
				decisions[1]["id"] = decisions[0]["id"]
			case "foreign":
				decisions[0]["id"] = "APPLICATION-UNDECLARED"
			case "reordered":
				decisions[0], decisions[1] = decisions[1], decisions[0]
			case "generation":
				payload["generation"] = "999"
			case "digest":
				payload["sourceSnapshotDigest"] = governanceHash([]byte("different captured source"))
			}
			if result, rejected := service.request("continue", payload); !rejected {
				t.Fatal("incomplete or foreign decision acquired ownership", result)
			}
			correct := []map[string]any{}
			for _, contract := range contracts {
				correct = append(correct, map[string]any{"id": contract["ruleId"], "decision": map[string]any{"status": "pass", "findings": []any{}}})
			}
			payload["decisions"], payload["generation"], payload["sourceSnapshotDigest"] = correct, projection["generation"], projection["sourceSnapshotDigest"]
			if result, rejected := service.request("continue", payload); rejected || result["status"] != "products" {
				t.Fatal("failed candidate poisoned later complete decisions", result, rejected)
			}
		})
	}
}
