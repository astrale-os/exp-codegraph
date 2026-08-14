export type JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type JobEvent = 'start' | 'succeed' | 'fail' | 'cancel'

export function applyJobEvent(state: JobState, event: JobEvent): JobState
