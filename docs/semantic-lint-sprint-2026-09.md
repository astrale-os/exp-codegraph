# Semantic lint: September 2026 sprint closeout

The first vertical slice works through actual installed candidate packages: Codegraph
owns semantic queries and the SDK runs Query rules through a resident lint session and
CLI watch. Its public surface is smaller and its ownership model is substantially more
incremental. Large-project latency and memory remain insufficient. This is a pause and
handoff, not a production-release announcement.

This document records the state on **2026-09-08**. Implementation stops at Codegraph
`5df48307c33e3d5d4741325570eaf93a294fc878` and SDK
`054a41caea15dfc0385048f45f2a47703be83a1b`. Proposals below are not implemented APIs.
The documentation change containing this report does not change either runtime.

## Delivery state

The [complete PR inventory](semantic-lint-pr-stack-2026-09.md) records all heads and dependency bases.

| Area | State at pause | Remaining condition |
| --- | --- | --- |
| Codegraph stack through [PR53](https://github.com/astrale-os/exp-codegraph/pull/53) | Published, qualified baseline at `b9b549941910719e48942f0e571af5b1e7325c1f` | Review/integration and final release qualification |
| Body row ownership [PR54](https://github.com/astrale-os/exp-codegraph/pull/54) | Published at `bea7ece75d27bf74a9f28aefa83069835bbe2c53`; draft | Resolve the large-corpus retention regression |
| Columnar body codec [PR55](https://github.com/astrale-os/exp-codegraph/pull/55) | Published at `5df48307c33e3d5d4741325570eaf93a294fc878`; draft; functional and installed qualification pass | Requalify memory after fixing its inherited row representation |
| [SDK PR461](https://github.com/astrale-os/sdk/pull/461) | Published at `054a41caea15dfc0385048f45f2a47703be83a1b`; draft | Actual distributed Codegraph dependency, lockfile and registry-based CI |
| [Distribution proposal PR22](https://github.com/astrale-os/exp-codegraph/pull/22) | Published at `dc2b1a7f83ad56e3249e0f194de7f8a17aa57f97`; draft, based on PR29 | Distribution decision, then incorporate the selected performance stack |

All 46 Codegraph PR head SHAs from PR10 through PR55 were checked against the remote
branches at closeout. The SDK head also matches its remote branch. Successful applicable
Codegraph workflow runs exist at those heads; some check rollups retain earlier cancelled
runs superseded by successful runs. PR54 and PR55 each have 15 successful checks.

PR44 was merged by the repository owner into its stack base on 2026-09-08 at 10:04:02 UTC,
at `9e2eb060f110ddd9f0beabcc37502d1b7c3095df`. This is a prerequisite integration within
the stack, not a release of the stack to main. The other PR10–55 entries remain open at
this checkpoint. No registry publication or deployment is claimed.

The SDK's committed manifest currently has **no Codegraph dependency**, although runtime
code imports Codegraph. Local links were intentionally excluded and removed during
closeout. Staged candidate installations add the dependency and transport the actual
qualified archives. They establish package behavior, not npm dependency closure.
[SDK CI at the exact head](https://github.com/astrale-os/sdk/actions/runs/34194674227)
therefore still fails with missing Codegraph modules. Do not treat a clean worktree or
passing staged installation as a mergeable SDK release.

## What the slice now provides

The current [value API guide](typescript-values.md) documents the implemented surface:
`openTypeScriptProject`, pinned snapshots, `snapshot.calls({ paths, sources })`,
`snapshot.values({ call, limits })`, and value plans with `property`, `invoke` and
`resolve`. `mapValueResult` projects results while preserving uncertainty. Contextual
operands preserve bindings and closures through a library model. Independent resolutions
receive independent proof allowances; work inside one model shares its enclosing proof.

Codegraph owns source/body/callee joins, generic value evaluation, positive and negative
dependencies, bounded automatic proof reuse, index lifetime, and coherent publication.
The SDK owns Astrale constructor semantics, policy decisions, diagnostics, source ASTs
and the developer-facing lint lifecycle. Domain source is the acceptance corpus.

The SDK adapter fell from 444 to 334 lines after its manual observation cache and raw
joins were removed. The useful result is the ownership transfer: rules no longer manage
proof-cache keys, invalidation or Codegraph graph reconstruction. A smaller line count
alone is not an acceptance criterion. Constructor identity still uses exact declaration
provenance, including package-internal paths; a public-export identity primitive remains
a concrete DX gap.

The implemented Query slice covers aliases, reexports, runtime namespaces, curried
factories, captured callbacks, configuration objects, helper forwarding and repairs.
Uncertain discovery or incomplete inventories remain indeterminate. A same-named local
function or an SDK-compatible static type cannot establish SDK runtime identity.

The SDK exposes repeated `openDomainLinter(...).lint()` and `astrale-domain lint --watch`.
Refreshes serialize, stale reports cannot publish as current, temporary source errors
recover, and disposal cancels work and releases its owners. Installed edit journeys
compare each result with fresh analysis under the same budgets.

Non-Query examples exercise Organization Rules and Services Integration/Provider
descriptor and closure shapes. They do **not** constitute complete Integration, Provider
or Workflow lint implementations. Promise intrinsics, arbitrary `Object.assign` callable
exports, instance equality and unrestricted interprocedural effects are not claimed.

## Qualification and exact artifacts

The selected PR53 baseline passed 722 tests in 100 files, eight typecheck lanes and
44 specifications. Its [general CI](https://github.com/astrale-os/exp-codegraph/actions/runs/34221610356)
and [native CI](https://github.com/astrale-os/exp-codegraph/actions/runs/34221610236)
passed. Its six actual archives were admitted and used for the SDK's seven installed
packed-scaffold tests and a separate 21-check non-Query journey.

The PR55 candidate passed 737 tests in 102 files, all eight typechecks, build and all
44 specifications. Its [general CI](https://github.com/astrale-os/exp-codegraph/actions/runs/34227856307)
and [native CI](https://github.com/astrale-os/exp-codegraph/actions/runs/34227856334)
passed, including five native builds, exact archive assembly and eight installed
platform/Node consumers. Synthetic CI source
`57d78b5312aaf88277089db2d2c902f32f610f11` has the same tree as PR55:
`5a000822911c010107046de7ac60a5719266ec0f`.

Independent admission compared 513 distributed source files and 668 generated files
against the exact source and isolated rebuild; generated maps are excluded from that
668-file comparison. All six actual archives were checked. The latest installed SDK
qualification passed **7/7**, including custom scaffold, repeated lint, public session,
CLI watch, failure/repair and cancellation. The React scaffold is generation/identity
only. The separate non-Query qualification passed **21/21**, with a complete 17-call
inventory and full reports equal to the earlier qualified cohorts. Default native
package resolution was used, without source or executable overrides.

The unchanged SDK source passed 1,130 tests in 137 files, Node compatibility and 42
script tests, plus its complete typechecks, build and package checks. Installed
qualification separately checked the actual SDK and Codegraph generated bytes before
fixture cleanup.

| Exact PR55 installed artifact | SHA256 |
| --- | --- |
| Root Codegraph archive | `6f4bb350f4294cd72a53eae5402f5bf1a7db9eabd6860249814b957649110b12` |
| Installed CI darwin-arm64 native | `e4e496005513341fd2e9c734d5973e74c02f764c378d8441a652fa83357c9ba4` |
| SDK candidate archive | `883f74803dd11ac44ad81b80428b69480550c700189b6462c0e7a89d7260edd6` |
| Six-archive admission receipt | `33e363b002b451dcee74b6f68b1b5fa1e62691991118ed4f7e5499b884e1f9e0` |
| Installed SDK qualification receipt | `e92030bbfab3a4505f9ca24083ff00a92e5d230552623b791b0a507b550db23b` |
| Installed non-Query receipt | `9e33d18ed2068f1173684f858a0721dc5b7f30bfdbca03c0b270706b9264e47a` |

Local performance executables are distinct from the installed CI executable. The
ordinary PR55 measurements below use the clean local executable
`bc5c90cd5ced217532fc0a50bd90cea99091143564e800a751bd4fe8bd55c82e`;
the control uses `7d8c2cc5dcf169d861b2d4f48080f2bf1259d1f2d89c243980aaa6f1c5d2d2b3`.
The provisional packer micro used a third, separately recorded executable. None is
silently substituted for CI-installed evidence.

## Performance: useful reductions, insufficient total cost

The largest fixture is derived from real 1pact Query modules. It adds 5,040 copies
of authored modules, rather than representing a deployed Domain of that size. It has
35,009 calls and 46,529 proof requests. Services, Organization and unexpanded 1pact also
provided real acceptance examples. Replica scaling tests volume and index behavior;
it does not cover every large-repository topology or public dependency fanout.

The latest matched ordinary journeys compare PR53 against PR54+55 using identical SDK
bytes and Node 26.7. Telemetry, profiling and forced GC are off; external RSS sampling
is every 500 ms. Each pair preserves all eight complete normalized SDK results,
including diagnostics, evidence, coverage, uncertainty and repair outcomes.

| Step | ×1 PR53 → PR55 | ×16 PR53 → PR55 | ×64 PR53 → PR55 |
| --- | ---: | ---: | ---: |
| Cold lint | 5.011 → 5.517 s | 13.211 → 12.013 s | 38.173 → 38.545 s |
| First unrelated edit | 174 → 172 ms | 685 → 626 ms | 2.680 → 2.754 s |
| Second unrelated edit | 162 → 170 ms | 672 → 617 ms | 2.552 → 2.660 s |
| Local helper edit | 853 → 808 ms | 1.236 → 1.197 s | 3.198 → 3.226 s |
| Helper type change | 1.279 → 1.249 s | 1.859 → 1.812 s | 4.689 → 5.267 s |
| Repair | 1.140 → 1.136 s | 1.902 → 1.735 s | 4.194 → 4.499 s |
| Combined sampled peak RSS | 1.866 → 1.753 GB | 3.615 → 3.282 GB | 8.073 → 7.580 GB |

These are single paired observations, not p95 estimates or causal attribution to each
PR. Startup process inventories showed no external compiler/test work in these six
runs; later external activity is not excluded. Decimal MB/GB are used in measurements;
MiB below denotes the binary cache allowance. The largest corpus shows no latency
improvement. Lower sampled RSS also does not establish lower retained JS heap.

Several deeper changes have demonstrated component savings:

- Persistent value-index and memory-query updates consume committed deltas; proof
  coordinates, generation ownership and stream admission avoid repeated broad copying.
- Compact adjacency reduces its measured retained representation, including buffers,
  by about 87% at ×1 and ×4. A separate full ×64 retention diagnostic for PR53 reduced
  JS heap after GC by about 237 MB relative to the preceding qualified cohort.
- Packed body codec 6 stores occurrence columns and flat numeric relation/edge/definition
  tables. Readers still support codecs 1–6. In the same-consumer/same-producer codec 5/6
  component comparison, complete-index heap plus buffers falls 216.026 → 204.770 MB
  at ×1 and 281.296 → 266.645 MB at ×4. Public views, generations and all call proofs
  agree; existing private fingerprints intentionally change with physical encoding.
- The Go packer micro falls from 635,566 to 367,681 bytes/op and 12,410 to 3,167
  allocations/op. This excludes compiler execution, transport and the SDK, and is not
  a native RSS or full-lint speedup.

Those wins do not add up mechanically. The combined PR54+55 candidate retains
**37,947,768 more bytes of JS heap after GC** at the end of the ×64 journey than a
contemporary PR53 control: 2,135,701,832 versus 2,097,754,064 bytes. All eight complete
outputs remain equal. This concern is the reason PR54 and PR55 remain draft.

## Open retention defect and a reproducible next step

A separate actual cold ×64 diagnostic preserves the same generation, source manifest,
full SDK output, 21 live table roots, 2,344,374 entries and 823,419 row contributions
in both variants. There is no extra retained table history in the inspected population.
The approximately 38 MB excess is present before and after inspection and forced GC.

Control slots and node references each share one V8 hidden Map. Candidate fused rows
remain frozen objects with fast properties and 56-byte instances, but the first 64
sampled Maps and descriptor arrays are all distinct. None of the remaining rows matches
those 64 representatives. This proves at least 65 Maps, **not** that all 823,419 are
distinct. The sampled candidate Maps have no back pointer. Allocation-site samples
alone did not reveal this metadata cost or establish a retaining dominator.

A local reproducer now exercises the real `IndexedValues.empty().update` over 100,007
rows derived from eleven small admitted codec-6 frames, without a compiler or SDK.
The expansion rewrites linked IDs consistently; it is a mechanism reproducer, not a
performance model of 1pact. Original, null-initialized and fully predeclared object
literals reproduce the fragmented Map histogram. A private class stabilizes it:

| Local construction, no forced pre-update GC | Map observation | Final JS heap after GC |
| --- | --- | ---: |
| Current literal with self data field | Fragmented histogram | 237.880 MB |
| Private class with four data fields and self | One Map for all rows | 217.888 MB |
| Private class with three fields and shared prototype getter | One Map for all rows | 217.090 MB |

Buffers are identical at 1,215,851 bytes. Public projection checksum and row counts
agree. Immutability checks pass for the local class variants. A forced collection just
before index update masks the original defect; instrumentation inside the factory also
perturbs it. Generic interleaved reads and a standalone allocation micro did not
reproduce it. The exact V8 transition/collection mechanism remains unresolved.

The smallest next product experiment is a **private four-field class with `value = this`**,
frozen after construction. It preserves the existing data-field contract and avoids a
getter. The getter variant saves another eight bytes per instance locally, but is a
separate decision. Neither variant has been committed to product or qualified at ×64.
Do not count its approximately 20 MB local gain as a measured macro improvement.

Requalification must include ordinary cold allocation with no pre-update GC, old pins,
overlapping contributors, 1→2→1 ownership transitions, failed admission/retry, both packed
and logical providers, full same-budget results, and contemporary ×64 retention. Keep
engine introspection in local qualification; durable product tests should assert the
ownership and semantic behavior rather than one engine's hidden Map identity.

Local diagnostic receipts, retained as optional resumption aids:

- `codegraph-row-shape-diagnostic/provenance.json`, SHA256
  `2d395f1d5f3d1cd449fe539b0b5925f4350740a7f731519a444b3cca2838aed9`.
- `codegraph-row-contribution-feedback/receipt.json`, SHA256
  `550cdb79be9e40fbed2b9859fd2c4cab11a47130ac77a2fea65cd2496a19397b`.

These were generated under `/private/tmp`; their raw logs are ephemeral evidence, not
new package dependencies or required runtime assets. The finding and acceptance recipe
above remain available if those files are discarded.

## Retrospective

The strongest decision was to keep the complete installed lint loop as the correctness
oracle. It exposed constructor lookalikes, negative-read invalidation, incomplete
discovery, publication failures, source membership changes and platform packaging
defects that isolated evaluator tests could miss. Independent semantic, ownership and
artifact reviews materially improved the result.

The strongest DX improvement came from giving Codegraph the right generic ownership:
typed call inventory, contextual values and automatic proof reuse. It did not require
a rule registry or Astrale-specific query language. Non-Query witnesses helped check
that these primitives were reusable.

The main architectural limit is now clear: a changed generation still causes the SDK
to reconstruct its overall observation and request 46,529 proofs at ×64. The existing
8 MiB project cache retains roughly 2,300 entries at that scale. Faster individual
lookups cannot remove that full traversal, and simply enlarging the cache would retain
more detailed proofs. Native inventory/manifest processing and SDK source verification
also retain broad work. Incremental storage alone does not make the consumer's complete
observation incremental.

The main measurement lesson is that fewer objects, lower micro allocations and lower
sampled RSS are three different claims. Small forced-GC component probes hid a real
large-context Map problem. Future acceptance needs both ordinary end-to-end runs and
separate retention diagnostics with representative allocation history. Profiling
belongs after a stable ordinary baseline, and its conclusions must be checked against
unchanged results and work counts.

The main process cost was the length of the stack and repeated qualification of nearby
revisions. Small causal PRs remain useful for review, but the next sprint should group
them into fewer explicit milestones, freeze one integration candidate per milestone,
and reserve the full installed matrix for those candidates. Preserve required PR checks;
avoid treating every exploratory micro as a new release candidate. Maintain one stable
baseline, one candidate and one current handoff document; old receipts remain history.

The distribution decision stayed open while the implementation advanced. This leaves
the SDK PR incomplete despite passing candidate installations. Resolve that dependency
route early in the next integration milestone. Public npm publication is a proposed
route in PR22, not an authorization inferred from performance work.

## Proposed second sprint

The organizing objective should be **minimum rule code with cost proportional to
relevant changes**, verified through at least two distinct semantic rule families.
Start from consumer examples and a small contract, implement the dependency foundations
that make it safe, and optimize whichever owner still dominates the measured loop.

### Milestone 0: a trustworthy baseline and release route

Fix or replace the row representation, then compare PR53, the repaired candidate and
codec 5/6 at the actual large corpus. Restore a demonstrated retention improvement
before adding another retained cache. Preserve full semantics and independent budgets.
Choose the distribution route; incorporate the selected code into the distribution
proposal, obtain the actual released version, commit the SDK dependency and lock, and
qualify registry-installed consumers before claiming delivery.

### Milestone 1: reuse a complete semantic observation

The first consumer target is an unrelated edit that does not rerun the Query observer
or its value resolutions. The current API remains the building block. A possible
single operation is shown below; **`compute` is illustrative and does not exist yet**:

```ts
const semantic = await snapshot.compute(observeQuerySemantics, {
  paths: selectedPaths,
  limits: effectiveLimits,
}, { signal })
const located = locateWithCurrentSourceFiles(semantic, source)
```

The callback would use a tracked reader's existing `calls`, `values` and value plans.
Rules would declare no cache key, dependency list or invalidation hook. Codegraph would
own the result and its complete read receipt; the SDK would apply current AST locations
and policy outside that reusable calculation. Variable external inputs must be explicit;
callback identity cannot prove that a mutable closure, ambient file read or clock is pure.

Build selection dependencies before offering this operation. Existing value proof bases
are insufficient: a newly added call, a previously absent path or a completeness change
can alter a result without changing any previously returned FactId. Record selection
and value changes atomically with the same index revision. The read-only design proposes
global completeness, all-calls, unmapped-source count, source and path witness families,
reusing existing Columns and incremental completeness counts. These are private
implementation candidates, not new public key types.

The journal must cover effective overlapping contributors, two sources at one path,
renames, missing paths, masked completeness reasons, capability-only changes and custom
bodies that alter another contributor's call occurrence. Obtain capabilities from the
same pinned query before publication. Unknown lineage, old pins or external writers
recompute conservatively; never retain an unbounded chain of revisions for reuse.

Retain compact observations, inputs and read receipts within the **existing shared
8 MiB allowance**, including bookkeeping. A local receipt study at ×4 measured about
3.28 MB for exact whole-query receipts plus observations; adding that to current proofs
would exceed the existing allowance. An experimental Bloom representation reduces that
study to about 649 KB, but is not implemented and does not prove ×64 admission.
If used, a Bloom filter may certify disjointness only against a complete change set on
a known lineage; possible hits recompute. False positives may cost work; missed changes
must never authorize reuse. Construction memory also needs a bound.

Nonportable results and admission overflow must still execute correctly without being
cached. Cancellation and exceptions cannot publish partial receipts. Proof exhaustion
remains unknown under its exact proof limits; memory-admission exhaustion only disables
memoization. Do not add a global execution budget until its incomplete-result contract
is explicit. A first miss can recompute the whole selected observation; partition by
source or candidate only when that remaining cost is measured as the next bottleneck.

### Milestone 2: prove the DX beyond Query

Use a real semantic definition-ID collision check over Mutations and Migrations as a
second candidate. Resolve IDs through aliases, spreads, factories and imported helpers;
let the SDK reduce proven IDs and report collisions. A new definition must invalidate
an empty selection or introduce a collision even when every old value proof is valid.
The existing `QLT-DEF-IDS` rule sometimes requires a literal form: accepting a computed
constant is a separate policy decision, not an automatic semantic-engine upgrade.

In parallel, specify public-export identity with real SDK/Kernel and non-Astrale library
examples. It must handle aliases/reexports and conditional package entry points while
rejecting local lookalikes and type-only provenance. Extend callable namespace and
intrinsic support only with concrete witnesses. The goal is to remove package-internal
declaration path checks, without adding Query, Mutation or Domain concepts to Codegraph.

### Milestone 3: remove the remaining broad work

After whole-observation reuse, measure native refresh, source discovery/verification,
generation manifest hashing/transfer and diagnostic rendering separately. Remaining
targets include global inventories, manifest/map copies, public dependency fanout and
the SDK's `sourceSnapshotDigest`/AST traversal. Keep changes at their owner and preserve
automatic detection of edits. Do not replace source coherence with caller promises
that a file is unrelated.

Use the same frozen small/medium/large fixtures, plus a large corpus with different
dependency topology. Record ordinary latency distributions on a reserved measurement
window, changed facts and visited rows, resolution/callback counts, JS heap, buffers,
native memory and total RSS. An independent edit should perform zero new semantic
resolutions when its observation is admitted and no relevant witness changes. Index
maintenance for that edit must avoid scans of all bodies/calls/manifests.

Interactive aspirations remain 100–300 ms first feedback and under one second for
ordinary affected completion on a declared representative corpus and machine. They are
targets, not sprint-one achievements or universal deadlines. Set cold-start and total
memory budgets from the corrected baseline before accepting a second milestone;
component percentage improvements alone are insufficient.

### Acceptance and proposed PR boundaries

Prefer a small number of dependent reviewable milestones, with causal `fix`/`feat`/`perf`
PRs inside each: row ownership repair; atomic selection journal; tracked observation
contract and bounded reuse; SDK adoption plus the second rule; then measured native or
SDK broad-work reductions. Public-export identity can be an independent feature once
its consumer contract and negative witnesses are agreed.

Every milestone keeps fresh-versus-incremental full result equality, including evidence
and uncertainty; zero→one and negative reads; add/delete/rename/revert; helper/import/
config changes; budget isolation; cancellation on hit and during evaluation; eviction;
old pins; failed publication/retry; and bounded release of owned resources. Qualify the
exact integrated archives in the real SDK session/watch loop before advancing the
release candidate. A second rule must remain short by using generic primitives, without
declaring technical dependencies or reproducing a TypeScript evaluator downstream.

## Local handoff

All product worktrees belonging to this sprint were audited. Stale edits in the original
Codegraph worktree, platform worktree and performance control were already covered by
published PR content; generated duplicates were restored. The SDK manifest/lock link
was local qualification transport and was also restored. Patches were saved temporarily
before cleanup. No unique uncommitted product change remains in those worktrees.

Remaining local material is coordination notes, reproducible probes, frozen runtimes,
candidate archives, logs, dependency/build caches and non-git qualification stagings.
The six SDK stagings contain already committed SDK revisions plus transport changes;
they contain no unpublished runtime feature. They can be recreated. Primary repositories
and work belonging to other tasks were not cleaned. No new optimization, experiment,
merge or publication should resume automatically from this checkpoint; the user asked
to pause and plan the second sprint.
