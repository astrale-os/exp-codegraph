import { describe, expect, it } from 'vitest'

import { canonicalTypeProviderCoordinate } from '../typescript/package-coordinate.ts'

describe('TypeScript package coordinates', () => {
  it.each([
    ['package:@types/react/index.d.ts', 'package:react/index.d.ts'],
    ['package:@types/babel__core/index.d.ts', 'package:@babel/core/index.d.ts'],
    ['package:react/index.d.ts', 'package:react/index.d.ts'],
  ])('maps declaration provider %s to %s', (input, expected) => {
    expect(canonicalTypeProviderCoordinate(input)).toBe(expected)
  })
})
