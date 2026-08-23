import { createHash } from 'node:crypto'

import { CHECK_SEMANTIC_PLAN } from './model.ts'

/** Address one exact source, producer, repository, family, and semantic-plan pack. */
export function semanticPackScope(input: {
  readonly sourceProof: string
  readonly producerFingerprint: string
  readonly repository: string
  readonly family: string
}): string {
  const identity = JSON.stringify({ ...input, plan: CHECK_SEMANTIC_PLAN })
  return `semantic-pack-${createHash('sha256').update(identity).digest('hex')}`
}
