# GitHub artifact distribution

Codegraph is a GitHub-distributed tool. It is not published to npm or GitHub Packages. The root
manifest and the four platform manifests are marked `private`, omit `publishConfig`, and exist as
packing units for one qualified GitHub Actions artifact:

1. `@astrale-os/codegraph`
2. `@astrale-os/codegraph-native-darwin-arm64`
3. `@astrale-os/codegraph-native-darwin-x64`
4. `@astrale-os/codegraph-native-linux-arm64`
5. `@astrale-os/codegraph-native-linux-x64`

They share one version and one source revision. Their package names are internal coordinates inside
the artifact, not public registry coordinates.

## Qualification flow

`.github/workflows/native-release.yml` is a qualification workflow despite the historical filename.
On a pull request, a push to `main`, or a manual dispatch it:

1. checks out one exact Git revision with read-only permissions and without persisted credentials,
   using the Config setup action pinned to merged revision
   `9bffee57d53b603b556bb545145fdde10f20a4c5`;
2. builds and qualifies each of the four native targets;
3. assembles manifests that bind every executable to that source revision;
4. packs the root and all four native units into five tarballs;
5. uploads those tarballs as the `codegraph-release` GitHub Actions artifact; and
6. downloads that artifact on every target, installs the complete five-tarball cohort in an
   isolated temporary project, and executes a real analysis with the matching native package.

The isolated consumer disables workspace links and strips registry and GitHub credentials from its
environment. Its lock may reference only the five downloaded artifact tarballs plus ordinary public
third-party dependencies. This proves the GitHub artifact is self-consistent without treating a
linked checkout as distribution evidence.

## Consumption

Consumers pin the Codegraph source revision in GitHub and use the `codegraph-release` artifact from
the successful native qualification run for that same revision. They install the complete artifact
cohort; Codegraph then selects the native package matching the current platform. A source revision
and artifact from different runs must never be mixed.

GitHub Actions artifacts are authenticated GitHub objects with retention controlled by repository
settings. They are not npm releases, GitHub Package releases, Git tags, or GitHub Releases. A push or
merge to `main` may refresh qualification evidence, but it never writes to a package registry and
never creates a release.

## Dependency policy

The source workspace links the four owned native units for development. It also applies the strict
seven-day minimum release age to direct and transitive third-party dependencies. Only reviewed
Astrale package patterns and the exact `bun-types@1.4.0` compatibility exception bypass that age.
Those installation exceptions do not authorize registry publication.
