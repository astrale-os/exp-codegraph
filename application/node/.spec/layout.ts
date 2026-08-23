import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: [
    'checkpoint.ts',
    'fingerprint.ts',
    'index.ts',
    'inventory.ts',
    'service.ts',
    'source-proof.ts',
    'topology.ts',
  ],
  ignore: ['git-inventory.optimization.ts', 'topology.optimization.ts'],
  exact: true,
})
