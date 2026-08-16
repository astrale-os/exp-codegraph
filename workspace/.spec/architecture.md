# Workspace foundation

The workspace layer owns process-independent, repository-agnostic operational state. It sits below
analysis applications, specification tooling, CLIs, agents, and development servers; none of those
consumer concepts may enter this boundary.

Persisted workspace data is advisory. Semantic stores and exact source inventories remain authority,
and every consumer must be able to reject a checkpoint and reconstruct its state cold.
