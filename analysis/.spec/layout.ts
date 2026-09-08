import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: [
    'binding/',
    'facts/',
    'generation/',
    'identity/',
    'index.ts',
    'internal/',
    'internal/manifest.ts',
    'internal/ordered-map.ts',
    'internal/query-index.ts',
    'internal/state.ts',
    'memory/',
    'pass/',
    'policy/',
    'profiling/',
    'protocol/',
    'query/',
    'source/',
    'sqlite/',
    'store-selection.ts',
    'typescript/',
  ],
  exact: true,
})
