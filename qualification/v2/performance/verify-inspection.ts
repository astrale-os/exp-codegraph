import { createHash } from 'node:crypto'

import type {
  TypeSpecApplicationRefresh,
  TypeSpecApplicationService,
} from '../../../application/index.ts'

import { stableJson } from '../../../analysis/identity/model.ts'
import { createTypeScriptFactReader } from '../../../analysis/typescript/index.ts'

/** Inspect raw normalized shards and their unchanged logical module projection outside timing. */
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
        let modules = 0
        let declarations = 0
        let legacyModules = 0
        let maximumModulePayloadBytes = 0
        let maximumDeclarationPayloadBytes = 0
        const rawDigest = createHash('sha256')
        for await (const fact of query.export({ namespaces: ['astrale.typescript.module'] })) {
          const serialized = stableJson({
            id: fact.id,
            schemaVersion: fact.schemaVersion,
            kind: fact.kind,
            subject: fact.subject,
            payload: fact.payload,
          })
          rawDigest.update(serialized).update('\0')
          const bytes = Buffer.byteLength(serialized)
          if (fact.kind === 'module') {
            modules++
            if (fact.schemaVersion === 1) legacyModules++
            maximumModulePayloadBytes = Math.max(maximumModulePayloadBytes, bytes)
          } else if (fact.kind === 'declaration') {
            declarations++
            maximumDeclarationPayloadBytes = Math.max(maximumDeclarationPayloadBytes, bytes)
          }
        }
        let logicalModules = 0
        const logicalDigest = createHash('sha256')
        for await (const fact of createTypeScriptFactReader(query).export('module')) {
          logicalModules++
          logicalDigest.update(stableJson({ subject: fact.subject, payload: fact.payload })).update('\0')
        }
        universes.push({
          universe,
          manifestShards: manifest.length,
          modules,
          declarations,
          legacyModules,
          logicalModules,
          maximumModulePayloadBytes,
          maximumDeclarationPayloadBytes,
          rawDigest: rawDigest.digest('hex'),
          logicalDigest: logicalDigest.digest('hex'),
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
