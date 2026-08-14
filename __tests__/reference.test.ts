import { describe, expect, it } from 'vitest'

import { pointerFromPath, readPointer } from '../reference/index.ts'

describe('JSON pointers', () => {
  it('reads root, escaped object keys, and array positions', () => {
    const value = { 'a/b': { '~key': ['zero', undefined] } }
    expect(readPointer(value, '')).toEqual({ found: true, value })
    expect(readPointer(value, '/a~1b/~0key/0')).toEqual({ found: true, value: 'zero' })
    expect(readPointer(value, '/a~1b/~0key/1')).toEqual({ found: true, value: undefined })
    expect(readPointer(value, '/a~1b/~0key/2')).toEqual({ found: false })
  })

  it('produces escaped pointers from data paths', () => {
    expect(pointerFromPath(['a/b', '~key', 0])).toBe('/a~1b/~0key/0')
  })
})
