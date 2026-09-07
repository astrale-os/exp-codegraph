# Symbolic value ownership

One portable evaluator owns TypeScript value transfers for scalar evaluation and symbolic
provenance. Native facts establish expressions, canonical symbols, argument bindings and
control-flow completeness. The evaluator preserves lexical environments when helpers return
closures, resolves effective object properties in source order, and propagates explicit unknown
results for unsupported transfers. Asynchronous functions, generators, rest/spread arguments,
compound assignments and incomplete control flow never become synchronous known values by
following an operand or return relation alone.

`value(occurrence).invoke().property('build').invoke().resolve()` is an immutable demand plan.
Each resolve owns an independent depth, step and alternative budget. A model cannot erase a
budget failure by ignoring an exhausted operand. Inspection exposes shape and execution metadata;
closures, environments and lazy property references stay private. `invoke()` demands a callback
without manufacturing arguments; ordinary source calls retain their native parameter bindings.

An optional synchronous call model owns ecosystem semantics. It can demand callee, receiver and
argument values under the current proof budget and emit a typed atom, an explicit unknown, or
delegate to generic evaluation. Canonical receiver symbol origin remains distinct from a selected
method's declaration origin. Model functions and emitted atoms must have stable, deterministic
meaning for their lifetime; a changed model must use a new function identity.

One snapshot owns one lazy body/symbol index, shared across models and budgets. There is no global
index or compiler handle. Completed proofs retain evidence and private fingerprints for every
positive and negative lookup. `canReuse` compares fact identity, payload, completeness, lookup
membership, model identity and effective budget against the new evaluator. Fact IDs alone do not
prove unchanged content. Proofs can survive disposal of their original reader without retaining
that reader, its query, or its index. Serialized or caller-constructed results are not reusable.
