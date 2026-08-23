import { defineLaw } from '@astrale-os/codegraph/authoring'

export const CODEGRAPH_PROTOCOL_BOUNDED_FRAMES = defineLaw({
  id: 'CODEGRAPH-PROTOCOL-BOUNDED-FRAMES',
  statement:
    'Every native JSONL frame, assembled physical transaction, and decoded semantic Fact-payload set is independently bounded; a multi-frame transaction resolves only after exact request identity, protocol, order, count, byte length, digest, physical capability, and semantic transaction admission succeed, and no prefix is consumer-visible.',
  tests: [
    {
      file: '../../__tests__/analysis-v2.test.ts',
      id: 'CODEGRAPH-PROTOCOL-BOUNDED-FRAMES',
    },
    {
      file: '../../__tests__/analysis-v2.test.ts',
      id: 'CODEGRAPH-PROTOCOL-SEMANTIC-PAYLOAD-LIMIT',
    },
  ],
})

export const CODEGRAPH_PROTOCOL_COMMIT_LATE = defineLaw({
  id: 'CODEGRAPH-PROTOCOL-COMMIT-LATE',
  statement:
    'A native candidate remains replayable and private until the application store acknowledges its exact committed generation and sequence; failed materialization never advances the resident base.',
  tests: [
    {
      file: '../../__tests__/analysis-v2.test.ts',
      id: 'CODEGRAPH-PROTOCOL-COMMIT-LATE',
    },
  ],
})

export const CODEGRAPH_PROTOCOL_CANCELLATION = defineLaw({
  id: 'CODEGRAPH-PROTOCOL-CANCELLATION',
  statement:
    'Cancellation rejects with the caller-owned reason, terminates the affected native session, and exposes neither a partial response nor an advanced generation.',
  tests: [
    {
      file: '../../__tests__/analysis-v2.test.ts',
      id: 'CODEGRAPH-PROTOCOL-CANCELLATION',
    },
  ],
})

export const CODEGRAPH_PROTOCOL_AFFECTED_SHARD_WIRE = defineLaw({
  id: 'CODEGRAPH-PROTOCOL-AFFECTED-SHARD-WIRE',
  statement:
    'After a base generation exists, native transport carries only affected shard upserts and deletes; the consumer reconstructs and validates the complete manifest from its exact pinned base.',
})

export const CODEGRAPH_PROTOCOL_PAYLOAD_NEGOTIATION = defineLaw({
  id: 'CODEGRAPH-PROTOCOL-PAYLOAD-NEGOTIATION',
  statement:
    'A producer emits a private physical Fact payload only after the consumer explicitly advertises its versioned decoder; negotiation can change bytes and allocation only, never semantic payloads, fact or shard digests, generations, provenance, completeness, or query results.',
})
