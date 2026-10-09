# npm distribution

```sh
pnpm add @astrale-os/codegraph
```

One public package contains JavaScript, declarations, the local server and small release manifests.
It contains no native executables or prebuilt viewer assets. Installation and ordinary imports do
not download them, run an installation script or require Go/Rust toolchains.

## Download only what you use

| First use | Download |
| --- | --- |
| Native TypeScript analysis | Go analyzer for the current host |
| Captured generic linting | Rust worker, when that host supports it |
| `cg dev . --open` | Viewer archive |

Downloads come from this repository's GitHub Releases, under
`codegraph-v<package-version>-<source-revision>`. Each npm manifest pins the exact source revision,
encoded and original byte lengths and SHA-256 digests. Both forms are verified before an atomic
cache publication. A valid cache works offline; a corrupt entry is repaired on the next use.
The package directory can stay read-only. No mutable `latest` URL or platform npm package is used.

The Go analyzer supports macOS arm64/x64, Linux arm64/x64 and Windows x64. The Rust worker is a
separate capability on macOS arm64 and Linux x64, using GNU libc on Linux. Other hosts return
`NATIVE_OXLINT_UNAVAILABLE` for that capability; their Go analyzer remains available. The worker
pins Oxlint 1.81.0 and its protocol/source identity. A consumer's own engine, presets and domain
rule implementations are separate admission inputs.

The viewer is served from its verified archive. Headless analysis does not fetch or open it.
Running from the source checkout continues to use the local Vite viewer.

## Prepare an offline environment

```sh
pnpm exec cg preload                     # Current host's Go analyzer
pnpm exec cg preload --generic           # Also its supported Rust worker
pnpm exec cg preload --viewer            # Also the viewer
pnpm exec cg preload --generic --viewer  # Go + Rust + viewer on a host supporting the worker
```

Run preload with the same user/cache as the later process. Preserve that cache in an offline image
or CI cache; no network is needed for already admitted components. An empty cache needs network
access to the pinned release. A failed or cancelled download never becomes a valid cache entry.

```ts
import { preloadNativeArtifacts } from '@astrale-os/codegraph/analysis/native'

await preloadNativeArtifacts({ generic: true, signal })
```

## Qualify and publish

`native-release.yml` builds and qualifies the complete native matrix from one exact commit.
Assembly emits two separate GitHub Actions artifacts:

- `codegraph-release`: the lightweight npm archive.
- `codegraph-assets`: the authenticated native/viewer payloads and their two manifests.

After admission, the workflow publishes a source-bound GitHub prerelease so isolated packed
consumers can exercise the actual public download URLs. It resumes identical files after an
interrupted draft; published bytes are never overwritten. Forks do not receive publication
permissions. A source commit that changes workflows may require an owner to publish these assets
with GitHub's Workflows permission before this first qualification can proceed.

npm publication remains manual: `publish.yml` requires an already successful native qualification
on `main`, the exact source SHA and the same admitted archive. It verifies public assets before
publishing through npm Trusted Publishing, then verifies the immutable npm archive and an actual
npm consumer. An existing version must have identical integrity; the publisher never rebuilds it.

Consumers, including the SDK, pin an actually published npm version. A local `file:` archive can
prove an unpublished revision in an isolated experiment; it does not establish npm distribution.
[Download a qualified unpublished archive](github-artifacts.md).
