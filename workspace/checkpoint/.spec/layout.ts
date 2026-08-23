import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: false,
  entries: ['index.ts'],
  ignore: ['json.ts', 'model.ts', 'store.optimization.ts', 'store.ts', 'validation.ts'],
})
