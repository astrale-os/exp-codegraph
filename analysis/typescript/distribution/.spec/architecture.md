# Native analysis distribution

This module owns artifact selection and admission, not compiler construction. The public Codegraph
package reads one immutable release manifest, selects the exact current OS/architecture artifact,
and verifies package version, containment, file kind, executable mode, byte length, and SHA-256
before a process session can spawn it.

Platform packages are opaque distribution artifacts and expose no JavaScript API. Compiler-near
source and `ttsc` remain release inputs outside this runtime module. Resolution never downloads,
compiles, searches `PATH`, or falls back from a missing/corrupt artifact.
