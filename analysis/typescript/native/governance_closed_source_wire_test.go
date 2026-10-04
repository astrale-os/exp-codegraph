package main

import (
	"astrale-typespec-v2-native-analysis/jsstring"
	"bytes"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSourceWireTextPreservesCanonicalIdentity(t *testing.T) {
	for _, text := range []string{"", "plain ASCII", "\x00\b\t\n\f\r\x1f", "\"\\<>&", "\ufeff\u2028\u2029\ufffd", "é日本語", "😀", "a\xed\xa0\x80z", "\xed\xb0\x80", "\xed\xa0\xbd\xed\xb8\x80"} {
		t.Run(text, func(t *testing.T) {
			original, err := json.Marshal(jsstring.JSONText(text))
			if err != nil {
				t.Fatal(err)
			}
			wire, extra, err := governanceSourceWireText(text)
			if err != nil || uint64(len(wire))+extra != uint64(len(original)) {
				t.Fatalf("legacy size changed: wire=%q extra=%d original=%q err=%v", wire, extra, original, err)
			}
			if extra == 0 {
				if !bytes.Equal(wire, original) {
					t.Fatal("canonical fallback changed")
				}
			} else {
				var decoded string
				if err := json.Unmarshal(wire, &decoded); err != nil || decoded != text {
					t.Fatalf("compact string lost identity: %q %v", decoded, err)
				}
			}
			outer, err := json.Marshal(map[string]any{"text": wire})
			expected := append(append([]byte("{\"text\":"), wire...), '}')
			if err != nil || !bytes.Equal(outer, expected) {
				t.Fatalf("outer RawMessage escaping changed size: %q %v", outer, err)
			}
		})
	}
	canonical, _ := json.Marshal(jsstring.JSONText("A"))
	if string(canonical) != "\"\\u0041\"" {
		t.Fatal("global canonical string encoding changed")
	}
}

func TestSourceWireTextPreservesOriginalMalformedError(t *testing.T) {
	for _, text := range []string{"\xff", "\xc0\xaf", "\xe2\x82", "\xf4\x90\x80\x80", "\xed\xa0\x7f"} {
		_, original := json.Marshal(jsstring.JSONText(text))
		_, _, actual := governanceSourceWireText(text)
		var want, got *json.MarshalerError
		if original == nil || actual == nil || !errors.As(original, &want) || !errors.As(actual, &got) || actual.Error() != original.Error() || got.Type != want.Type {
			t.Fatalf("original malformed error changed: original=%v actual=%v", original, actual)
		}
	}
}

// Reconstruct canonical bytes from an actual admitted map, using the original
// JSONText owner as the oracle rather than the new admission arithmetic.
func sourceWireLegacyFrame(t *testing.T, frame map[string]any, session *governanceSession) []byte {
	t.Helper()
	copy := make(map[string]any, len(frame))
	for key, value := range frame {
		copy[key] = value
	}
	rows := []map[string]any{}
	for index, row := range frame["files"].([]map[string]any) {
		clone := make(map[string]any, len(row))
		for key, value := range row {
			clone[key] = value
		}
		clone["text"] = jsstring.JSONText(session.productsSession.Project.Files[index].Text)
		rows = append(rows, clone)
	}
	copy["files"] = rows
	encoded, err := json.Marshal(copy)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestSourceWireHandoffRetainsExactLegacyThreshold(t *testing.T) {
	for _, offset := range []int{-1, 0, 1} {
		t.Run([]string{"below", "equal", "above"}[offset+1], func(t *testing.T) {
			session, _ := liveInputSession(t, nil)
			project := session.productsSession.Project
			project.Files[0].Text = ""
			baseline, err := session.closedSourceHandoff(false)
			if err != nil {
				t.Fatal(err)
			}
			frame := baseline.(map[string]any)
			session.productsSession.sourceBody = nil // New first-admission boundary fixture.
			padding := governanceClosedSourceLimit + offset - len(sourceWireLegacyFrame(t, frame, session))
			project.Files[0].Text = strings.Repeat("x", padding/6)
			// The original token is opaque. ASCII remainder padding reaches the exact
			// old boundary without introducing an invalid authored filesystem path.
			session.productsSession.Token += strings.Repeat("t", padding%6)
			frame["token"] = session.productsSession.Token
			if size := len(sourceWireLegacyFrame(t, frame, session)); size != governanceClosedSourceLimit+offset {
				t.Fatalf("original boundary fixture size=%d", size)
			}
			result, err := session.closedSourceHandoff(false)
			if err != nil {
				t.Fatal(err)
			}
			status := result.(map[string]any)["status"]
			if offset <= 0 && status != "source" || offset > 0 && status != "partial" {
				t.Fatalf("expanded admission changed: offset=%d status=%v", offset, status)
			}
			if offset > 0 && !reflect.DeepEqual(result.(map[string]any)["residual"], []string{"Captured source frame exceeds original private payload admission bound."}) {
				t.Fatal("original partial residual changed")
			}
		})
	}
}

func TestSourceWireHandoffPreservesGuardPriority(t *testing.T) {
	for _, guard := range []string{"metadata", "exclusive-owner"} {
		t.Run(guard, func(t *testing.T) {
			session, root := liveInputSession(t, nil)
			project := session.productsSession.Project
			project.Files[0].Text = "\xff"
			if guard == "metadata" {
				path := filepath.Join(root, "tsconfig.json")
				delete(project.capture.byteCells, path)
				delete(project.capture.observations, "read\x00"+path)
			} else {
				session.productsSession.SourceProducts = []governanceRuleProduct{}
			}
			_, err := session.closedSourceHandoff(true)
			want := "closed input frame lacks exclusive admitting owner"
			if guard == "metadata" {
				want = "closed source root metadata was not captured: tsconfig.json"
			}
			if err == nil || err.Error() != want {
				t.Fatalf("guard no longer precedes text encoding: %v", err)
			}
		})
	}
}

func TestSourceWireHandoffOversizeDoesNotHideLaterMalformedText(t *testing.T) {
	session, _ := liveInputSession(t, func(root string) {
		governanceWrite(t, root, "other.ts", "export {}")
		governanceWrite(t, root, "tsconfig.json", "{\"include\":[\"*.ts\"]}")
	})
	files := session.productsSession.Project.Files
	if len(files) < 2 {
		t.Fatal("two actual captured authored files required")
	}
	files[0].Text = strings.Repeat("x", governanceClosedSourceLimit/6+1)
	files[1].Text = "\xff"
	_, original := json.Marshal(jsstring.JSONText(files[1].Text))
	_, actual := session.closedSourceHandoff(false)
	if actual == nil || actual.Error() != original.Error() {
		t.Fatalf("oversize hid original later encoding failure: %v", actual)
	}
}

func TestSourceWireHandoffOwnsRepliesAndCurrentProjection(t *testing.T) {
	session, _ := liveInputSession(t, nil)
	first, err := session.closedSourceHandoff(false)
	if err != nil {
		t.Fatal(err)
	}
	rows := first.(map[string]any)["files"].([]map[string]any)
	wire := rows[0]["text"].(json.RawMessage)
	wire[0] = '!'
	rows[0]["path"] = "foreign.ts"
	governanceSourceObservationFixture(t, session)
	second, err := session.closedSourceHandoff(true)
	if err != nil {
		t.Fatal(err)
	}
	frame := second.(map[string]any)
	if frame["status"] != "source-projection" || frame["files"] != nil || session.productsSession.Project.Files[0].Path == "foreign.ts" {
		t.Fatal("reply mutation escaped into current capture")
	}
	actual, err := json.Marshal(frame)
	if err != nil || !json.Valid(actual) {
		t.Fatalf("first raw buffer mutation corrupted later reply: %v", err)
	}
	inputs := frame["resolutionInputs"].(governanceClosedSourceInputs)
	if inputs.Token != session.productsSession.Token || inputs.Status != "known" {
		t.Fatal("current typed resolution owner changed")
	}
	compiler := session.productsSession.Project.capture.compiler
	compiler.mu.Lock()
	compiler.metadataLossy = true
	compiler.mu.Unlock()
	third, err := session.closedSourceHandoff(true)
	if err != nil || third.(map[string]any)["resolutionInputs"].(governanceClosedSourceInputs).Status != "unavailable" {
		t.Fatalf("resolution projection was reused: %v", err)
	}
}

func TestSourceWireTextSaturatesOnlyExceededBudget(t *testing.T) {
	text := strings.Repeat("x", governanceClosedSourceLimit/5+1)
	wire, extra, err := governanceSourceWireText(text)
	if err != nil || !json.Valid(wire) || extra != governanceClosedSourceLimit+1 {
		t.Fatalf("oversize delta did not retain rejection predicate: %d %v", extra, err)
	}
}
