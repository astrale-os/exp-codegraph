import { createHash } from 'node:crypto'

import type { TypeSpecApplicationSnapshot } from '../application/index.ts'
import type { SpecificationSnapshot } from '../specification/index.ts'
import type { CliCommand } from './parse.ts'
import type { CliOutput } from './report.ts'
import type { CliCheckCatalog, CliResult, CliServices } from './run.ts'

import {
  applicationRepositoryExcludes,
  resolveApplicationRoot,
} from '../application/discovery/index.ts'
import { resolveApplicationRepositoryIdentity } from '../application/index.ts'
import {
  codegraphProducerFingerprint,
  createCheckpointedRepositoryInventory,
  nodeApplicationRepositoryKey,
  nodeApplicationWorkspaceCheckpointDirectory,
} from '../application/node/index.ts'
import { selectApplicationSpecifications } from '../application/selection/index.ts'
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.ts'
import {
  createFileWorkspaceCheckpointStore,
  decodeWorkspaceCheckpointJson,
  encodeWorkspaceCheckpointJson,
  WORKSPACE_CHECKPOINT_JSON_ENCODING,
} from '../workspace/checkpoint/index.ts'
import { CLI_CHECK_LIMITS } from './limits.ts'
import { reportProjectedCheckResult, runCommand } from './run.ts'

const FORMAT = 'astrale.codegraph.cli-check-result'
const VERSION = 1
const RESULT = 'cli/check-result.json.br'
const CATALOG_FORMAT = 'astrale.codegraph.cli-check-catalog'
const CATALOG_VERSION = 1
const CATALOG = 'cli/check-catalog.json.br'
const MAXIMUM_RESULT_BYTES = 16 * 1024 * 1024
const MAXIMUM_CATALOG_BYTES = CLI_CHECK_LIMITS.maximumCatalogCheckpointDecodedBytes

type CheckCommand = Extract<CliCommand, { readonly name: 'check' }>

interface TranscriptEntry {
  readonly channel: 'stdout' | 'stderr'
  readonly message: string
}

interface StoredCheckResult {
  readonly format: typeof FORMAT
  readonly version: typeof VERSION
  readonly producerFingerprint: string
  readonly request: string
  readonly repository: string
  readonly inventory: string
  readonly snapshot: string
  readonly exitCode: number
  readonly transcript: readonly TranscriptEntry[]
  readonly catalogStatus?:
    | 'available'
    | 'encode-failed'
    | 'not-applicable'
    | 'publish-failed'
    | 'projected'
}

interface StoredCheckCatalog {
  readonly format: typeof CATALOG_FORMAT
  readonly version: typeof CATALOG_VERSION
  readonly producerFingerprint: string
  readonly family: string
  readonly repository: string
  readonly inventory: string
  readonly snapshot: string
  readonly catalog: CliCheckCatalog
}

/**
 * Admit an exact previous check result before constructing the application. Any cache uncertainty
 * is advisory: the canonical command runs and is the only producer of publishable output.
 */
export async function runCliCommand(
  command: CliCommand,
  services: CliServices,
  output: CliOutput,
): Promise<CliResult> {
  if (command.name !== 'check' || !command.cache) return runCommand(command, services, output)

  const root = await resolveApplicationRoot(command.root)
  const cacheDirectory = defaultTypeSpecCacheDirectory()
  const store = createFileWorkspaceCheckpointStore({
    directory: nodeApplicationWorkspaceCheckpointDirectory(cacheDirectory, root),
    maxArtifacts: 4_096,
    maximumScopes: 512,
  })
  let canonicalStarted = false
  try {
    const producerFingerprint = await codegraphProducerFingerprint()
    const repositoryKey = await nodeApplicationRepositoryKey(root)
    const repository = await resolveApplicationRepositoryIdentity(root, repositoryKey)
    const request = checkRequest(command)
    const scope = `cli-check-${sha256(request)}`
    const family = checkFamily(command)
    const catalogScope = `cli-check-catalog-${sha256(family)}`
    const inventory = await createCheckpointedRepositoryInventory({
      root,
      store,
      producerFingerprint: `${producerFingerprint}:repository-inventory/3`,
    })({
      root,
      repository,
      scope: { exclude: applicationRepositoryExcludes(root, command.exclude) },
    })

    const cached = await loadResult(store, scope, {
      producerFingerprint,
      request,
      repository,
      inventory: inventory.revision,
    })
    if (cached) {
      replay(output, cached.transcript)
      return {
        exitCode: cached.exitCode,
        check: {
          repository: cached.repository,
          inventory: cached.inventory,
          snapshot: cached.snapshot,
        },
      }
    }

    if (command.select.length) {
      const catalog = await loadCatalog(store, catalogScope, {
        producerFingerprint,
        family,
        repository,
        inventory: inventory.revision,
      })
      if (catalog) {
        const transcript: TranscriptEntry[] = []
        const projected = projectCatalogCheck(root, command, catalog, transcript)
        await publishResult(store, scope, {
          format: FORMAT,
          version: VERSION,
          producerFingerprint,
          request,
          repository,
          inventory: inventory.revision,
          snapshot: projected.check!.snapshot,
          exitCode: projected.exitCode,
          transcript,
          catalogStatus: 'projected',
        })
        replay(output, transcript)
        return projected
      }
    }

    const transcript: TranscriptEntry[] = []
    const recording = recordingOutput(output, transcript)
    canonicalStarted = true
    const result = await runCommand(command, services, recording)
    if (
      result.check &&
      result.check.repository === repository &&
      result.check.inventory === inventory.revision
    ) {
      const catalogStatus =
        !command.select.length && result.check.catalog
          ? await publishCatalog(store, catalogScope, {
              format: CATALOG_FORMAT,
              version: CATALOG_VERSION,
              producerFingerprint,
              family,
              repository,
              inventory: inventory.revision,
              snapshot: result.check.snapshot,
              catalog: result.check.catalog,
            })
          : 'not-applicable'
      await publishResult(store, scope, {
        format: FORMAT,
        version: VERSION,
        producerFingerprint,
        request,
        repository,
        inventory: inventory.revision,
        snapshot: result.check.snapshot,
        exitCode: result.exitCode,
        transcript,
        catalogStatus,
      })
    }
    return result
  } catch (error) {
    if (canonicalStarted) throw error
    // Admission is strictly advisory. Re-run without touching the canonical command semantics.
    return runCommand(command, services, output)
  } finally {
    await store.dispose()
  }
}

async function publishResult(
  store: ReturnType<typeof createFileWorkspaceCheckpointStore>,
  scope: string,
  stored: StoredCheckResult,
): Promise<void> {
  try {
    const artifact = encodeWorkspaceCheckpointJson(stored, {
      maximumDecodedBytes: MAXIMUM_RESULT_BYTES,
    })
    await store.publish(scope, {
      manifest: {
        format: FORMAT,
        version: VERSION,
        producerFingerprint: stored.producerFingerprint,
        payload: {
          request: stored.request,
          repository: stored.repository,
          inventory: stored.inventory,
          snapshot: stored.snapshot,
          exitCode: stored.exitCode,
          transcriptEntries: stored.transcript.length,
          ...(stored.catalogStatus ? { catalogStatus: stored.catalogStatus } : {}),
          encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
          decodedBytes: artifact.decodedBytes,
        },
      },
      artifacts: { [RESULT]: artifact.value },
    })
  } catch {
    // A read-only, damaged, or racing cache cannot change a successful canonical check.
  }
}

async function publishCatalog(
  store: ReturnType<typeof createFileWorkspaceCheckpointStore>,
  scope: string,
  stored: StoredCheckCatalog,
): Promise<'available' | 'encode-failed' | 'publish-failed'> {
  let artifact: ReturnType<typeof encodeWorkspaceCheckpointJson>
  try {
    artifact = encodeWorkspaceCheckpointJson(stored, {
      maximumDecodedBytes: MAXIMUM_CATALOG_BYTES,
    })
  } catch {
    return 'encode-failed'
  }
  try {
    await store.publish(scope, {
      manifest: {
        format: CATALOG_FORMAT,
        version: CATALOG_VERSION,
        producerFingerprint: stored.producerFingerprint,
        payload: {
          family: stored.family,
          repository: stored.repository,
          inventory: stored.inventory,
          snapshot: stored.snapshot,
          specifications: stored.catalog.specifications.length,
          qualifications: stored.catalog.qualifications.length,
          encoding: WORKSPACE_CHECKPOINT_JSON_ENCODING,
          decodedBytes: artifact.decodedBytes,
        },
      },
      artifacts: { [CATALOG]: artifact.value },
    })
    return 'available'
  } catch {
    return 'publish-failed'
  }
}

async function loadResult(
  store: ReturnType<typeof createFileWorkspaceCheckpointStore>,
  scope: string,
  expectation: {
    readonly producerFingerprint: string
    readonly request: string
    readonly repository: string
    readonly inventory: string
  },
): Promise<StoredCheckResult | undefined> {
  try {
    const loaded = await store.load(scope)
    if (
      !loaded.ok ||
      loaded.manifest.format !== FORMAT ||
      loaded.manifest.version !== VERSION ||
      loaded.manifest.producerFingerprint !== expectation.producerFingerprint
    ) {
      return
    }
    const bytes = loaded.artifacts.get(RESULT)
    if (!bytes) return
    const decoded = decodeWorkspaceCheckpointJson(bytes, {
      maximumDecodedBytes: MAXIMUM_RESULT_BYTES,
    }).value
    if (!isStoredCheckResult(decoded)) return
    if (
      decoded.producerFingerprint !== expectation.producerFingerprint ||
      decoded.request !== expectation.request ||
      decoded.repository !== expectation.repository ||
      decoded.inventory !== expectation.inventory
    ) {
      return
    }
    return decoded
  } catch {
    return
  }
}

async function loadCatalog(
  store: ReturnType<typeof createFileWorkspaceCheckpointStore>,
  scope: string,
  expectation: {
    readonly producerFingerprint: string
    readonly family: string
    readonly repository: string
    readonly inventory: string
  },
): Promise<StoredCheckCatalog | undefined> {
  try {
    const loaded = await store.load(scope)
    if (
      !loaded.ok ||
      loaded.manifest.format !== CATALOG_FORMAT ||
      loaded.manifest.version !== CATALOG_VERSION ||
      loaded.manifest.producerFingerprint !== expectation.producerFingerprint
    ) {
      return
    }
    const bytes = loaded.artifacts.get(CATALOG)
    if (!bytes) return
    const decoded = decodeWorkspaceCheckpointJson(bytes, {
      maximumDecodedBytes: MAXIMUM_CATALOG_BYTES,
    }).value
    if (!isStoredCheckCatalog(decoded)) return
    if (
      decoded.producerFingerprint !== expectation.producerFingerprint ||
      decoded.family !== expectation.family ||
      decoded.repository !== expectation.repository ||
      decoded.inventory !== expectation.inventory
    ) {
      return
    }
    return decoded
  } catch {
    return
  }
}

function projectCatalogCheck(
  root: string,
  command: CheckCommand,
  stored: StoredCheckCatalog,
  transcript: TranscriptEntry[],
): CliResult {
  const specifications = stored.catalog
    .specifications as unknown as readonly SpecificationSnapshot[]
  const selected = selectApplicationSpecifications(root, specifications, {
    select: command.select,
    focused: true,
  })
  const qualified = new Set(selected.qualification.map((value) => value.source))
  const qualifications = stored.catalog.qualifications.filter((value) =>
    qualified.has(value.source),
  )
  const diagnostics = [
    ...selected.diagnostics,
    ...stored.catalog.sharedDiagnostics,
    ...selected.qualification.flatMap((specification) => specification.diagnostics),
    ...qualifications.flatMap((qualification) => qualification.diagnostics),
  ]
  const identity = sha256(
    JSON.stringify({
      format: `${CATALOG_FORMAT}-projection/1`,
      basis: stored.snapshot,
      request: checkRequest(command),
      selection: selected.selection,
      qualifications: qualifications.map((value) => value.id),
      diagnostics,
    }),
  )
  const snapshot = {
    id: `application:${identity}`,
    repository: stored.repository,
    inventory: stored.inventory,
    selection: selected.selection,
    specifications: selected.included,
  } as unknown as Pick<
    TypeSpecApplicationSnapshot,
    'id' | 'repository' | 'inventory' | 'selection' | 'specifications'
  >
  return reportProjectedCheckResult(
    recordingOutput(undefined, transcript),
    command,
    snapshot,
    diagnostics,
    qualifications.some((qualification) => qualification.status !== 'pass'),
  )
}

function checkRequest(command: CheckCommand): string {
  return JSON.stringify({
    format: `${FORMAT}-request/${VERSION}`,
    exclude: sortedUnique(command.exclude),
    select: sortedUnique(command.select),
    requireCompleteLayout: command.requireCompleteLayout,
    requireExactLayout: command.requireExactLayout,
    quiet: command.quiet,
  })
}

function checkFamily(command: CheckCommand): string {
  return JSON.stringify({
    format: `${CATALOG_FORMAT}-family/${CATALOG_VERSION}`,
    exclude: sortedUnique(command.exclude),
    requireCompleteLayout: command.requireCompleteLayout,
    requireExactLayout: command.requireExactLayout,
    quiet: command.quiet,
  })
}

function recordingOutput(output: CliOutput | undefined, transcript: TranscriptEntry[]): CliOutput {
  return {
    out(message) {
      transcript.push({ channel: 'stdout', message })
      output?.out(message)
    },
    error(message) {
      transcript.push({ channel: 'stderr', message })
      output?.error(message)
    },
    ...(output?.update ? { update: (message: string) => output.update!(message) } : {}),
    ...(output?.clear ? { clear: () => output.clear!() } : {}),
  }
}

function replay(output: CliOutput, transcript: readonly TranscriptEntry[]): void {
  for (const entry of transcript) {
    if (entry.channel === 'stdout') output.out(entry.message)
    else output.error(entry.message)
  }
}

function isStoredCheckResult(value: unknown): value is StoredCheckResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Partial<StoredCheckResult>
  return (
    result.format === FORMAT &&
    result.version === VERSION &&
    typeof result.producerFingerprint === 'string' &&
    typeof result.request === 'string' &&
    typeof result.repository === 'string' &&
    typeof result.inventory === 'string' &&
    typeof result.snapshot === 'string' &&
    Number.isSafeInteger(result.exitCode) &&
    (result.exitCode === 0 || result.exitCode === 1) &&
    Array.isArray(result.transcript) &&
    result.transcript.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        (entry.channel === 'stdout' || entry.channel === 'stderr') &&
        typeof entry.message === 'string',
    )
  )
}

function isStoredCheckCatalog(value: unknown): value is StoredCheckCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const stored = value as Partial<StoredCheckCatalog>
  if (
    stored.format !== CATALOG_FORMAT ||
    stored.version !== CATALOG_VERSION ||
    typeof stored.producerFingerprint !== 'string' ||
    typeof stored.family !== 'string' ||
    typeof stored.repository !== 'string' ||
    typeof stored.inventory !== 'string' ||
    typeof stored.snapshot !== 'string' ||
    !stored.catalog ||
    typeof stored.catalog !== 'object'
  ) {
    return false
  }
  const catalog = stored.catalog as Partial<CliCheckCatalog>
  return (
    Array.isArray(catalog.sharedDiagnostics) &&
    Array.isArray(catalog.specifications) &&
    catalog.specifications.every(isCatalogSpecification) &&
    Array.isArray(catalog.qualifications) &&
    catalog.qualifications.every(isCatalogQualification)
  )
}

function isCatalogSpecification(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const specification = value as Partial<CliCheckCatalog['specifications'][number]>
  return (
    typeof specification.id === 'string' &&
    typeof specification.source === 'string' &&
    typeof specification.root === 'string' &&
    Array.isArray(specification.sourceReferences) &&
    specification.sourceReferences.every(
      (reference) =>
        reference &&
        typeof reference === 'object' &&
        !Array.isArray(reference) &&
        reference.target &&
        typeof reference.target === 'object' &&
        !Array.isArray(reference.target) &&
        typeof reference.target.source === 'string',
    ) &&
    Array.isArray(specification.diagnostics)
  )
}

function isCatalogQualification(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const qualification = value as {
    readonly id?: unknown
    readonly status?: unknown
    readonly source?: unknown
    readonly diagnostics?: unknown
  }
  return (
    typeof qualification.id === 'string' &&
    typeof qualification.status === 'string' &&
    typeof qualification.source === 'string' &&
    Array.isArray(qualification.diagnostics)
  )
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
