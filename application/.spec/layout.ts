import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: true,
  entries: [
    'limits.ts',
    'analysis/',
    'discovery/',
    'interaction/',
    'node/',
    'observation/',
    'selection/',
    'snapshot/',
    'index.ts',
    'model.ts',
    'service.ts',
  ],
})
