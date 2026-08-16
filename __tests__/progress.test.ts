import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisTelemetryEvent } from '../analysis/index.ts'
import { createCliProgress, createDevStartupProgress } from '../cli/progress.ts'
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

describe('development startup progress', () => {
  it('renders real phases, elapsed time, and milestones on one interactive line', () => {
    vi.useFakeTimers()
    const updates: string[] = []
    const messages: string[] = []
    const progress = createDevStartupProgress({
      out: (message) => messages.push(message),
      error: () => undefined,
      update: (message) => updates.push(message),
      clear: () => undefined,
    })

    progress.onTelemetry(telemetry('store.selection', 'completed', { backend: 'durable' }))
    progress.onTelemetry(telemetry('application.inventory', 'started'))
    vi.advanceTimersByTime(1_000)
    progress.onTelemetry(telemetry('application.inventory', 'completed'))
    progress.onTelemetry(telemetry('application.discovery', 'started'))
    progress.succeed()

    expect(updates.some((message) => message.includes('Inventorying repository'))).toBe(true)
    expect(updates.some((message) => message.includes('Discovering specifications'))).toBe(true)
    expect(updates.some((message) => message.includes('2/8 · 1s'))).toBe(true)
    expect(updates.every((message) => !message.includes('%'))).toBe(true)
    expect(messages).toEqual(['✓ Specification viewer ready in 1s · durable cache'])
  })

  it('uses sparse stable lines outside an interactive terminal', () => {
    const messages: string[] = []
    const progress = createDevStartupProgress({
      out: (message) => messages.push(message),
      error: () => undefined,
    })

    progress.onTelemetry(telemetry('store.selection', 'completed', { backend: 'durable' }))
    progress.onTelemetry(telemetry('application.inventory', 'started'))
    progress.onTelemetry(
      telemetry('application.projection', 'completed', { specifications: 42 }),
    )
    progress.succeed()

    expect(messages).toEqual([
      'Initializing specification viewer...',
      'CODEGRAPH_STORE=durable',
      'Inventorying repository...',
      '✓ Specification viewer ready in 0s · durable cache · 42 specifications',
    ])
    expect(messages.join('\n')).not.toContain('\u001b[')
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

function telemetry(
  phase: string,
  status: 'started' | 'completed',
  metrics: Readonly<Record<string, string | number | boolean>> = {},
): AnalysisTelemetryEvent {
  return {
    format: 'astrale.codegraph.analysis-telemetry',
    version: 1,
    component: 'analysis',
    phase,
    metrics: { status, ...metrics },
  }
}
