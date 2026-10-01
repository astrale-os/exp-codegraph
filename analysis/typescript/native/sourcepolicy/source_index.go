package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	coordinates "astrale-typespec-v2-native-analysis/sourcecoordinates"
	ast "github.com/microsoft/typescript-go/shim/ast"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

type callAnchor struct{ start, end int }
type fileSourceIndex struct {
	source      *ast.SourceFile
	coordinates *coordinates.Index
	calls       map[callAnchor][]*ast.Node
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

// The previous per-observation DFS selected the LAST matching call. Retain DFS
// order in each rare duplicate anchor bucket, and apply top-level admission at
// lookup instead of conflating its authority with source coordinates.
func (file *File) runtimeCall(start, end int, onlyTopLevel bool) *ast.Node {
	if file.Source == nil {
		return nil
	}
	index := file.sourceIndex()
	if index.calls == nil {
		index.calls = map[callAnchor][]*ast.Node{}
		authored.Walk(file.Source.AsNode(), func(node *ast.Node) {
			if node.Kind == ast.KindCallExpression {
				key := callAnchor{index.offset(scanner.GetTokenPosOfNode(node, file.Source, false)), index.offset(node.End())}
				index.calls[key] = append(index.calls[key], node)
			}
		})
	}
	var found *ast.Node
	for _, node := range index.calls[callAnchor{start, end}] {
		if !onlyTopLevel || qmTopLevel(node) {
			found = node
		}
	}
	return found
}
