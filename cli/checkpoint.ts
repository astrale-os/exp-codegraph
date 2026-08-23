import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

import type { TypeSpecApplicationSnapshot } from '../application/index.ts'
import type { SpecificationSnapshot } from '../specification/index.ts'
import type { CliCommand } from './parse.ts'
import type { CliOutput } from './report.ts'
import type {
  CliPortableCheckpoint,
  CliResult,
  CliServices,
} from './run.ts'
import type {
  CliAccelerationEvent,
  CliAccelerationOperation,
} from './acceleration.ts'

import {
  applicationRepositoryExcludes,
  resolveApplicationRoot,
} from '../application/discovery/index.ts'
import { resolveApplicationRepositoryIdentity } from '../application/index.ts'
import {
  codegraphProducerFingerprint,
  createCheckpointedRepositoryInventory,
  createGitSourceProofProvider,
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
import {
  cliAccelerationError,
  createCliAccelerationEvent as accelerationEvent,
  createCliAccelerationReceipt,
} from './acceleration.ts'
import { reportProjectedCheckResult, runCommand } from './run.ts'
import {
  CHECK_CATALOG_ARTIFACT as CATALOG,
  CHECK_CATALOG_FORMAT as CATALOG_FORMAT,
  CHECK_CATALOG_VERSION as CATALOG_VERSION,
  CHECK_RESULT_ARTIFACT as RESULT,
  CHECK_RESULT_FORMAT as FORMAT,
  CHECK_RESULT_VERSION as VERSION,
  MAXIMUM_CHECK_CATALOG_BYTES as MAXIMUM_CATALOG_BYTES,
  MAXIMUM_CHECK_RESULT_BYTES as MAXIMUM_RESULT_BYTES,
  isStoredCheckCatalog,
  isStoredCheckResult,
  type CheckTranscriptEntry as TranscriptEntry,
  type StoredCheckCatalog,
  type StoredCheckResult,
} from './semantic-pack/model.ts'
import {
  loadSemanticPack,
  portableApplicationReference,
  publishSemanticPack,
  semanticPackScope,
} from './semantic-pack/store.ts'

type CheckCommand = Extract<CliCommand, { readonly name: 'check' }>


/**
 * Admit an exact previous check result before constructing the application. Any cache uncertainty
 * is advisory: the canonical command runs and is the only producer of publishable output.
 */
export async function runCliCommand(
  command: CliCommand,
  services: CliServices,
  output: CliOutput,
): Promise<CliResult> {
  if (command.name !== 'check') return runCommand(command, services, output)
  const suppliedSemanticPackDirectory = process.env.ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR?.trim()
  if (!command.cache && !suppliedSemanticPackDirectory) {
    return runCommand(command, services, output)
  }

  const root = await resolveApplicationRoot(command.root)
  const cacheDirectory = defaultTypeSpecCacheDirectory()
  const store = command.cache
    ? createFileWorkspaceCheckpointStore({
        directory: nodeApplicationWorkspaceCheckpointDirectory(cacheDirectory, root),
        maxArtifacts: 4_096,
        maximumScopes: 512,
      })
    : undefined
  let semanticStore: ReturnType<typeof createFileWorkspaceCheckpointStore> | undefined
  let semanticPackWritable = false
  let portableCheckpoint: CliPortableCheckpoint | undefined
  let canonicalStarted = false
  const events: CliAccelerationEvent[] = []
  try {
    const producerFingerprint = await codegraphProducerFingerprint({
      persistence: command.cache ? 'advisory' : 'memory',
    })
    const repositoryKey = await nodeApplicationRepositoryKey(root)
    const repository = await resolveApplicationRepositoryIdentity(root, repositoryKey)
    const request = checkRequest(command)
    const family = checkFamily(command)
    const repositoryExcludes = applicationRepositoryExcludes(root, command.exclude)
    const loadInventory = () => createCheckpointedRepositoryInventory({
      root,
      store: store!,
      producerFingerprint: `${producerFingerprint}:repository-inventory/3`,
    })({ root, repository, scope: { exclude: repositoryExcludes } })
    const inventoryPromise = store && !suppliedSemanticPackDirectory
      ? loadInventory()
      : undefined
    const proofStarted = performance.now()
    const proofAdmission = await createGitSourceProofProvider().admit(root, {
      version: 'application-source-scope/1',
      exclude: repositoryExcludes,
      ignored: 'reject-semantic',
    })
    events.push({
      operation: 'source-proof',
      outcome: proofAdmission.ok ? 'admitted' : 'fallback',
      code: proofAdmission.ok ? 'proof-admitted' : proofAdmission.code,
      durationMs: performance.now() - proofStarted,
      ...(proofAdmission.ok
        ? {}
        : { error: { name: 'SourceProofFallback', message: proofAdmission.message } }),
    })
    const sourceProof = proofAdmission.ok ? proofAdmission.proof.id : undefined
    if (sourceProof) {
      semanticPackWritable = suppliedSemanticPackDirectory === undefined
      semanticStore = createFileWorkspaceCheckpointStore({
        directory: suppliedSemanticPackDirectory
          ? resolve(suppliedSemanticPackDirectory)
          : join(cacheDirectory, 'semantic-packs', 'checks'),
        maxArtifacts: 4_096,
        maximumScopes: 1_024,
      })
      const semantic = await loadSemanticPack(
        semanticStore,
        semanticPackScope({ sourceProof, producerFingerprint, repository, family }),
        { producerFingerprint, sourceProof, request, family, repository },
        command.select.length > 0,
      )
      events.push(semantic.event)
      if (semantic.result) {
        replay(output, semantic.result.transcript)
        return withAcceleration({
          exitCode: semantic.result.exitCode,
          check: {
            repository: semantic.result.repository,
            inventory: semantic.result.inventory,
            snapshot: semantic.result.snapshot,
          },
        }, events)
      }
      if (semantic.catalog) {
        const transcript: TranscriptEntry[] = []
        const projected = projectCatalogCheck(root, command, semantic.catalog, transcript)
        replay(output, transcript)
        return withAcceleration(projected, events)
      }
      if (semanticPackWritable || semantic.application) {
        portableCheckpoint = {
          store: semanticStore,
          sourceProof,
          writable: semanticPackWritable,
          ...(semantic.application ? { reference: semantic.application } : {}),
        }
      }
    }
    if (!store) {
      canonicalStarted = true
      return withAcceleration(
        await runCommand(command, services, output, portableCheckpoint),
        events,
      )
    }
    const scope = `cli-check-${sha256(request)}`
    const catalogScope = `cli-check-catalog-${sha256(family)}`
    const inventory = await (inventoryPromise ?? loadInventory())

    const cached = await loadResult(
      store,
      scope,
      {
        producerFingerprint,
        ...(sourceProof ? { sourceProof } : {}),
        request,
        repository,
        inventory: inventory.revision,
      },
      'workspace-result-read',
    )
    events.push(cached.event)
    if (cached.value) {
      replay(output, cached.value.transcript)
      return withAcceleration({
        exitCode: cached.value.exitCode,
        check: {
          repository: cached.value.repository,
          inventory: cached.value.inventory,
          snapshot: cached.value.snapshot,
        },
      }, events)
    }

    if (command.select.length) {
      const catalog = await loadCatalog(store, catalogScope, {
        producerFingerprint,
        family,
        repository,
        inventory: inventory.revision,
      })
      events.push(catalog.event)
      if (catalog.value) {
        const transcript: TranscriptEntry[] = []
        const projected = projectCatalogCheck(root, command, catalog.value, transcript)
        const stored: StoredCheckResult = {
          format: FORMAT,
          version: VERSION,
          producerFingerprint,
          ...(sourceProof ? { sourceProof } : {}),
          request,
          repository,
          inventory: inventory.revision,
          snapshot: projected.check!.snapshot,
          exitCode: projected.exitCode,
          transcript,
          catalogStatus: 'projected',
        }
        events.push(await publishResult(store, scope, stored, 'workspace-result-publish'))
        if (semanticStore && sourceProof && semanticPackWritable) {
          const application = await portableApplicationReference(
            semanticStore,
            producerFingerprint,
            sourceProof,
            repository,
            inventory.revision,
            command.exclude,
          )
          events.push(
            await publishSemanticPack(
              semanticStore,
              semanticPackScope({ sourceProof, producerFingerprint, repository, family }),
              stored,
              family,
              sourceProof,
              { ...(application ? { application } : {}) },
            ),
          )
        }
        replay(output, transcript)
        return withAcceleration(projected, events)
      }
    }

    const transcript: TranscriptEntry[] = []
    const recording = recordingOutput(output, transcript)
    canonicalStarted = true
    const result = await runCommand(command, services, recording, portableCheckpoint)
    if (
      result.check &&
      result.check.repository === repository &&
      result.check.inventory === inventory.revision
    ) {
      let catalogStatus: StoredCheckResult['catalogStatus'] = 'not-applicable'
      let catalog: StoredCheckCatalog | undefined
      if (!command.select.length && result.check.catalog) {
        catalog = {
          format: CATALOG_FORMAT,
          version: CATALOG_VERSION,
          producerFingerprint,
          ...(sourceProof ? { sourceProof } : {}),
          family,
          repository,
          inventory: inventory.revision,
          snapshot: result.check.snapshot,
          catalog: result.check.catalog,
        }
        const published = await publishCatalog(store, catalogScope, catalog)
        catalogStatus = published.status
        events.push(published.event)
      }
      const stored: StoredCheckResult = {
        format: FORMAT,
        version: VERSION,
        producerFingerprint,
        ...(sourceProof ? { sourceProof } : {}),
        request,
        repository,
        inventory: inventory.revision,
        snapshot: result.check.snapshot,
        exitCode: result.exitCode,
        transcript,
        catalogStatus,
      }
      events.push(await publishResult(store, scope, stored, 'workspace-result-publish'))
      if (semanticStore && sourceProof && semanticPackWritable) {
        const application = await portableApplicationReference(
          semanticStore,
          producerFingerprint,
          sourceProof,
          repository,
          inventory.revision,
          command.exclude,
        )
        events.push(
          await publishSemanticPack(
            semanticStore,
            semanticPackScope({ sourceProof, producerFingerprint, repository, family }),
            stored,
            family,
            sourceProof,
            {
              ...(catalog ? { catalog } : {}),
              ...(application ? { application } : {}),
            },
          ),
        )
      }
    }
    return withAcceleration(result, events)
  } catch (error) {
    if (canonicalStarted) throw error
    events.push({
      operation: 'admission',
      outcome: 'fallback',
      code: 'acceleration-admission-failed',
      durationMs: 0,
      error: cliAccelerationError(error),
    })
    // Admission is strictly advisory. Re-run without touching the canonical command semantics.
    return withAcceleration(await runCommand(command, services, output), events)
  } finally {
    await Promise.all([store?.dispose(), semanticStore?.dispose()])
  }
}

async function publishResult(
  store: ReturnType<typeof createFileWorkspaceCheckpointStore>,
  scope: string,
  stored: StoredCheckResult,
  operation: Extract<CliAccelerationOperation, 'workspace-result-publish'>,
): Promise<CliAccelerationEvent> {
  const started = performance.now()
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
          ...(stored.sourceProof ? { sourceProof: stored.sourceProof } : {}),
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
    return {
      ...accelerationEvent(operation, 'published', 'published', started),
      work: {
        bytesWritten: artifact.value.byteLength,
        bytesDecoded: artifact.decodedBytes,
        writtenShards: 1,
      },
    }
  } catch (error) {
    return accelerationEvent(operation, 'failed', 'publication-failed', started, error)
  }
}

async function publishCatalog(
  store: ReturnType<typeof createFileWorkspaceCheckpointStore>,
  scope: string,
  stored: StoredCheckCatalog,
): Promise<{
  readonly status: 'available' | 'encode-failed' | 'publish-failed'
  readonly event: CliAccelerationEvent
}> {
  const started = performance.now()
  let artifact: ReturnType<typeof encodeWorkspaceCheckpointJson>
  try {
    artifact = encodeWorkspaceCheckpointJson(stored, {
      maximumDecodedBytes: MAXIMUM_CATALOG_BYTES,
    })
  } catch (error) {
    return {
      status: 'encode-failed',
      event: accelerationEvent('catalog-publish', 'failed', 'encode-failed', started, error),
    }
  }
  try {
    await store.publish(scope, {
      manifest: {
        format: CATALOG_FORMAT,
        version: CATALOG_VERSION,
        producerFingerprint: stored.producerFingerprint,
        payload: {
          family: stored.family,
          ...(stored.sourceProof ? { sourceProof: stored.sourceProof } : {}),
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
    return {
      status: 'available',
      event: {
        ...accelerationEvent('catalog-publish', 'published', 'catalog-published', started),
        work: {
          bytesWritten: artifact.value.byteLength,
          bytesDecoded: artifact.decodedBytes,
          writtenShards: 1,
        },
      },
    }
  } catch (error) {
    return {
      status: 'publish-failed',
      event: accelerationEvent(
        'catalog-publish',
        'failed',
        'publication-failed',
        started,
        error,
      ),
    }
  }
}

interface AccelerationLoad<Value> {
  readonly value?: Value
  readonly event: CliAccelerationEvent
}

async function loadResult(
  store: ReturnType<typeof createFileWorkspaceCheckpointStore>,
  scope: string,
  expectation: {
    readonly producerFingerprint: string
    readonly sourceProof?: string
    readonly request: string
    readonly repository: string
    readonly inventory?: string
  },
  operation: Extract<CliAccelerationOperation, 'workspace-result-read'>,
): Promise<AccelerationLoad<StoredCheckResult>> {
  const started = performance.now()
  const miss = (code: string): AccelerationLoad<StoredCheckResult> => ({
    event: accelerationEvent(operation, 'miss', code, started),
  })
  try {
    const loaded = await store.load(scope)
    if (!loaded.ok) return miss(loaded.reason)
    if (
      loaded.manifest.format !== FORMAT ||
      loaded.manifest.version !== VERSION ||
      loaded.manifest.producerFingerprint !== expectation.producerFingerprint
    ) {
      return miss('manifest-incompatible')
    }
    const bytes = loaded.artifacts.get(RESULT)
    if (!bytes) return miss('artifact-missing')
    const artifact = decodeWorkspaceCheckpointJson(bytes, {
      maximumDecodedBytes: MAXIMUM_RESULT_BYTES,
    })
    const decoded = artifact.value
    if (!isStoredCheckResult(decoded)) return miss('payload-invalid')
    if (
      decoded.producerFingerprint !== expectation.producerFingerprint ||
      decoded.request !== expectation.request ||
      decoded.repository !== expectation.repository ||
      (expectation.sourceProof !== undefined && decoded.sourceProof !== expectation.sourceProof) ||
      (expectation.inventory !== undefined && decoded.inventory !== expectation.inventory)
    ) {
      return miss('identity-mismatch')
    }
    return {
      value: decoded,
      event: {
        ...accelerationEvent(operation, 'hit', 'admitted', started),
        work: {
          bytesRead: bytes.byteLength,
          bytesDecoded: artifact.decodedBytes,
          loadedShards: 1,
        },
      },
    }
  } catch (error) {
    return {
      event: accelerationEvent(operation, 'failed', 'load-failed', started, error),
    }
  }
}

async function loadCatalog(
  store: ReturnType<typeof createFileWorkspaceCheckpointStore>,
  scope: string,
  expectation: {
    readonly producerFingerprint: string
    readonly sourceProof?: string
    readonly family: string
    readonly repository: string
    readonly inventory?: string
  },
  operation: Extract<CliAccelerationOperation, 'catalog-read'> = 'catalog-read',
): Promise<AccelerationLoad<StoredCheckCatalog>> {
  const started = performance.now()
  const miss = (code: string): AccelerationLoad<StoredCheckCatalog> => ({
    event: accelerationEvent(operation, 'miss', code, started),
  })
  try {
    const loaded = await store.load(scope)
    if (!loaded.ok) return miss(loaded.reason)
    if (
      loaded.manifest.format !== CATALOG_FORMAT ||
      loaded.manifest.version !== CATALOG_VERSION ||
      loaded.manifest.producerFingerprint !== expectation.producerFingerprint
    ) {
      return miss('manifest-incompatible')
    }
    const bytes = loaded.artifacts.get(CATALOG)
    if (!bytes) return miss('artifact-missing')
    const artifact = decodeWorkspaceCheckpointJson(bytes, {
      maximumDecodedBytes: MAXIMUM_CATALOG_BYTES,
    })
    const decoded = artifact.value
    if (!isStoredCheckCatalog(decoded)) return miss('payload-invalid')
    if (
      decoded.producerFingerprint !== expectation.producerFingerprint ||
      (expectation.sourceProof !== undefined && decoded.sourceProof !== expectation.sourceProof) ||
      decoded.family !== expectation.family ||
      decoded.repository !== expectation.repository
    ) {
      return miss('identity-mismatch')
    }
    if (expectation.inventory !== undefined && decoded.inventory !== expectation.inventory) {
      return miss('identity-mismatch')
    }
    return {
      value: decoded,
      event: {
        ...accelerationEvent(operation, 'hit', 'catalog-admitted', started),
        work: {
          bytesRead: bytes.byteLength,
          bytesDecoded: artifact.decodedBytes,
          loadedShards: 1,
        },
      },
    }
  } catch (error) {
    return {
      event: accelerationEvent(operation, 'failed', 'load-failed', started, error),
    }
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

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function withAcceleration(result: CliResult, events: readonly CliAccelerationEvent[]): CliResult {
  return { ...result, acceleration: createCliAccelerationReceipt(events) }
}
