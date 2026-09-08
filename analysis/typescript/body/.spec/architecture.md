# Executable scopes

The body namespace contains both independently executed function bodies and module
evaluation. `scope` distinguishes them; absent scope in older facts means function.
The existing `function` field is the stable execution-owner identity for either
scope. Module owners derive from source identity, not source revision, and have no
parameters, return values, or recursion. Module facts have kind `module-body`.
New function bodies also carry their execution form: sync, async, generator, or
async-generator. An older fact without that field does not establish sync execution.

An enclosing scope retains function literals as opaque expression occurrences with
the independently executed body's identity in `symbol`. Relations preserve those
values as arguments, object-property initializers, or concise returns. Callback
execution is never counted as execution of the enclosing scope. Parentheses,
type assertions, and spreads retain explicit operand relations; consumers choose
the semantics of those constructs rather than guessing from adjacent spans.

Resolved call targets join function-body owners, including const function
initializers and immutable callable alias chains. Canonical import aliases and
reexports use the compiler symbol. A callable type or signature alone does not
prove value identity. `targetOrigin`, when present, adds the actual named package,
case-preserving package-relative declaration file, and lexical declaration path.
Its absence means that origin was not proved. Same-spelled functions in another
package, file, or lexical scope have different origins. Package manifests and
origins are cached within one compiler projection, so dependency updates cannot
reuse stale origins across generations.

`ResolvedCall.signature` is a bounded portable identity of the signature
declaration selected by the compiler. It includes the declaring owner, portable
source coordinate, overload ordinal, and authored signature header, excluding
the executable body. Different instantiations of the same declaration share this
identity; authored type arguments and parameter bindings are separate call facts.
An unavailable synthetic declaration leaves signature absent. Header formatting
may invalidate this identity; it is not a structural type-equivalence oracle.

Rendered types are presentation, not semantic identity. The earlier producer's
signature strings required expensive SDK generic union expansion, changed with
compiler allocation/cache order, and destabilized unrelated body digests. Native
pass 1.3 replaces that display with the declaration identity and never formats a
type to extract a call. Old stored strings remain readable as versioned historical
facts; consumers must not parse a signature string as TypeScript syntax. Display
queries can be designed separately when a consumer needs them.

Class initialization and namespace execution remain explicit incomplete control
flow in enclosing scopes. Conditional and short-circuit expressions are also
marked partial until expression-level branching is represented by the CFG.

For complete straight-line control flow, a use reaches only the last completed
definition of its symbol. Assignments take effect after their right-hand side is
evaluated, so `x = x` still reads the preceding definition. These edges are
definite. Branches, loops, and incomplete CFGs retain possible-definition edges
until their reaching sets are proved; source order alone does not establish
dominance through those constructs.

The packed body codec is version 5. Readers continue admitting versions 1–4 without
assigning new meaning to absent fields. Versions 2–4 introduced execution scope,
value-symbol origins, and binary operators. Version 5 adds `symbolKind` as a witness
that an occurrence denotes an actual module namespace: every declaration of the
unaliased compiler symbol is a SourceFile and its import/export alias chain has
no type-only declaration. A variable with a compatible namespace
type never receives this witness. Native producer 0.6 / pass 1.6 owns this fact.

The symbolic evaluator can project the canonical origin of a member occurrence
only when its receiver is proved to be a module namespace value. Local aliases
preserve that value; casts and structural type compatibility do not establish it.
A reexport may resolve to a different package's canonical member declaration.

Property-access occurrences preserve their authored `propertyName`, separately from
the member's canonical symbol origin. An exported alias can be spelled `Alias` while
its declaration is named `marker`; static casts do not rename the actual local
object's property. Version 5 stores this name as an interned text ordinal.

`propertyNamespace` is the static receiver type's SourceFile module symbol, emitted
only for exported module members. It is an expectation, not runtime evidence. The
evaluator joins it to the resolved runtime namespace's symbol before trusting the
member origin. Casting a different real namespace to `typeof SDK` therefore cannot
manufacture SDK exports. No module-wide export map or type rendering is required.
