// Package observabledecision explores rule-specific native evaluation. It is
// deliberately not registered as a production linter capability.
package observabledecision

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"unicode/utf8"

	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
)

type Result struct{ ID, Reason string }
type Decision struct {
	Subject string
	Result  Result
	Reads   map[string][32]byte
}
type Stats struct{ Parsed, Evaluated, Reused, BucketDeltas, BarrierReads int }
type Report struct {
	Decisions  []Decision
	Duplicates map[string][]string
	Stats      Stats
	Complete   bool
}
type binding struct {
	exported         bool
	expr, function   *ast.Node
	target, imported string
}
type subject struct {
	key, path string
	call      *ast.Node
}
type file struct {
	text     string
	hash     [32]byte
	bindings map[string]binding
	subjects []subject
	safe     bool
}

// Session owns captured bytes, ASTs, reverse traces, decisions and ID buckets.
// Missing paths are observations too. Admissions are immutable for this pilot;
// a membership change requires a new session.
type Session struct {
	paths     []string
	files     map[string]*file
	decisions map[string]Decision
	reverse   map[string]map[string]bool
	buckets   map[string]map[string]bool
	// IntrinsicModule must be bound to a qualified immutable SDK package by the
	// caller. This prototype tests the model, not package admission/certification.
	IntrinsicModule string
}

func New(paths []string, intrinsic string) (*Session, error) {
	s := &Session{files: map[string]*file{}, decisions: map[string]Decision{}, reverse: map[string]map[string]bool{}, buckets: map[string]map[string]bool{}, IntrinsicModule: intrinsic}
	for _, p := range paths {
		a, e := filepath.Abs(p)
		if e != nil {
			return nil, e
		}
		s.paths = append(s.paths, filepath.Clean(a))
	}
	sort.Strings(s.paths)
	for i, p := range s.paths {
		if i > 0 && s.paths[i-1] == p {
			return nil, fmt.Errorf("duplicate admission %s", p)
		}
	}
	return s, nil
}
func capture(path string) (*file, error) {
	b, e := os.ReadFile(path)
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	if !utf8.Valid(b) {
		return nil, fmt.Errorf("invalid UTF-8: %s", path)
	}
	return &file{text: string(b), hash: sha256.Sum256(b)}, nil
}
func parse(path string, f *file) {
	f.bindings = map[string]binding{}
	f.safe = true
	sf := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: path}, f.text, core.ScriptKindTS)
	if len(sf.Diagnostics()) != 0 {
		f.safe = false
	}
	put := func(name string, b binding) {
		if _, found := f.bindings[name]; found {
			f.safe = false
		}
		f.bindings[name] = b
	}
	for _, n := range sf.Statements.Nodes {
		switch n.Kind {
		case ast.KindImportDeclaration:
			d := n.AsImportDeclaration()
			if d.ImportClause == nil {
				f.safe = false
				continue
			}
			c := d.ImportClause.AsImportClause()
			if c.PhaseModifier == ast.KindTypeKeyword {
				continue
			}
			if c.Name() != nil || c.NamedBindings == nil || c.NamedBindings.Kind != ast.KindNamedImports {
				f.safe = false
				continue
			}
			for _, el := range c.NamedBindings.AsNamedImports().Elements.Nodes {
				v := el.AsImportSpecifier()
				if v.IsTypeOnly {
					continue
				}
				imported := el.Name().Text()
				if v.PropertyName != nil {
					imported = v.PropertyName.Text()
				}
				put(el.Name().Text(), binding{target: d.ModuleSpecifier.Text(), imported: imported})
			}
		case ast.KindFunctionDeclaration:
			if n.Name() == nil {
				f.safe = false
				continue
			}
			put(n.Name().Text(), binding{function: n, exported: n.ModifierFlags()&ast.ModifierFlagsExport != 0})
			if !pureFunction(n) {
				f.safe = false
			}
		case ast.KindVariableStatement:
			d := n.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
			if d.Flags&ast.NodeFlagsConst == 0 {
				f.safe = false
			}
			for _, v := range d.Declarations.Nodes {
				if v.Name().Kind != ast.KindIdentifier {
					f.safe = false
					continue
				}
				expr := v.AsVariableDeclaration().Initializer
				put(v.Name().Text(), binding{expr: expr, exported: n.ModifierFlags()&ast.ModifierFlagsExport != 0})
				if expr != nil && expr.Kind == ast.KindCallExpression {
					f.subjects = append(f.subjects, subject{key: path + "#" + v.Name().Text(), path: path, call: expr})
				}
				if !pureExpr(expr) {
					f.safe = false
				}
			}
		default:
			f.safe = false
		}
	}
}

// The accepted island has no mutation, receiver, prototype access, namespace
// call, closure write, branch or hidden initializer effects. Unsupported code
// produces a residual; it is never guessed from static types.
func pureExpr(n *ast.Node) bool {
	if n == nil {
		return false
	}
	switch n.Kind {
	case ast.KindStringLiteral, ast.KindIdentifier:
		return true
	case ast.KindBinaryExpression:
		b := n.AsBinaryExpression()
		return b.OperatorToken.Kind == ast.KindPlusToken && pureExpr(b.Left) && pureExpr(b.Right)
	case ast.KindCallExpression:
		c := n.AsCallExpression()
		if c.Expression.Kind != ast.KindIdentifier {
			return false
		}
		for _, a := range c.Arguments.Nodes {
			if !pureExpr(a) {
				return false
			}
		}
		return true
	case ast.KindObjectLiteralExpression:
		for _, p := range n.AsObjectLiteralExpression().Properties.Nodes {
			if p.Kind != ast.KindPropertyAssignment || !pureExpr(p.AsPropertyAssignment().Initializer) {
				return false
			}
		}
		return true
	}
	return false
}
func pureFunction(n *ast.Node) bool {
	if ast.GetCombinedModifierFlags(n)&ast.ModifierFlagsAsync != 0 || n.AsFunctionDeclaration().AsteriskToken != nil {
		return false
	}
	allowed := map[string]bool{}
	for _, p := range n.Parameters() {
		if p.Name().Kind != ast.KindIdentifier || p.AsParameterDeclaration().DotDotDotToken != nil {
			return false
		}
		allowed[p.Name().Text()] = true
	}
	var parametersOnly func(*ast.Node) bool
	parametersOnly = func(v *ast.Node) bool {
		if v == nil {
			return false
		}
		switch v.Kind {
		case ast.KindIdentifier:
			return allowed[v.Text()]
		case ast.KindStringLiteral:
			return true
		case ast.KindBinaryExpression:
			b := v.AsBinaryExpression()
			return b.OperatorToken.Kind == ast.KindPlusToken && parametersOnly(b.Left) && parametersOnly(b.Right)
		}
		return false
	}

	if n.Body() == nil || n.Body().Kind != ast.KindBlock {
		return false
	}
	st := n.Body().AsBlock().Statements.Nodes
	return len(st) == 1 && st[0].Kind == ast.KindReturnStatement && parametersOnly(st[0].AsReturnStatement().Expression)
}

// Import execution is part of the effect guard, even when an imported binding
// is not otherwise read. Absence probes participate in the same trace.
func (s *Session) safeModule(path string, d *Decision, seen map[string]bool) bool {
	if seen[path] {
		return true
	}
	seen[path] = true
	f := s.read(path, d)
	if f == nil || !f.safe {
		return false
	}
	resolve := func(b binding) (binding, bool) {
		if b.target == s.IntrinsicModule {
			return b, true
		}
		if !strings.HasPrefix(b.target, ".") {
			return b, false
		}
		base := filepath.Clean(filepath.Join(filepath.Dir(path), b.target))
		for _, p := range []string{base + ".ts", filepath.Join(base, "index.ts")} {
			if _, ok := s.files[p]; !ok {
				return b, false
			}
			target := s.read(p, d)
			if target != nil {
				if !s.safeModule(p, d, seen) {
					return b, false
				}
				v, ok := target.bindings[b.imported]
				return v, ok && v.exported
			}
		}
		return b, false
	}
	for _, b := range f.bindings {
		if b.target != "" {
			if _, ok := resolve(b); !ok {
				return false
			}
		}
	}
	var safeValue func(*ast.Node) bool
	safeValue = func(n *ast.Node) bool {
		if n == nil {
			return false
		}
		switch n.Kind {
		case ast.KindStringLiteral, ast.KindIdentifier:
			return true
		case ast.KindBinaryExpression:
			b := n.AsBinaryExpression()
			return b.OperatorToken.Kind == ast.KindPlusToken && safeValue(b.Left) && safeValue(b.Right)
		case ast.KindObjectLiteralExpression:
			for _, p := range n.AsObjectLiteralExpression().Properties.Nodes {
				if p.Kind != ast.KindPropertyAssignment || !safeValue(p.AsPropertyAssignment().Initializer) {
					return false
				}
			}
			return true
		case ast.KindCallExpression:
			c := n.AsCallExpression()
			if c.Expression.Kind != ast.KindIdentifier {
				return false
			}
			b, ok := f.bindings[c.Expression.Text()]
			if !ok {
				return false
			}
			if b.target != "" {
				b, ok = resolve(b)
				if !ok {
					return false
				}
			}
			if !(b.target == s.IntrinsicModule && b.imported == "Query") && (b.function == nil || !pureFunction(b.function)) {
				return false
			}
			for _, a := range c.Arguments.Nodes {
				if !safeValue(a) {
					return false
				}
			}
			return true
		}
		return false
	}
	for _, b := range f.bindings {
		if b.expr != nil && !safeValue(b.expr) {
			return false
		}
	}
	return true
}
func (s *Session) Refresh() (Report, error) {
	trial := *s
	trial.files = map[string]*file{}
	trial.decisions = map[string]Decision{}
	trial.reverse = map[string]map[string]bool{}
	trial.buckets = map[string]map[string]bool{}
	for p, f := range s.files {
		trial.files[p] = f
	}
	for key, d := range s.decisions {
		trial.decisions[key] = d
	}
	for p, members := range s.reverse {
		trial.reverse[p] = map[string]bool{}
		for key, v := range members {
			trial.reverse[p][key] = v
		}
	}
	for id, members := range s.buckets {
		trial.buckets[id] = map[string]bool{}
		for key, v := range members {
			trial.buckets[id][key] = v
		}
	}
	report, err := trial.refresh()
	if err != nil {
		return Report{}, err
	}
	*s = trial
	return report, nil
}
func (s *Session) refresh() (Report, error) {
	stats := Stats{}
	changed := map[string]bool{}
	next := map[string]*file{}
	for _, p := range s.paths {
		f, e := capture(p)
		if e != nil {
			return Report{}, e
		}
		old := s.files[p]
		if old == nil && f == nil {
			next[p] = nil
			continue
		}
		if old != nil && f != nil && old.hash == f.hash {
			next[p] = old
			continue
		}
		changed[p] = true
		if f != nil {
			parse(p, f)
			stats.Parsed++
		}
		next[p] = f
	}
	dirty := map[string]bool{}
	for p := range changed {
		for key := range s.reverse[p] {
			dirty[key] = true
		}
	}
	s.files = next
	active := map[string]subject{}
	for _, f := range s.files {
		if f != nil {
			for _, sub := range f.subjects {
				active[sub.key] = sub
			}
		}
	}
	for key, old := range s.decisions {
		if _, ok := active[key]; !ok {
			s.remove(old, &stats)
			delete(s.decisions, key)
		}
	}
	keys := make([]string, 0, len(active))
	for key := range active {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		sub := active[key]
		old, exists := s.decisions[key]
		if exists && !changed[sub.path] && !dirty[key] {
			stats.Reused++
			continue
		}
		d := Decision{Subject: key, Reads: map[string][32]byte{}}
		budget := 100
		d.Result = s.evaluateSubject(sub, &d, &budget)
		stats.Evaluated++
		sameValue := exists && old.Result == d.Result
		if exists {
			if sameValue {
				for p := range old.Reads {
					delete(s.reverse[p], old.Subject)
				}
			} else {
				s.remove(old, &stats)
			}
		}
		s.decisions[key] = d
		for p := range d.Reads {
			if s.reverse[p] == nil {
				s.reverse[p] = map[string]bool{}
			}
			s.reverse[p][key] = true
		}
		if d.Result.Reason == "" && !sameValue {
			if s.buckets[d.Result.ID] == nil {
				s.buckets[d.Result.ID] = map[string]bool{}
			}
			s.buckets[d.Result.ID][key] = true
			stats.BucketDeltas++
		}
	}
	// A single whole captured-byte barrier protects discovery, negative probes,
	// and all decision inputs. It reads real bytes; no metadata shortcut.
	for _, p := range s.paths {
		f, e := capture(p)
		stats.BarrierReads++
		if e != nil {
			return Report{}, e
		}
		old := s.files[p]
		if (f == nil) != (old == nil) || (f != nil && f.hash != old.hash) {
			return Report{}, fmt.Errorf("capture changed during evaluation: %s", p)
		}
	}
	report := Report{Duplicates: map[string][]string{}, Stats: stats, Complete: false}
	for _, key := range keys {
		report.Decisions = append(report.Decisions, s.decisions[key])
	}
	for id, members := range s.buckets {
		if len(members) > 1 {
			for key := range members {
				report.Duplicates[id] = append(report.Duplicates[id], key)
			}
			sort.Strings(report.Duplicates[id])
		}
	}
	return report, nil
}
func (s *Session) remove(d Decision, stats *Stats) {
	for p := range d.Reads {
		delete(s.reverse[p], d.Subject)
	}
	if d.Result.Reason == "" {
		delete(s.buckets[d.Result.ID], d.Subject)
		if len(s.buckets[d.Result.ID]) == 0 {
			delete(s.buckets, d.Result.ID)
		}
		stats.BucketDeltas++
	}
}
func (s *Session) read(p string, d *Decision) *file {
	f := s.files[p]
	if f == nil {
		d.Reads[p] = [32]byte{}
	} else {
		d.Reads[p] = f.hash
	}
	return f
}
func unknown(reason string) Result { return Result{Reason: reason} }
func (s *Session) evaluateSubject(sub subject, d *Decision, budget *int) Result {
	f := s.read(sub.path, d)
	if f == nil || !s.safeModule(sub.path, d, map[string]bool{}) {
		return unknown("unsupported module effects")
	}
	c := sub.call.AsCallExpression()
	if c.Expression.Kind != ast.KindIdentifier {
		return unknown("receiver or indirect factory")
	}
	b, ok := f.bindings[c.Expression.Text()]
	if !ok || b.target != s.IntrinsicModule || b.imported != "Query" {
		return unknown("constructor ownership not established")
	}
	if len(c.Arguments.Nodes) != 1 || c.Arguments.Nodes[0].Kind != ast.KindObjectLiteralExpression {
		return unknown("unsupported projector")
	}
	var id *ast.Node
	for _, p := range c.Arguments.Nodes[0].AsObjectLiteralExpression().Properties.Nodes {
		if p.Kind != ast.KindPropertyAssignment {
			return unknown("spread or computed projector")
		}
		name := p.Name()
		if name == nil || (name.Kind != ast.KindIdentifier && name.Kind != ast.KindStringLiteral) {
			return unknown("computed property")
		}
		if name.Text() == "id" {
			id = p.AsPropertyAssignment().Initializer
		}
	}
	if id == nil {
		return unknown("missing id")
	}
	return s.eval(sub.path, id, map[string]string{}, d, budget)
}
func (s *Session) eval(path string, n *ast.Node, env map[string]string, d *Decision, budget *int) Result {
	*budget--
	if *budget < 0 {
		return unknown("step limit")
	}
	if n == nil {
		return unknown("missing expression")
	}
	switch n.Kind {
	case ast.KindStringLiteral:
		return Result{ID: n.Text()}
	case ast.KindIdentifier:
		if v, ok := env[n.Text()]; ok {
			return Result{ID: v}
		}
		f := s.read(path, d)
		if f == nil || !f.safe {
			return unknown("missing or effectful module")
		}
		b, ok := f.bindings[n.Text()]
		if !ok {
			return unknown("missing binding")
		}
		if b.expr != nil {
			if b.expr.Pos() >= n.Pos() {
				return unknown("initialization order")
			}
			return s.eval(path, b.expr, env, d, budget)
		}
		return unknown("unsupported value binding")
	case ast.KindBinaryExpression:
		b := n.AsBinaryExpression()
		if b.OperatorToken.Kind != ast.KindPlusToken {
			return unknown("unsupported operator")
		}
		l := s.eval(path, b.Left, env, d, budget)
		if l.Reason != "" {
			return l
		}
		r := s.eval(path, b.Right, env, d, budget)
		if r.Reason != "" {
			return r
		}
		return Result{ID: l.ID + r.ID}
	case ast.KindCallExpression:
		c := n.AsCallExpression()
		if c.Expression.Kind != ast.KindIdentifier {
			return unknown("receiver or indirect helper")
		}
		f := s.read(path, d)
		if f == nil || !f.safe {
			return unknown("missing or effectful module")
		}
		b, ok := f.bindings[c.Expression.Text()]
		if !ok {
			return unknown("missing helper")
		}
		functionPath := path
		if b.target != "" {
			if !strings.HasPrefix(b.target, ".") {
				return unknown("unmodeled package")
			}
			base := filepath.Clean(filepath.Join(filepath.Dir(path), b.target))
			candidates := []string{base + ".ts", filepath.Join(base, "index.ts")}
			found := false
			for _, candidate := range candidates {
				target, admitted := s.files[candidate]
				if !admitted {
					return unknown("resolution probe outside admission")
				}
				s.read(candidate, d)
				if target != nil {
					if !target.safe {
						return unknown("effectful imported module")
					}
					b, ok = target.bindings[b.imported]
					if !b.exported {
						ok = false
					}
					functionPath = candidate
					found = true
					break
				}
			}
			if !found || !ok {
				return unknown("missing imported helper")
			}
		}
		if b.function == nil || !pureFunction(b.function) {
			return unknown("unsupported helper")
		}
		parameters := b.function.Parameters()
		if len(parameters) != len(c.Arguments.Nodes) {
			return unknown("arity")
		}
		callEnv := map[string]string{}
		for i, a := range c.Arguments.Nodes {
			v := s.eval(path, a, env, d, budget)
			if v.Reason != "" {
				return v
			}
			name := parameters[i].Name()
			if name.Kind != ast.KindIdentifier {
				return unknown("destructured parameter")
			}
			callEnv[name.Text()] = v.ID
		}
		return s.eval(functionPath, b.function.Body().AsBlock().Statements.Nodes[0].AsReturnStatement().Expression, callEnv, d, budget)
	}
	return unknown("unsupported expression")
}

// Equivalent compares public decisions and duplicate aggregation, deliberately
// ignoring operational counters and traces (which remain inspectable).
func Equivalent(a, b Report) bool {
	if !reflect.DeepEqual(a.Duplicates, b.Duplicates) || len(a.Decisions) != len(b.Decisions) {
		return false
	}
	for i := range a.Decisions {
		if a.Decisions[i].Subject != b.Decisions[i].Subject || a.Decisions[i].Result != b.Decisions[i].Result {
			return false
		}
	}
	return true
}
