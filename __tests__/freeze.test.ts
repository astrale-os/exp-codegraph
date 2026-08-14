import { describe, expect, it } from 'vitest'

import { freeze } from '../viewer/host/freeze.ts'

describe('renderer values', () => {
  it('freezes every nested value', () => {
    const value = { list: [{ name: 'before' }] }
    expect(freeze(value)).toBe(value)
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.list)).toBe(true)
    expect(Object.isFrozen(value.list[0])).toBe(true)
    expect(() => {
      value.list[0]!.name = 'after'
    }).toThrow()
  })
})
