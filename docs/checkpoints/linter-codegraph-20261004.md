# Linter / Codegraph checkpoint — 2026-10-04

This branch preserves the retained local implementation. It is a source checkpoint; it is not an npm release or a merge into main.

SDK baseline: cad2f224ddcb4ff5137231584fc25208d28611fc. Codegraph baseline: f35484f143ca31ad6f2b4c4a9d93a4fffbbd890a. Those references are fixed; later intermediate versions are not new baselines.

Selected composition: SDK076c221 plus the seven qualified admitted-source files; Codegraph97f7b122 plus the formatted canonical program-syntax implementation and verified dead-verifier / aggregate-emitter cleanup. Diagnostics, watcher experiments, JSON replacement and demand-closure prototypes remain separate.

The latest cleanup removes135 maintained lines (155 production removed,20 test lines added). Cumulative gains and remaining limits are recorded in the final validation manifest. The greater-than10x cold/edited latency and10000-line retirement targets are still open; they are not release claims.

Reproduction uses each repository's checked-in packageManager and frozen lockfile, Node26.7.0 and the bundled Go toolchain. Install/build Codegraph first. For local paired validation only, SDK node_modules/@astrale-os/codegraph must resolve to this Codegraph checkpoint; the SDK manifest currently lacks that published dependency. Native packaging must bind the rebuilt CLI and its required owned Oxlint executable. Do not reuse stale native-release checksums.

Before public release: integrate current upstream in isolated branches and rerun package suites, declare the published SDK/Codegraph dependency cohort, qualify native artifacts and Rust ownership on every supported target, and qualify default/custom/fix behavior on all12 domains.

Original1Pact is not changed. Experimental evidence and source archives remain local; generated caches may be retired after their source and result records are preserved.
