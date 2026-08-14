# TypeSpec application composition

The application module is the headless workflow boundary above normative specification compilation,
resident analysis, and conformance. It returns one immutable projection tied to exact input
identities and owns no CLI, HTTP, viewer, or process-global behavior.

One published snapshot binds the portable repository identity, exact inventory, normative corpus,
repository statistics, analysis snapshot set, observation facts, qualifications, and selection
authority. `open(snapshot)` leases its source and analysis generations until disposal. Full
selection is authoritative; focused selection remains advisory and records its primary, support,
included, and optional dependent closure.

The analysis workspace remains a nested submodule because its resident compiler lifecycle,
multi-project refresh, and snapshot-set pinning are independently reusable from TypeSpec catalog
presentation.
