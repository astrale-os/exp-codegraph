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

Class initialization and namespace execution remain explicit incomplete control
flow in enclosing scopes. Conditional and short-circuit expressions are also
marked partial until expression-level branching is represented by the CFG.

The packed body codec is version 2 and carries scope and target origin. Readers
continue admitting version 1 as function bodies with no target-origin metadata;
older producers can therefore be read without assigning new meaning to old facts.
