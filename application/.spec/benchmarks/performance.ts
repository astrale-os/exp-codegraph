import { defineBenchmark } from '@astrale-os/codegraph/authoring'

export const TYPESPEC_COLD_FULL = defineBenchmark({
  id: 'TYPESPEC-COLD-FULL',
  statement: 'Bounds a cold full Kernel qualification through the headless application service.',
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
