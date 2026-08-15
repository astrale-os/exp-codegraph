import { portablePath } from '../../analysis/identity/index.ts'
import type { RepositoryFile } from '../model.ts'
import type { RepositoryStatisticsGrouping } from './model.ts'

export interface RepositoryPathOwner {
  /** Repository-relative directory owned by this group. `.` owns the repository root. */
  readonly root: string
  readonly key: string
  readonly label?: string
}

/**
 * Build one deterministic, single-owner grouping from nested repository roots.
 * The deepest matching root wins, so a child module does not inflate its parent.
 */
export function createRepositoryPathOwnershipGrouping(
  id: string,
  owners: readonly RepositoryPathOwner[],
): RepositoryStatisticsGrouping {
  if (!id.trim()) throw new Error('Repository statistics grouping id must not be empty.')
  const normalized = owners.map((owner) => ({
    ...owner,
    root: normalizeRoot(owner.root),
  }))
  const roots = new Set<string>()
  for (const owner of normalized) {
    if (!owner.key.trim()) throw new Error('Repository statistics owner key must not be empty.')
    if (roots.has(owner.root)) {
      throw new Error(`Repository statistics ownership root is ambiguous: ${owner.root}.`)
    }
    roots.add(owner.root)
  }
  normalized.sort(
    (left, right) =>
      depth(right.root) - depth(left.root) ||
      left.root.localeCompare(right.root) ||
      left.key.localeCompare(right.key),
  )
  return {
    id,
    values(file: RepositoryFile) {
      const owner = normalized.find((candidate) => owns(candidate.root, file.path))
      return owner
        ? [{ key: owner.key, ...(owner.label ? { label: owner.label } : {}) }]
        : [{ key: 'unassigned' }]
    },
  }
}

function normalizeRoot(root: string): string {
  const input = root.trim().replace(/^\.\//u, '').replace(/\/$/u, '') || '.'
  const normalized = input === '.' ? input : portablePath(input)
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Repository statistics ownership root must be repository-relative: ${root}.`)
  }
  return normalized
}

function owns(root: string, path: string): boolean {
  return root === '.' || path === root || path.startsWith(`${root}/`)
}

function depth(root: string): number {
  return root === '.' ? 0 : root.split('/').length
}
