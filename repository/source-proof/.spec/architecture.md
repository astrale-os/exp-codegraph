# Source proof

Source proof binds one Git tree, a sorted working-tree overlay, and versioned Codegraph source-scope
rules. It is an admission key, not a Git implementation and not permission to change repository
inventory semantics.

The portable repository layer owns the immutable proof vocabulary and identity. A receiver-bound
Node adapter owns Git execution, porcelain parsing, dirty byte reads, mode evidence, and mutation
detection. Unsupported or uncertain evidence returns a visible fallback so the complete scanner
remains the semantic authority.

A clean proof may authorize a Node adapter to construct the same canonical inventory from immutable
Git blobs. That adapter must retain canonical byte digests, classification, topology, ordering, and
failure behavior; otherwise it falls back to the complete scanner.
