import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Reject an unratified maintainability-ceiling edit before measuring the candidate. */
export async function assertMaintainabilityBudgetLock(
  budgetPath: string,
  budgetBytes: Uint8Array,
): Promise<void> {
  const value: unknown = JSON.parse(
    await readFile(resolve(dirname(budgetPath), 'budget.lock.json'), 'utf8'),
  )
  const sha256 = createHash('sha256').update(budgetBytes).digest('hex')
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { readonly format?: unknown }).format !==
      'astrale.codegraph.maintainability-budget-lock' ||
    (value as { readonly version?: unknown }).version !== 1 ||
    (value as { readonly sha256?: unknown }).sha256 !== sha256
  ) {
    throw new Error('Maintainability budget does not match its ratified lock.')
  }
}
