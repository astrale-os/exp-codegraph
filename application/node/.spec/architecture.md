# Node application composition

This adapter owns Node filesystem persistence and native-plugin cache lifecycle around the portable
TypeSpec application. Physical checkout identities are confined to SQLite namespaces and never enter
semantic repository, generation, fact, or application identities.

An advisory metadata preflight may reuse a previously content-hashed repository inventory only
when the complete path, inode, size, modification-time, and change-time census is identical. Any
uncertainty falls back to the canonical byte-reading inventory service.
