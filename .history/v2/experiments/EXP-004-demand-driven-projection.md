# EXP-004: Demand-driven native projection

Status: implemented; Codegraph diagnostic passed; Kernel and governed benchmark evidence pending

Date: 2026-08-15

## Hypothesis

The native adapter can derive an exact projector DAG from requested capabilities and avoid unrelated
semantic walks without changing the selected namespace. A module catalog should pay for compiler
load, source-manifest admission, and module observation, but not symbol discovery, general
occurrences, function bodies, CFG, definition-use, or value inputs.

The semantic threshold is exact: for every native capability, the selected fact envelopes after
omitting only their enclosing generation binding and the selected shard references must equal that
namespace from an all-capability cold build. The execution threshold is zero unrequested semantic
projector phases. Requested projection inputs must not change `ProjectUniverseId`.

This experiment does not freeze or claim a universal latency ratio. The useful performance signal is
that elapsed work and emitted bytes follow the selected capability rather than the richest graph.

## Architecture

`projectionPlan` is a private native execution plan above the resident ttsc Program. It selects the
project, diagnostic, module, source, symbol, occurrence, and body projectors independently. A
projector may use compiler objects or private prerequisites, but it publishes only explicitly
requested namespaces. The plan is not a second semantic authority and does not enter compiler
universe identity.

The stable contract remains at the TypeScript adapter facade and laws. Native stage mechanics and
the diagnostic harness remain outside exact `.spec` physical inventory under the thin-spine rule.

## Exact microproject result

`qualification/v2/experiments/projection-plan.ts` runs an all-capability cold oracle, then one cold
run for each of the seven native capabilities. It asserts:

- exact selected fact envelopes without only `generation`;
- exact selected shard references;
- one emitted namespace, including a complete empty diagnostic shard;
- the exact semantic phase allowlist and zero unrelated semantic phases;
- one stable universe across every projection plan; and
- a module-boundary change alters the generation and module fact without altering the universe.

The current run passed all assertions with 10 all-capability facts and seven shards.

## Codegraph diagnostic

Both measurements used the same dirty source tree, native binary
`bc0b59f05c28e8a0b5f562450dd41c7e685f5f974817af286ef02d82fa99c585`, compiler project
`tsconfig.json`, 35 module boundaries, memory materialization, and compact native payload
negotiation.

| Projection | Cold refresh | Facts | Semantic fact bytes |
| --- | ---: | ---: | ---: |
| `astrale.typescript.module` | 2,520.64 ms | 35 | 5,778,556 |
| all seven native capabilities | 93,084.44 ms | 73,449 | 225,610,455 |

The diagnostic ratio is 36.93x. Both runs derived universe
`project-universe:84020989b519784286d75d39a6fcd6c5120a40f61f561af8746b54d408105c60`
and source manifest
`source-manifest:9ab0f4a9bb59b93734e8f848460ce774a8ca9df06916eae5643b6d1f05ab550b`.

The all-capability native telemetry attributed 24,234.85 ms to symbol discovery, 25,252.18 ms to
general occurrences, and 31,110.26 ms to bodies. None of those phases appeared in the module-only
run. Module observation itself was 1,978.34 ms in the shallow run.

Raw diagnostic artifacts are `/private/tmp/codegraph-module-only-profile.json` and
`/private/tmp/codegraph-all-capabilities-profile.json`. They are temporary diagnostic inputs, not
governed evidence and not release qualification.

## Remaining qualification

- Repeat exact projection equivalence on the frozen Codegraph corpus rather than only the
  adversarial microproject.
- Run Kernel as a clean holdout using only Kernel-owned `.spec` modules.
- Retain configuration/root/plugin fallback and cold-equivalence coverage.
- Measure representative shallow, body-only, and rich consumer plans in fresh counterbalanced
  processes before adopting a performance limit.
- Continue the DAG through portable passes, query hydration, and policy inputs; native selectivity
  alone does not prove end-to-end proportional work.
