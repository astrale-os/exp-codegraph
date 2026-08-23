# Node application composition

This adapter owns Node filesystem persistence and native-plugin cache lifecycle around the portable
TypeSpec application. Physical checkout identities are confined to SQLite namespaces and never enter
semantic repository, generation, fact, or application identities.

An advisory metadata preflight may reuse a previously content-hashed repository inventory only
when the complete path, inode, size, modification-time, and change-time census is identical. Any
uncertainty falls back to the canonical byte-reading inventory service.

The adapter also captures the installed Git executable for source-proof admission. Portable layers
consume only the opaque proof and changed-path evidence; unsupported Git state visibly falls back
to the complete inventory path.

For a clean source-cold memory run, the same admitted proof may authorize an immutable Git-tree
inventory. The adapter enumerates the exact bound tree, hashes its blob bytes with the canonical
inventory digest, preserves the directory-topology binding, and reports the optimization decision.
Dirty or uncertain worktrees retain the complete filesystem scanner.
Clean-tree materialization may run concurrently with worktree admission only against an immutable
resolved tree object; a changed HEAD, rejected proof, or materialization failure visibly falls back.

The adapter may compose its worktree-local application checkpoint with a caller-owned portable
store. Local exact evidence has precedence; otherwise an exact SourceProof-bound manifest may
restore the sharded corpus. Read-only stores are never disposed or published by the adapter.
