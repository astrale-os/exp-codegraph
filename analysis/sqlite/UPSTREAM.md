# Selective Codegraph provenance

The TypeSpec SQLite materializer is owned by TypeSpec and has no runtime dependency on
`@optave/codegraph`. Its semantic schema, immutable generations, portable identities, fact
envelopes, provenance, completeness, and query contract were designed independently for TypeSpec
V2.

A source-level evaluation of `@optave/codegraph` 3.16.0 at revision
`11475e7c0f36fd3fcb482dd3ea65f6d5845049b3` informed several operational choices:

- normalized SQLite tables with compound query indexes;
- WAL mode and bounded writer waiting;
- content hashing as the final authority after metadata triage;
- explicit purge-oriented delete and rename qualification;
- parameter-bound filter construction and bounded pagination; and
- adversarial incremental-versus-cold comparison after repository churn.

No Codegraph parser, graph ontology, mutable-current lifecycle, line/database identity, change
journal, or mirrored native/WASM implementation is included. No source file is copied verbatim.
The reuse class is therefore **conceptual influence**: TypeSpec owns the implementation and does
not promise Codegraph schema, API, or behavioral compatibility.

If future work copies or adapts implementation text, the changed file must carry a prominent
modification notice and the distribution must preserve the upstream Apache License 2.0 and
applicable attribution. Such reuse is limited to small mechanism-level units. A copied subsystem,
compatibility layer, or recurring synchronization obligation must be treated as a fork and return
to architectural review.

Upstream: https://github.com/optave/ops-codegraph-tool

License: Apache-2.0, Copyright 2026 Optave AI Solutions Inc.
