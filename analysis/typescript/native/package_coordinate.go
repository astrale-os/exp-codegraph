package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type packageOwner struct{ directory, name string }

// Package ownership belongs to one extraction snapshot. Both named owners and
// negative directory lookups are shared by sibling files, then discarded before
// the next refresh so edits to package metadata cannot reuse stale provenance.
type packageCoordinateResolver struct {
	root        string
	coordinates map[string]string
	directories map[string]packageOwner
	reads       int
}

func newPackageCoordinateResolver(root string) *packageCoordinateResolver {
	absolute, _ := filepath.Abs(root)
	return &packageCoordinateResolver{root: absolute, coordinates: map[string]string{}, directories: map[string]packageOwner{}}
}

func workspacePackageCoordinate(root, source string) string {
	return newPackageCoordinateResolver(root).coordinate(source)
}

func (r *packageCoordinateResolver) coordinate(source string) string {
	absolute, err := filepath.Abs(source)
	if err != nil || r.root == "" {
		return ""
	}
	if value, exists := r.coordinates[absolute]; exists {
		return value
	}
	owner := r.owner(filepath.Dir(absolute), pathContains(r.root, absolute))
	coordinate := ""
	if owner.name != "" {
		coordinate = "package:" + owner.name
		if subpath, err := filepath.Rel(owner.directory, absolute); err == nil && subpath != "." {
			coordinate += "/" + filepath.ToSlash(subpath)
		}
	}
	r.coordinates[absolute] = coordinate
	return coordinate
}

func (r *packageCoordinateResolver) owner(directory string, inside bool) (owner packageOwner) {
	visited := []string{}
	defer func() {
		for _, path := range visited {
			r.directories[path] = owner
		}
	}()
	for {
		if inside && !pathContains(r.root, directory) {
			return
		}
		if cached, exists := r.directories[directory]; exists {
			return cached
		}
		visited = append(visited, directory)
		r.reads++
		content, err := os.ReadFile(filepath.Join(directory, "package.json"))
		if err == nil {
			var document struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(content, &document) != nil {
				return
			}
			if document.Name != "" {
				return packageOwner{directory: directory, name: document.Name}
			}
		} else if !os.IsNotExist(err) {
			return
		}
		if inside && directory == r.root {
			return
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return
		}
		directory = parent
	}
}

func pathContains(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
