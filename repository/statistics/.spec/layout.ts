import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: true,
  entries: [
    'aggregate.ts',
    'analyze.ts',
    'grouping.ts',
    'incremental.ts',
    'index.ts',
    'lines.ts',
    'model.ts',
  ],
})
