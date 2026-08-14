import { transition } from '@astrale-os/codegraph/authoring'

import { jobState } from '../states/job.js'

export function startJob() {
  return transition(jobState, 'pending', 'start')
}
