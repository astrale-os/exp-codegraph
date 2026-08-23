# Application checkpoint

This adapter binds a repository-scoped compiled corpus plus its latest application request, exact
inventory, producer version, immutable analysis generation identities, requested optional
statistics, and qualification snapshot to the generic workspace checkpoint store. It contains no
server or viewer state.

An exact inventory and request hit may publish immediately. A compatible corpus hit from another
selection, qualification profile, or older inventory is only a delta base: the application refreshes
affected normative inputs and recomputes request-owned derived products before publication.
When the semantic request is identical, unchanged specification-local qualifications may be rebound
to the refreshed exact analysis snapshot; a request mismatch, universe-scoped profile, changed owner,
or uncertain impact recomputes the affected product.

The checkpoint is advisory: any mismatch, malformed artifact, missing generation, or snapshot
identity disagreement falls back to the ordinary cold application path.

Each derived JSON artifact is independently encoded and expansion-bounded. The complete decoded
checkpoint is also bounded by the application limits, so a small physical payload cannot bypass the
interactive memory budget.

Compiled API source bodies and tokens are content-addressed once across specification artifacts.
This physical representation reconstructs the exact `SpecificationSnapshot` API while keeping
application semantics independent of checkpoint storage and viewer transport.

A portable checkpoint binds the same manifest to an opaque SourceProof and may be referenced by its
canonical manifest digest from a semantic-pack root. A read-only binding may restore evidence but
disables publication; it never reports a write that policy prohibited.

For a non-exact focused request, the reader may first admit the manifest-owned corpus index and
then load only the selected dependency closure plus its content-addressed API payloads. Omitted
owner artifacts remain committed by the atomic manifest but are neither read nor represented as
admitted evidence.
