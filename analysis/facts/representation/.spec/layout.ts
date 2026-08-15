import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: ['index.ts'],
  exact: true,
  // Codec state and lazy decoding remain private behind the representation facade.
  ignore: ['codec.ts'],
})
