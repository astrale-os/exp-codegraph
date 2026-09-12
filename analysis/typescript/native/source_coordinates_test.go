package main

import (
	"strings"
	"testing"
	"unicode/utf16"
)

func TestSourceCoordinatesMatchUTF16AtEveryRuneBoundary(t *testing.T) {
	for _, text := range []string{
		"", "export const value = call()\r\n", "// élève déjà\ncall('été')",
		"\ufeff// 👩🏽‍💻 𝒙\r\ncall('🪐')", "a\rb\u2028c\u2029d\r\ne\n",
		strings.Repeat("é😀abc\r\n", 4096),
	} {
		coordinates := indexSourceCoordinates(text)
		expected := 0
		check := func(offset int) {
			if actual := coordinates.utf16(offset); actual != expected {
				t.Fatalf("offset %d: got %d UTF-16 units, expected %d", offset, actual, expected)
			}
		}
		for offset, value := range text {
			check(offset)
			expected += len(utf16.Encode([]rune{value}))
		}
		check(len(text))
	}
}

func TestSourceCoordinatesKeepASCIIFastAndUnicodeSparse(t *testing.T) {
	ascii := strings.Repeat("const value = call();\r\n", 4096)
	if indexSourceCoordinates(ascii) != nil {
		t.Fatal("ASCII sources must not allocate a conversion table")
	}
	if allocations := testing.AllocsPerRun(10, func() { indexSourceCoordinates(ascii) }); allocations != 0 {
		t.Fatalf("ASCII conversion allocated %f times", allocations)
	}
	coordinates := indexSourceCoordinates(ascii + "é" + ascii + "😀" + ascii)
	if len(coordinates) != 2 {
		t.Fatalf("sparse Unicode allocated %d entries instead of 2", len(coordinates))
	}
	if actual := coordinates.utf16(len(ascii)*3 + len("é😀")); actual != len(ascii)*3+3 {
		t.Fatalf("incorrect sparse UTF-16 length %d", actual)
	}
}
