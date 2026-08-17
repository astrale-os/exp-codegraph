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
