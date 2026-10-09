import { openCapturedTypeScriptReader, type TypeScriptComputation, type TypeScriptProjectSnapshot } from '../../analysis/typescript/index.ts'
import type { NativeDecisionSession } from '../../analysis/native/index.ts'

declare const snapshot: TypeScriptProjectSnapshot

const countCalls: TypeScriptComputation<{ readonly paths: readonly string[] }, number> = async (read, input) => {
  // @ts-expect-error Only tracked semantic reads belong in a computation.
  read.query
  const inventory = await read.calls({ paths: input.paths })
  const values = await read.values<{ readonly endpoint: string }>()
  for (const { call } of inventory.sites) {
    const proof = await values.value(call.occurrence).resolve()
    if (proof.kind === 'known' && proof.value.kind === 'atom') proof.value.value.endpoint satisfies string
  }
  return inventory.sites.length
}

const count = await snapshot.compute(countCalls, { paths: ['routes.ts'] })
count satisfies number
// @ts-expect-error Inputs follow the callback contract.
await snapshot.compute(countCalls, { paths: [42] })

const inferred = await snapshot.compute((_read, input) => ({ id: input.id }), { id: 'route' })
inferred.id satisfies string

declare const capturedSession: NativeDecisionSession
const captured = await openCapturedTypeScriptReader(capturedSession, {
  token: 'owned', generation: 'capture', sourceSnapshotDigest: 'a'.repeat(64),
}, { signal: new AbortController().signal })
const capturedCount = await captured.compute(countCalls, { paths: ['routes.ts'] })
capturedCount satisfies number
// @ts-expect-error The capture exposes tracked observations, not its backing fact query.
captured.query
// @ts-expect-error Captured observations preserve the callback input contract.
await captured.compute(countCalls, { paths: [42] })
await captured.dispose()
