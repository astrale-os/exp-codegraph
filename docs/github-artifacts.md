# Native qualification artifacts

GitHub Actions remains the build and qualification transport for Codegraph's exact native release.
The public distribution is documented in [npm distribution](npm-distribution.md); no version is
published yet. The former GitHub-only policy is explicitly replaced by that distribution.

`native-release.yml` builds macOS arm64 and Linux x64 from one source revision, qualifies their
semantics, assembles the immutable release manifest and uploads one tarball as
`codegraph-release`. It retains read-only permissions and never publishes to a registry.

The packed consumer installs that tarball in an isolated project, with no workspace links or
source compiler installation. This proves the artifact independently of the source tree.
A local SDK qualification may consume this exact archive, but it is not npm distribution proof.
The manually activated publisher consumes that same successful main artifact without rebuilding.

## Install in an existing project

Choose a successful `native-release.yml` run on `main` at the revision you want to inspect.
Download its qualified archive, then install it in your project:

```sh
gh run download <run-id> --repo astrale-os/exp-codegraph \
  --name codegraph-release --dir .codegraph-release
pnpm add ./.codegraph-release/*.tgz
pnpm exec cg --version
```

The package selects the native executable for the current platform; consumers do not build Go or
Rust themselves. Registry publication remains a separate, manually activated step.
[Inspect a project](../README.md#inspect-a-project).
