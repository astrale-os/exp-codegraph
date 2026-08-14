import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCliProgress } from '../cli/progress.ts'
import { estimatedCatalogProgress } from '../viewer/shell/app.tsx'

afterEach(() => vi.useRealTimers())

describe('CLI catalog progress', () => {
  it('reports completed modules and names active work in a heartbeat', () => {
    vi.useFakeTimers()
    const messages: string[] = []
    const progress = createCliProgress(
      { out: (message) => messages.push(message), error: () => undefined },
      false,
    )

    progress.onProgress({
      phase: 'load',
      status: 'started',
      source: 'runtime/query/.spec',
      completed: 0,
      total: 2,
    })
    vi.advanceTimersByTime(10_000)
    progress.onProgress({
      phase: 'load',
      status: 'completed',
      source: 'runtime/query/.spec/api.d.ts',
      completed: 1,
      total: 2,
    })
    progress.close()

    expect(messages).toEqual([
      'Still checking load after 10s. Active: runtime/query/.spec.',
      '[1/2] runtime/query/.spec/api.d.ts',
    ])
  })
})

describe('catalog loading progress', () => {
  it('advances quickly through the expected window and keeps crawling below completion', () => {
    expect(estimatedCatalogProgress(0)).toBeCloseTo(0.03)
    expect(estimatedCatalogProgress(1_000)).toBeCloseTo(0.25)
    expect(estimatedCatalogProgress(8_000)).toBeCloseTo(0.68)
    expect(estimatedCatalogProgress(30_000)).toBeCloseTo(0.91)

    const samples = [0, 1_000, 8_000, 30_000, 60_000, 120_000, 1_000_000].map(
      estimatedCatalogProgress,
    )
    expect(samples.every((value, index) => index === 0 || value > samples[index - 1]!)).toBe(true)
    expect(samples.at(-1)).toBeLessThan(1)
  })

  it('decelerates instead of becoming visually stuck', () => {
    const firstSecond = estimatedCatalogProgress(1_000) - estimatedCatalogProgress(0)
    const ninthSecond = estimatedCatalogProgress(9_000) - estimatedCatalogProgress(8_000)
    const thirtyFirstSecond = estimatedCatalogProgress(31_000) - estimatedCatalogProgress(30_000)

    expect(firstSecond).toBeGreaterThan(ninthSecond)
    expect(ninthSecond).toBeGreaterThan(thirtyFirstSecond)
    expect(thirtyFirstSecond).toBeGreaterThan(0)
  })
})
