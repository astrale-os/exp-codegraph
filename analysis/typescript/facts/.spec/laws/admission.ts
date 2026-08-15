import { defineLaw } from '@astrale-os/codegraph/authoring'

export const TYPESCRIPT_FACT_READER_ADMISSION = defineLaw({
  id: 'TYPESCRIPT-FACT-READER-ADMISSION',
  statement:
    'A typed TypeScript fact reader returns only admitted base namespaces and schemas through selected-kind or single-pass all-kind traversal; malformed payloads fail explicitly and are never cast into consumer evidence.',
})
