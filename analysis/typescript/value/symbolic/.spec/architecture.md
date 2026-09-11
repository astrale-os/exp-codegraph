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

The call context's `propertyName` is the member named by its callee occurrence, not the name of
the selected declaration or a renamed export. Its first read records the callee dependency and
uses at most one step of the enclosing proof; repeated reads share that captured metadata.
Unrequested metadata costs no proof work. A model can combine the member name with a proved
receiver without trusting a structural method signature. Missing or unsupported callee shapes
leave the name absent. Like operand resolution, reads end with the synchronous call model.
The current native IR only pairs a direct property callee with its receiver; parenthesized
`(object.method)(...)` and computed callees are not given inferred member metadata here.

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
effective budget. Adjacent indexed revisions invalidate readers of changed positive
and negative keys through an inverse dependency graph; other readers validate each
shared proof basis once per immutable index. A discontinuous revision starts a new
validation lineage without retaining prior indexes. Equal dependency, evidence and budget bases
share immutable storage across receipts. The cache remains bounded across all models
and budgets by an 8 MiB conservative storage estimate, including shared dependency
memberships and its bounded aging frequency sketch. Admission retains useful resident
work through scans exceeding capacity; equally frequent newcomers do not displace it.
Oversized or non-portable results bypass caching. Entries retain only receipts, shared
bases and serialized plan keys, never the plan, reader or value index. Project
disposal clears and closes the cache so surviving old plans cannot repopulate it.
Aborted requests reject before a cache hit and before publishing a new receipt.

Resident bases share an exact vocabulary of evidence identifiers and effective budgets.
Basis keys contain opaque numeric evidence coordinates instead of repeating full fact
identifiers. These coordinates are collision-free within their owner and never reused;
their dictionary entries are reference-counted by resident bases and removed with the last
basis. Preparing or rejecting a demand retains no vocabulary entry. Receipts still expose
their original ordered fact identifiers and effective limits; atoms are neither interned
nor transformed. Storage accounting includes the shared vocabulary, per-basis references
and coordinate arrays. Caller-held receipts may outlive cache residency without retaining
the cache, a snapshot or an index.

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
hash tries. Multiple contributor writes to one slot are grouped within the transaction and merged
once at publication, avoiding quadratic call catalogues for wide source files. Direct-effect projections record their positive and negative lookup inputs, so adding or
removing a callee body also recomputes affected escape/alias joins. Initial admission remains global
and atomic. The value index retains occurrence-to-fragment routes and source-to-call identifiers;
logical occurrences, relations, definitions and values are projected only when demanded. Call path
filters select source buckets before materializing call sites. Helpers outside those paths resolve
through the same function lookup. Global mutation, initializer, alias and escape inputs are projected
from compact columns regardless of the selected sources, so filtering cannot conceal an effect.

Trie branches use a bitmap and compact child arrays. A bounded slot string preserves each branch's
existing insertion order independently of its lookup positions. Edits copy shared branches before
writing; publishing an edit prevents later mutation of pinned roots. Digest words only route lookups:
leaves and collision buckets compare complete keys, including arbitrary non-coordinate strings.

The packed fast path requires an exact physical fact state, a known composed decoder instance,
freshly parsed owned JSON input and successful shard admission. Codec names, inherited wrappers
and caller-frozen objects do not establish ownership. Uncertified/custom representations retain
full semantic admission and an index-owned copy of their data containers, without freezing caller state.
Fallback call grouping uses each occurrence’s actual source; only the packed format attests one source
per body. Changed owned body fingerprints use their exact immutable representation
and fact header; unchanged fragments and hashes are shared. Full bodies are expanded only when
a semantic demand needs function execution metadata. Private fragment caches are retained by their
immutable facts and leased indices, with no strong reference to a preceding index or query.

The project retains its current index and explicit snapshot leases. Undemanded changes compact by
shard relative to the last demanded index, rather than retaining an unbounded transaction chain.
Completed index updates detach their base promises. Unseen external writes and failed lazy bases
fall back to a fresh pinned query. Closing a snapshot clears its factory/projection caches and releases
its index lease; caller-held evaluators and plans may retain their own immutable evidence.

Dependency witnesses preserve exact lookup membership. A present occurrence shares its function
witness only when both contributing fingerprints are equal; overlapping fact owners retain an exact
occurrence witness. Initializer fingerprints include the referenced occurrence fingerprints, so
proofs cut short by a budget cannot retain evidence from a removed fact. Revision deltas report every
changed fingerprint, including added and removed lookup keys, without scanning untouched tables.

Call selection has its own private witnesses for the global completeness, complete inventory,
source buckets, logical paths and the count of relevant sources without a path. Filtered reads
record absent buckets as well as present ones. These witnesses are published atomically with the
value index and capabilities from the same pinned query; an index without this certification can
still produce calls but cannot certify a reusable selection. Changed bodies, effective source
mappings and overlapping occurrence owners update only affected buckets. Completeness counters
preserve shared attribution and partial reasons hidden by unavailable results, including when
provenance changes without a value fingerprint change. Capability-only transactions update the
global witness. Old pins retain immutable selection metadata; compacted updates compare against
their actual demanded base. Read-time path matching still selects among source buckets, whereas
maintaining the selection journal never scans the unchanged body or source catalogue.


A proof is admitted with its producing index revision. If a model reenters an older
evaluator between lookup and publication, the outer proof cannot inherit that older
reader's fast-validation lineage. A mismatched producer remains uncertified until
its full dependency basis is checked against the requesting immutable index.
