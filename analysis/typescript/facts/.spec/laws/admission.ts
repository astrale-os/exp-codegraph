import { defineLaw } from '@astrale-os/codegraph/authoring'

export const TYPESCRIPT_FACT_READER_ADMISSION = defineLaw({
  id: 'TYPESCRIPT-FACT-READER-ADMISSION',
  statement:
    'A typed TypeScript fact reader returns only admitted base namespaces and schemas through selected-kind or single-pass all-kind traversal; malformed payloads fail explicitly and are never cast into consumer evidence.',
})

export const TYPESCRIPT_FACT_READER_OWNED_ADMISSION = defineLaw({
  id: 'TYPESCRIPT-FACT-READER-OWNED-ADMISSION',
  statement:
    'Repeated typed reads may reuse successful payload admission only for the same kind and schema of a decoded root owned and deeply frozen by a built-in codec; every envelope remains checked, and custom or caller-frozen data remains revalidated.',
  tests: [
    {
      file: '../../../__tests__/typescript-normalized-facts.test.ts',
      id: 'TYPESCRIPT-FACT-READER-OWNED-ADMISSION',
    },
    {
      file: '../../../__tests__/typescript-normalized-facts.test.ts',
      id: 'TYPESCRIPT-FACT-READER-CUSTOM-ADMISSION',
    },
  ],
})

export const TYPESCRIPT_MODULE_DECLARATION_HYDRATION = defineLaw({
  id: 'TYPESCRIPT-MODULE-DECLARATION-HYDRATION',
  statement:
    'The typed reader returns the unchanged complete module payload for either legacy embedded declarations or normalized declaration references, verifies every referenced fact and subject, and fails before exposing a module when support is missing, duplicated, mismatched, or malformed.',
  tests: [
    {
      file: '../../../__tests__/typescript-normalized-facts.test.ts',
      id: 'TYPESCRIPT-MODULE-DECLARATION-HYDRATION',
    },
    {
      file: '../../../__tests__/typescript-normalized-facts.test.ts',
      id: 'TYPESCRIPT-MODULE-DECLARATION-MISSING',
    },
    {
      file: '../../../__tests__/typescript-normalized-facts.test.ts',
      id: 'TYPESCRIPT-MODULE-DECLARATION-IDENTITY',
    },
    {
      file: '../../../__tests__/typescript-normalized-facts.test.ts',
      id: 'TYPESCRIPT-MODULE-DECLARATION-PHYSICAL-FAULTS',
    },
  ],
})
