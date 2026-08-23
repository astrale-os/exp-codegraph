import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout({
  entries: [
    'index.ts',
    'snapshot/',
    'snapshot/batch.ts',
    'snapshot/compile.ts',
    'snapshot/index.ts',
    'snapshot/identity.ts',
    'snapshot/model.ts',
    'snapshot/resources.ts',
    'resource/',
  ],
  ignore: [
    'module/typescript-evidence.optimization.ts',
    'module/typescript-program.optimization.ts',
    'module/typescript-reference.optimization.ts',
  ],
})
