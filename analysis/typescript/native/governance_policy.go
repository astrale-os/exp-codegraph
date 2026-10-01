package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

func containsString(values []string, s string) bool {
	for _, v := range values {
		if v == s {
			return true
		}
	}
	return false
}
func governanceConfigure(project *governedProject) (func(string) bool, error) {
	capture := project.capture
	path := filepath.Join(project.Root, "astrale.lint.json")
	m, err := capture.lstat(path)
	config := map[string]any{}
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("Cannot inspect Domain lint configuration %s.", path)
	}
	if err == nil {
		if !m.Mode().IsRegular() {
			return nil, fmt.Errorf("Domain lint configuration must be a regular file: %s.", path)
		}
		if m.Size() > 64*1024 {
			return nil, fmt.Errorf("Domain lint configuration %s is %d bytes; maximum is 65536.", path, m.Size())
		}
		bytes, err := capture.read(path)
		if err != nil || !utf8.Valid(bytes) {
			return nil, fmt.Errorf("Cannot parse Domain lint configuration %s.", path)
		}
		if err = json.Unmarshal([]byte(strings.TrimPrefix(string(bytes), "\ufeff")), &config); err != nil || config == nil {
			return nil, fmt.Errorf("Cannot parse Domain lint configuration %s.", path)
		}
	}
	for key := range config {
		if key != "layers" && key != "disabledRules" && key != "ignore" {
			return nil, fmt.Errorf("Domain lint configuration has unknown fields: %s.", key)
		}
	}
	layers := map[string]any{}
	if value, present := config["layers"]; present {
		var ok bool
		layers, ok = value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("Domain lint configuration layers must be an object.")
		}
	}
	for id, value := range layers {
		index := -1
		for i, layer := range project.Policy.Layers {
			if layer.ID == id {
				index = i
				break
			}
		}
		if index < 0 {
			return nil, fmt.Errorf("Unknown Domain lint layer %s.", id)
		}
		row, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("Domain lint layer %s must be an object.", id)
		}
		if len(row) == 0 {
			return nil, fmt.Errorf("Domain lint layer %s must configure a sourcePath or alias.", id)
		}
		for key, value := range row {
			if key != "sourcePath" && key != "alias" {
				return nil, fmt.Errorf("Domain lint layer %s has unknown fields: %s.", id, key)
			}
			s, ok := value.(string)
			if key == "sourcePath" {
				if !ok || !regexp.MustCompile(`^[a-z][a-z0-9-]*/$`).MatchString(s) {
					return nil, fmt.Errorf("Domain lint layer %s sourcePath must be a root directory ending in '/'.", id)
				}
				project.Policy.Layers[index].SourcePath = s
			} else if !ok || !regexp.MustCompile(`^#[a-z][a-z0-9-]*$`).MatchString(s) {
				return nil, fmt.Errorf("Domain lint layer %s alias must be a root # alias without a wildcard.", id)
			}
		}
	}
	// Disabled rule membership is governed by canonical source TSV, not the subset
	// of native implementations. It remains report assembly's explicit obligation.
	catalog := map[string]bool{}
	for i, line := range strings.Split(project.Policy.Rules, "\n") {
		if i > 0 && line != "" {
			catalog[strings.Split(line, "\t")[0]] = true
		}
	}
	if value, present := config["disabledRules"]; present {
		rows, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("Domain lint configuration disabledRules must be an object.")
		}
		for id, value := range rows {
			if !catalog[id] {
				return nil, fmt.Errorf("Disabled Domain lint rule %s is unknown.", id)
			}
			s, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("Disabled Domain lint rule %s reason must be a string.", id)
			}
			reason := strings.TrimSpace(s)
			if len(reason) == 0 || len(reason) > 240 {
				return nil, fmt.Errorf("Disabled Domain lint rule %s reason must contain 1-240 bytes.", id)
			}
			project.Disabled[id] = reason
		}
	}
	// SDK compileDomainPolicy rejects duplicate remapped layer paths.
	paths := map[string]bool{}
	for _, layer := range project.Policy.Layers {
		if paths[layer.SourcePath] {
			return nil, fmt.Errorf("Domain policy has duplicate layer source path %s.", layer.SourcePath)
		}
		paths[layer.SourcePath] = true
	}
	patterns := []string{}
	if value, present := config["ignore"]; present {
		values, ok := value.([]any)
		if !ok {
			return nil, fmt.Errorf("Domain lint configuration ignore must be an array.")
		}
		if len(values) > 64 {
			return nil, fmt.Errorf("Domain lint configuration ignore has more than 64 patterns.")
		}
		for _, v := range values {
			p, ok := v.(string)
			if !ok {
				return nil, fmt.Errorf("Domain lint ignore patterns must be strings.")
			}
			patterns = append(patterns, p)
		}
	}
	expressions := []*regexp.Regexp{}
	governed := map[string]string{}
	for _, layer := range project.Policy.Layers {
		governed[strings.TrimSuffix(layer.SourcePath, "/")] = fmt.Sprintf("declared layer %s (%s)", layer.ID, layer.SourcePath)
	}
	for _, r := range project.Policy.RootFiles {
		governed[r.SourcePath] = "governed root file " + r.SourcePath
	}
	for _, pattern := range patterns {
		fail := func(reason string) error { return fmt.Errorf("Domain lint ignore pattern %q %s.", pattern, reason) }
		if len(pattern) == 0 || len(pattern) > 512 {
			return nil, fail("must contain 1-512 characters")
		}
		if strings.TrimSpace(pattern) != pattern {
			return nil, fail("must not start or end with whitespace")
		}
		if strings.HasPrefix(pattern, "/") {
			return nil, fail("must be relative to the Domain root")
		}
		if strings.ContainsAny(pattern, `\[]{}!`) {
			return nil, fail("may only use '*', '**', and '?' wildcards")
		}
		segments := strings.Split(strings.TrimSuffix(pattern, "/"), "/")
		for _, segment := range segments {
			if segment == "" || segment == "." || segment == ".." {
				return nil, fail("must not contain empty, '.', or '..' segments")
			}
			if strings.Contains(segment, "**") && segment != "**" {
				return nil, fail("must use '**' as a whole path segment")
			}
		}
		if strings.ContainsAny(segments[0], "*?") {
			return nil, fail("must start with a literal root entry, such as mockups/**")
		}
		if owner := governed[segments[0]]; owner != "" {
			return nil, fmt.Errorf("Domain lint ignore pattern %q would exclude %s; ignore only paths outside the Domain layout.", pattern, owner)
		}
		expression := ""
		for i, segment := range segments {
			if segment == "**" {
				expression += "(?:/[^/]+)*"
				continue
			}
			if i > 0 {
				expression += "/"
			}
			for _, c := range segment {
				switch c {
				case '*':
					expression += "[^/]*"
				case '?':
					expression += "[^/]"
				default:
					expression += regexp.QuoteMeta(string(c))
				}
			}
		}
		expressions = append(expressions, regexp.MustCompile("^"+expression+"$"))
	}
	return func(path string) bool {
		segments := strings.Split(path, "/")
		for i := range segments {
			prefix := strings.Join(segments[:i+1], "/")
			for _, expression := range expressions {
				if expression.MatchString(prefix) {
					return true
				}
			}
		}
		return false
	}, nil
}
