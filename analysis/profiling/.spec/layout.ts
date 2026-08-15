import { defineLayout } from '@astrale-os/codegraph/authoring'

// Profiling exposes one durable headless facade. Its telemetry implementation
// remains intentionally free to evolve without file-inventory governance.
export default defineLayout({
  entries: ['index.ts'],
  exact: false,
})
