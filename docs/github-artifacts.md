# Native qualification artifacts

GitHub Actions remains the build and qualification transport for Codegraph's exact native release.
Published versions are installed from npm, as documented in [npm distribution](npm-distribution.md).
This page covers the qualification transport and how to install a revision that is not published.

`native-release.yml` builds macOS arm64/x64, Linux arm64/x64 and Windows x64 from one source revision, qualifies their
semantics, assembles the immutable release manifest and uploads one tarball as
`codegraph-release`. Native executables and viewer assets are qualified separately as
`codegraph-assets`, then published to a source-bound GitHub prerelease before packed consumers run.
Only that asset job receives Contents write; npm publication remains a separate manual main action.

The captured Oxlint worker is an additional capability on macOS arm64 and Linux x64. The other
hosts qualify the Go analyzer and explicit worker unavailability after package installation.

The packed consumer installs that tarball in an isolated project, with no workspace links or
source compiler installation. This proves the artifact independently of the source tree.
A local SDK qualification may consume this exact archive, but it is not npm distribution proof.
The manually activated publisher consumes that same successful main artifact without rebuilding.

## Install an unpublished revision

Choose a successful `native-release.yml` run on `main` at the revision you want to inspect.
Download its qualified archive, then install it in your project:

```sh
gh run download <run-id> --repo astrale-os/exp-codegraph \
  --name codegraph-release --dir .codegraph-release
pnpm add ./.codegraph-release/*.tgz
pnpm exec cg --version
pnpm exec cg preload --viewer
```

The package selects the native executable for the current platform; consumers do not build Go or
Rust themselves. Registry publication remains a separate, manually activated step.
[Inspect a project](../README.md#inspect-a-project).
