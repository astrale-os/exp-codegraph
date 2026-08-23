# Command-line ownership

The CLI owns argument normalization, operating-system process behavior, terminal output, exit status,
and restart checkpoints. The application remains the canonical producer of a check result; the CLI
may replay that result only after exact executable, request, repository, and source admission.

Workspace-local replay is inventory-keyed. A portable semantic check pack is additionally keyed by
the Git-backed SourceProof, producer fingerprint, request, and repository, so a relocated clean
checkout can admit the same canonical transcript before a complete inventory scan.

A canonical whole-check publication also emits a family-keyed catalog shard containing the exact
owner/dependency closure, specification diagnostics, shared diagnostics, and specification-scoped
qualification decisions. A different selected request may consume that shard only by applying the
canonical selection projection under the same SourceProof, producer, repository, exclusion, layout,
and output family. Exact-request output remains a separate shard and always has precedence. The
portable result and catalog shards become visible through one family-keyed atomic manifest; a
reader first admits only that manifest and then reads and digest-checks exactly the result or catalog
shard required by its request. Missing or corrupt evidence rejects its requested closure without
forcing unrelated artifact reads.

The same root may commit to the application-owned sharded corpus manifest. If a compact shard
misses, the CLI passes that exact reference to the Node application adapter; a read-only consumer
may restore the corpus and re-project the request without compiling or writing the supplied pack.

CI keeps ordinary mutable caching disabled. It may consume a supplied read-only semantic-pack store
through `ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR`; a miss or invalid pack runs the uncached canonical
command and never writes into the supplied store.

Checkpoint absence, corruption, version drift, or identity uncertainty is an advisory miss. It must
run the canonical application command and must never manufacture success, suppress a diagnostic, or
change the byte-ordered stdout/stderr transcript.

Every proof, checkpoint, catalog, and semantic-pack hit, miss, fallback, publication, and failure is
retained in a structured non-semantic acceleration receipt. The receipt is available to
qualification and debugging without changing the terminal transcript or exit status; advisory
publication failure is never silently discarded.

Ordinary `cg check` requests only capabilities that contribute to its canonical diagnostics and
result. Repository statistics remain an explicit application capability for viewer and reporting
consumers and are not computed as hidden check work.
