import { afterEach, describe, expect, it } from 'vitest'

import { createTypeSpecApplicationService } from '../application/index.ts'
import {
  APPLICATION_TEST_FACT_NAMESPACE,
  type ApplicationTestEvidenceFact,
} from '../application/observation/index.ts'
import { executeEvidenceTests, planEvidenceTests } from '../cli/evidence.ts'
import { fixture, type Fixture } from './fixture.ts'

const fixtures: Fixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('attached evidence test execution', () => {
  it('runs the changed module and its consumers without running upstream support', async () => {
    const current = await fixture({
      ...evidenceModule('support', '@fixture/support', 'SUPPORT-EVIDENCE'),
      ...evidenceModule(
        'owner',
        '@fixture/owner',
        'OWNER-EVIDENCE',
        "import type { Support } from '../../support/.spec/api.js'\nexport interface Owner { readonly support: Support }\n",
      ),
      ...evidenceModule(
        'consumer',
        '@fixture/consumer',
        'CONSUMER-EVIDENCE',
        "import type { Owner } from '../../owner/.spec/api.js'\nexport interface Consumer { readonly owner: Owner }\n",
      ),
    })
    fixtures.push(current)
    const application = await createTypeSpecApplicationService({
      root: current.root,
      repository: 'test:cli-evidence',
    })
    await application.refresh({
      select: ['owner'],
      includeDependents: true,
      focused: true,
      qualify: true,
      compilerAnalysis: false,
    })
    const reader = await application.open()

    const selected = await planEvidenceTests(current.root, reader, 'selected')
    const changed = await planEvidenceTests(current.root, reader, 'changed')

    expect(selected.groups.map((group) => group.packageName)).toEqual(['@fixture/owner'])
    expect(changed.groups.map((group) => group.packageName)).toEqual([
      '@fixture/consumer',
      '@fixture/owner',
    ])
    expect(changed.active).toBe(2)
    await reader.dispose()
    await application.dispose()
  })

  it('deduplicates attachments, reports inactive evidence, and runs packages sequentially', async () => {
    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/root', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface API {}\n',
      'module/.spec/laws/evidence.ts': `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const FIRST_LAW = defineLaw({ id: 'FIRST-LAW', statement: 'The first law always holds.', tests: [{ file: 'tests/evidence.test.ts', id: 'EVIDENCE-ACTIVE' }] })
export const SECOND_LAW = defineLaw({ id: 'SECOND-LAW', statement: 'The second law also holds.', tests: [{ file: 'tests/evidence.test.ts', id: 'EVIDENCE-ACTIVE' }, { file: 'tests/evidence.test.ts', id: 'EVIDENCE-SKIPPED' }, { file: 'tests/evidence.test.ts', id: 'EVIDENCE-TODO' }] })
`,
      'module/tests/evidence.test.ts': `import { it } from 'vitest'
/** @evidence EVIDENCE-ACTIVE */
it('runs', () => {})
/** @evidence EVIDENCE-SKIPPED */
it.skip('waits', () => {})
/** @evidence EVIDENCE-TODO */
it.todo('remains')
`,
    })
    fixtures.push(current)
    const application = await createTypeSpecApplicationService({
      root: current.root,
      repository: 'test:cli-evidence',
    })
    await application.refresh({ qualify: true, compilerAnalysis: false })
    const reader = await application.open()
    const loadedEvidence: unknown[] = []
    for (const universe of reader.snapshot.analysis?.universes ?? []) {
      const query = await reader.query(universe)
      try {
        for await (const fact of query.export({ namespaces: [APPLICATION_TEST_FACT_NAMESPACE] })) {
          const payload = fact.payload as ApplicationTestEvidenceFact
          loadedEvidence.push(
            ...payload.laws.flatMap((definition) => definition.evidence),
            ...payload.states.flatMap((definition) => definition.evidence),
          )
        }
      } finally {
        await query.dispose()
      }
    }
    expect(loadedEvidence).toHaveLength(4)
    const plan = await planEvidenceTests(current.root, reader, 'all')
    const calls: string[][] = []
    const groups: string[] = []
    const result = await executeEvidenceTests(
      current.root,
      plan,
      (group) => groups.push(group.packageName),
      {
        async run(_root, files) {
          calls.push([...files])
          return 0
        },
      },
    )

    expect(plan).toMatchObject({ active: 1, skipped: 1, todo: 1 })
    expect(plan.groups).toEqual([
      {
        packageName: '@fixture/root',
        files: ['module/tests/evidence.test.ts'],
        evidenceCount: 1,
      },
    ])
    expect(calls).toEqual([['module/tests/evidence.test.ts']])
    expect(groups).toEqual(['@fixture/root'])
    expect(result).toEqual({ passed: 1, failed: 0, failedPackages: [] })
    await reader.dispose()
    await application.dispose()
  })
})

function evidenceModule(
  directory: string,
  packageName: string,
  evidenceId: string,
  api = `export interface ${title(directory)} {}`,
): Record<string, string> {
  return {
    [`${directory}/package.json`]: JSON.stringify({ name: packageName, type: 'module' }),
    [`${directory}/.spec/api.d.ts`]: api,
    [`${directory}/.spec/laws/evidence.ts`]: `import { defineLaw } from '@astrale-os/codegraph/authoring'
export const ${evidenceId.replaceAll('-', '_')} = defineLaw({ id: ${JSON.stringify(evidenceId)}, statement: 'The attached behavior holds.', tests: [{ file: 'tests/evidence.test.ts', id: ${JSON.stringify(evidenceId)} }] })
`,
    [`${directory}/tests/evidence.test.ts`]: `import { it } from 'vitest'
/** @evidence ${evidenceId} */
it(${JSON.stringify(`runs ${directory}`)}, () => {})
`,
  }
}

function title(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
