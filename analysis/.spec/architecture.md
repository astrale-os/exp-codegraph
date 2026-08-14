# Headless semantic analysis

Analysis is a reusable evidence engine, not a TypeSpec verifier. Compiler-near producers and
portable passes publish immutable facts; materializers commit complete generations; consumers hold
generation-pinned query leases.

```mermaid
flowchart LR
  subgraph Pure[Portable contracts]
    I[identity]
    F[facts]
    G[generation]
    P[pass]
    Q[query]
  end

  subgraph Producers[Producers]
    R[repository]
    T[typescript]
    B[body IR]
  end

  subgraph Materializers[Materializers]
    M[memory]
    S[sqlite]
  end

  I --> F --> G
  F --> P
  G --> Q
  P --> Q
  G --> M --> Q
  G --> S --> Q
  R --> F
  T --> F
  B --> T
```

Import direction points from each consumer to the owner it needs. The public `analysis` module is a
structural facade; it owns no mutable singleton, store selection, process lifecycle, or TypeSpec
policy.

```mermaid
sequenceDiagram
  participant N as Native session
  participant O as Pass orchestrator
  participant S as AnalysisStore
  participant Q as AnalysisQuery
  participant C as Consumer

  N-->>O: complete base FactTransaction
  O->>O: validate and derive in DAG order
  O->>S: commit complete next generation
  activate S
  S->>S: validate base, manifest, shards
  S-->>O: atomically visible
  deactivate S
  C->>S: open(universe, generation)
  S-->>C: pinned Q lease
  C->>Q: facts(filter, page)
  Q-->>C: immutable FactPage
  C->>Q: dispose
```

The following are distinct contracts:

- identity owns portable equality and never embeds an absolute checkout path;
- facts own evidence, provenance, and epistemic completeness;
- generation owns complete manifests and optimistic transaction bases;
- pass owns dependency planning and mandatory/optional failure semantics;
- query owns snapshot leases and bounded access; and
- source owns digest-verified text access without persisting source bodies; and
- memory and SQLite implement one `AnalysisStore` contract without leaking backend types.

An `AnalysisSnapshotSet` pins both the exact repository inventory revision and every included
universe generation. Portable output shards name the semantic capabilities whose completeness they
bound; capability and namespace names need not match. Unaffected portable output is carried from
validated in-memory shards without fact export, pass execution, or immutable-row rewrite.

The filesystem mirrors this authority graph as a hierarchical module tree. Each capability owner
keeps a small, mostly flat collection of cohesive files; another directory level is justified only
by a separately reusable subdomain, lifecycle, protocol, or backend. Generic horizontal buckets
and catch-all helpers are rejected because they erase dependency direction rather than simplify it.

Shard content digests omit only the enclosing generation field from each fact. The manifest of
those semantic shard digests determines the generation identity, after which transaction validation
binds every fact to that exact generation. Fact IDs are row keys inside a generation-pinned query;
there is no recursive digest construction.
