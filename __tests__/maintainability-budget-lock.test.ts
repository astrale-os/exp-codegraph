import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { assertMaintainabilityBudgetLock } from '../qualification/v2/maintainability/lock.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('maintainability budget lock', () => {
  it('rejects an unratified ceiling edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-maintainability-lock-'))
    temporary.push(root)
    const budgetPath = join(root, 'budget.json')
    const budget = Buffer.from('{"maximum":1}\n')
    await writeFile(budgetPath, budget)
    await writeFile(join(root, 'budget.lock.json'), JSON.stringify({
      format: 'astrale.codegraph.maintainability-budget-lock',
      version: 1,
      sha256: createHash('sha256').update(budget).digest('hex'),
    }))

    await expect(assertMaintainabilityBudgetLock(budgetPath, budget)).resolves.toBeUndefined()
    await expect(
      assertMaintainabilityBudgetLock(budgetPath, Buffer.from('{"maximum":2}\n')),
    ).rejects.toThrow('does not match its ratified lock')
  })
})
