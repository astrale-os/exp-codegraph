import { defineLayout } from '@astrale-os/codegraph/authoring'

export default defineLayout([
  'src/',
  'src/value.ts',
  'src/domain/',
  'src/domain/model.ts',
  'src/domain/normalize.ts',
  'src/domain/invariants.ts',
  'src/runtime/',
  'src/runtime/context.ts',
  'src/runtime/dispatch.ts',
  'src/runtime/cleanup.ts',
  'src/adapters/',
  'src/adapters/storage/',
  'src/adapters/storage/read.ts',
  'src/adapters/storage/write.ts',
])
