import { defineLaw } from '@astrale-os/codegraph/authoring'

export const CODEGRAPH_PROTOCOL_BOUNDED_FRAMES = defineLaw({
  id: 'CODEGRAPH-PROTOCOL-BOUNDED-FRAMES',
  statement:
    'Every native JSONL frame and assembled transaction is independently bounded; a multi-frame transaction resolves only after exact request identity, protocol, order, count, byte length, digest, and semantic transaction admission succeed, and no prefix is consumer-visible.',
})
