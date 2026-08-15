import { defineLaw } from '@astrale-os/codegraph/authoring'

export const FACT_REPRESENTATION_TRANSPARENCY = defineLaw({
  id: 'FACT-REPRESENTATION-TRANSPARENCY',
  statement:
    'Physical payload metadata is carried outside the unrestricted semantic payload domain; admission computes identity and decoded-size bounds from the exact semantic value, public reads return one immutable memoized result or error, and rebinding, transport, and storage preserve the private representation without changing observable Fact semantics.',
})
