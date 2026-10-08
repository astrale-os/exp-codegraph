# npm distribution

Codegraph is distributed as one public npm package, `@astrale-os/codegraph`. This replaces the
GitHub-only policy introduced by [d51572d](https://github.com/astrale-os/exp-codegraph/commit/d51572dae7b110e9c3293751655731499a01d2c0),
whose contract said the packages “are not published to npm or GitHub Packages”, and the earlier
proposal of one root package plus five platform packages. No version is published yet. Opening a
PR or running qualification does not publish anything; `publish.yml` has only a manual trigger.

The reason for npm distribution is the SDK's npm-only dependency closure. A public SDK package
cannot resolve a private GitHub Actions artifact using an ordinary exact npm dependency. Workspace
links, local archives and rewritten registry URLs cannot establish that public dependency closure.

## One package, two native targets

The package carries its native executables in `native-artifacts/<target>/bin/`:

- `darwin-arm64`: macOS on Apple silicon
- `linux-x64`: Linux on x64

npm selects by platform only between packages, so one package delivers both targets to every
install: 37 MB packed and 85 MB installed, measured on the artifacts of main revision `1db5927`,
against about 19 MB and 45 MB for one target. That cost buys one name to publish, one Trusted
Publisher and one exact dependency for consumers.

macOS x64, Linux arm64 and Windows are not delivered. The package still installs there; packaged
native analysis fails closed with `NATIVE_TARGET_UNSUPPORTED`. Adding a POSIX target means adding
it to the target tables, the declared executable files and both workflow matrices. Windows also
needs its `.exe` names and its worker ineligibility restored.

Consumers install only `@astrale-os/codegraph@VERSION` and never build Go or Rust. Runtime
admission checks the selected executable against the release manifest of the installed package.

Each target delivers `bin/codegraph-native` and `bin/codegraph-oxlint`, the latter built from the
pinned Oxlint 1.81.0 source recipe and maintained patch. Rust is a build input; consumers do not
install a Rust toolchain. The worker descriptor records its actual bytes, SHA-256, engine/protocol
versions and source pins, and the Go executable binds that same identity at build time. Both
executables are qualified after installation with lifecycle, capture, stale-publication and repair
controls.

The worker is a separate capability admitted by `resolvePackagedNativeOxlint`. Its absence or
corruption does not invalidate `resolvePackagedNativeAnalysis`, which allows consumers to recover
through their original analyzer. Linux worker builds target GNU libc; worker distribution does not
admit a consumer's original Oxlint bindings, presets or domain rule implementations.

`pnpm pack` marks only `bin` entries and the files declared in `publishConfig.executableFiles` as
executable, so the four native executables are declared there and the release validator rejects an
undeclared one.

## One qualified release

The existing native workflow builds on both targets and qualifies the installed archive on
Node 22.13, 22, 24 and 26. Its `codegraph-release` artifact contains the one tarball. The manual
publisher requires a successful main run of that exact workflow at the exact selected source SHA.
It checks the archive manifest, each native executable's SHA-256, that the archive delivers no
other native file, and the tarball's SHA-512. An existing npm version must already have identical
archive integrity before publication can resume.

Config's existing pinned `publish/packages` action receives the admitted `tarballs-json` mapping.
It derives the npm channel from the version and verifies visibility. It never repacks or
recompiles this release. No GitHub Packages mirror, release automation framework, release tag
creation or token fallback is introduced.

After publication, the immutable npm archive integrity is checked again. The existing consumer
then installs only the exact version from npm, rejects local/GitHub/alternate-registry lock
sources, checks the source revision, executes the native analyzer, and exercises resident facts,
bounded values, edits, no-ops and an old pinned reader.

## Activation and first publication

The package name returned HTTP 404 from npm's public registry on 2026-10-08. No package, Trusted
Publisher, secret or repository setting was created.

npm attaches a Trusted Publisher only to a package that already exists, so the first version is an
owner operation: a package owner publishes the qualified archive of a successful main run, then
configures Trusted Publishing for the package. The GitHub coordinates are organization
`astrale-os`, repository `exp-codegraph`, workflow filename `publish.yml`. Config uses direct
`npm publish`, so that action must be allowed by the Trusted Publisher. The workflow runs on a
GitHub-hosted runner and requests OIDC permission only in its publication job. See the official
[npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/).
The workflow does not manufacture a placeholder publication or fall back to credentials when trust
is unavailable.

Once those prerequisites and the complete main qualification are satisfied, an authorized owner
can manually select the exact main SHA and native workflow run. A push or merge alone never
triggers publication. The workflow's outputs and npm consumer must pass before downstream
manifests are switched to the exact registry version.

## Honest integration before activation

A temporary SDK or Kernel checkout can install the genuine qualified `.tgz` file and run its own
loop. Its local `file:` lock is artifact evidence and stays local. A release manifest and npm-only
lock must be generated against an actually published Codegraph version. Do not replace archive
lock entries with invented npm URLs or integrities. Until the package exists and the npm consumer
passes, a registry dependency change remains a draft dependency.
