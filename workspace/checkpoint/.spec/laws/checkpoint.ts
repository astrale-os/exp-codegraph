import { defineLaw } from '@astrale-os/codegraph/authoring'

export const CHECKPOINT_IS_ADVISORY = defineLaw({
  id: 'CHECKPOINT-IS-ADVISORY',
  statement:
    'Missing, corrupt, incompatible, or oversized checkpoint data produces a cache miss and can never replace semantic validation.',
  tests: [
    { file: '../../__tests__/workspace-checkpoint.test.ts', id: 'CHECKPOINT-ADVISORY-MISS' },
  ],
})

export const CHECKPOINT_PUBLICATION_IS_ATOMIC = defineLaw({
  id: 'CHECKPOINT-PUBLICATION-IS-ATOMIC',
  statement:
    'A published scope exposes either its preceding complete manifest or its next complete manifest and digest-verified artifacts, never partial bytes.',
  tests: [
    {
      file: '../../__tests__/workspace-checkpoint.test.ts',
      id: 'CHECKPOINT-ATOMIC-PUBLICATION',
    },
  ],
})

export const CHECKPOINT_SELECTIVE_ARTIFACT_ADMISSION = defineLaw({
  id: 'CHECKPOINT-SELECTIVE-ARTIFACT-ADMISSION',
  statement:
    'Manifest-only and selected-artifact loads validate the complete bounded manifest and every requested artifact digest while performing no read or admission of an omitted artifact.',
  tests: [
    {
      file: '../../__tests__/workspace-checkpoint.test.ts',
      id: 'CHECKPOINT-SELECTIVE-ARTIFACT-ADMISSION',
    },
  ],
})
