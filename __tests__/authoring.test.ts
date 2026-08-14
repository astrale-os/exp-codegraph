import { describe, expect, it } from 'vitest'

import {
  defineBenchmark,
  defineCapability,
  defineLaw,
  defineLayout,
  definePackage,
  definePackagePattern,
  defineState,
  eventsOf,
  illegalTransitionsOf,
  statesOf,
  transition,
  transitionsOf,
} from '../authoring/index.ts'

describe('module specification authoring', () => {
  it('keeps non-state descriptors as transparent data', () => {
    const law = { id: 'MUT-ATOMIC', statement: 'Mutation effects are atomic.' } as const
    const capability = { id: 'QRY-FILTER', statement: 'Queries can filter values.' } as const
    const benchmark = {
      id: 'QRY-FILTER-SCALE',
      statement: 'Characterizes filtering as the input grows.',
      workload: 'Filter a deterministic collection at representative scales.',
      metrics: ['duration'],
    } as const
    const dependency = { package: 'jose', purpose: 'Implements credential signatures.' } as const
    const pattern = { pattern: '@types/*', reason: 'Ambient development declarations.' } as const
    const layout = ['src/', 'src/index.ts'] as const
    const configuredLayout = {
      entries: layout,
      exact: true,
      ignore: ['**/*.test.*'],
    } as const

    expect(defineLaw(law)).toBe(law)
    expect(defineCapability(capability)).toBe(capability)
    expect(defineBenchmark(benchmark)).toBe(benchmark)
    expect(definePackage(dependency)).toBe(dependency)
    expect(definePackagePattern(pattern)).toBe(pattern)
    expect(defineLayout(layout)).toBe(layout)
    expect(defineLayout(configuredLayout)).toBe(configuredLayout)
  })

  it('derives legal, illegal, initial, and terminal state topology deterministically', () => {
    const job = defineState({
      initial: 'pending',
      transitions: {
        pending: { start: 'running', cancel: 'cancelled' },
        running: { succeed: 'succeeded', cancel: 'cancelled' },
        succeeded: {},
        cancelled: {},
      },
    })

    expect(statesOf(job)).toEqual(['pending', 'running', 'succeeded', 'cancelled'])
    expect(eventsOf(job)).toEqual(['start', 'cancel', 'succeed'])
    expect(eventsOf(job, 'running')).toEqual(['succeed', 'cancel'])
    expect(transitionsOf(job)).toEqual([
      { from: 'pending', event: 'start', to: 'running' },
      { from: 'pending', event: 'cancel', to: 'cancelled' },
      { from: 'running', event: 'succeed', to: 'succeeded' },
      { from: 'running', event: 'cancel', to: 'cancelled' },
    ])
    expect(illegalTransitionsOf(job)).toEqual([
      { from: 'pending', event: 'succeed' },
      { from: 'running', event: 'start' },
      { from: 'succeeded', event: 'start' },
      { from: 'succeeded', event: 'cancel' },
      { from: 'succeeded', event: 'succeed' },
      { from: 'cancelled', event: 'start' },
      { from: 'cancelled', event: 'cancel' },
      { from: 'cancelled', event: 'succeed' },
    ])
    expect(transition(job, 'pending', 'start')).toBe('running')
  })

  it('rejects an illegal transition at runtime when called from untyped JavaScript', () => {
    const state = defineState({ transitions: { ready: { finish: 'done' }, done: {} } })
    const call = transition as (definition: typeof state, from: string, event: string) => string

    expect(() => call(state, 'done', 'finish')).toThrow('Illegal state transition: done + finish')
  })
})
