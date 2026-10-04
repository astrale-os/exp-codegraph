package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	coordinates "astrale-typespec-v2-native-analysis/sourcecoordinates"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

type fileSourceIndex struct {
	source        *ast.SourceFile
	coordinates   *coordinates.Index
	calls         map[int][]*ast.Node
	topLevelCalls map[int][]*ast.Node
}

// No path/global cache: source replacement creates a new coordinate/AST owner.
func (file *File) sourceIndex() *fileSourceIndex {
	if file.index == nil || file.index.source != file.Source || file.index.coordinates.Text() != file.Source.Text() {
		file.index = &fileSourceIndex{source: file.Source, coordinates: coordinates.New(file.Source.Text())}
	}
	return file.index
}
func (index *fileSourceIndex) offset(offset int) int {
	// Preserve the original source-prefix bounds check, including malformed ASTs.
	_ = index.source.Text()[:offset]
	return index.coordinates.Offset(offset)
}
func qmStart(file *File, node *ast.Node) int {
	return file.sourceIndex().offset(scanner.GetTokenPosOfNode(node, file.Source, false))
}
func qmEnd(file *File, node *ast.Node) int { return file.sourceIndex().offset(node.End()) }

// The original DFS tests top-level admission before the start coordinate, then
// reads the end coordinate ONLY when the start matches. Separate ordered start
// buckets preserve that short-circuit behavior, including malformed AST anchors.
func (file *File) runtimeCall(start, end int, onlyTopLevel bool) *ast.Node {
	if file.Source == nil {
		return nil
	}
	index := file.sourceIndex()
	calls := index.calls
	if onlyTopLevel {
		calls = index.topLevelCalls
	}
	if calls == nil {
		calls = map[int][]*ast.Node{}
		valid := true
		length := len(file.Source.Text())
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if !valid {
				return
			}
			if node.Kind == ast.KindCallExpression && (!onlyTopLevel || qmTopLevel(node)) {
				if node.Pos() < 0 || node.Pos() > length || node.End() < 0 || node.End() > length {
					valid = false
					return
				}
				at := index.offset(scanner.GetTokenPosOfNode(node, file.Source, false))
				calls[at] = append(calls[at], node)
			}
		})
		if !valid {
			return scanRuntimeCall(file, start, end, onlyTopLevel)
		}
		if onlyTopLevel {
			index.topLevelCalls = calls
		} else {
			index.calls = calls
		}
	}
	var found *ast.Node
	for _, node := range calls[start] {
		if index.offset(node.End()) == end {
			found = node
		}
	}
	return found
}

// Parsed native sources have bounded AST ranges. If an external/synthetic AST
// violates that representation, execute the original ordered short-circuit walk;
// publishing a partial index would change its exception behavior.
func scanRuntimeCall(file *File, start, end int, onlyTopLevel bool) *ast.Node {
	var found *ast.Node
	authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
		if node.Kind == ast.KindCallExpression && (!onlyTopLevel || qmTopLevel(node)) && qmStart(file, node) == start && qmEnd(file, node) == end {
			found = node
		}
	})
	return found
}
