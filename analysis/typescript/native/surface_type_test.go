package main

import (
	"reflect"
	"testing"

	shimast "github.com/microsoft/typescript-go/shim/ast"
)

func TestCallableGenericBindingsIncludeRuntimeFunctionForms(t *testing.T) {
	for _, kind := range []shimast.Kind{
		shimast.KindFunctionDeclaration,
		shimast.KindFunctionExpression,
		shimast.KindArrowFunction,
		shimast.KindFunctionType,
	} {
		if !callableCanDeclareTypeParameters(kind) {
			t.Fatalf("callable kind %v must retain its generic bindings", kind)
		}
	}
	if callableCanDeclareTypeParameters(shimast.KindClassDeclaration) {
		t.Fatal("non-callable declarations must not be treated as callable generic scopes")
	}
}

func TestLiteralFromSyntaxUsesParsedTypeScriptStringValue(t *testing.T) {
	actual := literalFromSyntax(shimast.KindStringLiteral, "auth", "'auth'", nil)
	expected := map[string]any{"kind": "literal", "value": "auth"}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("single-quoted TypeScript literal differs: actual=%#v expected=%#v", actual, expected)
	}
}
