import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: ['index.ts'],
  exact: true,
  // Versioned body tuples remain private behind the physical codec facade.
  ignore: ['body.ts'],
})
