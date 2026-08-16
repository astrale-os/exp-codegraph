# Application checkpoint

This adapter binds a repository-scoped compiled corpus plus its latest application request, exact
inventory, producer version, immutable analysis generation identities, statistics, and qualification
snapshot to the generic workspace checkpoint store. It contains no server or viewer state.

An exact inventory and request hit may publish immediately. A compatible corpus hit from another
selection, qualification profile, or older inventory is only a delta base: the application refreshes
affected normative inputs and recomputes request-owned derived products before publication.

The checkpoint is advisory: any mismatch, malformed artifact, missing generation, or snapshot
identity disagreement falls back to the ordinary cold application path.

Each derived JSON artifact is independently encoded and expansion-bounded. The complete decoded
checkpoint is also bounded by the application limits, so a small physical payload cannot bypass the
interactive memory budget.

Compiled API source bodies and tokens are content-addressed once across specification artifacts.
This physical representation reconstructs the exact `SpecificationSnapshot` API while keeping
application semantics independent of checkpoint storage and viewer transport.
