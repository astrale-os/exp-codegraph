import type { TypeScriptComputation, TypeScriptProjectSnapshot } from '../../analysis/typescript/index.ts'

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
