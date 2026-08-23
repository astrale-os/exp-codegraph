import { execFile as execFileCallback } from 'node:child_process'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { availableParallelism, cpus, hostname, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import type { AnalysisTelemetryEvent } from '../../../analysis/index.ts'
import type { CliServices } from '../../../cli/run.ts'

import { createMemoryAnalysisStore } from '../../../analysis/index.ts'
import { applicationRepositoryExcludes, resolveApplicationRoot } from '../../../application/discovery/index.ts'
import {
  codegraphProducerFingerprint,
  createGitSourceProofProvider,
  createNodeRepositoryInventory,
  nodeApplicationRepositoryKey,
} from '../../../application/node/index.ts'
import { createNodeTypeSpecApplicationService } from '../../../application/node/service.ts'
import { createTypeSpecApplicationServiceWithDependencies } from '../../../application/service.ts'
import { defaultTypeSpecCacheDirectory } from '../../../cache/file-store.ts'
import { changedSpecificationScope } from '../../../cli/changes.ts'
import { runCliCommand } from '../../../cli/checkpoint.ts'
import { executeEvidenceTests, planEvidenceTests } from '../../../cli/evidence.ts'
import { parseCommand } from '../../../cli/parse.ts'
import { terminalText } from '../../../cli/report.ts'
import { runCommand } from '../../../cli/run.ts'
import { readCodegraphVersion } from '../../../cli/version.ts'
import { initializeModuleSpecification } from '../../../specification/module/init.ts'
import { compileSpecificationSnapshots } from '../../../specification/snapshot/batch.ts'
import {
  createCheckPerformanceReceipt,
  deriveCheckPerformanceCounters,
  maximumNativeResidentMiB,
  maximumWorkerResidentUpperBoundMiB,
  MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES,
  sha256,
  type DirectoryEvidence,
} from './model.ts'
import {
  assertConstitutedCheckRequest,
  assertRatifiedPerformanceConstitution,
  CHECK_PERFORMANCE_CONSTITUTION,
} from './constitution.ts'

const execFile = promisify(execFileCallback)
await assertRatifiedPerformanceConstitution()
const root = await resolveApplicationRoot(requiredArgument('--corpus-root'))
const output = resolve(requiredArgument('--output'))
const performanceClass = requiredEnum('--class', ['C0', 'C1', 'C2', 'C3'])
const mode = requiredEnum('--mode', ['canonical', 'optimized'])
const seriesRunId = process.env.CODEGRAPH_QUALIFICATION_RUN_ID?.trim()
const seriesSample = process.env.CODEGRAPH_QUALIFICATION_SAMPLE_INDEX?.trim()
if ((seriesRunId === undefined) !== (seriesSample === undefined)) {
  throw new Error('Series run id and sample index must be supplied together.')
}
const seriesSampleIndex = seriesSample === undefined ? undefined : Number(seriesSample)
if (seriesSampleIndex !== undefined && (!Number.isSafeInteger(seriesSampleIndex) || seriesSampleIndex < 0)) {
  throw new Error('Series sample index must be a non-negative safe integer.')
}
const separator = process.argv.indexOf('--')
if (separator < 0 || separator === process.argv.length - 1) {
  throw new Error('run-check requires raw CLI arguments after --.')
}
const argv = process.argv.slice(separator + 1)
const command = parseCommand(argv)
if (command.name !== 'check' || (await resolveApplicationRoot(command.root)) !== root) {
  throw new Error('Performance receipt request must be a check of the exact corpus root.')
}
if (mode === 'canonical' && command.cache) {
  throw new Error('Canonical performance receipts require --no-cache.')
}

const cacheDirectory = defaultTypeSpecCacheDirectory()
const semanticPackDirectory = process.env.ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR?.trim()
  ? resolve(process.env.ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR)
  : undefined
const start = {
  ci: process.env.CI === 'true',
  localCache: await directoryEvidence(cacheDirectory),
  ...(semanticPackDirectory
    ? { semanticPack: await directoryEvidence(semanticPackDirectory) }
    : {}),
}
const sourceProof = await createGitSourceProofProvider().admit(root, {
  version: 'application-source-scope/1',
  exclude: applicationRepositoryExcludes(root, command.exclude),
  ignored: 'reject-semantic',
})
const producerFingerprint = await codegraphProducerFingerprint()
const harnessSha256 = sha256(await readFile(import.meta.filename))
const codegraphRevision = (
  await execFile('git', ['-C', resolve(import.meta.dirname, '../../..'), 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  })
).stdout.trim()
const repositoryRevision = (
  await execFile('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
).stdout.trim()
assertConstitutedCheckRequest(repositoryRevision, performanceClass, argv)
const telemetry: AnalysisTelemetryEvent[] = []
const hardware = {
  cpuModel: cpus()[0]?.model ?? 'unknown',
  logicalCpus: cpus().length,
  availableParallelism: availableParallelism(),
  totalMemoryBytes: totalmem(),
}
const services: CliServices = {
  version: readCodegraphVersion,
  initializeModule: initializeModuleSpecification,
  createApplication: (applicationRoot, cache, portableCheckpoint) =>
    mode === 'canonical'
      ? createCanonicalApplication(applicationRoot)
      : createNodeTypeSpecApplicationService({
          root: applicationRoot,
          cacheDirectory,
          persistence: cache ? 'advisory' : 'memory',
          ...(portableCheckpoint ? { portableCheckpoint } : {}),
          native: {
            maximumResidentBytes: MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES,
            telemetry: (event) => telemetry.push(event),
          },
          telemetry: (event) => telemetry.push(event),
        }),
  startDev: async () => {
    throw new Error('Check performance runner cannot start a development server.')
  },
  changedSpecificationScope,
  planEvidenceTests,
  executeEvidenceTests,
}

async function createCanonicalApplication(applicationRoot: string) {
  const store = createMemoryAnalysisStore({ maximumRetainedGenerations: 2 })
  const canonicalInventory = createNodeRepositoryInventory({ root: applicationRoot })
  try {
    const application = await createTypeSpecApplicationServiceWithDependencies(
      {
        root: applicationRoot,
        repository: await nodeApplicationRepositoryKey(applicationRoot),
        analysis: { store, maximumRetainedGenerations: 2 },
        telemetry: (event) => telemetry.push(event),
      },
      {
        inventory: async (request) => {
          const started = performance.now()
          const inventory = await canonicalInventory(request)
          const bytes = inventory.files.reduce((total, file) => total + file.bytes, 0)
          telemetry.push({
            format: 'astrale.codegraph.analysis-telemetry',
            version: 1,
            component: 'analysis',
            phase: 'qualification.canonical-inventory',
            durationNs: Math.round((performance.now() - started) * 1_000_000),
            metrics: {
              status: 'completed',
              filesTraversed: inventory.files.length,
              bytesTraversed: bytes,
              bytesRead: bytes,
              bytesHashed: bytes,
            },
          })
          return inventory
        },
        compile: async (catalogRoot, directories, options) => {
          const started = performance.now()
          const snapshots = []
          for (const directory of directories) {
            snapshots.push(...(await compileSpecificationSnapshots(catalogRoot, [directory], {
              ...options,
              onPhase: (phase) => {
                try {
                  options?.onPhase?.(phase)
                } catch {
                  // Qualification observation cannot change canonical compilation.
                }
                telemetry.push({
                  format: 'astrale.codegraph.analysis-telemetry',
                  version: 1,
                  component: 'analysis',
                  phase: `qualification.canonical.compile.${phase.phase}`,
                  durationNs: Math.round(phase.durationMs * 1_000_000),
                  metrics: {
                    status: 'completed',
                    items: phase.items,
                    ...(phase.workerPeakResidentBytes === undefined
                      ? {}
                      : { workerPeakResidentBytes: phase.workerPeakResidentBytes }),
                    ...(phase.workerResidentUpperBoundBytes === undefined
                      ? {}
                      : { workerResidentUpperBoundBytes: phase.workerResidentUpperBoundBytes }),
                  },
                })
              },
            })))
          }
          telemetry.push({
            format: 'astrale.codegraph.analysis-telemetry',
            version: 1,
            component: 'analysis',
            phase: 'qualification.canonical-slow',
            durationNs: Math.round((performance.now() - started) * 1_000_000),
            metrics: {
              status: 'completed',
              specificationOwners: directories.length,
              declarationSessions: directories.length,
              declarationPrograms: directories.length,
              moduleSessions: directories.length,
              modulePrograms: directories.length,
            },
          })
          return snapshots
        },
      },
    )
    let disposed = false
    return {
      refresh: (options: Parameters<typeof application.refresh>[0]) => application.refresh(options),
      current: () => application.current(),
      open: (snapshot: Parameters<typeof application.open>[0]) => application.open(snapshot),
      settle: () => application.settle(),
      async dispose() {
        if (disposed) return
        disposed = true
        const results = await Promise.allSettled([application.dispose(), store.dispose()])
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        )
        if (rejected) throw rejected.reason
      },
    }
  } catch (error) {
    await store.dispose()
    throw error
  }
}

let stdout = ''
let stderr = ''
let exitCode = 2
let result: Awaited<ReturnType<typeof runCliCommand>> | undefined
let failure: { readonly name: string; readonly message: string; readonly code?: string } | undefined
const usageBefore = process.resourceUsage()
const startedAt = new Date().toISOString()
const started = performance.now()
try {
  const commandOutput = {
    out: (message: string) => {
      stdout += `${message}\n`
    },
    error: (message: string) => {
      stderr += `${message}\n`
    },
  }
  result = mode === 'canonical'
    ? await runCommand(command, services, commandOutput)
    : await runCliCommand(command, services, commandOutput)
  exitCode = result.exitCode
} catch (error) {
  const name = error instanceof Error ? error.name : 'unknown'
  const message = error instanceof Error ? error.message : String(error)
  const code = errorCode(error)
  failure = { name, message, ...(code ? { code } : {}) }
  stderr += `${terminalText(message)}\n`
}
const wallMilliseconds = performance.now() - started
const usageAfter = process.resourceUsage()
const finish = {
  localCache: await directoryEvidence(cacheDirectory),
  ...(semanticPackDirectory
    ? { semanticPack: await directoryEvidence(semanticPackDirectory) }
    : {}),
}
const maximumWorkerMiB = maximumWorkerResidentUpperBoundMiB(telemetry)
const maximumNativeMiB = maximumNativeResidentMiB(telemetry)
const maximumRssMiB = usageAfter.maxRSS / 1_024
const receipt = createCheckPerformanceReceipt({
  format: 'astrale.codegraph.check-performance-receipt',
  version: 3,
  class: performanceClass,
  mode,
  request: { argv },
  runner: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    codegraphRevision,
    harnessSha256,
    processId: process.pid,
    startedAt,
    instance: process.env.CODEGRAPH_QUALIFICATION_RUNNER_ID?.trim() || hostname(),
    hardware,
  },
  ...(seriesRunId && seriesSampleIndex !== undefined
    ? { series: { runId: seriesRunId, sampleIndex: seriesSampleIndex } }
    : {}),
  subject: {
    producerFingerprint,
    sourceProof,
    repositoryRevision,
    constitutionSha256: CHECK_PERFORMANCE_CONSTITUTION.sha256,
  },
  start,
  result: {
    exitCode,
    stdout,
    stderr,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    ...(result?.check
      ? {
          check: {
            repository: result.check.repository,
            inventory: result.check.inventory,
            snapshot: result.check.snapshot,
          },
        }
      : {}),
    ...(result?.acceleration ? { acceleration: result.acceleration } : {}),
    ...(failure ? { failure } : {}),
  },
  work: {
    telemetry,
    counters: deriveCheckPerformanceCounters(telemetry, result?.acceleration),
  },
  resources: {
    wallMilliseconds,
    userCpuMilliseconds: (usageAfter.userCPUTime - usageBefore.userCPUTime) / 1_000,
    systemCpuMilliseconds: (usageAfter.systemCPUTime - usageBefore.systemCPUTime) / 1_000,
    maximumRssMiB,
    maximumNativeResidentMiB: maximumNativeMiB,
    maximumWorkerResidentUpperBoundMiB: maximumWorkerMiB,
    maximumProcessTreeResidentUpperBoundMiB:
      maximumRssMiB + maximumWorkerMiB + maximumNativeMiB,
  },
  finish,
})
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
process.stdout.write(
  `${JSON.stringify({
    format: receipt.format,
    class: receipt.class,
    mode: receipt.mode,
    exitCode: receipt.result.exitCode,
    wallMilliseconds: Math.round(receipt.resources.wallMilliseconds * 100) / 100,
    receiptSha256: receipt.receiptSha256,
    output,
  }, null, 2)}\n`,
)

async function directoryEvidence(path: string): Promise<DirectoryEvidence> {
  let entries: readonly string[]
  try {
    entries = await readdir(path, { recursive: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { exists: false, files: 0, bytes: 0 }
    throw error
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const metadata = await stat(resolve(path, entry))
      return metadata.isFile() ? metadata.size : 0
    }),
  )
  return {
    exists: true,
    files: sizes.filter((size) => size > 0).length,
    bytes: sizes.reduce((total, size) => total + size, 0),
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function requiredEnum<const Value extends string>(
  name: string,
  values: readonly Value[],
): Value {
  const value = requiredArgument(name)
  if (!values.includes(value as Value)) throw new Error(`${name} is invalid.`)
  return value as Value
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
