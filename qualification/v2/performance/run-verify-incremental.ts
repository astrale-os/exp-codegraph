import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { AnalysisTelemetryEvent } from '../../../analysis/index.ts'
import type { TypeSpecApplicationRefresh } from '../../../application/index.ts'

import { stableJson } from '../../../analysis/identity/model.ts'
import {
  codegraphProducerFingerprint,
  createGitSourceProofProvider,
} from '../../../application/node/index.ts'
import { createNodeTypeSpecApplicationService } from '../../../application/node/service.ts'
import { applicationRepositoryExcludes, resolveApplicationRoot } from '../../../application/discovery/index.ts'
import { defaultTypeSpecCacheDirectory } from '../../../cache/file-store.ts'
import { inspectVerifyApplication } from './verify-inspection.ts'
import {
  maximumNativeResidentMiB,
  MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES,
} from './model.ts'

const root = await resolveApplicationRoot(requiredArgument('--corpus-root'))
const output = resolve(requiredArgument('--output'))
const nativeBinary = resolve(requiredArgument('--native-binary'))
const changedPath = requiredArgument('--changed-path').replaceAll('\\', '/')
const selected = requiredArgument('--select')
const cacheDirectory = defaultTypeSpecCacheDirectory()
if ((await fileEvidence(resolve(cacheDirectory, 'analysis-v2.sqlite'))).exists) {
  throw new Error('V2 requires an empty analysis store before its resident baseline.')
}
const telemetry: AnalysisTelemetryEvent[] = []
const service = await createNodeTypeSpecApplicationService({
  root,
  cacheDirectory,
  persistence: 'advisory',
  native: {
    binary: nativeBinary,
    maximumResidentBytes: MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES,
    telemetry: (event) => telemetry.push(event),
  },
  telemetry: (event) => telemetry.push(event),
})
const options = {
  requestedCapabilities: ['declaration-models'] as const,
  qualify: true,
  compilerAnalysis: true,
  focused: true,
  select: [selected],
}
try {
  const cleanProof = await sourceProof()
  const baselineStarted = performance.now()
  const baseline = await service.refresh(options)
  const baselineWallMilliseconds = performance.now() - baselineStarted
  const baselineInspection = await inspectVerifyApplication(service, baseline)
  process.stdout.write('CODEGRAPH_VERIFY_V2_READY\n')
  await resumeSignal()
  const dirtyProof = await sourceProof()
  const telemetryOffset = telemetry.length
  const usageBefore = process.resourceUsage()
  const deltaStarted = performance.now()
  const delta = await service.refresh({ ...options, changed: [changedPath] })
  const deltaWallMilliseconds = performance.now() - deltaStarted
  const usageAfter = process.resourceUsage()
  const deltaInspection = await inspectVerifyApplication(service, delta)
  const settlement = await service.settle()
  const proofAfter = await sourceProof()
  const body = {
    format: 'astrale.codegraph.verify-incremental-receipt' as const,
    version: 1 as const,
    class: 'V2' as const,
    runner: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      producerFingerprint: await codegraphProducerFingerprint({ persistence: 'memory' }),
      nativeSha256: digest(await readFile(nativeBinary)),
      harnessSha256: digest(await readFile(import.meta.filename)),
    },
    request: { selected, changedPath },
    subject: { cleanProof, dirtyProof, proofAfter },
    baseline: {
      wallMilliseconds: baselineWallMilliseconds,
      maximumNativeResidentMiB: maximumNativeResidentMiB(telemetry),
      refresh: refreshEvidence(baseline),
      inspection: baselineInspection,
    },
    delta: {
      wallMilliseconds: deltaWallMilliseconds,
      refresh: refreshEvidence(delta),
      inspection: deltaInspection,
      telemetry: telemetry.slice(telemetryOffset),
      resources: {
        userCpuMilliseconds: (usageAfter.userCPUTime - usageBefore.userCPUTime) / 1_000,
        systemCpuMilliseconds: (usageAfter.systemCPUTime - usageBefore.systemCPUTime) / 1_000,
        maximumRssMiB: usageAfter.maxRSS / 1_024,
        maximumNativeResidentMiB: maximumNativeResidentMiB(telemetry),
      },
      checkpoint: settlement.checkpoint,
    },
    finish: { analysisStore: await fileEvidence(resolve(cacheDirectory, 'analysis-v2.sqlite')) },
  }
  const receipt = { ...body, receiptSha256: digest(stableJson(body)) }
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({
    format: receipt.format,
    class: receipt.class,
    deltaWallMilliseconds: Math.round(deltaWallMilliseconds * 100) / 100,
    receiptSha256: receipt.receiptSha256,
    output,
  }, null, 2)}\n`)
} finally {
  await service.dispose()
}

function refreshEvidence(refresh: TypeSpecApplicationRefresh) {
  const snapshot = refresh.snapshot
  return {
    snapshot: snapshot.id,
    inventory: snapshot.inventory,
    capabilities: snapshot.capabilities,
    selection: snapshot.selection,
    specifications: snapshot.specifications.length,
    qualificationStatuses: counts(snapshot.qualifications.map(({ status }) => status)),
    diagnostics: snapshot.diagnostics,
    analysisDiagnostics: snapshot.analysisDiagnostics,
    analysis: snapshot.analysis,
    changes: refresh.changes,
    timing: refresh.timing,
  }
}

async function sourceProof() {
  return createGitSourceProofProvider().admit(root, {
    version: 'application-source-scope/1',
    exclude: applicationRepositoryExcludes(root, []),
    ignored: 'reject-semantic',
  })
}

function resumeSignal(): Promise<void> {
  return new Promise((resolveSignal, reject) => {
    process.stdin.once('data', () => {
      process.stdin.pause()
      resolveSignal()
    })
    process.stdin.once('error', reject)
    process.stdin.resume()
  })
}

async function fileEvidence(path: string) {
  try {
    const value = await stat(path)
    return { exists: value.isFile(), bytes: value.isFile() ? value.size : 0 }
  } catch {
    return { exists: false, bytes: 0 }
  }
}

function counts(values: readonly string[]) {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`${name} is required.`)
  return value
}
