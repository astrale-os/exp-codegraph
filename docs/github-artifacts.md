# Native qualification artifacts

GitHub Actions remains the build and qualification transport for Codegraph's exact native release.
The proposed public distribution is documented in [npm distribution](npm-distribution.md); its
approval is still pending. The former GitHub-only policy is explicitly replaced by that proposal.

`native-release.yml` builds Linux and macOS x64/arm64 plus Windows x64 from one source revision,
qualifies their semantics, assembles the immutable release manifest and uploads six tarballs as
`codegraph-release`. It retains read-only permissions and never publishes to a registry.

The packed consumer installs the complete tarball cohort in an isolated project, with no workspace
links or source compiler installation. This proves the artifact independently of the source tree.
A local SDK qualification may consume these exact archives, but it is not npm distribution proof.
The manually activated publisher consumes those same successful main artifacts without rebuilding.

## Install in an existing project

Choose a successful `native-release.yml` run on `main` at the revision you want to inspect.
Download its qualified cohort, then install the six archives together in your project:

```sh
gh run download <run-id> --repo astrale-os/exp-codegraph \
  --name codegraph-release --dir .codegraph-release
pnpm add ./.codegraph-release/*.tgz
pnpm exec cg --version
```

Keep all archives from the same run. The root package selects the native executable for the
current platform; consumers do not build Go or Rust themselves. Registry publication remains
a separate, manually activated step. [Inspect a project](../README.md#inspect-a-project).
