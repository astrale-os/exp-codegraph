import { describe, expect, it } from 'vitest'

import type { ExampleResource } from '../specification/resource/index.ts'

import { groupExamples, presentExample } from '../viewer/specification/examples.tsx'

describe('examples reader', () => {
  it('derives human titles and hierarchy from source paths', () => {
    const presented = presentExample(
      example('./examples/getting-started/minimal-domain.ts', 'getting-started/minimal-domain.ts'),
    )

    expect(presented).toMatchObject({
      title: 'Minimal Domain',
      groups: ['Getting Started'],
    })
    expect(presented.id).toMatch(/^example-minimal-domain-[a-z0-9]+$/u)
  })

  it('groups arbitrary nested directories while preserving manifest order', () => {
    const examples = [
      presentExample(example('./examples/authoring/definitions/classes.ts', 'classes.ts')),
      presentExample(example('./examples/authoring/definitions/interfaces.ts', 'interfaces.ts')),
      presentExample(example('./examples/operations/accept-domain.ts', 'accept-domain.ts')),
    ]

    expect(groupExamples(examples)).toMatchObject({
      examples: [],
      groups: [
        {
          name: 'Authoring',
          groups: [
            {
              name: 'Definitions',
              examples: [{ title: 'Classes' }, { title: 'Interfaces' }],
            },
          ],
        },
        {
          name: 'Operations',
          examples: [{ title: 'Accept Domain' }],
        },
      ],
    })
  })
})

function example(ref: string, source: string): ExampleResource {
  return {
    ref,
    source,
    text: 'export {}\n',
    revision: 'revision',
    against: 'code',
    declarationPointer: '/examples/0',
  }
}
