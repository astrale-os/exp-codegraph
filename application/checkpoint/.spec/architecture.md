# Application checkpoint

This adapter binds an application request, exact repository inventory, producer version, immutable
analysis generation identities, specification corpus, statistics, and qualification snapshot to the
generic workspace checkpoint store. It contains no server or viewer state.

The checkpoint is advisory: any mismatch, malformed artifact, missing generation, or snapshot
identity disagreement falls back to the ordinary cold application path.
