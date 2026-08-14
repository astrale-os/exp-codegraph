import { defineState } from '@astrale-os/codegraph/authoring'

export const jobState = defineState({
  initial: 'pending',
  transitions: {
    pending: { start: 'running', cancel: 'cancelled' },
    running: { succeed: 'succeeded', fail: 'failed', cancel: 'cancelled' },
    succeeded: {},
    failed: {},
    cancelled: {},
  },
})
