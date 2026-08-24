import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: true,
  entries: [
    'boundary.ts',
    'index.ts',
    'model.ts',
    'native.ts',
    'workspace-observability.ts',
    'workspace.optimization.ts',
    'workspace.ts',
  ],
})
