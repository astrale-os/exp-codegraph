package observabledecision

// This observer accepts native-owned immutable captures. It performs no IO and
// creates neither a compiler Program nor generic BodyIR. Its narrow semantics
// are an exploratory product, never permission to publish complete coverage.
import (
	js "astrale-typespec-v2-native-analysis/jsstring"
	coordinates "astrale-typespec-v2-native-analysis/sourcecoordinates"
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"strings"

	ast "github.com/microsoft/typescript-go/shim/ast"
	core "github.com/microsoft/typescript-go/shim/core"
	parser "github.com/microsoft/typescript-go/shim/parser"
	scanner "github.com/microsoft/typescript-go/shim/scanner"
)

type CapturedFile struct {
	Path, AbsolutePath, Role, Layer, Submodule, Text string
	Source                                           *ast.SourceFile
}
type Origin struct {
	Package, File string
	Path          []string
}
type SemanticRead struct{ Kind, Path, Name, Fingerprint string }
type GlobalValueObservation struct {
	Target     *ast.Node
	TargetPath string
	Known      bool
	Origin     *Origin
	Reads      []SemanticRead
}
type Resolution struct {
	Unavailable bool
	Path        string
	Origin      *Origin
	Reads       []SemanticRead
	Reason      string
}
type EffectRequest struct {
	Path, Operation string
	Node            *ast.Node
	LocalAssignment bool
}
type EffectSummary struct {
	Unavailable  bool
	VirtualSteps int
	ChargeKey    string
	Pure         bool
	Reason       string
	Reads        []SemanticRead
	EffectKind   string
}
type Limits struct{ MaximumDepth, MaximumSteps, MaximumAlternatives int }
type DemandContext struct {
	CallTarget                    func(path string, node *ast.Node) NativeEffectCall
	ReferenceAvailable            func(path string, node *ast.Node) (available, known bool)
	GlobalValue                   func(path string, node *ast.Node) GlobalValueObservation
	ExpressionAdmitted            func(path string, node *ast.Node) (admitted, known bool)
	DefinitionSubjects            func(paths []string) NativeDefinitionSubjects
	CompilerLibraryReceiver       func(path string, call *ast.Node) LibraryReceiverObservation
	Calls                         func(paths []string) NativeCallInventory
	Model                         string
	ExperimentalPrimitiveAddition bool
	Files                         []CapturedFile
	// Resolution must follow captured compiler/runtime package/export conditions
	// and return canonical declaration provenance, including negative probes.
	Resolve func(owner, specifier, export string) Resolution
	// Effects are explicit semantic inputs from the same immutable capture. No
	// arbitrary whole-program purity premise is silently manufactured here.
	Effect func(EffectRequest) EffectSummary
	Limits Limits
}
type DemandOutcome struct {
	MigrationIncomplete  bool   `json:",omitempty"`
	Construct            string `json:",omitempty"`
	Kind, String, Reason string
	Message              string
	Count                int
	StringPresent        bool
	Reads                []SemanticRead
	Steps                int
	Values, Candidates   []NativeValueSummary `json:",omitempty"`
	Reasons              []DemandReason       `json:",omitempty"`
}
type DemandReason struct{ Code, Message string }
type DemandShape struct {
	Curried, Callable, Async, Generator bool
	ParameterCount                      int
}
type QueryObservation struct {
	Ownership                                                                           DemandOutcome
	SubjectID, Path                                                                     string
	Start, End                                                                          int
	ConstructorIdentity                                                                 string
	ID, BuildCallbackCount, ProjectCallbackCount, CanonicalRequestCount, ProjectorProof DemandOutcome
	ProjectorShape                                                                      DemandShape
}
type QueryProduct struct {
	InventoryKnown    bool
	DiscoveryFailures []DemandDiscoveryFailure
	InventoryReasons  []string
	Observations      []QueryObservation
	Residual          []DemandOutcome
	Complete          bool
}
type demandBinding struct {
	node                *ast.Node
	specifier, export   string
	exported, namespace bool
	mutable             bool
}
type demandModule struct {
	coordinates *coordinates.Index
	digest      string
	file        CapturedFile
	bindings    map[string]demandBinding
	candidates  []*ast.Node
	reason      string
}
type demandValue struct {
	kind, text, reason string
	curried            bool
	node               *ast.Node
	module             string
	env                map[string]demandValue
	object             map[string]*ast.Node
	properties         map[string]demandValue
	origin             *Origin
	receiver           *demandValue
	values, candidates []demandValue
	incomplete         bool
}
type demandObserver struct {
	context DemandContext
	modules map[string]*demandModule
}
type demandRun struct {
	migrationIncomplete bool
	observer            *demandObserver
	reads               []SemanticRead
	steps, depth        int
	exhausted           string
	effectSeen          map[string]bool
	limits              Limits
	active              map[*ast.Node]map[string]bool
}

func demandUnknown(reason string) demandValue   { return demandValue{kind: "unknown", reason: reason} }
func demandKnown(kind, text string) demandValue { return demandValue{kind: kind, text: text} }
func normalizedLimits(l Limits) Limits {
	if l.MaximumDepth == 0 {
		l.MaximumDepth = 64
	}
	if l.MaximumSteps == 0 {
		l.MaximumSteps = 4096
	}
	if l.MaximumAlternatives == 0 {
		l.MaximumAlternatives = 32
	}
	return l
}
func newDemandObserver(context DemandContext) *demandObserver {
	o := &demandObserver{context: context, modules: map[string]*demandModule{}}
	for _, f := range context.Files {
		if previous, duplicate := o.modules[f.Path]; duplicate {
			previous.reason = "duplicate captured path"
			continue
		}
		if f.Source == nil {
			if !filepath.IsAbs(f.AbsolutePath) {
				o.modules[f.Path] = &demandModule{file: f, reason: "captured absolute path unavailable"}
				continue
			}
			scriptKind := core.ScriptKindTS
			switch strings.ToLower(filepath.Ext(f.AbsolutePath)) {
			case ".tsx":
				scriptKind = core.ScriptKindTSX
			case ".jsx":
				scriptKind = core.ScriptKindJSX
			case ".js", ".mjs", ".cjs":
				scriptKind = core.ScriptKindJS
			}
			f.Source = parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: filepath.ToSlash(filepath.Clean(f.AbsolutePath))}, f.Text, scriptKind)
		}
		h := sha256.Sum256([]byte(f.Text))
		m := &demandModule{file: f, digest: fmt.Sprintf("%x", h), bindings: map[string]demandBinding{}}
		o.modules[f.Path] = m
		if f.Source.Text() != f.Text {
			m.reason = "captured AST/text mismatch"
		}
		if len(f.Source.Diagnostics()) != 0 {
			m.reason = "source syntax diagnostics"
		}
		put := func(name string, b demandBinding) {
			if _, ok := m.bindings[name]; ok {
				m.reason = "duplicate module binding"
			}
			m.bindings[name] = b
		}
		for _, n := range f.Source.Statements.Nodes {
			switch n.Kind {
			case ast.KindImportDeclaration:
				d := n.AsImportDeclaration()
				if d.ImportClause == nil {
					continue
				}
				c := d.ImportClause.AsImportClause()
				if c.PhaseModifier == ast.KindTypeKeyword {
					continue
				}
				if c.Name() != nil {
					put(c.Name().Text(), demandBinding{specifier: d.ModuleSpecifier.Text(), export: "default"})
				}
				if c.NamedBindings != nil {
					switch c.NamedBindings.Kind {
					case ast.KindNamespaceImport:
						put(c.NamedBindings.Name().Text(), demandBinding{specifier: d.ModuleSpecifier.Text(), export: "*", namespace: true})
					case ast.KindNamedImports:
						for _, el := range c.NamedBindings.AsNamedImports().Elements.Nodes {
							v := el.AsImportSpecifier()
							if v.IsTypeOnly {
								continue
							}
							name := el.Name().Text()
							export := name
							if v.PropertyName != nil {
								export = v.PropertyName.Text()
							}
							put(name, demandBinding{specifier: d.ModuleSpecifier.Text(), export: export})
						}
					}
				}
			case ast.KindVariableStatement:
				d := n.AsVariableStatement().DeclarationList.AsVariableDeclarationList()
				for _, v := range d.Declarations.Nodes {
					if v.Name().Kind != ast.KindIdentifier {
						continue
					}
					put(v.Name().Text(), demandBinding{node: v.AsVariableDeclaration().Initializer, exported: n.ModifierFlags()&ast.ModifierFlagsExport != 0, mutable: d.Flags&ast.NodeFlagsConst == 0})
					if v.AsVariableDeclaration().Initializer != nil {
						m.candidates = append(m.candidates, v.AsVariableDeclaration().Initializer)
					}
				}
			case ast.KindFunctionDeclaration:
				if n.Name() != nil {
					put(n.Name().Text(), demandBinding{node: n, exported: n.ModifierFlags()&ast.ModifierFlagsExport != 0})
				}
			}
		}
	}
	return o
}
func (o *demandObserver) run() *demandRun {
	return &demandRun{observer: o, limits: normalizedLimits(o.context.Limits), depth: -1, effectSeen: map[string]bool{}, active: map[*ast.Node]map[string]bool{}}
}
func (r *demandRun) enter() bool {
	if r.exhausted != "" {
		return false
	}
	r.steps++
	r.depth++
	if r.steps > r.limits.MaximumSteps {
		r.exhausted = "VALUE_STEP_LIMIT"
		return false
	}
	return r.checkDepth(r.depth)
}
func (r *demandRun) checkDepth(depth int) bool {
	if r.exhausted != "" {
		return false
	}
	if depth > r.limits.MaximumDepth {
		r.exhausted = "VALUE_DEPTH_LIMIT"
		return false
	}
	return true
}
func (r *demandRun) evalAt(path string, node *ast.Node, env map[string]demandValue, depth int) demandValue {
	saved := r.depth
	r.depth = depth - 1
	value := r.eval(path, node, env)
	r.depth = saved
	return value
}
func (r *demandRun) propertyAt(value demandValue, name string, depth int) demandValue {
	saved := r.depth
	r.depth = depth
	result := r.property(value, name)
	r.depth = saved
	return result
}
func (r *demandRun) invokeAt(value demandValue, args []demandValue, depth int) demandValue {
	// Mapping a proof preserves non-callable alternatives even after a sibling
	// exhausts its budget; only inspectable function evaluation consumes depth.
	if value.kind != "function" {
		saved := r.depth
		r.depth = depth
		result := r.invoke(value, args)
		r.depth = saved
		return result
	}
	if !r.checkDepth(depth) {
		return demandUnknown(r.exhausted)
	}
	saved := r.depth
	r.depth = depth
	result := r.invoke(value, args)
	r.depth = saved
	return result
}
func (r *demandRun) propertyNameCharge(depth int) bool {
	if r.exhausted != "" {
		return false
	}
	r.steps++
	if r.steps > r.limits.MaximumSteps {
		r.exhausted = "VALUE_STEP_LIMIT"
		return false
	}
	return r.checkDepth(depth)
}
func (r *demandRun) file(path string) *demandModule {
	m := r.observer.modules[path]
	if m != nil {
		r.reads = append(r.reads, SemanticRead{Kind: "source-bytes", Path: path, Fingerprint: m.digest})
	}
	return m
}
func (r *demandRun) guard(path, operation string, node *ast.Node) demandValue {
	return r.guardRequest(EffectRequest{Path: path, Operation: operation, Node: node})
}
func (r *demandRun) guardRequest(request EffectRequest) demandValue {
	if r.observer.context.Effect == nil {
		r.migrationIncomplete = true
		return demandUnknown("effect summary unavailable")
	}
	summary := r.observer.context.Effect(request)
	if summary.Unavailable {
		r.migrationIncomplete = true
	}
	r.reads = append(r.reads, summary.Reads...)
	if summary.VirtualSteps < 0 {
		return demandUnknown("invalid effect virtual charge")
	}
	chargeKey := summary.ChargeKey
	if chargeKey == "" {
		chargeKey = request.Path + "\x00" + request.Operation
	}
	if !r.effectSeen[chargeKey] {
		r.effectSeen[chargeKey] = true
		for step := 0; step < summary.VirtualSteps; step++ {
			r.steps++
			if r.steps > r.limits.MaximumSteps {
				r.exhausted = "VALUE_STEP_LIMIT"
				if strings.HasPrefix(request.Operation, "binding-mutation:") {
					return demandUnknown("VALUE_MUTATION_UNSUPPORTED")
				}
				return demandUnknown(r.exhausted)
			}
		}
	}
	if !summary.Pure && !(request.LocalAssignment && summary.EffectKind == "local") {
		reason := summary.Reason
		if reason == "" {
			reason = "effects not established"
		}
		return demandUnknown(reason)
	}
	return demandKnown("guard", summary.EffectKind)
}
func canonical(origin *Origin) demandValue {
	if origin == nil {
		return demandUnknown("canonical declaration unavailable")
	}
	if origin.Package == "@astrale-os/sdk" && len(origin.Path) == 1 && sdkDefinitionFile(origin.File, "query") && (origin.Path[0] == "defineQuery" || origin.Path[0] == "defineCollectionQuery" || origin.Path[0] == "defineCompositeQuery") {
		return demandValue{kind: "constructor", text: origin.Path[0], origin: origin}
	}
	if origin.Package == "@astrale-os/sdk" && len(origin.Path) == 1 && origin.Path[0] == "defineMutation" && sdkDefinitionFile(origin.File, "mutation") {
		return demandValue{kind: "constructor", text: origin.Path[0], origin: origin}
	}
	if origin.Package == "@astrale-os/kernel-core" && strings.Contains(origin.File, "graph/query/") && len(origin.Path) > 0 && origin.Path[len(origin.Path)-1] == "Query" {
		return demandValue{kind: "query-namespace", origin: origin}
	}
	return demandValue{kind: "external", origin: origin, reason: "unmodeled canonical export"}
}
func (r *demandRun) imported(owner, specifier, export string) demandValue {
	if r.observer.context.Resolve == nil {
		r.migrationIncomplete = true
		return demandUnknown("captured resolver unavailable")
	}
	resolution := r.observer.context.Resolve(owner, specifier, export)
	if resolution.Unavailable {
		r.migrationIncomplete = true
	}
	r.reads = append(r.reads, resolution.Reads...)
	if resolution.Reason != "" {
		return demandUnknown(resolution.Reason)
	}
	if resolution.Origin != nil {
		return canonical(resolution.Origin)
	}
	target := r.file(resolution.Path)
	if target == nil {
		return demandUnknown("captured resolved module unavailable")
	}
	b, ok := target.bindings[export]
	if !ok || !b.exported {
		return demandUnknown("missing exported binding")
	}
	if b.mutable {
		return demandUnknown("mutable export requires effect refinement")
	}
	if b.node != nil && b.node.Kind == ast.KindFunctionDeclaration {
		return demandValue{kind: "function", node: b.node, module: resolution.Path}
	}
	return r.eval(resolution.Path, b.node, nil)
}
func (r *demandRun) eval(path string, n *ast.Node, env map[string]demandValue) demandValue {
	if n != nil {
		if r.observer.context.ExpressionAdmitted != nil {
			admitted, known := r.observer.context.ExpressionAdmitted(path, n)
			if !known {
				r.migrationIncomplete = true
				return demandUnknown("Captured bounded expression admission authority is unavailable.")
			}
			if !admitted {
				return demandUnknown("VALUE_RELATION_MISSING")
			}
		} else if n.Kind == ast.KindNullKeyword && !legacyNullRootAdmitted(n) {
			return demandUnknown("VALUE_RELATION_MISSING")
		}
	}
	if n != nil && n.Kind == ast.KindIdentifier && r.observer.context.ReferenceAvailable != nil {
		available, known := r.observer.context.ReferenceAvailable(path, n)
		if !known {
			r.migrationIncomplete = true
			return demandUnknown("Captured value reference authority is unavailable.")
		}
		if !available {
			return demandUnknown("VALUE_RELATION_MISSING")
		}
	}
	if !r.enter() {
		r.depth--
		if r.steps > r.limits.MaximumSteps {
			return demandUnknown("VALUE_STEP_LIMIT")
		}
		return demandUnknown("VALUE_DEPTH_LIMIT")
	}
	defer func() { r.depth-- }()
	if n == nil {
		return demandKnown("undefined", "")
	}
	m := r.file(path)
	if m == nil {
		return demandUnknown("capture unavailable")
	}
	if m.reason != "" {
		return demandUnknown(m.reason)
	}
	frame := fmt.Sprintf("%p", env)
	frames := r.active[n]
	if frames == nil {
		frames = map[string]bool{}
		r.active[n] = frames
	}
	if frames[frame] {
		return demandValue{kind: "unknown", reason: "VALUE_RECURSION", text: "Value propagation encountered a recursive occurrence."}
	}
	frames[frame] = true
	defer delete(frames, frame)
	switch n.Kind {
	case ast.KindParameter:
		return demandValue{kind: "unknown", reason: "VALUE_NO_SEMANTIC_PATH", text: "No bounded value path is available for Parameter."}
	case ast.KindStringLiteral, ast.KindNoSubstitutionTemplateLiteral:
		literal, err := js.FromLiteral(m.file.Source, n)
		if err != nil {
			return demandUnknown("captured string literal cannot be established")
		}
		return demandKnown("string", literal.WTF8())
	case ast.KindNumericLiteral:
		return demandKnown("number", n.Text())
	case ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword:
		return demandKnown("literal", n.KindString())
	case ast.KindIdentifier:
		if value, found := r.localIdentifier(path, n, env); found {
			if guard := r.guard(path, "binding-escape:"+n.Text(), n); guard.kind == "unknown" {
				if guard.reason == "VALUE_ESCAPE_UNSUPPORTED" {
					return r.escaped(value)
				}
				return guard
			}
			return value
		}
		if guard := r.guard(path, "binding-mutation:"+n.Text(), n); guard.kind == "unknown" {
			if guard.reason == "VALUE_MUTATION_UNSUPPORTED" {
				if binding, found := m.bindings[n.Text()]; found && binding.node != nil && binding.specifier == "" {
					guard.candidates = append(guard.candidates, r.eval(path, binding.node, nil))
				}
				if bound, found := env[n.Text()]; found {
					if bound.kind == "reference" {
						bound = r.evalAt(bound.module, bound.node, bound.env, r.depth+1)
					}
					guard.candidates = append(guard.candidates, bound)
				}
			}
			return guard
		}
		// Escape affects mutable values after resolution. Passing an immutable
		// string or an inspectable function to an opaque call cannot mutate it.
		var value demandValue
		value = func() demandValue {
			if v, ok := env[n.Text()]; ok {
				if v.kind == "reference" {
					return r.evalAt(v.module, v.node, v.env, r.depth+1)
				}
				return v
			}
			b, ok := m.bindings[n.Text()]
			r.reads = append(r.reads, SemanticRead{Kind: "binding", Path: path, Name: n.Text(), Fingerprint: fmt.Sprint(ok)})
			if !ok {
				if lookup := r.observer.context.GlobalValue; lookup != nil {
					global := lookup(path, n)
					r.reads = append(r.reads, global.Reads...)
					if !global.Known {
						r.migrationIncomplete = true
						return demandUnknown("Captured global value authority is unavailable.")
					}
					if global.Target != nil {
						owner := r.file(global.TargetPath)
						if owner == nil || ast.GetSourceFileOfNode(global.Target) != owner.file.Source {
							r.migrationIncomplete = true
							return demandUnknown("Captured global initializer AST ownership is unavailable.")
						}
						if global.Target.Kind == ast.KindFunctionDeclaration {
							return demandValue{kind: "function", node: global.Target, module: global.TargetPath, env: captureDemandEnvironment(global.TargetPath, global.Target, env)}
						}
						return r.evalAt(global.TargetPath, global.Target, env, r.depth+1)
					}
					if global.Origin != nil {
						return canonical(global.Origin)
					}
					return demandValue{kind: "unknown", reason: "VALUE_NO_SEMANTIC_PATH", text: "No bounded value path is available for Identifier."}
				}
				return demandUnknown("VALUE_RELATION_MISSING")
			}
			if b.namespace {
				return demandValue{kind: "namespace", text: b.specifier, module: path}
			}
			if b.specifier != "" {
				return r.imported(path, b.specifier, b.export)
			}
			if b.node == nil {
				return demandValue{kind: "unknown", reason: "VALUE_NO_SEMANTIC_PATH", text: "No bounded value path is available for Identifier."}
			}
			if b.node.Kind == ast.KindFunctionDeclaration {
				return demandValue{kind: "function", node: b.node, module: path}
			}
			return r.eval(path, b.node, nil)
		}()
		if guard := r.guard(path, "binding-escape:"+n.Text(), n); guard.kind == "unknown" {
			if guard.reason == "VALUE_ESCAPE_UNSUPPORTED" {
				return r.escaped(value)
			}
			return guard
		}
		return value
	case ast.KindParenthesizedExpression:
		return r.eval(path, n.AsParenthesizedExpression().Expression, env)
	case ast.KindAsExpression:
		return r.eval(path, n.AsAsExpression().Expression, env)
	case ast.KindSatisfiesExpression:
		return r.eval(path, n.AsSatisfiesExpression().Expression, env)
	case ast.KindNonNullExpression:
		return r.eval(path, n.AsNonNullExpression().Expression, env)
	case ast.KindTypeAssertionExpression:
		return r.eval(path, n.AsTypeAssertion().Expression, env)
	case ast.KindBinaryExpression:
		if !r.observer.context.ExperimentalPrimitiveAddition {
			return demandValue{kind: "unknown", reason: "VALUE_NO_SEMANTIC_PATH", text: "No bounded value path is available for BinaryExpression."}
		}
		b := n.AsBinaryExpression()
		if b.OperatorToken.Kind != ast.KindPlusToken {
			return demandUnknown("unsupported binary transfer")
		}
		l := r.eval(path, b.Left, env)
		v := r.eval(path, b.Right, env)
		if l.kind == "string" && v.kind == "string" {
			left, lerr := js.FromCompilerText(l.text)
			right, rerr := js.FromCompilerText(v.text)
			if lerr != nil || rerr != nil {
				return demandUnknown("unowned JavaScript string addition")
			}
			return demandKnown("string", left.Concat(right).WTF8())
		}
		return demandUnknown("nonprimitive string addition")
	case ast.KindConditionalExpression:
		conditional := n.AsConditionalExpression()
		// Legacy reads direct constant authority for the condition, without
		// visiting it or propagating a condition through arbitrary aliases.
		condition := conditional.Condition
		for condition != nil && condition.Kind == ast.KindParenthesizedExpression {
			condition = condition.AsParenthesizedExpression().Expression
		}
		if condition != nil && (condition.Kind == ast.KindTrueKeyword || condition.Kind == ast.KindFalseKeyword) {
			if condition.Kind == ast.KindTrueKeyword {
				return r.eval(path, conditional.WhenTrue, env)
			}
			return r.eval(path, conditional.WhenFalse, env)
		}
		return r.alternatives([]demandValue{r.eval(path, conditional.WhenTrue, env), r.eval(path, conditional.WhenFalse, env)})
	case ast.KindArrowFunction, ast.KindFunctionExpression, ast.KindFunctionDeclaration, ast.KindMethodDeclaration:
		return demandValue{kind: "function", node: n, module: path, env: captureDemandEnvironment(path, n, env)}
	case ast.KindArrayLiteralExpression:
		return demandValue{kind: "object", object: map[string]*ast.Node{}, properties: map[string]demandValue{}, module: path, node: n, env: env, incomplete: true}
	case ast.KindObjectLiteralExpression:
		if guard := r.guard(path, "object-initializer-effects", n); guard.kind == "unknown" {
			return guard
		}
		return r.objectLiteral(path, n, env)
	case ast.KindPropertyAccessExpression:
		p := n.AsPropertyAccessExpression()
		receiver := r.eval(path, p.Expression, env)
		return r.propertyAt(receiver, p.Name().Text(), r.depth+1)
	case ast.KindVariableDeclaration:
		return r.eval(path, n.AsVariableDeclaration().Initializer, env)
	case ast.KindReturnStatement:
		expression := n.AsReturnStatement().Expression
		if expression == nil {
			return demandKnown("undefined", "")
		}
		admitted, known := r.expressionAdmission(path, expression)
		if !known {
			return demandUnknown("Captured bounded expression admission authority is unavailable.")
		}
		if !admitted {
			return demandKnown("undefined", "")
		}
		return r.eval(path, expression, env)
	case ast.KindCallExpression:
		c := n.AsCallExpression()
		if c.Expression.Kind == ast.KindPropertyAccessExpression {
			property := c.Expression.AsPropertyAccessExpression()
			name := property.Name().Text()
			if r.observer.context.Model != "none" && !r.propertyNameCharge(r.depth+1) {
				return demandUnknown(r.exhausted)
			}
			if name == "from" || name == "select" || name == "filter" || name == "expand" {
				receiver := r.evalAt(path, property.Expression, env, r.depth+1)
				if r.exhausted != "" {
					return demandUnknown(r.exhausted)
				}
				if receiver.kind == "query-namespace" && name == "from" {
					return demandKnown("builder", "")
				}
				if receiver.kind == "builder" {
					if name == "select" {
						return demandKnown("request", "")
					}
					if name == "filter" || name == "expand" {
						return demandKnown("builder", "")
					}
				}
				if modeled, ok := r.modelQueryReceiver(receiver, name); ok {
					return modeled
				}
				// Ordinary local lookalikes retain their inspectable function
				// behavior. A compatible declared signature is no intrinsic.

			}
		}
		var callTarget NativeEffectCall
		if r.observer.context.CallTarget != nil {
			callTarget = r.observer.context.CallTarget(path, n)
			if !callTarget.Known {
				r.migrationIncomplete = true
				return demandUnknown("Captured call target authority is unavailable.")
			}
			for _, binding := range callTarget.Bindings {
				if binding.Rest {
					return demandValue{kind: "unknown", reason: "VALUE_ARGUMENT_BINDING_UNSUPPORTED", text: "Spread and rest arguments require an aggregate argument binding."}
				}
			}
		}
		for _, argument := range c.Arguments.Nodes {
			if argument.Kind == ast.KindSpreadElement {
				return demandValue{kind: "unknown", reason: "VALUE_ARGUMENT_BINDING_UNSUPPORTED", text: "Spread and rest arguments require an aggregate argument binding."}
			}
		}
		callee := r.eval(path, c.Expression, env)
		if c.Expression.Kind == ast.KindIdentifier {
			if binding, found := m.bindings[c.Expression.Text()]; found && binding.node != nil && binding.node.Kind == ast.KindFunctionDeclaration && binding.node.Body() == nil {
				if r.depth+1 > r.limits.MaximumDepth {
					r.exhausted = "VALUE_DEPTH_LIMIT"
					return demandUnknown(r.exhausted)
				}
				return demandValue{kind: "unsupported", text: "external-or-bodyless-call"}
			}
		}
		if callee.kind == "constructor" {
			if len(c.Arguments.Nodes) == 0 {
				return demandKnown("factory", callee.text)
			}
			return demandValue{kind: "definition", text: callee.text, module: path, node: n, env: env, curried: false}
		}
		if callee.kind == "factory" {
			return demandValue{kind: "definition", text: callee.text, module: path, node: n, env: env, curried: true}
		}
		if callee.kind == "intrinsic-member" {
			return demandUnknown("intrinsic member called without its runtime receiver")
		}
		if callee.kind != "function" && callee.kind != "alternatives" && callTarget.Known && !callTarget.Dynamic {
			if callTarget.Target != nil && callTarget.BodyPresent {
				callee = demandValue{kind: "function", node: callTarget.Target, module: callTarget.TargetPath, env: captureDemandEnvironment(callTarget.TargetPath, callTarget.Target, env)}
			} else if callTarget.CallableOwner {
				callee = demandValue{kind: "unknown", reason: "VALUE_BODY_NOT_SELECTED", text: "The local callable body is outside the materialized selection."}
			} else {
				callee = demandValue{kind: "unsupported", text: "external-or-bodyless-call"}
			}
		}
		if callee.kind == "function" || callee.kind == "alternatives" || callee.kind == "unsupported" {
			args := make([]demandValue, 0, len(c.Arguments.Nodes))
			for _, argument := range c.Arguments.Nodes {
				args = append(args, demandValue{kind: "reference", node: argument, module: path, env: env})
			}
			return r.invokeAt(callee, args, r.depth+1)
		}
		if callee.kind == "unknown" {
			return callee
		}
		return demandValue{kind: "unknown", reason: "VALUE_DYNAMIC_CALL", text: "The call target is unresolved or dynamic."}
	}
	return demandValue{kind: "unknown", reason: "VALUE_NO_SEMANTIC_PATH", text: "No bounded value path is available for " + strings.TrimPrefix(n.KindString(), "Kind") + "."}
}
func (r *demandRun) property(v demandValue, name string) demandValue {
	if v.kind == "alternatives" {
		values := []demandValue{}
		for _, value := range v.values {
			values = append(values, r.propertyAt(value, name, r.depth+1))
		}
		return r.alternatives(values)
	}
	if v.kind == "unknown" || v.kind == "unsupported" {
		return v
	}
	if v.kind == "namespace" {
		return r.imported(v.module, v.text, name)
	}
	if v.kind == "query-namespace" && name == "from" {
		return demandValue{kind: "intrinsic-member", text: name, receiver: &v}
	}
	if v.kind == "builder" && (name == "filter" || name == "expand" || name == "select") {
		return demandValue{kind: "intrinsic-member", text: name, receiver: &v}
	}
	if v.kind == "object" {
		reference, present := v.properties[name]
		if v.properties == nil {
			node, legacyPresent := v.object[name]
			present = legacyPresent
			reference = demandValue{kind: "reference", node: node, module: v.module, env: v.env}
		}
		r.reads = append(r.reads, SemanticRead{Kind: "own-property", Path: v.module, Name: name, Fingerprint: fmt.Sprint(present)})
		if !present {
			if v.incomplete {
				return demandValue{kind: "unknown", reason: "VALUE_PROPERTY_INCOMPLETE", text: "The effective " + name + " property is unknown."}
			}
			return demandKnown("undefined", "")
		}
		return r.evalAt(reference.module, reference.node, reference.env, r.depth+1)
	}
	return demandUnknown("property receiver unavailable")
}
func (r *demandRun) invoke(v demandValue, args []demandValue) demandValue {
	if v.kind == "alternatives" {
		values := []demandValue{}
		for _, value := range v.values {
			values = append(values, r.invokeAt(value, args, r.depth+1))
		}
		return r.alternatives(values)
	}
	if v.kind == "unknown" || v.kind == "unsupported" {
		return v
	}
	if v.kind != "function" {
		return demandUnknown("noncallable value")
	}
	if guard := r.guard(v.module, "invoke-function", v.node); guard.kind == "unknown" {
		return guard
	}
	if ast.GetCombinedModifierFlags(v.node)&ast.ModifierFlagsAsync != 0 {
		return demandUnknown("async function invocation")
	}
	if v.node.Kind == ast.KindFunctionDeclaration && v.node.AsFunctionDeclaration().AsteriskToken != nil {
		return demandUnknown("generator invocation")
	}
	if v.node.Kind == ast.KindFunctionExpression && v.node.AsFunctionExpression().AsteriskToken != nil {
		return demandUnknown("generator invocation")
	}
	env := map[string]demandValue{}
	for name, value := range v.env {
		env[name] = value
	}
	for i, p := range v.node.Parameters() {
		if p.Name().Kind != ast.KindIdentifier {
			// Unobserved destructured parameters do not block the body proof.
			// A demanded binding element remains an unavailable value path.
			continue
		}
		if p.AsParameterDeclaration().DotDotDotToken != nil && len(args) > 0 {
			return demandValue{kind: "unknown", reason: "VALUE_ARGUMENT_BINDING_UNSUPPORTED", text: "Spread and rest arguments require an aggregate argument binding."}
		}
		if i < len(args) {
			env[p.Name().Text()] = args[i]
		} else {
			delete(env, p.Name().Text())
		}
	}
	body := v.node.Body()
	if body == nil {
		return demandUnknown("function body unavailable")
	}
	if body.Kind != ast.KindBlock {
		return r.evalAt(v.module, body, env, r.depth+1)
	}
	flow := inspectDemandFlow(v.node)
	if !flow.complete {
		return demandUnknown("VALUE_CONTROL_FLOW_INCOMPLETE")
	}
	returned := []demandValue{}
	for _, node := range flow.returns {
		returned = append(returned, r.evalAt(v.module, node, env, r.depth+1))
	}
	if flow.fallsThrough {
		returned = append(returned, demandKnown("undefined", ""))
	}
	return r.alternatives(returned)
}
func (r *demandRun) definitionAt(v demandValue, depth int) demandValue {
	if v.kind != "definition" {
		return demandUnknown("not a canonical definition")
	}
	call := v.node.AsCallExpression()
	if len(call.Arguments.Nodes) != 1 {
		return demandUnknown("projector arity")
	}
	projector := r.evalAt(v.module, call.Arguments.Nodes[0], v.env, depth+1)
	return r.invokeAt(projector, nil, depth)
}
func (r *demandRun) finish(value demandValue, mode string) DemandOutcome {
	if mode == "string" {
		return r.finishDefinitionID(value)
	}
	out := DemandOutcome{Kind: "known", Reads: r.reads, Steps: r.steps, MigrationIncomplete: r.migrationIncomplete}
	if value.kind == "alternatives" || len(value.candidates) > 0 {
		kind, values, reasons := r.projected(value)
		out.Kind, out.Reasons = kind, distinctReasons(reasons)
		if kind == "unknown" {
			out.Candidates = values
		} else {
			out.Values = values
		}
		if len(reasons) > 0 {
			out.Reason, out.Message = reasons[0].Code, reasons[0].Message
		}
		if kind == "known" && len(values) == 1 {
			value = demandValue{kind: values[0].Kind, text: values[0].Literal}
		}
		if (mode == "callback" || mode == "request") && kind != "unknown" {
			counts := map[int]bool{}
			for _, v := range values {
				count := 0
				if (mode == "callback" && v.Kind == "function") || (mode == "request" && v.Kind == "request") {
					count = 1
				}
				counts[count] = true
			}
			if len(counts) == 1 {
				out.Kind = "known"
				out.Reason = ""
				out.Message = ""
				for count := range counts {
					out.Count = count
				}
				return out
			}
		}
		if out.Kind != "known" && r.exhausted == "" {
			return out
		}
	}
	if r.exhausted != "" {
		out.Kind = "unknown"
		out.Reason = r.exhausted
		out.Message = legacyValueMessage(out.Reason)
		if len(out.Reasons) == 0 && value.kind == "unknown" && strings.HasPrefix(value.reason, "VALUE_") {
			_, _, out.Reasons = r.projected(value)
		}
		out.Reasons = distinctReasons(append(out.Reasons, DemandReason{Code: out.Reason, Message: out.Message}))
		return out
	}
	if value.kind == "unsupported" {
		out.Kind = "unsupported"
		out.Construct = value.text
		out.Message = "unsupported value transfer: " + value.text
		return out
	}
	if value.kind == "unknown" || (value.kind == "external" && mode != "") {
		out.Kind = "unknown"
		out.Reason = value.reason
		out.Message = legacyValueMessage(out.Reason)
		if value.text != "" {
			out.Message = value.text
		}
		if value.kind == "external" {
			if mode == "string" {
				out.Reason = "DEFINITION_ID_EXTERNAL"
				out.Message = legacyValueMessage(out.Reason)
			}
			if mode == "callback" {
				out.Message = "external callback body is unavailable"
			}
			if mode == "request" {
				out.Message = "external request provenance is unavailable"
			}
		}
		return out
	}
	switch mode {
	case "string":
		if value.kind == "string" {
			out.String = value.text
			out.StringPresent = true
		} else if value.kind != "undefined" {
			out.Reason = "not a known string"
		}
	case "callback":
		if value.kind == "function" {
			out.Count = 1
		}
	case "request":
		if value.kind == "request" {
			out.Count = 1
		}
	}
	return out
}
func utf16At(text string, offset int) int { return coordinates.Count(text, offset) }
func (module *demandModule) utf16At(offset int) int {
	if module.coordinates == nil || module.coordinates.Text() != module.file.Text {
		module.coordinates = coordinates.New(module.file.Text)
	}
	return module.coordinates.Offset(offset)
}

func ObserveQueries(context DemandContext) QueryProduct {
	return observeQueries(context, newDemandObserver(context), false)
}

// ObserveQueriesAndIDs preserves the earlier exploratory combined observation.
// Production Query rules do not observe IDs; Definition IDs have their own product.
func ObserveQueriesAndIDs(context DemandContext) QueryProduct {
	return observeQueries(context, newDemandObserver(context), true)
}
func observeQueries(context DemandContext, observer *demandObserver, includeID bool) QueryProduct {
	product := QueryProduct{Complete: false}
	seen := map[string]bool{}
	inventory, supplied := observer.callInventory("queries")
	product.InventoryKnown = supplied && inventory.Known
	if supplied && !inventory.Known {
		product.Residual = append(product.Residual, DemandOutcome{Kind: "unknown", Reason: "Native runtime call inventory authority is unavailable."})
		return product
	}
	if supplied && !inventory.Complete {
		product.InventoryReasons = append(product.InventoryReasons, inventory.Reasons...)
	}
	for _, site := range inventory.Sites {
		path, candidate := site.Path, site.Node
		m := observer.modules[path]
		if m == nil || m.reason != "" {
			if !supplied {
				product.Residual = append(product.Residual, DemandOutcome{Kind: "unknown", Reason: "Captured query source unavailable."})
			}
			continue
		}
		if supplied && (candidate == nil || site.Callee == nil) {
			continue
		}
		discovery := observer.run()
		discovery.limits = normalizedLimits(Limits{})
		discovery.reads = append(discovery.reads, inventory.Reads...)
		ownership := DemandOutcome{Kind: "known"}
		value := demandValue{}
		if supplied {
			if candidate.Kind != ast.KindCallExpression || ast.GetSourceFileOfNode(candidate) != m.file.Source {
				product.Residual = append(product.Residual, DemandOutcome{Kind: "unknown", Reason: "Runtime call anchor is not the captured AST owner."})
				continue
			}
			callee := discovery.evalAt(path, site.Callee, nil, 0)
			if discovery.migrationIncomplete {
				product.Residual = append(product.Residual, discovery.finish(callee, ""))
				continue
			}
			name, definite, curried := constructorCandidates(callee, len(candidate.AsCallExpression().Arguments.Nodes) > 0)
			if name == "" {
				if discovery.exhausted != "" {
					product.DiscoveryFailures = append(product.DiscoveryFailures, DemandDiscoveryFailure{Path: path, Start: site.Start, End: site.End, Reason: PublicQueryReason(discovery.finish(callee, ""))})
				}
				continue
			}
			value = demandValue{kind: "definition", text: name, module: path, node: candidate, curried: curried}
			if !definite {
				ownership.Kind = "ambiguous"
				ownership.Message = "the called factory may be an SDK Query constructor or another value"
			}
		} else {
			value = discovery.eval(path, candidate, nil)
		}
		if value.kind != "definition" {
			if value.kind == "unknown" {
				product.Residual = append(product.Residual, discovery.finish(value, ""))
			}
			continue
		}
		if value.text != "defineQuery" && value.text != "defineCollectionQuery" {
			continue
		}
		if value.module != path {
			continue
		}
		start := m.utf16At(scanner.GetTokenPosOfNode(value.node, m.file.Source, false))
		end := m.utf16At(value.node.End())
		subjectID := fmt.Sprintf("%s:%d:%d", path, start, end)
		if seen[subjectID] {
			continue
		}
		seen[subjectID] = true
		observation := QueryObservation{SubjectID: fmt.Sprintf("%s:%d:%d", path, start, end), Path: path, Start: start, End: end, ConstructorIdentity: "astrale.sdk." + value.text}
		observation.Ownership = ownership
		observation.Ownership.Reads = discovery.reads
		observation.Ownership.Steps = discovery.steps
		if supplied && site.SubjectID != "" {
			observation.SubjectID = site.SubjectID
		}
		call := value.node.AsCallExpression()
		shapeRun := observer.run()
		shapeValue := demandKnown("undefined", "")
		if len(call.Arguments.Nodes) > 0 {
			shapeValue = shapeRun.eval(value.module, call.Arguments.Nodes[0], value.env)
		}
		observation.ProjectorProof = shapeRun.finish(shapeValue, "")
		observation.ProjectorShape = DemandShape{Curried: value.curried, Callable: shapeValue.kind == "function"}
		if shapeValue.kind == "function" {
			observation.ProjectorShape.Async = ast.GetCombinedModifierFlags(shapeValue.node)&ast.ModifierFlagsAsync != 0
			observation.ProjectorShape.ParameterCount = len(shapeValue.node.Parameters())
			if shapeValue.node.Kind == ast.KindFunctionDeclaration {
				observation.ProjectorShape.Generator = shapeValue.node.AsFunctionDeclaration().AsteriskToken != nil
			}
			if shapeValue.node.Kind == ast.KindFunctionExpression {
				observation.ProjectorShape.Generator = shapeValue.node.AsFunctionExpression().AsteriskToken != nil
			}
		}
		if includeID {
			idRun := observer.run()
			idDefinition := idRun.definitionAt(value, 1)
			observation.ID = idRun.finish(idRun.propertyAt(idDefinition, "id", 0), "string")
		}
		buildRun := observer.run()
		buildDefinition := buildRun.definitionAt(value, 1)
		buildValue := buildRun.propertyAt(buildDefinition, "build", 0)
		observation.BuildCallbackCount = buildRun.finish(buildValue, "callback")
		projectRun := observer.run()
		projectDefinition := projectRun.definitionAt(value, 1)
		observation.ProjectCallbackCount = projectRun.finish(projectRun.propertyAt(projectDefinition, "project", 0), "callback")
		requestRun := observer.run()
		requestDefinition := requestRun.definitionAt(value, 2)
		requestValue := requestRun.propertyAt(requestDefinition, "build", 1)
		observation.CanonicalRequestCount = requestRun.finish(requestRun.invokeAt(requestValue, nil, 0), "request")
		if observation.ProjectorProof.Kind == "known" && !observation.ProjectorShape.Callable {
			observation.BuildCallbackCount = DemandOutcome{Kind: "known", Count: 0, Reads: observation.ProjectorProof.Reads}
			observation.ProjectCallbackCount = DemandOutcome{Kind: "known", Count: 0, Reads: observation.ProjectorProof.Reads}
		}
		if observation.BuildCallbackCount.Kind == "known" && observation.BuildCallbackCount.Count == 0 {
			observation.CanonicalRequestCount = DemandOutcome{Kind: "known", Count: 0, Reads: observation.BuildCallbackCount.Reads}
		}
		if value.text == "defineCollectionQuery" {
			observation.BuildCallbackCount = DemandOutcome{Kind: "known", Count: 1}
			observation.ProjectCallbackCount = DemandOutcome{Kind: "known", Count: 1}
			observation.CanonicalRequestCount = DemandOutcome{Kind: "known", Count: 1}
		}
		for _, count := range []struct {
			value   *DemandOutcome
			message string
		}{
			{&observation.BuildCallbackCount, "definition paths have different build callbacks"},
			{&observation.ProjectCallbackCount, "definition paths have different project callbacks"},
			{&observation.CanonicalRequestCount, "return paths have different request provenance"},
		} {
			if count.value.Kind == "ambiguous" {
				count.value.Message = count.message
			}
		}
		for _, proof := range []DemandOutcome{observation.Ownership, observation.ID, observation.ProjectorProof, observation.BuildCallbackCount, observation.ProjectCallbackCount, observation.CanonicalRequestCount} {
			if proof.MigrationIncomplete {
				product.Residual = append(product.Residual, DemandOutcome{Kind: "unknown", Reason: "Captured semantic demand authority is unavailable for " + path, MigrationIncomplete: true})
				break
			}
		}
		product.Observations = append(product.Observations, observation)
	}
	return product
}
