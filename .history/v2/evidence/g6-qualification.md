# Gate 6 extension and removal qualification

Status: complete

Date opened: 2026-08-15

Date completed: 2026-08-16

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

V2-REV-026 closes the evidence boundary by semantic and persistence class rather than by a Cartesian
product of projects and stores. The remaining nine repetitive Kernel SQLite projects and final cold
mirror were stopped at maintainer direction: every Kernel universe had already passed maximal memory
analysis and warm reuse, the richest real project had passed SQLite and reopen, Codegraph had passed
the complete memory/SQLite/reopen and relocated incremental/cold proof, and the generic store plus
affected-shard suites covered every distinct persistence and invalidation class. No unexplained
compiler diagnostic or suspicious-fact class is omitted by that disposition.

## Native release and packed-consumer proof

The supported native matrix completed on public Codegraph main at commit
`cc59d96e5997852fd081f5a4e934b829a70da41d` in GitHub Actions run
[`31901296422`](https://github.com/astrale-os/exp-codegraph/actions/runs/31901296422):

- native build and semantic/extension qualification passed on Linux x64, Linux arm64, Darwin x64,
  and Darwin arm64 native runners;
- assembly admitted one exact root manifest and four exact-version opaque artifact packages;
- every target installed the root and matching artifact tarballs offline with lifecycle scripts
  disabled, resolved the packaged binary, and executed the adversarial TypeScript analysis;
- the installed consumer contained no `ttsc`, `@ttsc`, Go source, Go module, source plugin, or
  compiler executable, while all four bounded value states and body/occurrence/module facts were
  observed through public package subpaths.

The root `native-release.json` pins package, protocol, compiler toolchain, target, package,
executable, byte length, and SHA-256 for every supported artifact. Windows remains deliberately
outside the supported matrix.

## Focused closure checks

- `pnpm run check`: 35 specifications, zero diagnostics.
- `pnpm run typecheck`: all package, test, application, extension, experiment, and self-host projects
  pass.
- Final candidate Vitest run: 49 files and 362 tests passed in the single-worker CI configuration;
  the physical-limit-forwarding and native distribution regressions are included.
- `scripts/check-v1-removal.ts`: zero diagnostics.
- `scripts/check-legacy-anchors.ts`: zero diagnostics.
- `native:assert-release` admitted exactly Darwin/Linux x64/arm64 artifacts, and GitHub Actions run
  `31901296422` built, packed, installed offline, and executed all four target combinations.
- `scripts/check-v1-removal.ts` and `scripts/check-legacy-anchors.ts` remain zero-diagnostic final
  authority scans.

All Gate 6 requirements are qualified. The V2 program is complete when the final candidate commit
passes the ordinary Codegraph CI check, typecheck, package suite, and governance verifier without
changing these semantic witnesses.
