# Gate 5 application-cut qualification

Status: complete

Date completed: 2026-08-15

## Authority decision

Codegraph now has one application authority. CLI and CI create the headless application service;
the server and watcher retain its immutable readers; source editing, reveal, and on-demand
qualification require the admitted application generation and exact source revision; the catalog
and viewer receive deterministic projections only. There is no alternate V1 reader, compiler mode,
dual write, or mixed-generation fallback.

Only Kernel-owned `.spec` modules are authoritative. The pinned holdout at Kernel revision
`683ae7980ef07f4b8d36d6425bbbccc00c00fe41` contains 306 specifications. Removed Admin, Shell,
Issues, and Events specifications are absent from discovery and are not treated as parity subjects.

## Application proof

The governed command was:

```sh
node qualification/v2/application/qualify.ts \
  --root /private/tmp/codegraph-kernel-holdout-683ae7980 \
  --native-binary .cache/native/darwin-arm64/bin/codegraph-native \
  --revision 683ae7980ef07f4b8d36d6425bbbccc00c00fe41 \
  --select core/auth/provision/result \
  --output .history/v2/evidence/g5-application.json
```

The last run completed the 306-specification application, asserted zero application and analysis
diagnostics, pinned analysis inventory equality, proved cold/warm application identity equality,
proved zero warm changes and invalidated passes, and completed an authoritative focused selection.
It then wrote
`.history/v2/evidence/g5-application.json.diagnostic.json` because the 381,897.14 ms cold duration
exceeded the former absolute predicate. The artifact remains diagnostic-only and was not relabelled.

V2-REV-024 disposes that one explained predicate: unchanged whole-corpus cold samples ranged from
185,478.13 to 381,897.14 ms and were not causal performance evidence. Cold duration remains recorded
against the reference; the already-qualified isolated cold comparison and every interactive or
resource limit remain hard gates.

| Measurement | Result | Governed disposition |
|---|---:|---|
| Cold full application | 381,897.14 ms | recorded diagnostic reference |
| Warm full application | 1,429.33 ms | pass, maximum 20,000 ms |
| Focused selection | 923.94 ms | pass, maximum 12,000 ms |
| Affected private edit | 906.17 ms, 28.73x | pass, exact incremental/cold equality |
| Native startup | 328.88 ms | pass, maximum 3,000 ms |
| SQLite database | 345,833,472 bytes | pass, maximum 536,870,912 bytes |
| Peak Node process RSS | 2,935.41 MiB | pass, maximum 3,584 MiB |

The affected-shard qualification independently proves Codegraph private edits at 91.31x and Kernel
private edits at 28.73x with exact cold equality across adversarial public shape, import, ambient,
create/delete/rename, configuration, and uncertain-change fallbacks. Demand-driven projection is
also independently qualified; Gate 5 requests only `typescript.module`, not body/CFG/value facts.

## Lifecycle and performance corrections

- Specification qualification is batched: each pinned universe/capability view opens once for the
  whole corpus rather than once per specification.
- A no-change request recomputes inventory, then performs zero discovery, compilation, statistics,
  analysis, or qualification work when inventory and normalized request match.
- Different selections over an unchanged inventory reuse one immutable compiled corpus. Focused
  tests prove zero rediscovery, compilation, and statistics recomputation; a source edit invalidates
  the cache and publishes a different snapshot.
- Application identity composes exact component identities and compact corpus digests instead of
  constructing a repository-sized JSON hash preimage.
- Failed performance runs now write diagnostic-only measurements before throwing, so expensive
  evidence is preserved without becoming governed success.

## Consumer and deletion proof

The coordinated cut covers:

| Consumer | V2 boundary |
|---|---|
| CLI and CI | `cli/application.ts`, `cli/run.ts` |
| Server and watcher | `server/application.ts`, `server/live-plugin.ts`, `server/watch.ts` |
| Catalog and viewer | `server/application-catalog.ts`, `viewer-host/specification.ts` |
| Editing and reveal | `server/application-operations.ts`, `application/interaction/` |
| Qualification transport | `application/interaction/qualification.ts` |
| Repository reads/statistics | inventory-pinned `repository/source/` and `repository/statistics/` |

`node scripts/check-v1-removal.ts` reports zero diagnostics. It proves that retired top-level
`catalog`, `code`, `editing`, `profile`, `reveal`, and `verification` authorities and the duplicate
`specification/model.ts` and `typescript/model.ts` files are absent; runtime sources contain no
`LegacySpecification`, `manifest-v1`, or `SPEC.yml`; the old authoring package spelling occurs only
inside the inert parser allow-list; and the package/CLI identities are `@astrale-os/codegraph` and
`cg`. `node scripts/check-legacy-anchors.ts` separately reports zero tracked legacy anchors.

The temporary `@astrale-os/spec/authoring` source spelling is governed by V2-REV-024. It maps to one
canonical authoring-helper identity during downstream migration, but exports no package alias,
executes no repository code, and selects no legacy semantic implementation.

## Verification

| Command | Result |
|---|---|
| `pnpm run check` | 35 Codegraph specifications, 0 diagnostics |
| `pnpm run test` | 48 files, 361 tests passed |
| `pnpm run typecheck` | root, consumer, application, extension, experiment, and self-host projects passed |
| `node scripts/check-v2-governance.ts` | 95 requirements, 7 gates, 26 drift decisions, 0 diagnostics |
| `node scripts/check-legacy-anchors.ts` | 0 diagnostics |
| `node scripts/check-v1-removal.ts` | 0 diagnostics |

The package suite stages exactly the declared published files in a read-only package root and runs
the `cg` CLI plus server/viewer consumer from that installation. Native multi-platform artifact
publication and fully offline packed installation remain Gate 6 release evidence rather than a
second Gate 5 application authority.

## Rollback

Rollback is a source-control revert of the coordinated application cut followed by deletion of the
regenerable Codegraph cache. No runtime flag, converter, shadow write, or alternate persisted
authority is retained for rollback.

Gate 5 is complete. Gate 6 owns SDK-like extension qualification, Codegraph and Kernel self-hosting,
native release/package proof, and the final zero-V1/legacy audit.
