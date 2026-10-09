# Native analysis distribution

This module owns platform selection and admission, not compiler construction. The single Codegraph
npm package carries an immutable native release manifest. `delivery: "github-release"` selects only
the requested current-host capability from the fixed public Codegraph repository release whose tag
binds the package version and source revision. Five Go targets are represented: Darwin ARM64/x64,
Linux ARM64/x64 and Windows x64. The generic worker is independently qualified on Darwin ARM64 and
Linux x64 (GNU libc); unavailable companions do not invalidate the Go analyzer.

The common `distribution` owner streams encoded and decoded bytes through exact size and SHA-256
admission into a unique staging file. Atomic publication leaves one content-addressed original file,
without modifying the installed package or retaining encoded downloads. Healthy cache entries work
offline. Failed, corrupt and cancelled transfers clean their own staging and are retryable; concurrent
readers retain their admitted inode while a corrupt cache entry is replaced. No install hook, network
compiler build, PATH search or alternate artifact fallback exists.

`preloadNativeArtifacts({ generic?, signal? })` prepares this host's requested capabilities before
entering an offline environment. Importing the API does not download an artifact. Rust is resolved
only when its capability is requested, and its exact worker version/source are independently admitted.
An explicit application-controlled binary keeps its original addressing and admission semantics.
Historical manifests without `delivery` continue to admit their embedded raw or compressed payloads.

Compiler-near source and `ttsc` remain release inputs outside this runtime module. The Node runtime
floor is 22.13, with the 24 and 26 release lines supported. Worker distribution does not admit an SDK's
original Oxlint bindings or presets; those remain independent consumer requirements.
