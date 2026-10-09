import type { NativeAnalysisSession, NativeCapturedAnalysisPort, NativeCapturedAnalysisSource, NativeCapturedAnalysisStamp, NativeProjectDescriptor } from '../../protocol/model.ts'
import { admitNativeAnalysisResponse } from '../../protocol/process-session.ts'
import { TYPESCRIPT_FACT_PAYLOAD_CODECS } from '../physical/index.ts'
import { BodyDemandExpansionRequired, type BoundedValueEvaluatorOptions } from '../value/model.ts'
import type { TypeScriptCallQuery } from '../body/types.ts'
import type { SourceId } from '../../identity/model.ts'
import { createResidentTypeScriptProject, type ResidentProjectionProject } from './project.ts'
import { capturePortable, restorePortable } from './portable.ts'
import type { TypeScriptComputation, TypeScriptProjectSnapshot, TypeScriptSemanticReader } from './model.ts'

export type CapturedTypeScriptSemanticReader = Pick<TypeScriptProjectSnapshot, 'compute' | 'dispose'>

class SourceSelectionRequired extends Error {
  readonly paths: readonly string[]
  constructor(paths: readonly string[]) {
    super('Captured call inventory requires its selected source bodies.')
    this.paths = paths
  }
}

interface CapturedEpoch {
  readonly port: NativeCapturedAnalysisPort
  readonly lifetime: AbortController
  readonly sources: readonly { path: string; source: SourceId }[]
  readonly roots: Set<string>
  readonly owners: Set<string>
  snapshot: TypeScriptProjectSnapshot
}

const owners = new WeakMap<NativeCapturedAnalysisSource, CapturedProjectionOwner>()

/**
 * Attach the existing generic reader to an application-owned compiler session.
 * The session owns facts, indexes and tracked computations; each reader owns an
 * immutable capture lease. No compiler or native process opens here. Callbacks
 * may replay for selected bodies: keep them stable and return plain observations.
 * Defaults to source and observed body facts. Request typescript.structure
 * explicitly when the computation needs static references or dependencies.
 */
export async function openCapturedTypeScriptReader(
  source: NativeCapturedAnalysisSource, capture: NativeCapturedAnalysisStamp,
  options: { readonly signal?: AbortSignal; readonly capabilities?: NativeProjectDescriptor['capabilities'] } = {},
): Promise<CapturedTypeScriptSemanticReader> {
  if (source.semanticReaderRevision !== 1 || !source.openSemanticProjection) {
    throw new Error('The native producer does not support captured semantic readers.')
  }
  const stamp = Object.freeze({ token: capture.token, generation: capture.generation,
    sourceSnapshotDigest: capture.sourceSnapshotDigest })
  const capabilities = Object.freeze([...new Set(options.capabilities ?? ['typescript.source', 'typescript.body-demand'])].sort())
  const port = await source.openSemanticProjection(stamp, { ...options, capabilities })
  try {
    port.ownerSignal.throwIfAborted()
    let owner = owners.get(source)
    if (!owner) {
      owner = new CapturedProjectionOwner(port)
      owners.set(source, owner)
      port.onOwnerDispose(() => owner!.dispose())
    }
    return await owner.open(port, options.signal)
  } catch (error) {
    await port.dispose().catch(() => {})
    throw error
  }
}

function factSession(port: NativeCapturedAnalysisPort): NativeAnalysisSession {
  return {
    request: async (request, options) => {
      const response = admitNativeAnalysisResponse(await port.request(request, options), TYPESCRIPT_FACT_PAYLOAD_CODECS)
      if (response.id !== request.id) throw new Error('Captured fact response belongs to another request.')
      return response
    },
    acknowledge: async (input, options) => {
      const response = admitNativeAnalysisResponse(await port.request({ ...input, kind: 'acknowledge' }, options), TYPESCRIPT_FACT_PAYLOAD_CODECS)
      if (response.id !== input.id || response.kind !== 'acknowledged' || response.generation !== input.generation) {
        throw new Error('Captured fact acknowledgement belongs to another publication.')
      }
    },
    // The epoch owns the lease. Replacing or rejecting a fact provider must not
    // retire its previous epoch before the replacement has been admitted.
    dispose: async () => {},
  }
}

class CapturedProjectionOwner {
  readonly #project: ResidentProjectionProject
  readonly #signal: AbortSignal
  readonly #epochs = new Set<CapturedEpoch>()
  readonly #roots = new Set<string>()
  readonly #owners = new Set<string>()
  readonly #wrappers = new WeakMap<Function, TypeScriptComputation<unknown, unknown>>()
  #current?: CapturedEpoch
  #executing?: CapturedEpoch
  #tail: Promise<void> = Promise.resolve()
  #closed = false
  #closing?: Promise<void>

  constructor(port: NativeCapturedAnalysisPort) {
    this.#signal = port.ownerSignal
    this.#project = createResidentTypeScriptProject(port.project, { open: async () => factSession(port) })
  }

  private enqueue<Value>(work: () => Promise<Value>): Promise<Value> {
    const run = this.#tail.then(() => {
      if (this.#closed) throw new Error('Captured semantic session is disposed.')
      this.#signal.throwIfAborted()
      return work()
    })
    this.#tail = run.then(() => {}, () => {})
    return run
  }

  open(port: NativeCapturedAnalysisPort, openingSignal?: AbortSignal): Promise<CapturedTypeScriptSemanticReader> {
    return this.enqueue(async () => {
      if (port.ownerSignal !== this.#signal) throw new Error('Captured fact port belongs to another session lifetime.')
      const signal = AbortSignal.any([port.signal, this.#signal, ...(openingSignal ? [openingSignal] : [])])
      signal.throwIfAborted()
      const previous = this.#current
      let snapshot: TypeScriptProjectSnapshot | undefined
      // Replace only the fact provider. The existing store, index deltas and
      // computation receipts survive capture changes and failed policy seals.
      try {
        await this.#project.replaceSession(port.project, { open: async () => factSession(port) })
        await this.#project.refresh({ bodyDemand: { paths: [...this.#roots].sort(), owners: [...this.#owners].sort() }, signal })
        snapshot = await this.#project.open()
        signal.throwIfAborted()
        const sources: { path: string; source: SourceId }[] = []
        for await (const { payload } of snapshot.facts.export('source')) {
          if (payload.projectOwned && !payload.declaration) sources.push({ path: payload.logicalPath, source: payload.source })
        }
        const materialized = new Set<string>()
        for await (const { payload } of snapshot.facts.export('body-demand')) {
          for (const owner of payload.owners) if (owner.materialized) materialized.add(owner.owner)
        }
        const knownPaths = new Set(sources.map((entry) => entry.path))
        const roots = new Set([...this.#roots].filter((path) => knownPaths.has(path)))
        signal.throwIfAborted()
        const epoch: CapturedEpoch = { port, lifetime: new AbortController(), sources: Object.freeze(sources),
          roots, owners: materialized, snapshot }
        // A successful replacement retires deferred demand on the earlier
        // lease; its materialized snapshot remains independently pinned.
        await previous?.port.dispose().catch(() => {})
        signal.throwIfAborted()
        this.#current = epoch
        this.#epochs.add(epoch)
        this.#owners.clear()
        this.#roots.clear()
        for (const path of roots) this.#roots.add(path)
        for (const owner of materialized) this.#owners.add(owner)
        return this.reader(epoch)
      } catch (error) {
        await snapshot?.dispose()
        if (previous && !previous.port.signal.aborted) {
          await this.#project.replaceSession(previous.port.project, { open: async () => factSession(previous.port) })
        }
        throw error
      }
    })
  }

  private wrapped<Input, Result>(observe: TypeScriptComputation<Input, Result>): TypeScriptComputation<Input, Result> {
    let callback = this.#wrappers.get(observe)
    if (!callback) {
      callback = (read, input) => {
        const epoch = this.#executing
        if (!epoch) throw new Error('Captured computation has no revision owner.')
        const forwarded: TypeScriptSemanticReader = {
          structure: () => read.structure(),
          values: <Atom = never>(options?: Omit<BoundedValueEvaluatorOptions<Atom>, 'query'>) => read.values<Atom>(options),
          calls: async (options: TypeScriptCallQuery = {}) => {
            const selection = { ...options, ...(options.paths ? { paths: [...options.paths] } : {}),
              ...(options.sources ? { sources: [...options.sources] } : {}) }
            // Delegate first so escaped/expired readers enforce the existing
            // lifetime, cancellation and selection receipt before any demand.
            const result = await read.calls(selection)
            const selected = selection.paths ?? epoch.sources.map((entry) => entry.path)
            const sources = selection.sources ? new Set(selection.sources) : undefined
            const requested = sources ? selected.filter((path) => epoch.sources.some((entry) => entry.path === path && sources.has(entry.source))) : selected
            const missing = requested.filter((path) => !epoch.roots.has(path))
            if (missing.length) throw new SourceSelectionRequired(Object.freeze([...new Set(missing)].sort()))
            return result
          },
        }
        return observe(Object.freeze(forwarded), input as Input)
      }
      this.#wrappers.set(observe, callback)
    }
    return callback as TypeScriptComputation<Input, Result>
  }

  private reader(epoch: CapturedEpoch): CapturedTypeScriptSemanticReader {
    let closing: Promise<void> | undefined
    return Object.freeze({
      compute: <Input, Result>(observe: TypeScriptComputation<Input, Result>, input: Input,
        options: { readonly signal?: AbortSignal } = {}): Promise<Result> => {
        const captured = capturePortable(input)
        const signal = AbortSignal.any([epoch.lifetime.signal, this.#signal, ...(options.signal ? [options.signal] : [])])
        return this.enqueue(async () => {
          signal.throwIfAborted()
          this.#executing = epoch
          try {
            for (;;) {
              try {
                return await epoch.snapshot.compute(this.wrapped(observe), captured ? restorePortable<Input>(captured.encoded) : input, { signal })
              } catch (error) {
                signal.throwIfAborted()
                if (!(error instanceof SourceSelectionRequired) && !(error instanceof BodyDemandExpansionRequired)) throw error
                // Old pins remain readable from captured facts. An unresolved
                // old demand never selects the current compiler or its lease.
                if (epoch !== this.#current || epoch.port.signal.aborted) throw new Error('Deferred semantic demand belongs to a retired capture.', { cause: error })
                let expanded = false
                if (error instanceof SourceSelectionRequired) {
                  for (const path of error.paths) if (!epoch.roots.has(path)) { epoch.roots.add(path); expanded = true }
                } else {
                  if (error.receipt.generation !== epoch.snapshot.generation.id || error.receipt.sourceManifest !== epoch.snapshot.generation.sourceManifest) {
                    throw new Error('Body demand belongs to another captured fact generation.', { cause: error })
                  }
                  for (const { owner } of error.receipt.requirements) if (!epoch.owners.has(owner)) { epoch.owners.add(owner); expanded = true }
                }
                if (!expanded) throw new Error('Captured semantic demand did not make progress.', { cause: error })
                await this.#project.refresh({ bodyDemand: { paths: [...epoch.roots].sort(), owners: [...epoch.owners].sort() }, signal })
                const previous = epoch.snapshot
                const next = await this.#project.open()
                try { signal.throwIfAborted() }
                catch (error) { await next.dispose(); throw error }
                epoch.snapshot = next
                await previous.dispose()
                this.#roots.clear(); this.#owners.clear()
                for (const path of epoch.roots) this.#roots.add(path)
                for (const owner of epoch.owners) this.#owners.add(owner)
              }
            }
          } finally { this.#executing = undefined }
        })
      },
      dispose: () => {
        if (closing) return closing
        epoch.lifetime.abort(new Error('Captured semantic reader is disposed.'))
        // Abort work immediately, but close its final pin only after any in-flight
        // publication/open has joined this same ownership queue.
        closing = this.#tail.then(async () => {
          this.#epochs.delete(epoch)
          if (this.#current === epoch) this.#current = undefined
          await Promise.all([epoch.snapshot.dispose(), epoch.port.dispose()])
        })
        this.#tail = closing.then(() => {}, () => {})
        return closing
      },
    })
  }

  dispose(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#closed = true
    for (const epoch of this.#epochs) epoch.lifetime.abort(new Error('Captured semantic session is disposed.'))
    const leases = [...this.#epochs].map((epoch) => epoch.port.dispose())
    this.#epochs.clear()
    this.#current = undefined
    this.#closing = Promise.all([this.#project.dispose(), ...leases]).then(() => this.#tail)
    return this.#closing
  }
}
