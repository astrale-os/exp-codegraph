export type JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type JobEvent = 'start' | 'succeed' | 'fail' | 'cancel'

const transitions: Readonly<Record<JobState, Readonly<Partial<Record<JobEvent, JobState>>>>> = {
  pending: { start: 'running', cancel: 'cancelled' },
  running: { succeed: 'succeeded', fail: 'failed', cancel: 'cancelled' },
  succeeded: {},
  failed: {},
  cancelled: {},
}

export function applyJobEvent(state: JobState, event: JobEvent): JobState {
  const target = transitions[state][event]
  if (!target) throw new Error(`Illegal job transition: ${state} + ${event}`)
  return target
}
