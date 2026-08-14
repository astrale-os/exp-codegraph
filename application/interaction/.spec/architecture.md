# Application interaction boundary

This headless boundary defines generation-pinned edit, reveal, and qualification transports. It
contains no catalog, filesystem, compiler, or viewer authority. Node HTTP handlers are private
adapters; the reusable protocol models remain runtime-neutral.

Every operation carries the exact application snapshot identity and expected source revision.
Matching a current path is insufficient: a stale generation or revision is rejected before any
read, write, reveal, or qualification action.
