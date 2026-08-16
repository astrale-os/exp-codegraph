# TypeSpec application composition

The application module is the headless workflow boundary above normative specification compilation,
resident analysis, and conformance. It returns one immutable projection tied to exact input
identities and owns no CLI, HTTP, viewer, or process-global behavior.

One published snapshot binds the portable repository identity, exact inventory, normative corpus,
repository statistics, analysis snapshot set, observation facts, qualifications, and selection
authority. `open(snapshot)` leases its source and analysis generations until disposal. Full
selection is authoritative; focused selection remains advisory and records its primary, support,
included, and optional dependent closure.

An unchanged refresh validates the repository inventory through the shared Codegraph workspace.
When that content identity, producer set, and normalized semantic request are unchanged, the service
reopens or returns the retained immutable snapshot without rediscovery, recompilation, analysis, or
qualification. A durable checkpoint is advisory evidence: stale, corrupt, missing, incompatible, or
pruned evidence takes the same cold semantic path and can never publish partial state.

Different selections over the same inventory share one immutable compiled corpus, source service,
and statistics report. A small checkpoint manifest may reference independently content-addressed
derived artifacts and exact analysis generations; it never embeds one repository-sized application
snapshot or duplicates fact payloads.

Application inventory is permanently bounded away from dependency stores, caches, distributions,
and generated evidence or benchmark artifacts. Consumer exclusions are additive and cannot disable
that floor; choosing a generated artifact or dependency store as the application root is rejected.

An explicit development change set reuses independently content-addressed specification snapshots
whose complete normative inputs are unaffected. New or removed anchors, changed `.spec` inputs,
declaration dependencies, source references, package authority, and project configuration select
their exact owner and transitive dependent closure. Changed paths are hints rather than authority;
unknown or incomplete closure widens visibly to a conservative full refresh. Inventory coherence is
validated after composition, so a stale hint cannot publish a mixed snapshot.

Repository statistics reuse per-file metrics only across identical source revision and analyzer
identity, then recompute exact summaries and groupings. Observation and qualification products are
partitioned by their declared owner and evidence inputs. Unchanged partitions are retained without
reload or rewrite; undeclared profile reads force conservative re-evaluation.

Application authority means every qualification outcome is pinned and reported. It does not turn a
repository with conformance findings into a false pass: pass, fail, indeterminate, and error
snapshots all remain content-addressed product output, while application or analysis diagnostics
still fail publication qualification.

The analysis workspace remains a nested submodule because its resident compiler lifecycle,
multi-project refresh, and snapshot-set pinning are independently reusable from TypeSpec catalog
presentation.
