import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { stableJson } from '../../../analysis/identity/model.ts'
import { normalizedCheckArgv, type PerformanceClass } from './model.ts'

const body = {
  format: 'astrale.codegraph.performance-constitution' as const,
  version: 1 as const,
  corpus: {
    repository: 'astrale-os/kernel-v2',
    revision: 'bfe6be8e7964f3d9d8b0b9d932802bd4d1cd740b',
  },
  check: {
    commonArguments: ['--require-complete-layout', '--quiet', '--no-cache'],
    workloads: [
      { id: 'whole', selectors: [], minimumOwners: 361, expectedExitCode: 1 },
      { id: 'leaf', selectors: ['core/auth/trust'], maximumOwners: 25, expectedExitCode: 0 },
      { id: 'dependency-heavy', selectors: ['backend'], minimumOwners: 100, expectedExitCode: 1 },
      {
        id: 'multi-select',
        selectors: ['protocol/codecs', 'server/lifecycle'],
        minimumOwners: 2,
        expectedExitCode: 0,
      },
    ],
  },
  mutations: [
    'private-documentation', 'api-declaration', 'port-declaration', 'package-authority',
    'typescript-configuration', 'layout', 'test-evidence', 'create', 'delete', 'rename',
    'revert', 'dirty', 'untracked', 'ignored', 'symlink', 'executable-mode', 'a-b-a',
  ],
  failures: [
    'corruption', 'truncation', 'oversize', 'concurrency', 'cancellation', 'toctou',
    'missing-producer', 'missing-closure', 'unreadable-source',
  ],
  counters: [
    'wall-time', 'user-cpu-time', 'system-cpu-time', 'runner-peak-rss', 'native-peak-rss',
    'bytes-traversed', 'bytes-read', 'bytes-hashed', 'bytes-decoded', 'compiler-sessions',
    'compiler-programs', 'compiled-owners', 'observed-owners', 'qualified-owners',
    'loaded-shards', 'written-shards', 'fallbacks', 'phase-timings',
  ],
} as const

export const CHECK_PERFORMANCE_CONSTITUTION = Object.freeze({
  ...body,
  sha256: createHash('sha256').update(stableJson(body)).digest('hex'),
})

export type CheckPerformanceWorkload =
  (typeof CHECK_PERFORMANCE_CONSTITUTION.check.workloads)[number]

export function constitutedCheckArgv(
  root: string,
  workload: CheckPerformanceWorkload,
): readonly string[] {
  return [
    'check',
    root,
    ...workload.selectors.flatMap((selector) => ['--select', selector]),
    ...CHECK_PERFORMANCE_CONSTITUTION.check.commonArguments,
  ]
}

/** Refuse performance evidence after an unratified constitution edit. */
export async function assertRatifiedPerformanceConstitution(): Promise<void> {
  const lock: unknown = JSON.parse(
    await readFile(new URL('./constitution.lock.json', import.meta.url), 'utf8'),
  )
  if (
    !lock ||
    typeof lock !== 'object' ||
    Array.isArray(lock) ||
    (lock as { readonly format?: unknown }).format !==
      'astrale.codegraph.performance-constitution-lock' ||
    (lock as { readonly version?: unknown }).version !== 1 ||
    (lock as { readonly sha256?: unknown }).sha256 !== CHECK_PERFORMANCE_CONSTITUTION.sha256
  ) {
    throw new Error('Performance constitution does not match its ratified lock.')
  }
}

export function assertConstitutedCheckRequest(
  repositoryRevision: string,
  performanceClass: PerformanceClass,
  argv: readonly string[],
): void {
  if (repositoryRevision !== CHECK_PERFORMANCE_CONSTITUTION.corpus.revision) {
    throw new Error('Performance receipt corpus revision is outside the ratified constitution.')
  }
  const request = JSON.stringify(normalizedCheckArgv(argv))
  if (
    (performanceClass === 'C1' || performanceClass === 'C3') &&
    !CHECK_PERFORMANCE_CONSTITUTION.check.workloads.some((workload) =>
      request === JSON.stringify(normalizedCheckArgv(constitutedCheckArgv('<corpus-root>', workload))),
    )
  ) {
    throw new Error('Performance receipt request is outside the ratified constitution.')
  }
}
