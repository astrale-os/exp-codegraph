import { defineCapability } from '@astrale-os/codegraph/authoring'

export const JOB_LIFECYCLE = defineCapability({
  id: 'JOB-LIFECYCLE',
  statement: 'Jobs evolve through a finite lifecycle.',
})
