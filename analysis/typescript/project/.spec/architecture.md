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

Value evaluators share one immutable body/symbol index within a snapshot. The call-model function
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
