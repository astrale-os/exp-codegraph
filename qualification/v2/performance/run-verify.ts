import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import type { AnalysisTelemetryEvent } from '../../../analysis/index.ts'
import type {
  TypeSpecApplicationRefresh,
  TypeSpecApplicationService,
} from '../../../application/index.ts'
import type { CliServices } from '../../../cli/run.ts'

import { stableJson } from '../../../analysis/identity/model.ts'
import {
  codegraphProducerFingerprint,
  createGitSourceProofProvider,
} from '../../../application/node/index.ts'
import { createNodeTypeSpecApplicationService } from '../../../application/node/service.ts'
import { applicationRepositoryExcludes, resolveApplicationRoot } from '../../../application/discovery/index.ts'
import { defaultTypeSpecCacheDirectory } from '../../../cache/file-store.ts'
import { changedSpecificationScope } from '../../../cli/changes.ts'
import { executeEvidenceTests, planEvidenceTests } from '../../../cli/evidence.ts'
import { parseCommand } from '../../../cli/parse.ts'
import { runCommand } from '../../../cli/run.ts'
import { readCodegraphVersion } from '../../../cli/version.ts'
import { initializeModuleSpecification } from '../../../specification/module/init.ts'
import { inspectVerifyApplication } from './verify-inspection.ts'
import {
  maximumNativeResidentMiB,
  MAXIMUM_QUALIFIED_NATIVE_RESIDENT_BYTES,
} from './model.ts'

const execFile = promisify(execFileCallback)
const root = await resolveApplicationRoot(requiredArgument('--corpus-root'))
const output = resolve(requiredArgument('--output'))
const nativeBinary = resolve(requiredArgument('--native-binary'))
const verifyClass = requiredEnum('--class', ['V0', 'V1'])
const separator = process.argv.indexOf('--')
if (separator < 0 || separator === process.argv.length - 1) {
  throw new Error('run-verify requires raw CLI arguments after --.')
}
const argv = process.argv.slice(separator + 1)
const command = parseCommand(argv)
if (command.name !== 'verify' || (await resolveApplicationRoot(command.root)) !== root) {
  throw new Error('Verify performance receipt must target the exact corpus root.')
}
if ((verifyClass === 'V0') !== (command.select.length > 0)) {
  throw new Error('V0 requires a selected request and V1 requires a whole-corpus request.')
}

const cacheDirectory = defaultTypeSpecCacheDirectory()
const cacheBefore = await fileEvidence(resolve(cacheDirectory, 'analysis-v2.sqlite'))
if (cacheBefore.exists) throw new Error(`${verifyClass} requires an empty analysis store.`)
const sourceProofBefore = await sourceProof()
const producerFingerprint = await codegraphProducerFingerprint({ persistence: 'memory' })
const nativeSha256 = digest(await readFile(nativeBinary))
const harnessSha256 = digest(await readFile(import.meta.filename))
const codegraphRevision = (
  await execFile('git', ['-C', resolve(import.meta.dirname, '../../..'), 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  })
).stdout.trim()
const telemetry: AnalysisTelemetryEvent[] = []
const refreshes: TypeSpecApplicationRefresh[] = []
let application: TypeSpecApplicationService | undefined
const services: CliServices = {
  version: readCodegraphVersion,
  initializeModule: initializeModuleSpecification,
  async createApplication(applicationRoot) {
    if (application || (await resolveApplicationRoot(applicationRoot)) !== root) {
      throw new Error('Verify runner application lifecycle is invalid.')
    }
    application = await createNodeTypeSpecApplicationService({
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
    return borrowed(application, refreshes)
  },
  startDev: async () => {
    throw new Error('Verify performance runner cannot start a development server.')
  },
  changedSpecificationScope,
  planEvidenceTests,
  executeEvidenceTests,
}

let stdout = ''
let stderr = ''
let exitCode = 2
let failure: { readonly name: string; readonly message: string } | undefined
const usageBefore = process.resourceUsage()
const started = performance.now()
try {
  const result = await runCommand(command, services, {
    out: (message) => { stdout += `${message}\n` },
    error: (message) => { stderr += `${message}\n` },
  })
  exitCode = result.exitCode
} catch (error) {
  failure = {
    name: error instanceof Error ? error.name : 'unknown',
    message: error instanceof Error ? error.message : String(error),
  }
}
const wallMilliseconds = performance.now() - started
const usageAfter = process.resourceUsage()
const refresh = refreshes.at(-1)
const inspection = application && refresh
  ? await inspectVerifyApplication(application, refresh)
  : undefined
const settlement = application ? await application.settle() : undefined
await application?.dispose()
const sourceProofAfter = await sourceProof()
const cacheAfter = await fileEvidence(resolve(cacheDirectory, 'analysis-v2.sqlite'))
const body = {
  format: 'astrale.codegraph.verify-performance-receipt' as const,
  version: 1 as const,
  class: verifyClass,
  request: { argv },
  runner: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    codegraphRevision,
    harnessSha256,
    nativeSha256,
  },
  subject: {
    producerFingerprint,
    sourceProofBefore,
    sourceProofAfter,
  },
  start: { analysisStore: cacheBefore },
  result: {
    exitCode,
    stdout,
    stderr,
    stdoutSha256: digest(stdout),
    stderrSha256: digest(stderr),
    ...(failure ? { failure } : {}),
    ...(refresh ? { refresh: refreshEvidence(refresh) } : {}),
    ...(inspection ? { inspection } : {}),
    ...(settlement?.checkpoint ? { checkpoint: settlement.checkpoint } : {}),
  },
  work: { telemetry },
  resources: {
    wallMilliseconds,
    userCpuMilliseconds: (usageAfter.userCPUTime - usageBefore.userCPUTime) / 1_000,
    systemCpuMilliseconds: (usageAfter.systemCPUTime - usageBefore.systemCPUTime) / 1_000,
    maximumRssMiB: usageAfter.maxRSS / 1_024,
    maximumNativeResidentMiB: maximumNativeResidentMiB(telemetry),
  },
  finish: { analysisStore: cacheAfter },
}
const receipt = { ...body, receiptSha256: digest(stableJson(body)) }
await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({
  format: receipt.format,
  class: receipt.class,
  exitCode: receipt.result.exitCode,
  wallMilliseconds: Math.round(receipt.resources.wallMilliseconds * 100) / 100,
  maximumRssMiB: Math.round(receipt.resources.maximumRssMiB * 100) / 100,
  receiptSha256: receipt.receiptSha256,
  output,
}, null, 2)}\n`)

function borrowed(
  service: TypeSpecApplicationService,
  values: TypeSpecApplicationRefresh[],
): TypeSpecApplicationService {
  return {
    async refresh(options) {
      const refresh = await service.refresh(options)
      values.push(refresh)
      return refresh
    },
    current: () => service.current(),
    open: (snapshot) => service.open(snapshot),
    settle: () => service.settle(),
    dispose: async () => undefined,
  }
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

async function fileEvidence(path: string): Promise<{
  readonly exists: boolean
  readonly bytes: number
}> {
  try {
    const value = await stat(path)
    return { exists: value.isFile(), bytes: value.isFile() ? value.size : 0 }
  } catch {
    return { exists: false, bytes: 0 }
  }
}

function counts(values: readonly string[]): Readonly<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function requiredEnum<Value extends string>(name: string, values: readonly Value[]): Value {
  const value = requiredArgument(name)
  if (!values.includes(value as Value)) throw new Error(`${name} is invalid.`)
  return value as Value
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`${name} is required.`)
  return value
}
