import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: [
    'body/',
    'dependency.ts',
    'distribution/',
    'facts/',
    'index.ts',
    'model.ts',
    'native/',
    'pipeline.ts',
    'physical/',
    'refresh.optimization.ts',
    'service.ts',
    'surface/',
    'ttsc/',
    'universe-transaction.ts',
    'value/',
  ],
  exact: true,
  ignore: ['native/**'],
})
