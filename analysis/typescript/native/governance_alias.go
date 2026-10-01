package main

import (
	"fmt"
	module "github.com/microsoft/typescript-go/astrale-codegraph-modulebridge"
	options "github.com/microsoft/typescript-go/shim/tsoptions"
	tspath "github.com/microsoft/typescript-go/shim/tspath"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf16"
)

func governanceUTF16Length(value string) int { return len(utf16.Encode([]rune(value))) }
func (project *governedProject) packageImportMappingKind(file *governedFile, specifier string) string {
	owner := project.resolver(false)
	fs := project.capture.compiler
	_ = owner
	directory := filepath.Dir(file.AbsolutePath)
	manifest := ""
	for {
		candidate := filepath.Join(directory, "package.json")
		if fs.FileExists(candidate) {
			manifest = candidate
			break
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	if manifest == "" {
		return "absent"
	}
	text, ok := fs.ReadFile(manifest)
	if !ok {
		return "absent"
	}
	value, _ := options.ParseConfigFileTextToJson(manifest, tspath.Path(manifest), text)
	object, ok := value.(*module.JSONMap)
	if !ok {
		return "absent"
	}
	raw, ok := object.Get("imports")
	if !ok {
		return "absent"
	}
	imports, ok := raw.(*module.JSONMap)
	if !ok {
		return "absent"
	}
	keys := []string{}
	for key := range imports.Keys() {
		star := strings.Index(key, "*")
		if key == specifier || (star >= 0 && strings.HasPrefix(specifier, key[:star]) && strings.HasSuffix(specifier, key[star+1:])) {
			keys = append(keys, key)
		}
	}
	index := func(key string) int {
		at := strings.Index(key, "*")
		if at < 0 {
			return -1
		}
		return governanceUTF16Length(key[:at])
	}
	sort.SliceStable(keys, func(i, j int) bool {
		a, b := keys[i], keys[j]
		if (a == specifier) != (b == specifier) {
			return a == specifier
		}
		if index(a) != index(b) {
			return index(a) > index(b)
		}
		return governanceUTF16Length(a) > governanceUTF16Length(b)
	})
	if len(keys) == 0 {
		return "absent"
	}
	target, _ := imports.Get(keys[0])
	s, ok := target.(string)
	if ok && strings.HasPrefix(s, "./") {
		return "literal"
	}
	return "opaque"
}
func governanceAliasConfiguration(project *governedProject) governanceOutcome {
	out := governanceOutcome{Rule: "IMP-ALIAS-CFG", Revision: "c28fb835daba008c01fdf0f6555817a358da85d5a697775c029e8a051c28f0ab", Status: "pass", Findings: []governanceEvidence{}}
	seen := map[string]bool{}
	problems := []string{}
	var first *governedFile
	for _, file := range project.Files {
		if file.Role != "production" {
			continue
		}
		out.SubjectCount++
		if first == nil {
			first = file
		}
		for _, imp := range file.Imports {
			specifier := imp.Specifier
			if !strings.HasPrefix(specifier, "#") || project.packageImportMappingKind(file, specifier) != "literal" {
				continue
			}
			compiler := project.resolveImport(file, specifier, false)
			packaged := project.resolveImport(file, specifier, true)
			if !compiler.IsResolved() || !packaged.IsResolved() {
				continue
			}
			sourcePath, err := filepath.Rel(project.Root, compiler.ResolvedFileName)
			if err != nil {
				continue
			}
			packagePath, err := filepath.Rel(project.Root, packaged.ResolvedFileName)
			if err != nil {
				continue
			}
			sourcePath = filepath.ToSlash(sourcePath)
			packagePath = filepath.ToSlash(packagePath)
			if project.FilesByPath[sourcePath] == nil || project.FilesByPath[packagePath] == nil || sourcePath == packagePath {
				continue
			}
			problem := fmt.Sprintf("Alias %s resolves to %s with compiler configuration but to %s through package imports.", specifier, sourcePath, packagePath)
			if !seen[problem] {
				seen[problem] = true
				problems = append(problems, problem)
			}
		}
	}
	if len(problems) > 0 {
		out.Status = "fail"
		anchor := project.FilesByPath["index.ts"]
		if anchor == nil {
			anchor = first
		}
		var evidence governanceEvidence
		if anchor == nil {
			evidence = governanceViolation(out.Rule, nil, nil, strings.Join(problems, "\n"))
		} else {
			evidence = governanceViolation(out.Rule, anchor, anchor.Source.AsNode(), strings.Join(problems, "\n"))
		}
		out.Findings = append(out.Findings, evidence)
	}
	return out
}
