export interface TaskLimiter {
  run<Result>(task: () => Promise<Result>): Promise<Result>
}

/** Bound concurrent resource use without coupling the task implementation to queueing policy. */
export function createTaskLimiter(concurrency: number): TaskLimiter {
  const capacity = positiveInteger(concurrency, 1)
  let active = 0
  const waiting: Array<() => void> = []

  const acquire = (): Promise<void> => {
    if (active < capacity) {
      active++
      return Promise.resolve()
    }
    return new Promise((resolve) => waiting.push(resolve))
  }
  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  return {
    async run(task) {
      await acquire()
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}
