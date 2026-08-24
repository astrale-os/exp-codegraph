import { createHash } from 'node:crypto'

import type {
  TypeSpecApplicationRefresh,
  TypeSpecApplicationService,
} from '../../../application/index.ts'

import { stableJson } from '../../../analysis/identity/model.ts'
import { APPLICATION_BINDING_FACT_NAMESPACE } from '../../../analysis/index.ts'

/** Inspect compact binding shards outside the timed verification operation. */
export async function inspectVerifyApplication(
  service: TypeSpecApplicationService,
  refresh: TypeSpecApplicationRefresh,
) {
  const snapshot = refresh.snapshot
  if (!snapshot.analysis) return { universes: [] }
  const reader = await service.open(snapshot.id)
  try {
    const universes = []
    for (const universe of snapshot.analysis.universes) {
      const query = await reader.query(universe)
      try {
        const manifest = await query.manifest()
        let bindings = 0
        let maximumBindingPayloadBytes = 0
        const digest = createHash('sha256')
        for await (const fact of query.export({ namespaces: [APPLICATION_BINDING_FACT_NAMESPACE] })) {
          if (fact.kind !== 'module-binding') continue
          const serialized = stableJson({
            id: fact.id,
            schemaVersion: fact.schemaVersion,
            kind: fact.kind,
            subject: fact.subject,
            payload: fact.payload,
          })
          bindings++
          maximumBindingPayloadBytes = Math.max(
            maximumBindingPayloadBytes,
            Buffer.byteLength(serialized),
          )
          digest.update(serialized).update('\0')
        }
        universes.push({
          universe,
          manifestShards: manifest.length,
          bindings,
          maximumBindingPayloadBytes,
          bindingDigest: digest.digest('hex'),
        })
      } finally {
        await query.dispose()
      }
    }
    return { universes }
  } finally {
    await reader.dispose()
  }
}
