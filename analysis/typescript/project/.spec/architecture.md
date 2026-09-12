# Resident TypeScript project

The project is a consumer-facing resource owner over the existing native analysis service. It resolves
installed native artifacts, defaults to an instance-local memory store, serializes refresh operations,
and owns its immutable readers. Explicitly supplied stores remain caller-owned.

A refresh returns its exact generation and the ordered transactions committed since the previous
successfully returned refresh. A post-commit acknowledgement failure cannot hide a change on retry:
the project retains the original transactions, including their base, sequence and completeness.
It never composes several generations into a transaction with an invented sequence. Source changes,
including known source deletions, remain pending alongside these transactions. Open accepts the complete generation
coordinate so a configuration rollover cannot accidentally select the current universe for an older
result. Snapshot readers preserve their generation while later refreshes publish new evidence.

A failed or cancelled compiler is disposed and recreated on the next refresh from the last stored
complete generation. Caller change arrays are captured before queued work yields. Disposal cancels
active work and releases readers and the owned store. Native artifacts and advanced session factories
remain explicit caller-controlled extension points.

An opening signal governs only factory opening. Once the resident process is available, each request
owns its own cancellation, so finishing a caller's task cannot kill a subsequently reused project.

Value evaluators share one immutable body/symbol/source index across snapshots of a generation. The call-model function
identity and exact effective budget select the evaluator; models never share conclusions just
because their budgets match. Symbolic demand plans preserve closures privately, and independent
resolutions expose evidence and explicit limits. Different budgets cannot reuse partial
conclusions as complete evidence.

The owned memory store retains at most two universes unless explicit reader leases
require more. The resident project holds its own current-generation lease, replacing
it only after opening the successful next generation. Historical reader access cannot
evict that current result. Caller-supplied stores keep their own retention policy.
Source-deletion metadata is keyed by universe and discarded when the corresponding
owned-store lineage is collected; retained historical lineages keep their metadata.


The snapshot exposes a typed call inventory over its existing immutable value index.
Source and exact logical-path filters select calls before site projection; source/body
admission and interprocedural value indexing remain shared and currently project-wide.
Unresolved calls are retained, including missing callee or source relations. Structural
inventory completeness is distinct from downstream bounded discovery: topology-only CFG
limits do not imply missing calls, while unsupported class/namespace execution and unknown
extraction limits remain partial. Missing capabilities never become a complete empty result.

A missing logical path cannot prove exclusion by a nonempty path filter. Such a
selection remains partial unless the explicit source filter already excludes that
source; no matching path or call is invented.

The resident index owner observes only successfully committed transactions. It maintains an immutable
shard catalogue and lazily applies changed facts plus affected joins when values are next requested.
Published indices structurally share untouched lookup branches while pinned readers retain their exact
revision. Undemanded deltas compact without retaining a chain of snapshots; unknown external-writer
lineages fall back to full query admission. A failed pending predecessor cannot poison subsequent
indices. Initial admission remains project-wide and is distinct from incremental update work.


`compute(observer, input, { signal })` runs an ordinary semantic observer over tracked
`calls` and `values` readers. Callback identity is stable; all variable external
parameters belong in the explicit input. The callback may capture module constants,
not mutable external state, files or time that Codegraph cannot observe. No keys,
dependency lists, rule registry or cache lifecycle are required downstream.

Plain object/array inputs are copied, normalized to a stable property order and deeply
frozen before the first yield. The callback sees exactly the data used for its key,
including undefined, absent properties, array holes, shared references and signed zero.
Plain results are owned frozen data; cache hits need not preserve object identity.
Accessors, proxies, classes and symbol properties run without retention. Raw value
proofs include private symbol metadata and should be projected to portable observations.
Readers, evaluators and plans from a computation expire when its callback settles.

The project retains serialized portable results and compact read receipts within the
same 8 MiB envelope as value proofs. Temporary receipt construction also reserves that
envelope. Saturated receipts, oversized results and unavailable admission finish the
computation without retaining a partial entry. Failed or cancelled computations cannot
publish results. Cancellation rejects without waiting for arbitrary observer work;
escaped reads expire and late work remains handled. Each caller owns its cancellation;
in-flight work is not deduplicated. Cached proofs retain opaque weak model identities,
not model closures that could capture a computation reader.

During collection, a temporary 32 KiB direct table recognizes repeated dependency witnesses
by exact, non-recycled cache-local numeric identities. Slot collisions and unavailable safe
identities repeat the normal hash; they never omit a dependency. Its reservation includes
the table and receipt compaction, and retained receipts contain neither these tags nor
references to their witnesses. Each independent computation starts with an empty table.

Receipt collection includes value cache hits, unknowns, budgets and absent reads, plus
complete call-selection membership and completeness. A negative filter answer for every
key of a direct, atomic index delta permits reuse without rerunning the observer or
resolutions. Possible intersections force recomputation. Missing lineage and old readers
recompute conservatively; a late old computation cannot replace a current entry. Results
can outlive cache eviction and project disposal. An affected edit still recomputes the
whole observer; per-candidate differential evaluation is a separate future capability.
