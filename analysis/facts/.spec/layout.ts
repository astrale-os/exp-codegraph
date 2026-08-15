import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: ['index.ts', 'model.ts', 'representation/', 'types.ts'],
  exact: true,
})
