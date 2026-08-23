import { describe, expect, it } from 'vitest'

import { mapApplicationObservationOwners } from '../application/observation/materialize.optimization.ts'

describe('application observation scheduling optimization', () => {
  it('bounds owner work and preserves canonical input order', async () => {
    let active = 0
    let maximumActive = 0
    const output = await mapApplicationObservationOwners(
      Array.from({ length: 12 }, (_, index) => index),
      async (index) => {
        active++
        maximumActive = Math.max(maximumActive, active)
        await new Promise<void>((resolve) => setTimeout(resolve, (12 - index) % 4))
        active--
        return `owner-${index}`
      },
    )

    expect(maximumActive).toBe(4)
    expect(output).toEqual(Array.from({ length: 12 }, (_, index) => `owner-${index}`))
  })

  it('reports the canonical earliest owner failure and stops admitting work', async () => {
    const started: number[] = []
    const operation = mapApplicationObservationOwners(
      Array.from({ length: 12 }, (_, index) => index),
      async (index) => {
        started.push(index)
        if (index === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
          throw new RangeError('owner-0')
        }
        if (index === 1) throw new TypeError('owner-1')
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        return index
      },
    )

    await expect(operation).rejects.toThrow(new RangeError('owner-0'))
    expect(started).toEqual([0, 1, 2, 3])
  })
})
