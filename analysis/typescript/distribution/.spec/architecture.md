# Native analysis distribution

This module owns artifact selection and admission, not compiler construction. The public Codegraph
package reads one immutable release manifest, selects the exact current OS/architecture artifact,
and verifies package version, containment, file kind, executable mode, byte length, and SHA-256
before a process session can spawn it.

Platform packages are opaque distribution artifacts and expose no JavaScript API. Compiler-near
source and `ttsc` remain release inputs outside this runtime module. Resolution never downloads,
compiles, searches `PATH`, or falls back from a missing/corrupt artifact.

The qualified targets are macOS and Linux on x64/arm64, and Windows on x64. Windows artifacts
use `bin/codegraph-native.exe`; their admission does not require POSIX executable permission bits.
The same packed project session, semantic facts and incremental refresh contract apply on each
target. The Node runtime floor is 22.13, with the 24 and 26 release lines also supported.

`resolvePackagedNativeOxlint` separately admits the captured generic worker against its own release
descriptor, package containment, executable permissions and actual bytes. Missing or corrupt
companions fail that capability without invalidating the Go analyzer, so callers can recover
through their original analysis path. Historical Go-only manifests remain readable.

The maintained worker targets macOS and Linux x64/arm64 (GNU libc on Linux). Windows packages
deliver the Go analyzer alone until worker file ownership and OS error identities are qualified.
Worker distribution does not admit an SDK's original Oxlint bindings or presets; those remain
independent consumer requirements. The SDK's initial captured qualification is Darwin ARM64 and
Oxlint 1.81.0.
