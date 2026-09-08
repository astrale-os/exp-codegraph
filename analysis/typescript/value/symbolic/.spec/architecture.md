# Symbolic value ownership

One portable evaluator owns TypeScript value transfers for scalar evaluation and symbolic
provenance. Native facts establish expressions, canonical symbols, argument bindings and
control-flow completeness. The evaluator preserves lexical environments when helpers return
closures, resolves effective object properties in source order, and propagates explicit unknown
results for unsupported transfers. Asynchronous functions, generators, rest/spread arguments,
compound assignments and incomplete control flow never become synchronous known values by
following an operand or return relation alone.

Observed binding and property writes invalidate initializer-only proofs. Direct aliases propagate
that uncertainty to their underlying object; this is conservative mutation detection, not heap
execution. Both the presence and absence of writes enter proof dependencies, so a newly added
mutation in another module invalidates a previously reusable proof and removal permits recovery.
Native parameter bindings propagate helper writes to callers, retaining the alias and call facts
that establish each effect path. Objects and opaque values passed as arguments to bodyless or
dynamic calls remain uncertain. Receivers are not globally marked as escaped. A definite local
reaching assignment can transfer its right-hand value only when the native operator is exactly
`EqualsToken` and no other execution owner can write that binding. Captured and interprocedural
writes remain uncertain.

An unknown result may carry non-exhaustive `candidates` from observed branches or earlier
initializers. These preserve discovery evidence when one possible factory is recognized but the
complete value is unknown. They never upgrade a rule's evidence to known or complete, including
after mutation or budget exhaustion.

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

One resident project owns a lazy body/symbol/source index per immutable generation, shared across
snapshots, models and budgets. Standalone evaluators keep a query-local index. There is no global
index or compiler handle. Completed proofs retain evidence and private fingerprints for every
positive and negative lookup. `canReuse` compares fact identity, payload, completeness, lookup
membership, model identity and effective budget against the new evaluator. Fact IDs alone do not
prove unchanged content. Proofs can survive disposal of their original reader without retaining
that reader, its query, or its index. Serialized or caller-constructed results are not reusable.

Effect indexing retains direct writes, escapes, and reverse alias/call-binding edges only.
It never constructs per-symbol transitive provenance sets. A demanded proof traverses
those edges under its step budget, records present and absent adjacency/effect keys,
and memoizes within that proof. Fan-out in unrelated functions does not consume a
value proof's budget or force a project-wide effect closure.

Property occurrences on a proven module namespace may resolve their actual exported
member origin, including reexports. The module-namespace witness is retained only
in the private runtime value, preserving local aliases without adding a public
value kind. A structurally compatible external object or local cast is not a module
namespace. Synthetic property plans without a member occurrence remain explicit
unknown when no exported-member relation is available.


A resident project transparently reuses completed resolutions across its snapshots.
The key contains the immutable demand plan, scalar/symbolic mode, model identity and
effective budget; every hit validates the existing positive and negative dependency
fingerprints against the requested snapshot. The shared LRU is bounded across all
models and budgets by 1024 entries and an 8 MiB conservative storage estimate.
Oversized or non-portable results bypass caching. Entries retain only receipts,
fingerprints and serialized plan keys, never the plan, reader or value index. Project
disposal clears and closes the cache so surviving old plans cannot repopulate it.
Aborted requests reject before a cache hit and before publishing a new receipt.

Engine-owned result wrappers, alternatives, evidence and reasons are immutable.
Opaque model atoms retain their original identity and are never frozen or cloned by
the engine. Their receipts are cacheable only when the atom graph is already deeply
immutable and portable; mutable atoms remain supported without automatic reuse.

Opaque atom alternatives use identity equality (`Object.is`), including signed zero.
Equal object fields do not prove equal model instances; the evaluator never serializes
an atom to decide identity. A model may deliberately return one shared immutable atom
when its domain semantics declare those alternatives equivalent.

Committed shard membership drives incremental value indexing. Only facts from changed shards are
read and admitted again; untouched lookup branches, facts and witnesses are shared through immutable
hash tries. Direct-effect projections record their positive and negative lookup inputs, so adding or
removing a callee body also recomputes affected escape/alias joins. The initial index remains a global
admission and projection; call path filters currently select output sites, not body materialization.

The project retains its current index and explicit snapshot leases. Undemanded changes compact by
shard relative to the last demanded index, rather than retaining an unbounded transaction chain.
Completed index updates detach their base promises. Unseen external writes and failed lazy bases
fall back to a fresh pinned query. Closing a snapshot clears its factory/projection caches and releases
its index lease; caller-held evaluators and plans may retain their own immutable evidence.

Dependency witnesses preserve exact lookup membership. A present occurrence shares its function
witness only when both selected fingerprints are equal; overlapping fact owners retain an exact
occurrence witness. Initializer fingerprints include the referenced occurrence fingerprints, so
proofs cut short by a budget cannot retain evidence from a removed fact. Revision deltas report every
changed fingerprint, including added and removed lookup keys, without scanning untouched tables.
