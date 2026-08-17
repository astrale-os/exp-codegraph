import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: false,
  entries: ['index.ts'],
  ignore: ['json.ts', 'model.ts', 'store.ts', 'validation.ts'],
})
