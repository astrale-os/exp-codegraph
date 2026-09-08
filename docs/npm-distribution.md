# Proposed npm distribution

Approval of the distribution change is still pending. This proposal replaces the GitHub-only
policy introduced by [d51572d](https://github.com/astrale-os/exp-codegraph/commit/d51572dae7b110e9c3293751655731499a01d2c0),
whose contract said the packages “are not published to npm or GitHub Packages”. It changes the
six package manifests from private packing units to public npm packages. Opening the draft PR
or running qualification does not publish anything; `publish.yml` has only a manual trigger.

The reason for the change is the SDK's npm-only dependency closure. A public SDK package cannot
resolve a private GitHub Actions artifact using an ordinary exact npm dependency. Workspace links,
local archives and rewritten registry URLs cannot establish that public dependency closure.

## One qualified release

The root `@astrale-os/codegraph` package and these opaque native packages share one version:

- `@astrale-os/codegraph-native-darwin-arm64`
- `@astrale-os/codegraph-native-darwin-x64`
- `@astrale-os/codegraph-native-linux-arm64`
- `@astrale-os/codegraph-native-linux-x64`
- `@astrale-os/codegraph-native-win32-x64`

Source manifests retain owned `workspace:*` edges. Packing rewrites them to the exact root version;
the release validator rejects local or ranged native dependencies inside the root archive.
Consumers install only `@astrale-os/codegraph@VERSION`; the package manager selects the matching
optional native package. Runtime admission still checks that binary against the release manifest.

The existing native workflow builds on every target and qualifies the installed archives on
Node 22.13, 22, 24 and 26. Its `codegraph-release` artifact contains the six tarballs. The manual
publisher requires a successful main run of that exact workflow at the exact selected source SHA.
It checks the archive manifests, each native executable's SHA-256, and each tarball's SHA-512.
An existing npm version must already have identical archive integrity before publication can resume.

Config's existing pinned `publish/packages` action receives the admitted `tarballs-json` mapping.
It publishes the five native packages before the root, derives the npm channel from the version,
and verifies visibility. It never repacks or recompiles this release. No GitHub Packages mirror,
release automation framework, release tag creation or token fallback is introduced.

After publication, all six immutable npm archive integrities are checked again. The existing
consumer then installs only the exact root version from npm, rejects local/GitHub/alternate-registry
lock sources, checks the source revision, executes the native analyzer, and exercises resident
facts, bounded values, edits, no-ops and an old pinned reader.

## Activation and first publication

The six package names returned HTTP 404 from npm's public registry during this proposal's audit
on 2026-09-08. No package, Trusted Publisher, secret or repository setting was created.

After the distribution decision is accepted, a package owner must establish npm ownership and
Trusted Publishing for each package. The GitHub coordinates are organization `astrale-os`,
repository `exp-codegraph`, workflow filename `publish.yml`. Config uses direct `npm publish`,
so that action must be allowed by the Trusted Publisher. The workflow runs on a GitHub-hosted
runner and requests OIDC permission only in its publication job. See the official
[npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/).
First-package setup is an owner operation; this workflow does not manufacture a placeholder
publication or fall back to credentials when trust is unavailable.

Once those prerequisites and the complete main qualification are satisfied, an authorized owner
can manually select the exact main SHA and native workflow run. A push or merge alone never
triggers publication. The workflow's outputs and npm consumer must pass before downstream SDK
manifests are switched to the exact registry version.

## Honest SDK integration before activation

A temporary SDK checkout can install the six genuine qualified `.tgz` files and run its packed
scaffold/linter loop. Its local `file:` lock is artifact evidence and stays local. The SDK release
manifest and npm-only lock must be generated against an actually published Codegraph version.
Do not replace archive lock entries with invented npm URLs or integrities. Until the six packages
exist and the npm consumer passes, the SDK registry dependency change remains a draft dependency.
