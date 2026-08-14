import { defineLaw } from '@astrale-os/codegraph/authoring'

export const TYPESCRIPT_FACT_READER_ADMISSION = defineLaw({
  id: 'TYPESCRIPT-FACT-READER-ADMISSION',
  statement:
    'A typed TypeScript fact reader returns only the selected namespace and admitted schema; malformed payloads fail explicitly and are never cast into consumer evidence.',
})
