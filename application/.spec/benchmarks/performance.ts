import { defineBenchmark } from '@astrale-os/codegraph/authoring'

export const TYPESPEC_COLD_FULL = defineBenchmark({
  id: 'TYPESPEC-COLD-FULL',
  statement: 'Records a cold full Kernel qualification through the headless application service.',
  workload: 'Refresh and qualify the complete Kernel specification corpus with an empty durable cache.',
  metrics: ['duration', 'peak-memory', 'sqlite-bytes', 'native-startup'],
})

export const TYPESPEC_WARM_FULL = defineBenchmark({
  id: 'TYPESPEC-WARM-FULL',
  statement: 'Bounds a no-change full Kernel refresh over retained native and materialized state.',
  workload: 'Repeat the complete Kernel qualification without changing repository inputs.',
  metrics: ['duration', 'peak-memory', 'reloaded-universes', 'rewritten-shards'],
})

export const TYPESPEC_FOCUSED_EDIT = defineBenchmark({
  id: 'TYPESPEC-FOCUSED-EDIT',
  statement: 'Bounds advisory feedback for one local source edit and its exact contract closure.',
  workload: 'Edit one Kernel TypeScript source, refresh its focused owner closure, and qualify it.',
  metrics: ['duration', 'invalidated-passes', 'reloaded-universes', 'rewritten-shards'],
})

export const CODEGRAPH_UNCHANGED_RESTART = defineBenchmark({
  id: 'CODEGRAPH-UNCHANGED-RESTART',
  statement: 'Bounds an unchanged new-process reopen through one validated workspace checkpoint.',
  workload:
    'Start a new process for the unchanged Kernel checkout and reopen its exact workspace, application, and catalog identities.',
  metrics: [
    'duration',
    'compiled-specifications',
    'native-extractions',
    'rewritten-shards',
    'written-bytes',
  ],
})

export const CODEGRAPH_SINGLE_OWNER_EDIT = defineBenchmark({
  id: 'CODEGRAPH-SINGLE-OWNER-EDIT',
  statement: 'Bounds one local specification edit through its exact application closure.',
  workload:
    'Edit one private Kernel specification resource and refresh its owner, derived observations, qualification, and viewer record.',
  metrics: [
    'duration',
    'compiled-specifications',
    'observed-specifications',
    'qualified-specifications',
    'projected-specifications',
    'rewritten-shards',
  ],
})
