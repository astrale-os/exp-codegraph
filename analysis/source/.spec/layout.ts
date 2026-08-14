import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: ['index.ts', 'model.ts', 'node-reader.ts', 'verify.ts'],
  exact: true,
})
