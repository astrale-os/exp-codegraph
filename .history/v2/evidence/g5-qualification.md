# Gate 5 application-cut qualification

Status: in progress

Date opened: 2026-08-14

Gate 5 is the single TypeSpec authority switch. CLI, CI, server, watcher, cache, transport, editing,
reveal, and viewer must consume immutable V2 snapshots and qualifications before the legacy reader,
compiler lifecycle, transport, and compatibility branches are deleted together.

No application-cut requirement is qualified yet. V1 remains authoritative while this record is in
progress; V2 output remains shadow evidence and cannot change user-visible diagnostics or exit
status.

The first cutover review finding, V2-CON-005, is complete: the 4,135-line recursive conformance
evaluator is split into bounded hierarchical module, declaration, type, and pure-semantic leaves,
with an automated 2,000-line ceiling. This refactor changes no qualified rule behavior.
