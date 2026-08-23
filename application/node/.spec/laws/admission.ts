import { defineLaw } from '@astrale-os/codegraph/authoring'

export const APPLICATION_CHECKPOINT_PRODUCER_IDENTITY = defineLaw({
  id: 'APPLICATION-CHECKPOINT-PRODUCER-IDENTITY',
  statement:
    'An application, inventory, or CLI checkpoint is admissible only for the exact executable Codegraph package tree and cache representation that produced it; a release version alone is insufficient identity.',
  tests: [
    {
      file: '../../__tests__/application-node-fingerprint.test.ts',
      id: 'APPLICATION-CHECKPOINT-PRODUCER-IDENTITY',
    },
  ],
})

export const APPLICATION_INVENTORY_DIRECTORY_TOPOLOGY = defineLaw({
  id: 'APPLICATION-INVENTORY-DIRECTORY-TOPOLOGY',
  statement:
    'Node application inventory identity binds admitted directory topology as well as regular-file bytes because empty optional directories can change exact layout conformance.',
  tests: [
    {
      file: '../../__tests__/application-node-inventory.test.ts',
      id: 'APPLICATION-INVENTORY-DIRECTORY-TOPOLOGY',
    },
  ],
})

export const APPLICATION_PORTABLE_CHECKPOINT_ADMISSION = defineLaw({
  id: 'APPLICATION-PORTABLE-CHECKPOINT-ADMISSION',
  statement:
    'A caller-owned portable application checkpoint is restorable only through its exact SourceProof-bound manifest commitment; a read-only binding performs no publication, transfers no store ownership, and reconstructs the canonical application snapshot without compilation.',
  tests: [
    {
      file: '../../__tests__/application-checkpoint.test.ts',
      id: 'APPLICATION-PORTABLE-CHECKPOINT-ADMISSION',
    },
  ],
})

export const APPLICATION_CHECKPOINT_REQUEST_PROJECTION = defineLaw({
  id: 'APPLICATION-CHECKPOINT-REQUEST-PROJECTION',
  statement:
    'A non-exact portable application restore reads only the normalized requested dependency closure, and corruption outside that closure cannot invalidate the admitted result.',
  tests: [
    {
      file: '../../__tests__/application-checkpoint.test.ts',
      id: 'APPLICATION-CHECKPOINT-REQUEST-PROJECTION',
    },
  ],
})

export const SOURCE_PROOF_MUTATION_FALLBACK = defineLaw({
  id: 'SOURCE-PROOF-MUTATION-FALLBACK',
  statement:
    'A dirty semantic source that changes while either bounded admission attempt is reading it cannot produce a SourceProof; the Node adapter returns an attributable retryable proof-unstable fallback to the complete scanner.',
  tests: [
    {
      file: '../../__tests__/source-proof.test.ts',
      id: 'SOURCE-PROOF-MUTATION-FALLBACK',
    },
  ],
})
