import type { BoundedValueLimits } from './model.ts'

/** Governed default budget returned to callers as effective configuration. */
export const DEFAULT_BOUNDED_VALUE_LIMITS: Readonly<Required<BoundedValueLimits>> = Object.freeze({
  maximumDepth: 12,
  maximumSteps: 2_000,
  maximumAlternatives: 32,
})

export function resolveBoundedValueLimits(
  input: BoundedValueLimits = {},
): Readonly<Required<BoundedValueLimits>> {
  const limits = { ...DEFAULT_BOUNDED_VALUE_LIMITS, ...input }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer.`)
    }
  }
  return Object.freeze(limits)
}
