import type { NativeBodyDemand } from './model.ts'

export function isBodyDemandPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') &&
    !/[\\\u0000]/.test(value) &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

/** Validate before publishing selection intent to a resident owner. */
export function captureBodyDemand(input: NativeBodyDemand): NativeBodyDemand {
  const paths = [...input.paths]
  if (paths.some((path) => !isBodyDemandPath(path))) {
    throw new TypeError('Body demand requires canonical owned logical source paths.')
  }
  return Object.freeze({ paths: Object.freeze([...new Set(paths)].sort()) })
}
