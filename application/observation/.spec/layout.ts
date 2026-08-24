import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: true,
  entries: [
    'index.ts',
    'materialize.ts',
    'materialize.optimization.ts',
    'model.ts',
    'schema-dependency.ts',
  ],
})
