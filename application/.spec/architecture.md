# TypeSpec application composition

The application module is the headless workflow boundary above normative specification compilation,
resident analysis, and conformance. It returns one immutable projection tied to exact input
identities and owns no CLI, HTTP, viewer, or process-global behavior.

One published snapshot binds the portable repository identity, exact inventory, normative corpus,
repository statistics, analysis snapshot set, observation facts, qualifications, and selection
authority. `open(snapshot)` leases its source and analysis generations until disposal. Full
selection is authoritative; focused selection remains advisory and records its primary, support,
included, and optional dependent closure.

An unchanged refresh first recomputes the repository inventory. When that content identity and the
normalized semantic request are unchanged, the service returns the retained immutable snapshot
without rediscovery, recompilation, analysis, or qualification. Explicit change/invalidation hints
and external schema roots bypass this optimization; the fast path therefore cannot hide inputs that
are not pinned by the local inventory.

Different selections over the same inventory share one immutable compiled corpus, source service,
and statistics report. The cache is deliberately one-entry and keyed by inventory plus discovery
filters: it removes duplicate repository-sized construction without becoming another persistence or
semantic authority.

Application authority means every qualification outcome is pinned and reported. It does not turn a
repository with conformance findings into a false pass: pass, fail, indeterminate, and error
snapshots all remain content-addressed product output, while application or analysis diagnostics
still fail publication qualification.

The analysis workspace remains a nested submodule because its resident compiler lifecycle,
multi-project refresh, and snapshot-set pinning are independently reusable from TypeSpec catalog
presentation.
