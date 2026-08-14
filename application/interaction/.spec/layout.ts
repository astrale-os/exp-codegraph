import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: true,
  entries: [
    'http/',
    'http/editing.ts',
    'http/qualification.ts',
    'http/reveal.ts',
    'editing.ts',
    'index.ts',
    'qualification-model.ts',
    'qualification.ts',
    'reveal.ts',
  ],
})
