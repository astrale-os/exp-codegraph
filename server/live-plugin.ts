import type { Plugin, ViteDevServer } from 'vite'

import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

import type {
  TypeSpecApplicationReader,
  TypeSpecApplicationService,
  TypeSpecApplicationSnapshot,
} from '../application/index.ts'
import type { AnalysisTelemetrySink } from '../analysis/index.ts'
import { dispatchAnalysisTelemetry } from '../analysis/profiling/dispatch.ts'
import type { CodegraphApplicationSessionOptions } from '../application/analysis/index.ts'
import type { SourceEditRequest, SourceEditResponse } from '../application/interaction/editing.ts'
import type { SpecRevealResponse } from '../application/interaction/reveal.ts'
import type { VerificationRunRequest, VerificationRunResponse } from '../application/interaction/qualification.ts'
import type { ViewerAdapterManifest } from '../viewer-host/manifest.ts'
import type { ViewerCatalog } from '../viewer-host/specification.ts'

import { handleSourceEditHttp } from '../application/interaction/http/editing.ts'
import { SOURCE_EDIT_ENDPOINT, SOURCE_EDIT_PROTOCOL } from '../application/interaction/editing.ts'
import { handleSpecRevealHttp } from '../application/interaction/http/reveal.ts'
import { SPEC_REVEAL_ENDPOINT, SPEC_REVEAL_PROTOCOL } from '../application/interaction/reveal.ts'
import { handleVerificationHttp } from '../application/interaction/http/qualification.ts'
import { VERIFICATION_ENDPOINT, VERIFICATION_PROTOCOL } from '../application/interaction/qualification.ts'
import { HISTORY_RESOURCE_ENDPOINT } from '../viewer-host/catalog.ts'
import { createServerApplicationService } from './application.ts'
import { projectApplicationCatalog } from './application-catalog.ts'
import { revealApplicationSpecification, saveApplicationSource } from './application-operations.ts'
import { handleCatalogPayloadHttp } from './catalog-http.ts'
import { createCatalogSnapshot } from './catalog-snapshot.ts'
import { CatalogSnapshotStore } from './catalog-store.ts'
import { handleHistoryResourceHttp } from './history-http.ts'
import {
  createRebuildScheduler,
  createSourceChangeFilter,
  type CatalogRebuildResult,
} from './reload.ts'
import { isWatchedSource } from './watch.ts'
import { createSpecificationImpactIndex } from '../application/change/index.ts'
import {
  createServerCatalogCheckpoint,
  type ServerCatalogCheckpoint,
  type ServerVerificationCheckpoint,
} from './catalog-checkpoint.ts'

export const CATALOG_INDEX_ID = 'virtual:spec-catalog-index'
const RESOLVED_CATALOG_INDEX_ID = `\0${CATALOG_INDEX_ID}`
const MAX_RESIDENT_VERIFIER_APPLICATIONS = 1

export interface LiveSpecsServices {
  createApplication(root: string, cache: boolean): Promise<TypeSpecApplicationService>
  projectCatalog(
    root: string,
    reader: TypeSpecApplicationReader,
    options?: import('./application-catalog.ts').ApplicationCatalogProjectionOptions,
  ): Promise<ViewerCatalog>
  editSource(
    root: string,
    reader: TypeSpecApplicationReader,
    request: SourceEditRequest,
  ): Promise<SourceEditResponse>
  revealSpecification(
    root: string,
    reader: TypeSpecApplicationReader,
    source: string,
  ): Promise<SpecRevealResponse>
}

export interface LiveSpecsOptions {
  root: string
  allowedRoots: string[]
  verify: boolean
  cache?: boolean
  native?: CodegraphApplicationSessionOptions
  telemetry?: AnalysisTelemetrySink
  services?: LiveSpecsServices
}

export function createLiveSpecsPlugin(options: LiveSpecsOptions): Plugin {
  const { root, allowedRoots, verify } = options
  const services = options.services ?? {
    ...defaultServices,
    createApplication: (applicationRoot: string, cache: boolean) =>
      createServerApplicationService(applicationRoot, cache, options.native, options.telemetry),
  }
  const applicationPromise = services.createApplication(root, options.cache !== false)
  const catalogCheckpointPromise: Promise<ServerCatalogCheckpoint | undefined> =
    options.services || options.cache === false
      ? Promise.resolve(undefined)
      : createServerCatalogCheckpoint(root).catch(() => undefined)
  let application: TypeSpecApplicationService | undefined
  let reader: TypeSpecApplicationReader | undefined
  let catalog: ViewerCatalog | undefined
  let applicationSnapshot: TypeSpecApplicationSnapshot | undefined
  let catalogGeneration = 0
  let deliveredGeneration = 0
  let operations = Promise.resolve()
  let initialization: Promise<void> | undefined
  let disposed = false
  let viteServer: ViteDevServer | undefined
  const pendingChanges = new Set<string>()
  const verifiedSpecifications = new Set<string>()
  const verifierApplications = new Map<string, TypeSpecApplicationService>()
  const sourceChanges = createSourceChangeFilter()
  const snapshots = new CatalogSnapshotStore()

  const rebuild = async (requestedCompiler?: boolean): Promise<CatalogRebuildResult> => {
    const started = performance.now()
    const changed = [...pendingChanges].sort()
    pendingChanges.clear()
    const forceCompiler = requestedCompiler ?? verify
    application ??= await applicationPromise
    const refreshed = await application.refresh({
        qualify: true,
        compilerAnalysis: forceCompiler,
        ...(forceCompiler
          ? {}
          : {
              requestedProfiles: [
                'contract.specification.validity',
                'contract.module.layout',
                'contract.module.schema-catalog',
                'contract.module.test-evidence',
              ],
            }),
        ...(changed.length ? { changed } : {}),
      })
    const verifiedChanges = refreshed.changes.specifications.refreshed.filter((source) =>
      verifiedSpecifications.has(source),
    )
    const nextReader = await application.open(refreshed.snapshot.id)
    try {
      const refresh = !catalog || forceCompiler
        ? refreshed.snapshot.specifications.map((value) => value.source)
        : [
            ...new Set([
              ...refreshed.changes.specifications.added,
              ...refreshed.changes.specifications.changed,
              ...refreshed.changes.specifications.refreshed,
            ]),
          ].sort()
      const projectionStarted = performance.now()
      dispatchAnalysisTelemetry(options.telemetry, {
        component: 'analysis',
        phase: 'application.projection',
        metrics: { status: 'started' },
      })
      const catalogCheckpoint = await catalogCheckpointPromise
      const restoredCatalog =
        !catalog && changed.length === 0
          ? await catalogCheckpoint?.load(refreshed.snapshot.id)
          : undefined
      let next =
        restoredCatalog ??
        (await services.projectCatalog(root, nextReader, {
          ...(catalog ? { previous: catalog } : {}),
          refresh,
        }))
      const verificationRecords = await catalogCheckpoint?.loadVerifications() ?? []
      const verificationInputs = verificationInputRevisions(refreshed.snapshot)
      next = restoreVerificationRecords(next, verificationRecords, verificationInputs)
      for (const record of verificationRecords) {
        const current = next.specs.find((candidate) => candidate.source === record.source)
        if (current?.verificationRevision === record.revision) {
          verifiedSpecifications.add(record.source)
        }
      }
      for (const source of verifiedChanges) {
        const verification = await refreshVerifiedSpecification(source, changed)
        const verified = verification?.specification
        const current = next.specs.find((candidate) => candidate.source === source)
        if (
          verification?.inventory !== refreshed.snapshot.inventory ||
          !current ||
          !verified?.verification ||
          current.verificationRevision !== verified.verificationRevision
        ) {
          continue
        }
        next = {
          ...next,
          specs: next.specs.map((candidate) =>
            candidate.source === source
              ? { ...candidate, verification: verified.verification }
              : candidate,
          ),
        }
      }
      const publication = snapshots.publish(
        createCatalogSnapshot(
          next,
          applicationAdapterManifest(refreshed.snapshot.id),
          refreshed.snapshot.id,
          snapshots.current,
        ),
      )
      const previous = reader
      reader = nextReader
      catalog = next
      applicationSnapshot = refreshed.snapshot
      if (publication.changed) catalogGeneration++
      if (!restoredCatalog) await catalogCheckpoint?.publish(refreshed.snapshot.id, next)
      await catalogCheckpoint?.publishVerifications(
        verificationRecordsFromCatalog(next, verificationInputs),
      )
      dispatchAnalysisTelemetry(options.telemetry, {
        component: 'analysis',
        phase: 'application.projection',
        durationNs: Math.round((performance.now() - projectionStarted) * 1_000_000),
        metrics: {
          status: 'completed',
          specifications: restoredCatalog ? 0 : refresh.length,
          retainedSpecifications: restoredCatalog ? next.specs.length : next.specs.length - refresh.length,
          checkpoint: restoredCatalog !== undefined,
        },
      })
      await previous?.dispose()
      dispatchAnalysisTelemetry(options.telemetry, {
        component: 'analysis',
        phase: 'application.refresh',
        durationNs: Math.round((performance.now() - started) * 1_000_000),
        metrics: {
          compilerAnalysis: forceCompiler,
          changedPaths: changed.length,
          affectedSpecifications: refreshed.changes.specifications.refreshed.length,
          projectedSpecifications: refresh.length,
          specifications: refreshed.snapshot.specifications.length,
          heapUsedBytes: process.memoryUsage().heapUsed,
          rssBytes: process.memoryUsage().rss,
        },
      })
      return { catalog: next, changed: publication.changed, generation: catalogGeneration }
    } catch (error) {
      await nextReader.dispose()
      throw error
    }
  }
  const inOrder = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const next = operations.then(operation, operation)
    operations = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  const rebuilds = createRebuildScheduler(() => inOrder(() => rebuild()))
  const deliver = ({ changed, generation }: CatalogRebuildResult): boolean => {
    if (!changed || generation <= deliveredGeneration) return false
    deliveredGeneration = generation
    return true
  }
  const ensureCurrent = async (): Promise<void> => {
    if (catalog && reader) return
    initialization ??= inOrder(async () => {
      if (!catalog || !reader) await rebuild()
    }).finally(() => {
      initialization = undefined
    })
    await initialization
  }
  const refreshVerifiedSpecification = async (
    source: string,
    changed: readonly string[] = [],
  ): Promise<
    | {
        readonly specification: ViewerCatalog['specs'][number] | undefined
        readonly inventory: string
      }
    | undefined
  > => {
    let verifier = verifierApplications.get(source)
    if (!verifier) {
      while (verifierApplications.size >= MAX_RESIDENT_VERIFIER_APPLICATIONS) {
        const oldest = verifierApplications.entries().next().value as
          | [string, TypeSpecApplicationService]
          | undefined
        if (!oldest) break
        verifierApplications.delete(oldest[0])
        await oldest[1].dispose()
      }
      verifier = await services.createApplication(root, options.cache !== false)
      verifierApplications.set(source, verifier)
    } else {
      verifierApplications.delete(source)
      verifierApplications.set(source, verifier)
    }
    const refreshed = await verifier.refresh({
      qualify: true,
      compilerAnalysis: true,
      focused: true,
      select: [source],
      ...(changed.length ? { changed } : {}),
    })
    const verificationReader = await verifier.open(refreshed.snapshot.id)
    try {
      const focused = await services.projectCatalog(root, verificationReader)
      return {
        specification: focused.specs.find((candidate) => candidate.source === source),
        inventory: refreshed.snapshot.inventory,
      }
    } finally {
      await verificationReader.dispose()
    }
  }
  const verifyInOrder = (request: VerificationRunRequest): Promise<VerificationRunResponse> =>
    inOrder(async () => {
      await ensureCurrent()
      let specification = catalog!.specs.find((candidate) => candidate.source === request.source)
      if (!specification) return rejected(request, 'SOURCE_NOT_FOUND', 'Specification source not found.')
      if (specification.verificationRevision !== request.revision) {
        return {
          ...rejected(request, 'SOURCE_CHANGED', 'Specification source changed.'),
          revision: specification.verificationRevision,
        }
      }
      if (specification.diagnostics.length || specification.modules.some((module) => module.diagnostics.length)) {
        return rejected(request, 'SPEC_INVALID', 'Specification validation must pass first.')
      }
      if (!specification.modules.some((module) => module.contract)) {
        return rejected(request, 'VERIFIER_MISSING', 'Specification has no API contract to verify.')
      }
      if (!specification.verification) {
        const inventory = applicationSnapshot!.inventory
        const started = performance.now()
        // Focused compiler qualification owns a separate application lifecycle. It must not move
        // the full viewer application's current snapshot or invalidate its local delta cache.
        try {
          const verification = await refreshVerifiedSpecification(request.source)
          if (verification?.inventory !== inventory) {
            return rejected(request, 'SOURCE_CHANGED', 'Specification inventory changed.')
          }
          specification = verification.specification
          dispatchAnalysisTelemetry(options.telemetry, {
            component: 'analysis',
            phase: 'application.verification',
            durationNs: Math.round((performance.now() - started) * 1_000_000),
            metrics: {
              specifications: 1,
              heapUsedBytes: process.memoryUsage().heapUsed,
              rssBytes: process.memoryUsage().rss,
            },
          })
        } catch (error) {
          const verifier = verifierApplications.get(request.source)
          verifierApplications.delete(request.source)
          await verifier?.dispose()
          throw error
        }
        if (applicationSnapshot!.inventory !== inventory || specification?.verificationRevision !== request.revision) {
          return {
            ...rejected(request, 'SOURCE_CHANGED', 'Specification source changed.'),
            ...(specification ? { revision: specification.verificationRevision } : {}),
          }
        }
      }
      if (!specification?.verification) {
        return rejected(request, 'EXECUTION_FAILED', 'V2 qualification did not produce a result.')
      }
      verifiedSpecifications.add(specification.source)
      const current = catalog!.specs.find((candidate) => candidate.source === specification!.source)
      if (current && current.verificationRevision === specification.verificationRevision) {
        const verified = { ...current, verification: specification.verification }
        catalog = {
          ...catalog!,
          specs: catalog!.specs.map((candidate) =>
            candidate.source === verified.source ? verified : candidate,
          ),
        }
        const publication = snapshots.publish(
          createCatalogSnapshot(
            catalog,
            applicationAdapterManifest(applicationSnapshot!.id),
            applicationSnapshot!.id,
            snapshots.current,
          ),
        )
        if (publication.changed) catalogGeneration++
        await (await catalogCheckpointPromise)?.publish(applicationSnapshot!.id, catalog)
        await (await catalogCheckpointPromise)?.publishVerifications(
          verificationRecordsFromCatalog(
            catalog,
            verificationInputRevisions(applicationSnapshot!),
          ),
        )
        const module = viteServer?.moduleGraph.getModuleById(RESOLVED_CATALOG_INDEX_ID)
        if (module) viteServer!.moduleGraph.invalidateModule(module)
      }
      return {
        protocol: VERIFICATION_PROTOCOL,
        status: 'completed',
        source: specification.source,
        revision: specification.verificationRevision,
        verification: specification.verification,
      }
    })

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await inOrder(async () => {
      await reader?.dispose()
      reader = undefined
      const resolved = application ?? await applicationPromise
      await Promise.all([
        resolved.dispose(),
        ...[...verifierApplications.values()].map((verifier) => verifier.dispose()),
        (await catalogCheckpointPromise)?.dispose(),
      ])
      verifierApplications.clear()
      application = undefined
    })
  }

  return {
    name: 'astrale-specs',
    enforce: 'pre',
    async buildStart() {
      await ensureCurrent()
    },
    async closeBundle() {
      await dispose()
    },
    resolveId(id) {
      return id === CATALOG_INDEX_ID ? RESOLVED_CATALOG_INDEX_ID : null
    },
    async load(id) {
      if (id !== RESOLVED_CATALOG_INDEX_ID) return null
      await ensureCurrent()
      return snapshots.current!.indexModule
    },
    async handleHotUpdate(context) {
      if (!isWatchedSource(applicationSnapshot, root, context.file, 'change', {
        compilerAnalysis: verify,
        compilerSpecifications: [...verifiedSpecifications],
      })) return
      if (!(await sourceChanges.changed(context.file))) return []
      pendingChanges.add(context.file)
      const result = await rebuilds.request()
      if (!deliver(result)) return []
      const module = context.server.moduleGraph.getModuleById(RESOLVED_CATALOG_INDEX_ID)
      if (!module) return []
      context.server.moduleGraph.invalidateModule(module)
      return [...new Set([module, ...context.modules])]
    },
    configureServer(vite) {
      viteServer = vite
      vite.httpServer?.once('close', () => void dispose())
      vite.middlewares.use(async (request, response, next) => {
        try {
          await ensureCurrent()
          if (request.url?.startsWith(HISTORY_RESOURCE_ENDPOINT)) {
            if (
              await handleHistoryResourceHttp(request, response, root, {
                resource(source, revision) {
                  return catalog!.specs
                    .flatMap((specification) => specification.history)
                    .find((resource) => resource.source === source && resource.revision === revision)
                },
              })
            ) return
          }
          if (handleCatalogPayloadHttp(request, response, snapshots)) return
          if (
            await handleSourceEditHttp(request, response, (command, snapshot) =>
              snapshot === reader!.snapshot.id
                ? services.editSource(root, reader!, command)
                : Promise.resolve({
                    status: 'error' as const,
                    message: 'Application snapshot changed; reload the catalog.',
                  }),
            )
          ) return
          if (
            await handleSpecRevealHttp(request, response, (source, snapshot) =>
              snapshot === reader!.snapshot.id
                ? services.revealSpecification(root, reader!, source)
                : Promise.resolve({
                    protocol: SPEC_REVEAL_PROTOCOL,
                    status: 'rejected' as const,
                    code: 'SNAPSHOT_CHANGED' as const,
                    message: 'Application snapshot changed; reload the catalog.',
                  }),
            )
          ) return
          if (
            await handleVerificationHttp(request, response, (command, snapshot) =>
              snapshot === reader!.snapshot.id
                ? verifyInOrder(command)
                : Promise.resolve(
                    rejected(command, 'SOURCE_CHANGED', 'Application snapshot changed; reload the catalog.'),
                  ),
            )
          ) return
          next()
        } catch (error) {
          next(error instanceof Error ? error : new Error(String(error)))
        }
      })
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/@fs/')) return next()
        try {
          const pathname = new URL(request.url, 'http://localhost').pathname
          let file = decodeURIComponent(pathname.slice('/@fs/'.length))
          if (sep === '/' && !file.startsWith('/')) file = `/${file}`
          const target = await realpath(file)
          if (!allowedRoots.some((allowed) => within(allowed, target))) throw new Error('outside roots')
          next()
        } catch {
          response.statusCode = 403
          response.end('Forbidden')
        }
      })
      vite.watcher.add(root)
      const reloadTopology = (event: 'add' | 'unlink', file: string) => {
        if (!isWatchedSource(applicationSnapshot, root, file, event, {
          compilerAnalysis: verify,
          compilerSpecifications: [...verifiedSpecifications],
        })) return
        void sourceChanges
          .changed(file)
          .then((changed) => {
            if (!changed) return
            pendingChanges.add(file)
            return rebuilds.request()
          })
          .then(async (result) => {
            if (!result || !deliver(result)) return
            const module = vite.moduleGraph.getModuleById(RESOLVED_CATALOG_INDEX_ID)
            if (module) {
              await vite.reloadModule(module)
              return
            }
            vite.ws.send({ type: 'full-reload' })
          })
          .catch((error: unknown) => {
            vite.config.logger.error(error instanceof Error ? error.message : String(error))
          })
      }
      vite.watcher.on('add', (file) => reloadTopology('add', file))
      vite.watcher.on('unlink', (file) => reloadTopology('unlink', file))
    },
  }
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function restoreVerificationRecords(
  catalog: ViewerCatalog,
  records: readonly ServerVerificationCheckpoint[],
  inputs: ReadonlyMap<string, string>,
): ViewerCatalog {
  const bySource = new Map(records.map((record) => [record.source, record]))
  let changed = false
  const specs = catalog.specs.map((specification) => {
    if (specification.verification) return specification
    const record = bySource.get(specification.source)
    if (
      !record ||
      record.revision !== specification.verificationRevision ||
      record.inputs !== inputs.get(specification.source)
    ) return specification
    changed = true
    return { ...specification, verification: record.verification }
  })
  return changed ? { ...catalog, specs } : catalog
}

function verificationRecordsFromCatalog(
  catalog: ViewerCatalog,
  inputs: ReadonlyMap<string, string>,
): readonly ServerVerificationCheckpoint[] {
  return catalog.specs
    .filter(
      (specification): specification is typeof specification & { verification: NonNullable<typeof specification.verification> } =>
        specification.verification !== undefined,
    )
    .map((specification) => ({
      source: specification.source,
      revision: specification.verificationRevision,
      inputs: inputs.get(specification.source) ?? 'missing',
      verification: specification.verification,
    }))
    .sort((left, right) => left.source.localeCompare(right.source))
}

function verificationInputRevisions(
  snapshot: TypeSpecApplicationSnapshot,
): ReadonlyMap<string, string> {
  const impact = createSpecificationImpactIndex(snapshot.specifications)
  const bySource = new Map(
    snapshot.specifications.map((specification) => [specification.source, [] as string[][]]),
  )
  for (const file of snapshot.statistics.files) {
    for (const owner of impact.impact(file.path).refreshedOwners) {
      bySource.get(owner)?.push([file.path, file.revision])
    }
  }
  return new Map(
    snapshot.specifications.map((specification) => [
      specification.source,
      createHash('sha256')
        .update(JSON.stringify([specification.id, bySource.get(specification.source) ?? []]))
        .digest('hex'),
    ]),
  )
}

function rejected(
  request: VerificationRunRequest,
  code: Extract<VerificationRunResponse, { status: 'rejected' }>['code'],
  message: string,
): Extract<VerificationRunResponse, { status: 'rejected' }> {
  return {
    protocol: VERIFICATION_PROTOCOL,
    status: 'rejected',
    code,
    message,
    source: request.source,
    revision: request.revision,
  }
}

const defaultServices: LiveSpecsServices = {
  createApplication: createServerApplicationService,
  projectCatalog: projectApplicationCatalog,
  editSource: saveApplicationSource,
  revealSpecification: revealApplicationSpecification,
}

function applicationAdapterManifest(snapshot: `application:${string}`): ViewerAdapterManifest {
  const endpoint = (path: string) => `${path}?${new URLSearchParams({ snapshot })}`
  return {
    editing: {
      transport: 'http',
      protocol: SOURCE_EDIT_PROTOCOL,
      endpoint: endpoint(SOURCE_EDIT_ENDPOINT),
    },
    reveal: {
      transport: 'http',
      protocol: SPEC_REVEAL_PROTOCOL,
      endpoint: endpoint(SPEC_REVEAL_ENDPOINT),
    },
    verification: {
      transport: 'http',
      protocol: VERIFICATION_PROTOCOL,
      endpoint: endpoint(VERIFICATION_ENDPOINT),
    },
  }
}
