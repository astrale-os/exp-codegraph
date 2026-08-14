import { defineLaw } from '@astrale-os/codegraph/authoring'

export const SOURCE_DISPLAY_INTEGRITY = defineLaw({
  id: 'SOURCE-DISPLAY-INTEGRITY',
  statement:
    'Source text is returned only when its digest and derived revision equal the generation-pinned expectation; changed bytes return stale evidence without text.',
})
