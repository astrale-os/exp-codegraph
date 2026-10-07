# Codegraph-owned Oxlint worker

`codegraph-oxlint` is the maintained captured-input worker built from Oxc's
`oxc_linter` crate at Oxlint 1.81.0. It is not the ordinary `apps/oxlint` CLI.
Cargo builds the `captured` example; packaging copies that executable to the
stable `bin/codegraph-oxlint` name without changing its default entry point.
The worker reads NDJSON on stdin and emits its authenticated discovery/lint
continuations on stdout. The existing Go owner remains responsible for physical
observation, capture identity, artifact lifetime, fresh checks and publication.

## Source and build authority

`native-source.json` pins Oxc commit
`0b4e2e67f4193e7ebfcc64982275eb583ae82c83` (the preserved
`oxlint_v1.81.0` checkout), Rust 1.98.0, the exact post-patch Cargo.lock,
and one cumulative maintained patch. Before applying that patch, the builder
must download and authenticate the public `ignore` 0.4.33 crate, then unpack
its `ignore-0.4.33/` root into `vendor/ignore`. Its archive SHA-256 is
`00b69833ed729dc5aa7d19541d96d6cf8e9137194207a04916d658e43168402f`.
That crate's preserved upstream revision is
`3fce3b5bb0236da2df6d99672afb8a719642eca7`, `crates/ignore`, in ripgrep.
The cumulative patch contains only the Oxc changes and changes to that public
crate; it does not duplicate the unchanged vendor source.

The Cargo target is `--package oxc_linter --example captured`. Before every
delivered worker build, the builder unconditionally runs the captured example's
14 unit tests and the capture authority's 5 discovery integration tests:
`cargo +1.98.0 test --package oxc_linter --example captured` and
`cargo +1.98.0 test --package oxlint-capture-authority`. Both commands and the
subsequent build use `--locked --release --jobs 4 --target <native-triple>`,
the same authenticated source checkout, environment and Cargo cache. The
authority is a member of the same workspace and uses its sole lockfile; no
`--lib` selection or test filter omits its integration tests. A failed test
process prevents delivery. Test output goes to stderr, preserving the builder's
JSON stdout. Reusing the release profile avoids a second debug dependency tree.
Build/distribution scripts
own the platform descriptors and the newly built executable's actual digest.
No Windows worker capability is advertised by this initial source recipe.

## Preserved-source provenance

The patch's postimages derive from the authenticated
`review/fd6-source-provenance-D-v1/pristine-frozen-overlays` snapshot in the
approved source archive of the private SDK preservation release 405228328.
The archive SHA-256 is
`67e96ccaece8921aabf1c4d5cd8141b0cefe6da7538bd5d726e9059a683d0532`.
The exact postimage checks are recorded beside the patch. Five excluded vendor
metadata/license/test-fixture files were recovered byte-for-byte from the
pinned public crate. The historical `.cargo-ok` cache marker is not source
and is intentionally omitted. The older 1.81 worker and rejected journal-delta
prototypes are not included. The maintained integration replaces the stale
standalone capture-authority workspace/lock with the single Oxc workspace lock;
worker and physical-observation source bodies are unchanged.

The historical fd6 receipt explicitly recorded incomplete artifact ownership
provenance. This recipe therefore defines a **new maintained build**, not a
reproduction claim for the historical fd6 executable. Every newly built worker
needs fresh protocol/capture tests and comparison with the genuine stock
Oxlint 1.81.0 engine before qualification. Source preservation alone is not a
build, semantic-equivalence, cross-platform or publication result.

## Licenses

Oxc is MIT licensed, copyright VoidZero Inc. & Contributors and Boshen; retain
its root `LICENSE` text in the distribution. The vendored `ignore` crate is dual
licensed `Unlicense OR MIT`; retain its `COPYING`, `UNLICENSE` and `LICENSE-MIT`
texts. These four complete texts are included in the existing root
`THIRD_PARTY_NOTICES.md`, which native package assembly copies verbatim.
The same notice file also includes the conservative normal/build dependency
union for the four UNIX worker targets, the captured example's runtime-used
dependency roots, and the pinned Rust standard-library distribution's copyright
notices. Repeated license texts are listed once with their component references.
This notice census is not a claim that every build dependency is linked into
the delivered executable; it does not include the unrelated Oxc workspace.
Refresh these notices when the pinned Rust toolchain, source recipe or dependency
lock changes.
The local worker and capture-authority additions are maintained here rather
than pushed to either upstream repository. Third-party origin refs are source
provenance, not publication destinations.
