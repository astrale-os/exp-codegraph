# Typed TypeScript fact access

This module is a validating projection over the generic generation-pinned query contract. It owns
neither persistence nor compiler analysis. Consumers select stable semantic fact kinds and receive
typed envelopes only after namespace, schema, and payload admission. Invalid materialized or native
payloads fail at this boundary rather than becoming downstream casts.

Physical schema-v2 module facts contain declaration references rather than repeated transitive
declaration closures. Schema-v1 declaration support uses the same module namespace and a distinct
`declaration` fact kind, preserving the existing module capability surface. The reader admits the
referenced facts, verifies fact and subject identity, and hydrates the unchanged schema-v1 logical
module payload before returning it. The producer derives the unchanged logical identity as a
bounded canonical stream over shared declaration support rather than rebuilding the schema-v1
monolith. Missing, malformed, duplicate, or mismatched support is a
contract error. Page reads fetch only the referenced support set; streaming module reads retain one
immutable declaration index and do not materialize all hydrated modules together.

`exportAll` preserves the original logical enumeration: it admits but does not yield physical
declaration-support facts, hydrates each module once, and yields the seven logical base kinds.
Extension facts remain owned by their own typed readers.
