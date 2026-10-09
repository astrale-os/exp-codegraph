package main

import (
	module "github.com/microsoft/typescript-go/astrale-codegraph-modulebridge"
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
	value, _ := governanceParseConfigText(manifest, text)
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
