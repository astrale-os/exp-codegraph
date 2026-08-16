# Application checkpoint

This adapter binds an application request, exact repository inventory, producer version, immutable
analysis generation identities, specification corpus, statistics, and qualification snapshot to the
generic workspace checkpoint store. It contains no server or viewer state.

The checkpoint is advisory: any mismatch, malformed artifact, missing generation, or snapshot
identity disagreement falls back to the ordinary cold application path.

Each derived JSON artifact is independently encoded and expansion-bounded. The complete decoded
checkpoint is also bounded by the application limits, so a small physical payload cannot bypass the
interactive memory budget.

Compiled API source bodies and tokens are content-addressed once across specification artifacts.
This physical representation reconstructs the exact `SpecificationSnapshot` API while keeping
application semantics independent of checkpoint storage and viewer transport.
