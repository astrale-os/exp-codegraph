package sourcecoordinates

import (
	"math/rand"
	"strings"
	"testing"
	"unicode/utf16"
)

func legacy(text string, offset int) int {
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	return len(utf16.Encode([]rune(text[:offset])))
}
func TestOriginalEveryByteCut(t *testing.T) {
	samples := []string{"", "ASCII\r\n\t", "aé日😀z", "\ufeffé\r\n😀", string([]byte{0xed, 0xa0, 0x80, 0xed, 0xbf, 0xbf}), string([]byte{0xff, 0xf0, 0x9f, 0x80, 0xc0, 0xaf, 0xef, 0xbf, 0xbd})}
	random := rand.New(rand.NewSource(20261001))
	for trial := 0; trial < 500; trial++ {
		raw := make([]byte, random.Intn(128))
		random.Read(raw)
		samples = append(samples, string(raw))
	}
	for _, text := range samples {
		index := New(text)
		for offset := -1; offset <= len(text)+1; offset++ {
			want := legacy(text, offset)
			if got := index.Offset(offset); got != want {
				t.Fatalf("index input %x cut%d got%d want%d", text, offset, got, want)
			}
			if got := Count(text, offset); got != want {
				t.Fatalf("count input %x cut%d got%d want%d", text, offset, got, want)
			}
		}
	}
}
func TestIndexOwnerAndZeroAllocationLookup(t *testing.T) {
	first := New("a😀z")
	second := New("aé日z")
	if first.Offset(5) != 3 || second.Offset(5) != 4 {
		t.Fatal("owners conflated")
	}
	if n := testing.AllocsPerRun(100, func() { _ = first.Offset(4); _ = first.Offset(5); _ = first.Offset(6) }); n != 0 {
		t.Fatalf("lookup allocations%g", n)
	}
	ascii := New(strings.Repeat("a", 10000))
	if len(ascii.adjustments) != 0 {
		t.Fatal("ASCII index should have no offset table")
	}
}
func BenchmarkOriginalPrefixCoordinates(b *testing.B) {
	text := strings.Repeat("const café='😀';\n", 1000)
	positions := []int{50, len(text) / 2, len(text) - 1}
	b.Run("original", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = legacy(text, positions[i%len(positions)])
		}
	})
	index := New(text)
	b.Run("source-index", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = index.Offset(positions[i%len(positions)])
		}
	})
}
