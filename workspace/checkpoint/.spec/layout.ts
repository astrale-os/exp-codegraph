import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: false,
  entries: ['index.ts'],
  ignore: ['model.ts', 'store.ts', 'validation.ts'],
})
