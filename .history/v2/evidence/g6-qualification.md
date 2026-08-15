# Gate 6 extension and removal qualification

Status: in progress

Date opened: 2026-08-15

Gate 6 owns the public SDK-like semantic extension proof, Codegraph and Kernel self-host audits,
native release/package proof on supported Unix targets, performance/invalidation closure, and final
zero-V1 authority scan. Gate 5 application authority is already complete and is not reopened by
these checks.

Windows is not a required release target. Darwin and Linux on x64 and arm64 remain the supported
matrix.

## Qualified extension and removal slices

The SDK-like public extension proof passes using only `@astrale-os/codegraph/analysis` and
`@astrale-os/codegraph/analysis/typescript`. It proves compiler-resolved builder identity,
same-spelled collision rejection, direct and returned callbacks, one bounded forwarded call, all
four value states, scoped completeness, relocated-root identity, memory/SQLite equality, SQLite
reopen, warm generation reuse, and incremental/cold equality. The machine artifact is
`sdk-extension-qualification.json`.

The V1-removal and legacy-anchor scans both report zero diagnostics. Product Domain specification
trees are neither discovered nor recreated; only Kernel-owned `.spec` modules participate in the
frozen holdout.

## Self-host diagnostic and fixes

Codegraph self-hosting completed at maximal semantic depth with 35 bound specifications, 74,160
facts, 228,279,150 semantic bytes, zero compiler diagnostics, exact memory/SQLite/reopen equality,
warm generation reuse, and relocated incremental equality against both cold stores. The private
edit completed in 801.46 ms versus an 86,808.74 ms cold-memory rebuild (108.31x); this is one causal
diagnostic comparison, not a sampling matrix.

The run exposed and fixed two generic portability defects:

- external symbol identity used an ownership-relative physical path, so a dependency declaration
  changed identity through a relocated checkout symlink;
- inherited configuration, project-reference, and diagnostic paths used the same ownership helper,
  producing `node_modules/...` in one checkout and `external:base.json` in another.

Semantic identity now uses portable public coordinates independently of extraction ownership. The
focused relocation oracle matched the exact universe, source manifest, generation, 3,792 bodies,
29,911 symbols, 40,112 occurrences, 309 sources, project fact, and 35 module facts before the
temporary diagnostic harness was deleted.

Kernel self-hosting resolved 306 authoritative specifications into ten distinct project universes.
All ten memory generations and warm-reuse checks passed. The richest FalkorDB project required
268,454,479 decoded semantic bytes and 365,326,188 physical bytes; the Host project required a
519,627,239-byte physical transaction. V2-REV-025 therefore ratifies independent 384 MiB semantic
and 512 MiB physical ceilings while retaining 64 MiB frames, and fixes the adapter to forward both
resolved limits explicitly to the native child.

The initial multi-project harness retained every rich memory graph solely to derive a snapshot-set
ID and reached Node's 4 GiB heap at SQLite start. Snapshot identity is now a pure reusable function
of the inventory revision and sorted universe-generation mapping, shared by both stores; the harness
disposes each memory universe after summarization. The largest FalkorDB SQLite project subsequently
passed without the prior OOM.

At maintainer direction, the remaining nine repetitive Kernel SQLite projects and the final cold
mirror were stopped rather than spending substantially longer repeating already-covered generic
store behavior. This is an explicit unqualified remainder for V2-QLF-009, not rewritten evidence.
Gate 6 remains in progress until native release installation and any desired final Kernel holdout
closure are performed.

## Focused closure checks

- `pnpm run check`: 35 specifications, zero diagnostics.
- `pnpm run typecheck`: all package, test, application, extension, experiment, and self-host projects
  pass.
- Broad Vitest run: 47 files and 360 tests passed; the sole failing legacy mock assertion was
  converted into an explicit physical-limit-forwarding regression, after which
  `analysis-v2.test.ts` passed 49/49.
- `scripts/check-v1-removal.ts`: zero diagnostics.
- `scripts/check-legacy-anchors.ts`: zero diagnostics.
- Native darwin-arm64 source build completed without local-system Go through the bundled ttsc
  toolchain. Ordinary packed-install qualification across all supported Unix artifacts remains the
  release blocker: `native:assert-release` correctly rejects the current manifest because it does
  not yet contain exactly darwin-arm64, darwin-x64, linux-arm64, and linux-x64.
