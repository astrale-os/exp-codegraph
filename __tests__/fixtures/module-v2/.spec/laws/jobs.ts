import { defineLaw } from '@astrale-os/codegraph/authoring'

export const JOB_TERMINAL_IRREVERSIBLE = defineLaw({
  id: 'JOB-TERMINAL-IRREVERSIBLE',
  statement: 'A terminal job state has no legal outgoing transition.',
})
