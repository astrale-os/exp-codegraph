# Typed TypeScript fact access

This module is a validating projection over the generic generation-pinned query contract. It owns
neither persistence nor compiler analysis. Consumers select stable semantic fact kinds and receive
typed envelopes only after namespace, schema, and payload admission. Invalid materialized or native
payloads fail at this boundary rather than becoming downstream casts.
