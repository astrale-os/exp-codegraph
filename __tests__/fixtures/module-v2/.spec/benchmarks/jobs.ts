import { defineBenchmark } from '@astrale-os/codegraph/authoring'

export const JOB_LIFECYCLE_BATCH = defineBenchmark({
  id: 'JOB-LIFECYCLE-BATCH',
  statement: 'Characterizes finite lifecycle transition throughput.',
  capability: 'JOB-LIFECYCLE',
  workload: 'Apply one thousand representative legal transitions.',
  metrics: ['duration', 'transitions-per-second'],
})
