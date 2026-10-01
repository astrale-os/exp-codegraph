package sourcepolicy

import (
	authored "astrale-typespec-v2-native-analysis/authoredsource"
	ast "github.com/microsoft/typescript-go/shim/ast"
)

// MachineTopology is the ordered SDK schema product used by mutation rules.
// Identity remains native state-authority output, never inferred from a type.
type MachineTopology struct {
	Known                                            bool
	ClassNames, AbstractNames, PropertyNames, Owners []string
	Classes, Abstract                                map[string]bool
	Parents                                          map[string][]string
	All                                              map[string][]string
	ByClass                                          map[string]map[string]string
	PropertyOrder                                    map[string][]string
	Ambiguous                                        map[string][]string
}

func qmPush(values []string, value string) []string {
	for _, v := range values {
		if v == value {
			return values
		}
	}
	return append(values, value)
}
func qmVisibleConst(identifier *ast.Node) *ast.Node {
	if identifier == nil || identifier.Kind != ast.KindIdentifier {
		return nil
	}
	for scope := identifier.Parent; scope != nil; scope = scope.Parent {
		if scope.Kind != ast.KindBlock && scope.Kind != ast.KindSourceFile {
			continue
		}
		var found *ast.Node
		for _, statement := range scope.StatementList().Nodes {
			if statement.Pos() >= identifier.Pos() {
				break
			}
			if statement.Kind != ast.KindVariableStatement {
				continue
			}
			list := statement.AsVariableStatement().DeclarationList
			if list.Flags&ast.NodeFlagsConst == 0 {
				continue
			}
			for _, d := range list.AsVariableDeclarationList().Declarations.Nodes {
				if d.Name().Kind == ast.KindIdentifier && d.Name().Text() == identifier.Text() && d.AsVariableDeclaration().Initializer != nil {
					found = d.AsVariableDeclaration().Initializer
				}
			}
		}
		if found != nil {
			return found
		}
	}
	return nil
}
func qmStaticObject(expression *ast.Node, seen map[string]bool) *ast.Node {
	if expression == nil {
		return nil
	}
	value := authored.Unwrap(expression)
	if value.Kind == ast.KindIdentifier {
		if seen[value.Text()] {
			return nil
		}
		if init := qmVisibleConst(value); init != nil {
			copy := map[string]bool{}
			for k, v := range seen {
				copy[k] = v
			}
			copy[value.Text()] = true
			return qmStaticObject(init, copy)
		}
	}
	if value.Kind == ast.KindObjectLiteralExpression {
		return value
	}
	return nil
}
func qmStaticChain(expression *ast.Node, seen map[string]bool) []string {
	if expression == nil {
		return nil
	}
	chain := qmChain(expression)
	if len(chain) > 1 {
		return chain
	}
	value := authored.Unwrap(expression)
	if value.Kind != ast.KindIdentifier || seen[value.Text()] {
		return chain
	}
	if init := qmVisibleConst(value); init != nil {
		copy := map[string]bool{}
		for k, v := range seen {
			copy[k] = v
		}
		copy[value.Text()] = true
		return qmStaticChain(init, copy)
	}
	return chain
}
func qmPropertyName(property *ast.Node) (string, bool) {
	name := property.Name()
	if name == nil {
		return "", false
	}
	switch name.Kind {
	case ast.KindIdentifier, ast.KindStringLiteral, ast.KindNumericLiteral:
		return name.Text(), true
	case ast.KindComputedPropertyName:
		expression := name.AsComputedPropertyName().Expression
		if text, ok := qmText(expression); ok {
			return text, true
		}
		chain := qmStaticChain(expression, nil)
		if len(chain) > 1 && chain[len(chain)-1] == "key" {
			return chain[len(chain)-2], true
		}
	}
	return "", false
}
func qmAssigned(object *ast.Node, name string) *ast.Node {
	if object == nil || object.Kind != ast.KindObjectLiteralExpression {
		return nil
	}
	for _, p := range object.AsObjectLiteralExpression().Properties.Nodes {
		if key, ok := qmPropertyName(p); ok && key == name {
			if p.Kind == ast.KindPropertyAssignment {
				return p.AsPropertyAssignment().Initializer
			}
			if p.Kind == ast.KindShorthandPropertyAssignment {
				return p.Name()
			}
			return nil
		}
	}
	return nil
}
func qmVariableName(node *ast.Node) string {
	for n := node; n != nil && n.Kind != ast.KindSourceFile; n = n.Parent {
		if n.Kind == ast.KindVariableDeclaration && n.Name().Kind == ast.KindIdentifier {
			return n.Name().Text()
		}
	}
	return ""
}
func qmPropertiesObject(node *ast.Node) bool {
	if node == nil || node.Parent == nil || node.Parent.Kind != ast.KindPropertyAssignment {
		return false
	}
	name, known := qmPropertyName(node.Parent)
	return known && name == "properties"
}
func BuildMachineTopology(project *Project) MachineTopology {
	out := MachineTopology{Known: true, Classes: map[string]bool{}, Abstract: map[string]bool{}, Parents: map[string][]string{}, All: map[string][]string{}, ByClass: map[string]map[string]string{}, PropertyOrder: map[string][]string{}, Ambiguous: map[string][]string{}}
	sources := map[string][]string{}
	record := func(file *File, owner, name string, value *ast.Node) {
		identity := StatePropertyIdentity(project, file, value)
		if !identity.Known {
			out.Known = false
			return
		}
		if identity.Kind == "resolved" {
			out.PropertyNames = qmPush(out.PropertyNames, name)
			out.All[name] = qmPush(out.All[name], identity.Identity)
		}
		if owner == "" || (identity.Kind != "resolved" && identity.Kind != "ambiguous") {
			return
		}
		sources[owner] = qmPush(sources[owner], file.Path+"#"+owner)
		out.Owners = qmPush(out.Owners, owner)
		if identity.Kind == "ambiguous" {
			out.Ambiguous[owner] = qmPush(out.Ambiguous[owner], name)
			return
		}
		if out.ByClass[owner] == nil {
			out.ByClass[owner] = map[string]string{}
		}
		out.PropertyOrder[owner] = qmPush(out.PropertyOrder[owner], name)
		out.ByClass[owner][name] = identity.Identity
	}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" {
			continue
		}
		authored.Walk(file.Source.AsNode(), func(n *ast.Node) {
			if (n.Kind == ast.KindPropertyAssignment || n.Kind == ast.KindShorthandPropertyAssignment) && qmPropertiesObject(n.Parent) {
				name, known := qmPropertyName(n)
				if !known {
					return
				}
				value := n.Name()
				if n.Kind == ast.KindPropertyAssignment {
					value = n.AsPropertyAssignment().Initializer
				}
				record(file, qmVariableName(n), name, value)
			}
			if n.Kind == ast.KindSpreadAssignment && qmPropertiesObject(n.Parent) {
				owner := qmVariableName(n)
				value := n.AsSpreadAssignment().Expression
				spread := qmStaticObject(value, nil)
				if spread != nil {
					for _, p := range spread.AsObjectLiteralExpression().Properties.Nodes {
						if p.Kind != ast.KindPropertyAssignment && p.Kind != ast.KindShorthandPropertyAssignment {
							continue
						}
						name, known := qmPropertyName(p)
						if !known {
							continue
						}
						value := p.Name()
						if p.Kind == ast.KindPropertyAssignment {
							value = p.AsPropertyAssignment().Initializer
						}
						record(file, owner, name, value)
					}
				} else if owner != "" {
					identity := StatePropertyIdentity(project, file, value)
					if !identity.Known {
						out.Known = false
					} else if identity.Kind != "absent" {
						out.Owners = qmPush(out.Owners, owner)
						out.Ambiguous[owner] = qmPush(out.Ambiguous[owner], "<spread>")
					}
				}
			}
			if n.Kind != ast.KindCallExpression {
				return
			}
			origin := project.Authored(file).ResolveImportedSymbol(n.AsCallExpression().Expression)
			if origin.Name != "nodeClass" || !authored.Contains(authored.DSLModules, origin.Module) {
				return
			}
			owner := qmVariableName(n)
			object := qmStaticObject(authored.Argument(n, 0), nil)
			if owner == "" || object == nil {
				return
			}
			out.ClassNames = qmPush(out.ClassNames, owner)
			out.Classes[owner] = true
			if abstract := qmAssigned(object, "abstract"); abstract != nil && abstract.Kind == ast.KindTrueKeyword {
				out.AbstractNames = qmPush(out.AbstractNames, owner)
				out.Abstract[owner] = true
			}
			extended := qmAssigned(object, "extends")
			if extended == nil {
				return
			}
			extended = authored.Unwrap(extended)
			if extended.Kind != ast.KindArrayLiteralExpression {
				return
			}
			for _, expression := range extended.AsArrayLiteralExpression().Elements.Nodes {
				chain := qmChain(expression)
				if chain == nil {
					chain = qmStaticChain(expression, nil)
				}
				if len(chain) > 0 {
					out.Parents[owner] = qmPush(out.Parents[owner], chain[len(chain)-1])
				}
			}
		})
	}
	for _, owner := range out.Owners {
		if len(sources[owner]) > 1 {
			for _, name := range out.PropertyOrder[owner] {
				out.Ambiguous[owner] = qmPush(out.Ambiguous[owner], name)
			}
			delete(out.ByClass, owner)
		}
	}
	changed := true
	for changed {
		changed = false
		for _, owner := range out.ClassNames {
			for _, parent := range out.Parents[owner] {
				for _, name := range out.Ambiguous[parent] {
					before := len(out.Ambiguous[owner])
					out.Ambiguous[owner] = qmPush(out.Ambiguous[owner], name)
					if len(out.Ambiguous[owner]) != before {
						changed = true
					}
				}
				source := out.ByClass[parent]
				if source == nil {
					continue
				}
				if out.ByClass[owner] == nil {
					out.ByClass[owner] = map[string]string{}
					out.Owners = qmPush(out.Owners, owner)
				}
				for _, name := range out.PropertyOrder[parent] {
					identity := source[name]
					prior, exists := out.ByClass[owner][name]
					if !exists {
						out.ByClass[owner][name] = identity
						out.PropertyOrder[owner] = qmPush(out.PropertyOrder[owner], name)
						changed = true
					} else if prior != identity {
						before := len(out.Ambiguous[owner])
						out.Ambiguous[owner] = qmPush(out.Ambiguous[owner], name)
						if len(out.Ambiguous[owner]) != before {
							changed = true
						}
					}
				}
			}
		}
	}
	for _, file := range project.Files {
		if file.Role != "production" || file.Layer != "schema" {
			continue
		}
		for _, d := range project.Authored(file).Definitions("defineSchema", "", authored.DSLModules, 1) {
			if d.Origin != "resolved" {
				continue
			}
			classes := qmStaticObject(qmAssigned(d.Object, "classes"), nil)
			if classes == nil {
				continue
			}
			for _, entry := range classes.AsObjectLiteralExpression().Properties.Nodes {
				if entry.Kind != ast.KindPropertyAssignment && entry.Kind != ast.KindShorthandPropertyAssignment {
					continue
				}
				name, known := qmPropertyName(entry)
				value := entry.Name()
				if entry.Kind == ast.KindPropertyAssignment {
					value = authored.Unwrap(entry.AsPropertyAssignment().Initializer)
				}
				if !known || value.Kind != ast.KindIdentifier {
					continue
				}
				sourceName := value.Text()
				for _, property := range out.Ambiguous[sourceName] {
					out.Ambiguous[name] = qmPush(out.Ambiguous[name], property)
				}
				if out.ByClass[sourceName] == nil || sourceName == name {
					continue
				}
				if out.ByClass[name] == nil {
					out.ByClass[name] = map[string]string{}
					out.Owners = qmPush(out.Owners, name)
				}
				for _, property := range out.PropertyOrder[sourceName] {
					identity := out.ByClass[sourceName][property]
					prior, exists := out.ByClass[name][property]
					if !exists || prior == identity {
						out.ByClass[name][property] = identity
						out.PropertyOrder[name] = qmPush(out.PropertyOrder[name], property)
					} else {
						out.Ambiguous[name] = qmPush(out.Ambiguous[name], property)
					}
				}
			}
		}
	}
	return out
}
