package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf16"
)

type governanceCompiledPolicy struct {
	Source             governancePolicy         `json:"source"`
	Digest             string                   `json:"digest"`
	Disabled           []governanceDisabledRule `json:"disabled"`
	IgnorePatternUnits [][]uint16               `json:"ignorePatternUnits"`
}
type governanceDisabledRule struct {
	RuleID string `json:"ruleId"`
	Reason string `json:"reason"`
}
type governancePolicySuspension struct {
	Root, Token string
	Capture     *governanceCapture
}

func (session *governanceSession) captureConfiguration(root string) (map[string]any, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	// Configuration is a separate owned product. Root topology is captured even
	// when absent; the SDK admits configuration and coverage before source work.
	canonical := absolute
	rootObservation := capture.probe(governanceProbeRequest{ID: "configuration-root", Kind: "canonicalize", Path: absolute})
	if rootObservation.Status == "known" {
		canonical = rootObservation.Value.(map[string]string)["path"]
	}
	capture.root = canonical
	path := filepath.Join(canonical, "astrale.lint.json")
	metadata := map[string]any{}
	var raw any
	info, err := capture.lstat(path)
	if err != nil && !os.IsNotExist(err) {
		metadata["kind"] = "inspection-error"
		metadata["error"] = governanceProbeFailure(err)
	}
	if err == nil {
		kind := "other"
		if info.Mode()&os.ModeSymlink != 0 {
			kind = "symlink"
		} else if info.Mode().IsRegular() {
			kind = "regular"
		}
		metadata["kind"] = kind
		metadata["size"] = info.Size()
		if kind == "regular" && info.Size() <= 65536 {
			bytes, readError := capture.read(path)
			if readError != nil {
				metadata["kind"] = "read-error"
				metadata["error"] = governanceProbeFailure(readError)
			} else {
				raw = base64.StdEncoding.EncodeToString(bytes)
			}
		}
	} else if os.IsNotExist(err) {
		metadata["kind"] = "absent"
	}
	session.generation++
	token := governanceHash([]byte(fmt.Sprintf("policy:%s:%d:%s", canonical, session.generation, capture.certificate())))
	session.policySuspension = &governancePolicySuspension{canonical, token, capture}
	return map[string]any{"status": "configuration", "token": token, "root": absolute, "canonicalRoot": canonical, "configPath": filepath.Join(absolute, "astrale.lint.json"), "configRawBase64": raw, "configKind": metadata["kind"], "configSize": metadata["size"], "configError": metadata["error"]}, nil
}

// The canonical SDK owner has admitted and normalized these patterns. Native
// matching interprets UTF16 units exactly like its non-Unicode JS regex, without
// parsing, trimming, validating or redigesting policy configuration.
func governanceAdmittedIgnore(patterns [][]uint16) func(string) bool {
	encode := func(units []uint16) string {
		var b strings.Builder
		for _, unit := range units {
			if unit == '/' {
				b.WriteByte('/')
			} else {
				b.WriteRune(rune(unit) + 0x10000)
			}
		}
		return b.String()
	}
	expressions := []*regexp.Regexp{}
	for _, pattern := range patterns {
		segments := [][]uint16{{}}
		for _, unit := range pattern {
			if unit == '/' {
				segments = append(segments, []uint16{})
			} else {
				segments[len(segments)-1] = append(segments[len(segments)-1], unit)
			}
		}
		expression := ""
		for i, segment := range segments {
			if len(segment) == 2 && segment[0] == '*' && segment[1] == '*' {
				expression += "(?:/[^/]+)*"
				continue
			}
			if i > 0 {
				expression += "/"
			}
			for _, unit := range segment {
				switch unit {
				case '*':
					expression += "[^/]*"
				case '?':
					expression += "[^/]"
				default:
					expression += regexp.QuoteMeta(encode([]uint16{unit}))
				}
			}
		}
		expressions = append(expressions, regexp.MustCompile("^"+expression+"$"))
	}
	return func(path string) bool {
		segments := strings.Split(path, "/")
		for i := range segments {
			prefix := encode(utf16.Encode([]rune(strings.Join(segments[:i+1], "/"))))
			for _, expression := range expressions {
				if expression.MatchString(prefix) {
					return true
				}
			}
		}
		return false
	}
}
func (session *governanceSession) continuePolicy(token string, authority governanceCompiledPolicy) (*governedProject, error) {
	suspension := session.policySuspension
	if suspension == nil || suspension.Token != token {
		return nil, fmt.Errorf("unknown or consumed policy capture token")
	}
	session.policySuspension = nil
	if session.parseCache == nil {
		session.parseCache = map[string]*governedFile{}
	}
	project, err := captureGovernedProjectAuthority(suspension.Root, authority.Source, session.parseCache, suspension.Capture, &authority)
	if err != nil {
		return nil, err
	}
	project.typeDemandCache = session.typeDemandOwner()
	project.programGeneration = session.programGeneration
	project.policyDigest = authority.Digest
	return project, nil
}
