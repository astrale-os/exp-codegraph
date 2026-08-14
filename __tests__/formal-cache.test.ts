import { describe, expect, it, vi } from 'vitest'

const katex = vi.hoisted(() => ({
  renderToString: vi.fn((value: string) => `<math>${value}</math>`),
}))

vi.mock('katex', () => ({ renderToString: katex.renderToString }))

import { renderFormalMath } from '../viewer/specification/formal.ts'

describe('formal math cache', () => {
  it('reuses rendered markup for the same immutable formula projection', () => {
    const links = [{ from: 0, to: 7, href: '?spec=module&tab=api' }] as const

    const first = renderFormalMath('prepare(x)', links)
    const second = renderFormalMath('prepare(x)', links)

    expect(second).toBe(first)
    expect(katex.renderToString).toHaveBeenCalledTimes(1)
  })
})
