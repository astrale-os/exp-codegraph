# Checkpoint storage

The checkpoint store is a generic bytes-and-JSON persistence port. Manifests are canonical,
atomically replaced, and small; artifacts are content-addressed, digest-verified, bounded, and
deduplicated. The store has no knowledge of TypeScript, specifications, viewers, or servers.

The optional deterministic JSON artifact codec keeps physical bytes distinct from decoded values.
Callers retain ownership of their decoded-size budgets and schema admission; encoded size never
substitutes for a bound on expanded content.

Load failures are typed cache misses. A caller validates its own producer, repository inventory,
request, generations, and artifact schema before using any restored state.
