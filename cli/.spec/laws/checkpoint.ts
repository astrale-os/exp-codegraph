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
