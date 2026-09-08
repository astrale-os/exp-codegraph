# Semantic lint PR inventory — 2026-09-08

Read this alongside [the sprint closeout](semantic-lint-sprint-2026-09.md). These are
the implementation heads checked against live remote branches at pause. The order
below follows dependencies; the distribution proposal branches separately from PR29.
PR44 is merged into its stack base. PR22, PR54 and PR55 remain draft; the other
Codegraph implementation entries are open. No stack-wide production release is claimed.

| PR | Scope | Head | Base branch |
| --- | --- | --- | --- |
| [#10](https://github.com/astrale-os/exp-codegraph/pull/10) | fix(analysis): recover coherent results after publication failures | `a34a4dd6eeac99166f40b2b8cee59a13d753d0e8` | `main` |
| [#11](https://github.com/astrale-os/exp-codegraph/pull/11) | fix(distribution): export compiled declarations for TypeScript consumers | `03797bc9210d7e3d5c4486d513787f1e1629b557` | `fix/analysis-publication-retry` |
| [#12](https://github.com/astrale-os/exp-codegraph/pull/12) | fix(typescript): preserve module execution and bounded value semantics | `ef192ea9492aad13bad18c653b51f3991e93a56c` | `fix/declaration-exports` |
| [#13](https://github.com/astrale-os/exp-codegraph/pull/13) | perf(analysis): reuse generation query indexes across memory leases | `8b260a096345c480826f049a2f6e2e84982641b2` | `fix/semantic-body-provenance` |
| [#14](https://github.com/astrale-os/exp-codegraph/pull/14) | perf(typescript): index native symbols and body occurrences once | `e554a76845f61754067b9c8d4db923af0ec38b35` | `perf/analysis-memory-query-indexes` |
| [#15](https://github.com/astrale-os/exp-codegraph/pull/15) | fix(typescript): preserve reaching values and stable signature identities | `4959973b6a73e784293a6c1002ab7b624816479f` | `perf/native-semantic-indexes` |
| [#16](https://github.com/astrale-os/exp-codegraph/pull/16) | feat(typescript): expose recoverable resident project snapshots | `7c3eb018eeba437d20c55ea6bf9045ae0fd35ebd` | `fix/native-query-provenance` |
| [#17](https://github.com/astrale-os/exp-codegraph/pull/17) | fix(analysis): retain declared value origins across package boundaries | `e5aabfcb46a98afe799196a847ef15000a6adeba` | `feat/typescript-project-session` |
| [#18](https://github.com/astrale-os/exp-codegraph/pull/18) | fix(distribution): support SDK consumer platforms and Node 22 | `41fe3b1e787e17d07829f64fd98ff9af4b4a1140` | `fix/runtime-symbol-origin` |
| [#19](https://github.com/astrale-os/exp-codegraph/pull/19) | feat(typescript): expose composable bounded symbolic value proofs | `94e69ceb25308266754003fc3d6729a818668cde` | `fix/sdk-consumer-platforms` |
| [#20](https://github.com/astrale-os/exp-codegraph/pull/20) | perf(typescript): reuse admission of owned semantic facts | `bdb494e3f47fb0c0a35224237d0f3d61e3f57548` | `feat/typescript-symbolic-values` |
| [#21](https://github.com/astrale-os/exp-codegraph/pull/21) | fix(typescript): bound resident universe retention | `6793128dba86e8cd924998be1a82d4b087510398` | `perf/typescript-fact-admission` |
| [#23](https://github.com/astrale-os/exp-codegraph/pull/23) | fix(typescript): prove runtime namespace member provenance | `dacccfb155deedc9411737d635ca1e38587e79f9` | `fix/resident-universe-retention` |
| [#24](https://github.com/astrale-os/exp-codegraph/pull/24) | feat(typescript): expose indexed call sites | `7a9bc638856dbc21b0389891b3b9eb6da59f6078` | `fix/runtime-namespace-provenance` |
| [#25](https://github.com/astrale-os/exp-codegraph/pull/25) | feat(typescript): map value results without strengthening uncertainty | `0442c7f4a3a1ae85a497de082b93be783c707b78` | `feat/typescript-call-projections` |
| [#26](https://github.com/astrale-os/exp-codegraph/pull/26) | perf(typescript): reuse value proofs within resident projects | `3914da7a113179bed42f77b8845c55c2225449be` | `feat/typescript-value-result-mapping` |
| [#27](https://github.com/astrale-os/exp-codegraph/pull/27) | fix(typescript): preserve opaque atom identity | `55aecf0f57cb7471d05b469f5c97eec6285a4335` | `perf/typescript-project-proof-reuse` |
| [#28](https://github.com/astrale-os/exp-codegraph/pull/28) | fix(typescript): resolve shorthand property value bindings | `714589c3c88c4c17afb40d3f50c2cda2491b8387` | `fix/typescript-atom-identity` |
| [#29](https://github.com/astrale-os/exp-codegraph/pull/29) | feat(typescript): preserve context through symbolic operand plans | `ac916b26222802e2b1563beb59208315f2161f41` | `fix/typescript-shorthand-binding` |
| [#30](https://github.com/astrale-os/exp-codegraph/pull/30) | perf(analysis): reduce canonical identity allocations | `4350dff403e08deae89274264b005d4d32dabb5b` | `feat/typescript-contextual-operands` |
| [#31](https://github.com/astrale-os/exp-codegraph/pull/31) | perf(native): canonicalize JSON without intermediate object graphs | `55b1e698e72ac816b7b841acecc7c8f2b5d89504` | `perf/analysis-canonical-allocation` |
| [#32](https://github.com/astrale-os/exp-codegraph/pull/32) | perf(native): encode only changed generation identity entries | `519a6639a9d7ce93d2e04c1c2f872c6009f4a9fd` | `perf/native-canonical-encoding` |
| [#33](https://github.com/astrale-os/exp-codegraph/pull/33) | perf(protocol): stream fact records through atomic admission | `01cfec40bff0e210b517551aed10cbb7a2ae376b` | `perf/native-delta-identities` |
| [#34](https://github.com/astrale-os/exp-codegraph/pull/34) | perf(native): share package ownership reads within each snapshot | `d0390b5082609a58d2def0e95c4766ebc4ffd2d0` | `perf/native-record-stream` |
| [#35](https://github.com/astrale-os/exp-codegraph/pull/35) | fix(typescript): preserve symbol identities across source membership changes | `f540e945dd4e701c05deed5cbae4ab57f1c4a55d` | `perf/native-package-ownership` |
| [#36](https://github.com/astrale-os/exp-codegraph/pull/36) | perf(typescript): update resident value indices from committed deltas | `07f416d89e95ca72e3394b4039278a1c237b1e53` | `fix/typescript-source-membership` |
| [#37](https://github.com/astrale-os/exp-codegraph/pull/37) | perf(typescript): share proof ownership and retain useful work during large scans | `e77173366a68b00b6bc0b73b02e5f1bcba44abc9` | `perf/typescript-value-index-deltas` |
| [#38](https://github.com/astrale-os/exp-codegraph/pull/38) | perf(facts): attest exact physical payload ownership for lazy projections | `3fb0a0a98f6432d26e3324b94199c49bb5c0999b` | `perf/typescript-proof-bases` |
| [#44](https://github.com/astrale-os/exp-codegraph/pull/44) | fix(test): own native fixtures through preparation and cleanup | `9e2eb060f110ddd9f0beabcc37502d1b7c3095df` | `perf/facts-owned-projection` |
| [#39](https://github.com/astrale-os/exp-codegraph/pull/39) | perf(protocol): bound streamed admission independently of project volume | `ea2e8a1a4dcb16259761aec040f066ec4615d7d0` | `fix/native-qualification-fixture-lifetime` |
| [#40](https://github.com/astrale-os/exp-codegraph/pull/40) | perf(typescript): project packed value fragments on demand | `c485054ffc520e7c6341175c7c5f6332df1ff218` | `perf/protocol-record-budgets` |
| [#41](https://github.com/astrale-os/exp-codegraph/pull/41) | perf(typescript): compact resident proof evidence coordinates | `d051c723099674595dd8450538dff6bfd0eb6f85` | `perf/typescript-lazy-value-projection` |
| [#42](https://github.com/astrale-os/exp-codegraph/pull/42) | fix(native): invalidate consumers when runtime callable targets change | `1ddac42a008a588750877883711eb47fb8a004df` | `perf/typescript-resident-proof-coordinates` |
| [#43](https://github.com/astrale-os/exp-codegraph/pull/43) | perf(generation): stream identities from retained manifest references | `34ec710bed4439446f5d44c9b1b7dacf3fe90896` | `fix/native-callable-read-dependencies` |
| [#45](https://github.com/astrale-os/exp-codegraph/pull/45) | perf(memory): update query indexes across committed generations | `fcf76c05dc502cc032785f2607a5a1ce9956c56a` | `perf/generation-manifest-stream` |
| [#46](https://github.com/astrale-os/exp-codegraph/pull/46) | perf(native): reuse recursive canonical field storage | `09d82ec46fb5f5c5d55a89795312bfc44f0c3d8c` | `perf/memory-shared-query-revisions` |
| [#47](https://github.com/astrale-os/exp-codegraph/pull/47) | perf(typescript): compact persistent value lookup branches | `92667878fec5bd7921a06f6aa9a3dc42966e99c0` | `perf/native-canonical-field-arena` |
| [#48](https://github.com/astrale-os/exp-codegraph/pull/48) | perf(memory): compare manifests against admitted shard data | `fda185f1e23294dd3f3d323004237b1773d0cc88` | `perf/typescript-compact-value-trie` |
| [#49](https://github.com/astrale-os/exp-codegraph/pull/49) | perf(generation): reuse immutable capability reference encodings | `4cbc534256c4ca553d1454b8cb56643a296e6fd7` | `perf/memory-direct-manifest-admission` |
| [#50](https://github.com/astrale-os/exp-codegraph/pull/50) | perf(native): share canonical payloads across fact and shard identities | `b5ae14c5a28df726add41c8d0fcfa6af1a2c95be` | `perf/generation-immutable-capabilities` |
| [#51](https://github.com/astrale-os/exp-codegraph/pull/51) | perf(native): release obsolete generation indexes after acknowledgement | `9e0b1b9d7a94bfa908223a1dcf9a6468eafc142b` | `perf/native-fact-shard-identities` |
| [#52](https://github.com/astrale-os/exp-codegraph/pull/52) | perf: derive value proof witnesses from fact ownership | `3e6dfb863197cc45d331320f6b07ee2ddcc9103c` | `perf/native-acknowledged-generation` |
| [#53](https://github.com/astrale-os/exp-codegraph/pull/53) | perf: compact packed body adjacency indexes | `b9b549941910719e48942f0e571af5b1e7325c1f` | `perf/typescript-proof-owner-lookup` |
| [#54](https://github.com/astrale-os/exp-codegraph/pull/54) | perf: unify indexed body row ownership | `bea7ece75d27bf74a9f28aefa83069835bbe2c53` | `perf/typescript-compact-adjacency` |
| [#55](https://github.com/astrale-os/exp-codegraph/pull/55) | perf: store packed body tables in columns | `5df48307c33e3d5d4741325570eaf93a294fc878` | `perf/typescript-body-row-ownership` |
| [#22](https://github.com/astrale-os/exp-codegraph/pull/22) | feat(distribution): propose publishing qualified npm artifacts | `dc2b1a7f83ad56e3249e0f194de7f8a17aa57f97` | `feat/typescript-contextual-operands` |

SDK consumer: [PR461](https://github.com/astrale-os/sdk/pull/461), branch
`feat/semantic-query-lint`, head `054a41caea15dfc0385048f45f2a47703be83a1b`,
draft against main. Its actual Codegraph distribution dependency and registry lock
remain incomplete; candidate archive qualification is documented in the closeout.
