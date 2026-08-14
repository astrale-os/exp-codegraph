import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: true,
  entries: ['index.ts', 'native.ts', 'plugin.cjs'],
})
