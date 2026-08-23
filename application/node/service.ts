import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import type { AnalysisStore, AnalysisTelemetrySink } from '../../analysis/index.ts'
import type { CodegraphApplicationSessionOptions } from '../analysis/index.ts'
import type { TypeSpecApplicationService } from '../index.ts'

import { selectAnalysisStore } from '../../analysis/index.ts'
import { dispatchAnalysisTelemetry } from '../../analysis/profiling/dispatch.ts'
import { createSQLiteAnalysisStore } from '../../analysis/sqlite/index.ts'
import {
  createFileWorkspaceCheckpointStore,
  type FileWorkspaceCheckpointStore,
} from '../../workspace/checkpoint/index.ts'
import { resolveApplicationRoot } from '../discovery/index.ts'
import { createTypeSpecApplicationServiceWithDependencies } from '../service.ts'
import {
  createNodeApplicationCheckpoint,
  type PortableNodeApplicationCheckpoint,
} from './checkpoint.ts'
import { codegraphProducerFingerprint } from './fingerprint.ts'
import {
  createCheckpointedRepositoryInventory,
  createGitRepositoryInventory,
} from './inventory.ts'

export interface NodeTypeSpecApplicationOptions {
  readonly root: string
  readonly cacheDirectory: string
  readonly persistence?: 'advisory' | 'memory'
  readonly repository?: string
  readonly maximumRetainedSnapshots?: number
  readonly maximumRetainedGenerations?: number
  readonly telemetry?: AnalysisTelemetrySink
  readonly native?: CodegraphApplicationSessionOptions
  /** Caller-owned portable store; the Node application never disposes it. */
  readonly portableCheckpoint?: PortableNodeApplicationCheckpoint
}

/** Node-owned store/native composition around the portable headless application service. */
export async function createNodeTypeSpecApplicationService(
  options: NodeTypeSpecApplicationOptions,
): Promise<TypeSpecApplicationService> {
  const root = await resolveApplicationRoot(options.root)
  const maximumRetainedGenerations = options.maximumRetainedGenerations ?? 2
  const selection = await selectAnalysisStore({
    persistence: 'advisory',
    ...((options.persistence ?? 'advisory') === 'advisory'
      ? {
          openDurable: () =>
            createSQLiteAnalysisStore({
              file: join(options.cacheDirectory, 'analysis-v2.sqlite'),
              // Physical isolation belongs to the store namespace, never semantic identities.
              namespace: `worktree:${createHash('sha256').update(root).digest('hex')}`,
              maximumRetainedGenerations,
              ...(options.telemetry ? { telemetry: options.telemetry } : {}),
            }),
        }
      : {}),
  })
  const store = selection.store
  const repository = options.repository ?? (await nodeApplicationRepositoryKey(root))
  const workspaceCheckpoint =
    selection.backend === 'durable'
      ? createFileWorkspaceCheckpointStore({
          directory: nodeApplicationWorkspaceCheckpointDirectory(options.cacheDirectory, root),
          maxArtifacts: 4_096,
          maximumScopes: 512,
        })
      : undefined
  dispatchAnalysisTelemetry(options.telemetry, {
    component: 'analysis',
    phase: 'store.selection',
    metrics: {
      backend: selection.backend,
      persistence: selection.persistence,
      requestedPersistence: options.persistence ?? 'advisory',
      fallback: selection.fallback !== undefined,
      ...(selection.fallback ? { fallbackCode: selection.fallback.code } : {}),
    },
  })
  try {
    const producer = workspaceCheckpoint || options.portableCheckpoint
      ? await codegraphProducerFingerprint()
      : undefined
    const checkpoint = producer
      ? createNodeApplicationCheckpoint({
          producerFingerprint: `${producer}:application-checkpoint/4`,
          ...(workspaceCheckpoint ? { local: workspaceCheckpoint } : {}),
          ...(options.portableCheckpoint ? { portable: options.portableCheckpoint } : {}),
        })
      : undefined
    const application = await createTypeSpecApplicationServiceWithDependencies(
      {
        root,
        repository,
        maximumRetainedSnapshots: options.maximumRetainedSnapshots,
        analysis: { store, maximumRetainedGenerations },
        ...(checkpoint ? { checkpoint } : {}),
        ...(options.telemetry ? { telemetry: options.telemetry } : {}),
        ...(options.native ? { native: options.native } : {}),
      },
      {
        inventory: workspaceCheckpoint
          ? createCheckpointedRepositoryInventory({
              root,
              store: workspaceCheckpoint,
              producerFingerprint: `${producer!}:repository-inventory/3`,
            })
          : createGitRepositoryInventory({
              root,
              ...(options.telemetry
                ? {
                    onDecision: (decision) =>
                      dispatchAnalysisTelemetry(options.telemetry, {
                        component: 'analysis',
                        phase: 'application.inventory.git',
                        durationNs: Math.round(decision.durationMs * 1_000_000),
                        metrics: {
                          status: 'completed',
                          outcome: decision.outcome,
                          code: decision.code,
                          ...(decision.proofMs !== undefined
                            ? { proofMs: decision.proofMs }
                            : {}),
                          ...(decision.treeMs !== undefined ? { treeMs: decision.treeMs } : {}),
                          ...(decision.blobsMs !== undefined ? { blobsMs: decision.blobsMs } : {}),
                          ...(decision.projectionMs !== undefined
                            ? { projectionMs: decision.projectionMs }
                            : {}),
                          ...(decision.filesTraversed !== undefined
                            ? { filesTraversed: decision.filesTraversed }
                            : {}),
                          ...(decision.bytesTraversed !== undefined
                            ? { bytesTraversed: decision.bytesTraversed }
                            : {}),
                          ...(decision.bytesRead !== undefined
                            ? { bytesRead: decision.bytesRead }
                            : {}),
                          ...(decision.bytesHashed !== undefined
                            ? { bytesHashed: decision.bytesHashed }
                            : {}),
                        },
                      }),
                  }
                : {}),
            }),
      },
    )
    return ownStore(application, store, workspaceCheckpoint)
  } catch (error) {
    await Promise.allSettled([store.dispose(), workspaceCheckpoint?.dispose()])
    throw error
  }
}

function ownStore(
  application: TypeSpecApplicationService,
  store: AnalysisStore,
  checkpoint: FileWorkspaceCheckpointStore | undefined,
): TypeSpecApplicationService {
  let disposed = false
  return {
    refresh: (options) => application.refresh(options),
    current: () => application.current(),
    open: (snapshot) => application.open(snapshot),
    settle: () => application.settle(),
    async dispose() {
      if (disposed) return
      disposed = true
      // Application disposal drains its scheduled checkpoint writer. Keep the checkpoint store
      // alive until that lifecycle edge has settled, then release the owned physical resources.
      const applicationResult = await Promise.allSettled([application.dispose()])
      const resourceResults = await Promise.allSettled([store.dispose(), checkpoint?.dispose()])
      const rejected = [...applicationResult, ...resourceResults].find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      if (rejected) throw rejected.reason
    },
  }
}

export function nodeApplicationWorkspaceCheckpointDirectory(
  cacheDirectory: string,
  root: string,
): string {
  return join(
    cacheDirectory,
    'workspaces',
    createHash('sha256').update(resolve(root)).digest('hex'),
    'application',
  )
}

export async function nodeApplicationRepositoryKey(root: string): Promise<string> {
  try {
    const value: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as { readonly name?: unknown }).name === 'string'
    ) {
      const name = (value as { readonly name: string }).name.trim()
      if (name) return `package:${name}`
    }
  } catch {
    // Anonymous source trees remain usable without leaking absolute paths into semantic identity.
  }
  return `anonymous:${basename(root) || 'repository'}`
}
