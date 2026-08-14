import type { JobEvent, JobState } from './api.js'

export interface JobTransitionStore {
  persist(from: JobState, event: JobEvent, to: JobState): Promise<void>
}
