# Structural inspection checkpoint — 2026-10-08

Base: `563609343df5f4a95fc15a21d63ea57f6841f093` (main).
Branch: `feat/structural-inspection-20261008`.

The public consumer answers API-reference and file-dependency questions with no
specification or body extraction. It consumes only Codegraph's public reader;
the independent TypeScript compiler is qualification infrastructure.

| Gate | Result |
| --- | --- |
| Complete package suite | 130 files, 1,092 tests passed, 1 skipped |
| Final structural integration | 7 tests passed, including a declaration-relocation case added after the complete gate |
| Cache, storage and existing computation gates | 7 suites, 67 tests passed |
| Complete Go suite | 417 top-level tests passed; 1,691 including subtests; 25 skipped; 0 failures |
| Compiler and public typechecks | All repository configurations passed; structural tests included |
| Architecture and governance | 45 specifications and all governance/legacy scans passed |
| Fixture compiler oracle | Exact agreement: 9 API-reference tokens, 14 module-request edges |
| Copied Domains compiler oracle | Exact agreement: 1 API-reference token, 1 module-request edge |
| Repeated edits | 24 edits checked against the oracle, 24 cache hits, deletion equal to a cold project, original pin preserved |
| Isolated packed consumer | Public declarations and JavaScript runtime passed, including tracked absence, old pins and cold equality |
| Local retention probes | Queries collected while released leases and expired structural/semantic readers were still retained; disposed public snapshot also collected |

Specialized owned-worker, original-runtime and probe Go fixtures were skipped;
the unchanged Rust worker lane was not rebuilt or qualified by this checkpoint.

## Exact local artifacts

```text
native source plugin SHA256:
5c58b7b1fda5e9296bee6ed40fff58315a502e03fdd739d93045e6a1f3c939f2

packed root package SHA256:
13892619547910a45a91aee8f2a9bf0c2fd3239bfcdb29d92151a14f883549a8

copied Domains inputs (services/utils/http-readiness):
accept.ts 75602572ec5aa5e7eccb7912f75b92fbf73818c314eff5ea73690eebc442944f
index.ts  7a6de9374e23fb38c3bc23c9864818f0aaf289209a5081c1e567d8978d942f32
```

The packed proof links ordinary offline dependencies and uses the explicit
candidate native binary. It qualifies this API, not a six-target release or
publication. Local receipts, raw inventories and observational RSS samples are
under `.cache/structural-evidence/`. Commands are in [README.md](README.md).

Toolchain: Node 26.8.1, TypeScript 6.0.3, tsgo 7.0.0-dev.20260707.2,
ttsc 0.25.0, Vitest 4.1.10, Vite 8.2.1. Local Vitest uses a temporary config
with automatic Preact JSX and `oxc.tsconfig: false` because the shared dependency
symlink prevents OXC resolving the JSR configuration. Normal repository
typechecking is unchanged and passes.

## Architecture and limits

One opt-in compiler inventory per owned source feeds persistent per-source
postings. Updates replace affected contributions; the owner retains the current
graph and explicit reader leases. Structural and value reports share the
existing 8 MiB result/proof budget. Released readers detach their loaders and
invocation contexts. Scope-wide and origin queries still examine project
metadata; dependent routes can have quadratic output size on a long chain.

The source implementation adds roughly 1,020 production lines, plus contracts,
tests and generated distribution files. This is a new inspection capability;
no performance multiplier or code-size reduction is claimed. RSS observations
cover a small corpus and include the independent oracle.

The inventory excludes `.d.ts` and external source enumeration. References are
authored symbolic tokens; implicit star re-exports use exports and dependencies.
Missing requested sources stay unavailable, unattributed provider uncertainty
stays visible, and loose external coordinates never produce ambiguous matches.

Next qualification work: broader read-only real-project corpora, declaration-file
inventory/ownership, and consumer-driven origin indexing if it proves useful.
