# Verified repository source access

The source service is bound to one immutable repository inventory. It returns text only when the
current bytes reproduce the pinned source revision; post-refresh edits are reported as stale
evidence rather than mixed with facts from another generation. Verification hashes the original
bytes before decoding UTF-8, so decoding details cannot change source identity. Reads are bounded by
an explicit configurable limit; the default is 16 MiB per source.
