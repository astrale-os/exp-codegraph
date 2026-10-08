# Native analysis distribution

This module owns artifact selection and admission, not compiler construction. The public Codegraph
package reads its one immutable release manifest, selects the exact current OS/architecture artifact
inside its own `native-artifacts` directory, and verifies package version, containment, file kind,
executable mode, byte length, and SHA-256 before a process session can spawn it.

Native artifacts are opaque executables delivered inside `@astrale-os/codegraph`; no other package
carries them and they expose no JavaScript API. Compiler-near source and `ttsc` remain release
inputs outside this runtime module. Resolution never downloads, compiles, searches `PATH`, or falls
back from a missing/corrupt artifact.

The qualified targets are macOS on arm64 and Linux on x64. The package installs on every other
platform, where packaged resolution fails with `NATIVE_TARGET_UNSUPPORTED`. The same packed project
session, semantic facts and incremental refresh contract apply on each target. The Node runtime
floor is 22.13, with the 24 and 26 release lines also supported.

`resolvePackagedNativeOxlint` separately admits the captured generic worker against its own release
descriptor, artifact directory containment, executable permissions and actual bytes. Missing or
corrupt companions fail that capability without invalidating the Go analyzer, so callers can recover
through their original analysis path. Historical Go-only manifests remain readable.

The maintained worker targets the same two platforms (GNU libc on Linux). Worker distribution does
not admit an SDK's original Oxlint bindings or presets; those remain independent consumer
requirements. The SDK's initial captured qualification is Darwin ARM64 and Oxlint 1.81.0.
