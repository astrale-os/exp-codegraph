# TypeSpec V2 Gate 0 baseline

Status: qualified

Base revision: `81553c4b334ac16e4837439a6a2be0daf849b7ed`

Date: 2026-08-13

## Current-base evidence before Gate 0 hygiene

- `pnpm --dir spec typecheck` passed.
- A cold `pnpm spec:check --quiet` reported twelve `API_ISOLATION_ISOLATION_TIMEOUT`
  diagnostics and two exact-layout diagnostics. A warm rerun removed the compiler timeouts and
  retained the two layout diagnostics.
- The layout diagnostics came from tracked `shell/core/user/.spec/icon.svg`, added after the Shell
  module it represented was deleted.
- `pnpm --dir spec test` passed 59 of 60 files and 525 of 526 tests. The sole failure was
  `spec/__tests__/test-file.test.ts`, which still invoked the deleted
  `shell/core/user/__tests__/identity.test.ts` path.
- 593 tracked files directly import `@astrale-os/spec/authoring`: 575 within `.spec` and 18 other
  implementation/test consumers.
- 303 active textual occurrences of `manifest-v1`, `LegacySpecification`, or `SPEC.yml` remain
  under `spec/` outside temporal history.
- The TypeSpec project contains 309 tracked TypeScript/TSX files.

The two Shell findings are pre-existing current-base defects, not V2 parity differences. Gate 0
repairs them before freezing the green V1 oracle. Compiler cold-start timeouts remain performance
evidence and are not erased by a successful warm run.

## Gate 0 hygiene

- Remove the orphaned Shell icon and empty deleted-module path.
- Retarget the focused workspace-runner test to a current Shell-owned test without weakening its
  package-routing assertion.

## Frozen artifacts

- `evidence/v1-oracle.json` now freezes normalized catalog and viewer transport digests, CLI parse
  contracts, protocol versions, public package exports, all 593 tracked authoring consumers, the
  complete active legacy inventory, and per-spec verification profile/rule/coverage summaries.
- The oracle is content-addressed and bounded below 2 MiB; repeated dependency sets are represented
  by exact digest and count rather than copied source paths.
- Full verification currently records 158 pass, 105 fail, 6 idle, and 6 error specifications. The
  `shell/.spec/api.d.ts` error is environmental: current Shell requires unpublished
  `@astrale-os/sdk >=0.4.20`, while the package registry currently exposes 0.4.19. It is not
  normalized into a false pass.
- `evidence/v1-cli.json` freezes help and usage errors, focused and empty selection behavior,
  focused verification diagnostics, process exit status, and focused evidence execution.
- `evidence/v1-performance.json` freezes focused no-cache, full no-cache, isolated cold/warm cache,
  and warm watcher-readiness workloads on Node 24 with the CI heap cap.
- The full cold check took 72.12 seconds and reached 1,885,224,960 bytes RSS. Its one opaque cache
  file occupied 21,752 KiB. The warm check took 15.54 seconds but still reached 1,342,734,336 bytes
  RSS. Warm watcher readiness took 13.502 seconds and reached 1,373,077,504 bytes RSS.
- `v1-oracle.json` is the tracked legacy/V1 symbol, path, consumer, profile, diagnostic, and transport
  inventory used by the final negative gate.
- Regeneration exposed and corrected one flaw in the initial freeze: verified transport digests had
  included volatile `durationMs` values. The corrected artifact changes only the 275 verified spec
  digests and their aggregate index/module digests; catalog semantics, verification summaries,
  unverified transports, and all 339 source payloads remain identical.
- A second regeneration exposed insertion-order-sensitive hashing in the same initial freeze even
  after duration normalization. The transport's own `revision` and aggregate `generation` also
  transitively encoded that volatile duration before normalization. Gate 0 therefore canonicalizes
  object keys recursively and recomputes derived envelope revisions from normalized content before
  hashing. Digests represent normalized values rather than runtime or JavaScript construction order.
- `drift.tsv` is the initially empty, machine-readable ledger for every proposed or accepted V1/V2
  difference. The V1 oracle is observational rather than normative: unexplained drift fails, while
  genuine V1 defects are specified and regression-tested instead of reproduced.

This file distinguishes observed baseline from its frozen evidence. The independent oracle
regeneration and complete TypeSpec qualification suite passed; the attributable exit record is
`evidence/g0-qualification.md`.
