import { defineLaw } from '@astrale-os/codegraph/authoring'

export const CLI_CHECKPOINT_EXACT_ADMISSION = defineLaw({
  id: 'CLI-CHECKPOINT-EXACT-ADMISSION',
  statement:
    'A check result is replayable only for the exact executable tree, normalized command request, repository identity, and byte-derived inventory that produced its snapshot and ordered output transcript.',
  tests: [{ file: '../__tests__/cli-v2.test.ts', id: 'CLI-CHECKPOINT-EXACT-ADMISSION' }],
})

export const CLI_CHECKPOINT_ADVISORY_RECOVERY = defineLaw({
  id: 'CLI-CHECKPOINT-ADVISORY-RECOVERY',
  statement:
    'Missing, malformed, corrupt, racing, or version-incompatible restart evidence is a cache miss; only a completed canonical check may publish a replacement.',
  tests: [{ file: '../__tests__/cli-v2.test.ts', id: 'CLI-CHECKPOINT-ADVISORY-RECOVERY' }],
})

export const CLI_CHECKPOINT_SELECTED_PROJECTION = defineLaw({
  id: 'CLI-CHECKPOINT-SELECTED-PROJECTION',
  statement:
    'A whole-check catalog may answer an arbitrary selected request only by applying the canonical owner and dependency closure to specification-scoped qualifications and explicitly partitioned shared diagnostics from the same admitted inventory.',
  tests: [{ file: '../__tests__/cli-v2.test.ts', id: 'CLI-CHECKPOINT-SELECTED-PROJECTION' }],
})

export const CLI_SEMANTIC_PACK_CATALOG_PROJECTION = defineLaw({
  id: 'CLI-SEMANTIC-PACK-CATALOG-PROJECTION',
  statement:
    'One atomic portable check-pack manifest may expose exact output and a whole-check catalog; a reader admits only the shard required by its normalized request, and a read-only catalog may answer another selected request without a local cache or application construction only when that closure and its SourceProof, producer, repository, and request-family identities reproduce the forced-canonical terminal transcript and exit status.',
  tests: [
    {
      file: '../__tests__/cli-acceleration.test.ts',
      id: 'CLI-SEMANTIC-PACK-CATALOG-PROJECTION',
    },
  ],
})

export const CLI_SEMANTIC_PACK_PUBLICATION_FAILURE = defineLaw({
  id: 'CLI-SEMANTIC-PACK-PUBLICATION-FAILURE',
  statement:
    'Semantic-pack publication failure is attributable in the acceleration receipt and remains advisory: it cannot change the completed canonical transcript, exit status, diagnostics, or result identities.',
  tests: [
    {
      file: '../__tests__/cli-acceleration.test.ts',
      id: 'CLI-SEMANTIC-PACK-PUBLICATION-FAILURE',
    },
  ],
})

export const CLI_SEMANTIC_PACK_APPLICATION_FALLBACK = defineLaw({
  id: 'CLI-SEMANTIC-PACK-APPLICATION-FALLBACK',
  statement:
    'The portable check-pack root commits to its SourceProof-bound sharded application manifest; when a compact request shard is unavailable, a read-only consumer may restore that exact corpus without compilation and must still reproduce the forced-canonical terminal transcript and exit status.',
  tests: [
    {
      file: '../__tests__/cli-acceleration.test.ts',
      id: 'CLI-SEMANTIC-PACK-CATALOG-PROJECTION',
    },
  ],
})

export const CLI_SEMANTIC_PACK_IDENTITY_ATOMICITY = defineLaw({
  id: 'CLI-SEMANTIC-PACK-IDENTITY-ATOMICITY',
  statement:
    'A semantic check-pack root exposes one complete publication only after SourceProof, producer, repository, request family, exact request or catalog closure, and any application-manifest reference are admitted; concurrent publishers cannot mix their result fields or artifacts.',
  tests: [
    {
      file: '../__tests__/semantic-pack.test.ts',
      id: 'CLI-SEMANTIC-PACK-IDENTITY-ATOMICITY',
    },
  ],
})

export const CLI_ACCELERATION_WORK_OBSERVABILITY = defineLaw({
  id: 'CLI-ACCELERATION-WORK-OBSERVABILITY',
  statement:
    'Every admitted or published result and semantic-pack shard reports its compressed bytes, decoded bytes, and loaded or written shard count from the owned codec result without changing command semantics.',
  tests: [
    {
      file: '../__tests__/semantic-pack.test.ts',
      id: 'CLI-ACCELERATION-WORK-OBSERVABILITY',
    },
  ],
})

export const CLI_SEMANTIC_PACK_PLAN_BINDING = defineLaw({
  id: 'CLI-SEMANTIC-PACK-PLAN-BINDING',
  statement:
    'A portable check pack explicitly binds the ordered qualification profiles, empty application capability set, disabled compiler analysis, and empty schema-root set; any plan drift is a manifest miss before result, catalog, or application shards are loaded.',
  tests: [
    {
      file: '../__tests__/semantic-pack.test.ts',
      id: 'CLI-SEMANTIC-PACK-PLAN-BINDING',
    },
  ],
})

export const CLI_CHECKPOINT_CONCURRENT_PUBLISH = defineLaw({
  id: 'CLI-CHECKPOINT-CONCURRENT-PUBLISH',
  statement:
    'Concurrent processes may race to publish the same admitted result, but readers observe one complete canonical artifact or a miss and never a partial transcript.',
  tests: [{ file: '../__tests__/cli-v2.test.ts', id: 'CLI-CHECKPOINT-CONCURRENT-PUBLISH' }],
})

export const CLI_CHECKPOINT_INVENTORY_CHURN = defineLaw({
  id: 'CLI-CHECKPOINT-INVENTORY-CHURN',
  statement:
    'Same-size writes, creates, renames, deletes, and reverts change result admission through the canonical byte-derived repository inventory even when a prior request checkpoint exists.',
  tests: [{ file: '../__tests__/cli-v2.test.ts', id: 'CLI-CHECKPOINT-INVENTORY-CHURN' }],
})

export const CLI_RESTART_PROCESS_BOUNDARY = defineLaw({
  id: 'CLI-RESTART-PROCESS-BOUNDARY',
  statement:
    'Warm restart evidence uses distinct operating-system processes, one shared cache, canonical primes, interleaved request shapes, byte-exact output parity, and exclusive duration ceilings for every sample and p95.',
  tests: [
    {
      file: '../__tests__/cli-restart-qualification.test.ts',
      id: 'CLI-RESTART-PROCESS-BOUNDARY',
    },
  ],
})
