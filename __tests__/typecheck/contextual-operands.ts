import type { TypeScriptProjectSnapshot } from '../../analysis/typescript/index.ts'
import type { OccurrenceId } from '../../analysis/identity/index.ts'

declare const snapshot: TypeScriptProjectSnapshot
declare const occurrence: OccurrenceId

const values = await snapshot.values<{ readonly route: string }>({
  call(context) {
    const callee = context.callee().resolve()
    if (callee.kind !== 'known' || callee.value.kind !== 'external') return
    const origin = callee.value.symbolOrigin
    if (origin?.package !== '@acme/http' || origin.file !== 'index.d.ts' || origin.path.length !== 1) return
    if (origin.path[0] === 'transparent') return context.argument(0)
    if (origin.path[0] !== 'route') return
    const path = context.argument(0)?.property('path').resolve()
    if (path?.kind === 'known' && path.value.kind === 'literal' && typeof path.value.value === 'string') {
      return { kind: 'atom', value: { route: path.value.value } }
    }
    return { kind: 'unknown', reason: 'The route path is opaque.' }
  },
})

const proof = await values.value(occurrence).resolve()
if (proof.kind === 'known' && proof.value.kind === 'atom') {
  proof.value.value.route satisfies string
}
