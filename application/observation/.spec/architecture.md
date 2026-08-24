# TypeSpec observations

Repository-scoped layout and test-evidence observations are materialized as versioned facts in a
dedicated universe. They never mutate normative specification snapshots, and conformance consumes
them through the same generation-pinned query contract as compiler facts.

When verification requests module bindings, the application resolves exact implementation
boundaries before observation and asks the compiler owner for one compact binding fact per
implemented specification.
The fact enumerates contract and implementation exports, direct dependencies, package intent,
error-code evidence, source ownership, and diagnostics. Runtime exports require an owner-local
`implementation.contract.ts` namespace `satisfies` binding; type exports must resolve explicitly to
the authoritative `.spec/api.d.ts` symbols.

Binding facts are independently content-addressed shards in the existing atomic observation
generation. A source change beneath an implementation owner invalidates that owner's binding and
qualification only. Whole-corpus compiler work executes behind bounded serial worker processes and
publishes peak-resident and phase telemetry. Failure is visible; no native module-graph fallback is
installed.
