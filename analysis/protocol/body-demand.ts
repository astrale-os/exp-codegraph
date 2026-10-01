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
  const owners = input.owners === undefined ? undefined : [...input.owners]
  if (owners?.some((owner) => typeof owner !== 'string' || owner.length === 0)) {
    throw new TypeError('Body demand requires nonempty owner identities.')
  }
  return Object.freeze({ paths: Object.freeze([...new Set(paths)].sort()),
    ...(owners !== undefined ? { owners: Object.freeze([...new Set(owners)].sort()) } : {}),
  })
}
