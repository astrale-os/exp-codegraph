# TypeSpec V2 implementation governance

Status: ratified

Authority: [TypeSpec V2 ADR](../adr/typespec-v2.md)

## Purpose

This program may change implementation mechanics aggressively, but it may not silently change the
ratified product semantics. Governance therefore separates four things:

1. the ADR records durable architectural decisions;
2. `requirements.tsv` decomposes those decisions into stable, reviewable obligations;
3. `gates.tsv` records whether the evidence required for each authority transition exists; and
4. accepted revision records explain every consensus change to a ratified obligation.

Passing tests alone does not establish conformance. A requirement is complete only when its owner,
normative contract, implementation, verification, and required migration or deletion evidence are
all attributable in the traceability ledger.

The frozen V1 oracle is observational evidence, not a normative V2 contract. V2 parity requires
every difference to be explained; it does not require known V1 defects to be reproduced. The
machine-readable `drift.tsv` ledger is therefore part of conformance evidence:

- unexplained behavior or projection drift fails qualification;
- a V1 defect is corrected only after the intended behavior is specified, linked to affected
  requirement IDs, accepted through the applicable decision process, and protected by a regression
  test;
- representation-only drift must prove semantic equivalence;
- environmental drift remains visible and cannot be normalized into a false pass; and
- implementation regressions are fixed, never entered as accepted drift.

## Requirement lifecycle

Each requirement has one state:

- `ratified`: accepted by the ADR, with implementation not yet claimed;
- `specified`: represented by a current normative `.spec` contract;
- `implemented`: implemented behind the correct owner boundary, but not yet fully qualified;
- `qualified`: all declared verification and gate evidence passes;
- `superseded`: replaced by an accepted revision, with the successor requirement named; or
- `deferred`: explicitly outside the V2 completion boundary through an accepted revision.

State advances are monotonic except through an accepted revision. `implemented` and `qualified`
rows must name concrete repository paths. A gate cannot be complete while one of its non-deferred
requirements is below `qualified`.

## Evidence strength

Evidence is recorded without conflating its status:

- `baseline` captures V1 behavior or a pre-existing defect;
- `unit` proves a local contract;
- `differential` compares incremental and cold semantic results;
- `parity` compares V1 and V2 product behavior;
- `adversarial` exercises false-positive and unknowable cases;
- `consumer` compiles or runs a real downstream intent;
- `negative` proves obsolete paths and symbols are absent;
- `benchmark` enforces an owned measurable limit; and
- `release` proves packaged native/runtime behavior on supported platforms.

Every evidence reference must identify a command, test ID, fixture, report, or immutable artifact.
Prose such as “reviewed” or “works” is not evidence.

### Oracle and drift evidence

`drift.tsv` classifies a proposed difference as `defect-correction`, `intentional-evolution`,
`representation-only`, or `environmental`. Its status is `proposed`, `accepted`, `rejected`, or
`superseded`. Accepted semantic changes (`defect-correction` and `intentional-evolution`) require an
accepted revision record naming every affected requirement. Accepted representation or environment
rows require verification evidence but no material revision when they do not change normative
semantics. A proposed row may support investigation, but no gate may treat it as accepted parity.

## Gate authority

Only one implementation may be authoritative at a time:

- Before Gate 5, V1 remains authoritative. V2 shadow output cannot affect diagnostics, writes, exit
  status, editing, or viewer state.
- Gate 5 is the coordinated authority switch. Its review must prove that every application consumes
  V2 snapshots and projections and that rollback is source-control plus regenerable-cache removal.
- Gate 6 completes V2 only after the extension proof and all V1/legacy negative scans pass.

Gate status is one of `pending`, `in-progress`, `blocked`, or `complete`. `blocked` requires an exact
external dependency and recovery condition; it is not a synonym for difficult work.

## Change classes

Implementation discoveries are classified before they change the target:

### Mechanical change

Refactoring, performance work, naming inside a private owner, or a schema-compatible implementation
detail that preserves every requirement. It needs ordinary review and qualification, not an ADR
revision.

### Clarification

A wording or traceability improvement that narrows ambiguity without changing consumer-observable
semantics, ownership, compatibility, trust, or a gate. It updates the ADR changelog and ledger in
the same change and records why no requirement meaning changed.

### Material revision

Any change to authority, dependency direction, public API, compatibility, trust, persistence,
completeness, cutover, deletion, or completion criteria. It requires an accepted revision record
before implementation becomes authoritative.

## Consensus-driven revision protocol

A material revision is proposed in `revisions/<revision-id>.md` from the template in that directory.
It must include:

- the affected requirement IDs and exact old/new semantics;
- motivation and new evidence;
- alternatives, compatibility and migration effects;
- effects on every downstream gate and frozen oracle;
- review from the TypeSpec product, analysis/native, consumer/DX, and qualification perspectives;
- unresolved objections and their disposition; and
- an explicit status of `proposed`, `accepted`, `rejected`, or `superseded`.

Consensus means all affected perspectives were heard and no unresolved objection demonstrates a
violation of Kernel safety, soundness, or a ratified consumer need. It does not require unanimity.
An accepted record names the deciding maintainers and rationale. A rejected objection remains in the
record so later evidence can reopen the decision honestly.

Urgent experimental work may continue behind a non-authoritative branch or fixture, but it cannot
alter V1 authority, advance a requirement, or weaken a gate before ratification.

## Review protocol

Every gate exit includes these independent passes:

1. ownership and import-DAG review;
2. incremental and epistemic-soundness review;
3. native/upstream maintenance and release review;
4. `.spec` language and downstream-consumer review;
5. persistence, DX, failure, and performance review; and
6. adversarial self-hosting review of TypeSpec and the Kernel.

Findings are either fixed, linked to an accepted revision, or recorded as a precise external blocker.
Reviewers inspect evidence, not only the implementation diff.

## Automated enforcement

`pnpm spec:check` runs `spec/scripts/check-v2-governance.ts`. The checker rejects duplicate or
unknown requirement IDs, invalid state transitions in the current ledger, missing ADR sections,
missing artifacts for advanced states, completed gates with incomplete requirements, malformed
revision references, accepted revisions that do not name all affected requirements, and malformed
or unqualified drift decisions.

The automated checker protects structural completeness. Semantic review remains mandatory because
no ledger can prove that an implementation actually satisfies the decision it cites.
