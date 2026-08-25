import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  exact: true,
  entries: [
    'acceleration.ts',
    'application.ts',
    'changes.ts',
    'check-report.ts',
    'checkpoint.ts',
    'evidence.ts',
    'limits.ts',
    'parse.ts',
    'progress.ts',
    'qualification-report.ts',
    'report.ts',
    'run.ts',
    'semantic-pack/',
    'semantic-pack/identity.ts',
    'semantic-pack/model.ts',
    'semantic-pack/store.ts',
    'version.ts',
  ],
})
