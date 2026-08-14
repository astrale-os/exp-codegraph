import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'

import type { Completeness, Fact, FactShard, FactShardReference, SourceSpan } from '../facts/index.ts'
import type { FactTransaction } from '../generation/index.ts'
import { admitAnalysisId, portablePath } from '../identity/index.ts'
import type {
  NativeAnalysisRequest,
  NativeAnalysisResponse,
  NativeAnalysisSession,
  NativeAnalysisSessionFactory,
  NativeProjectDescriptor,
} from './model.ts'
import { NATIVE_ANALYSIS_PROTOCOL_VERSION } from './model.ts'

export interface ProcessNativeAnalysisSessionFactoryOptions {
  readonly command: string
  readonly arguments?: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly maximumFrameBytes?: number
  readonly maximumErrorBytes?: number
}

export function createProcessNativeAnalysisSessionFactory(
  options: ProcessNativeAnalysisSessionFactoryOptions,
): NativeAnalysisSessionFactory {
  if (!options.command) throw new TypeError('Native analysis command is required.')
  const maximumFrameBytes = options.maximumFrameBytes ?? 64 * 1_024 * 1_024
  const maximumErrorBytes = options.maximumErrorBytes ?? 1 * 1_024 * 1_024
  validateLimit(maximumFrameBytes, 'maximumFrameBytes')
  validateLimit(maximumErrorBytes, 'maximumErrorBytes')
  return {
    async open(project, openOptions = {}) {
      openOptions.signal?.throwIfAborted()
      validateProject(project)
      const child = spawn(
        options.command,
        [
          ...(options.arguments ?? []),
          'serve',
          '--cwd',
          project.root,
          '--tsconfig',
          project.config,
          '--capabilities-json',
          JSON.stringify([...new Set(project.capabilities)].sort()),
          '--modules-json',
          JSON.stringify(
            [...(project.modules ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
          ),
        ],
        {
          cwd: project.root,
          env: { ...process.env, ...options.environment },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      return await ProcessNativeAnalysisSession.open(
        child,
        maximumFrameBytes,
        maximumErrorBytes,
        openOptions.signal,
      )
    },
  }
}

class ProcessNativeAnalysisSession implements NativeAnalysisSession {
  readonly #pending = new Map<
    number,
    {
      resolve(value: NativeAnalysisResponse): void
      reject(error: Error): void
      removeAbort?(): void
    }
  >()
  #stderr = ''
  #disposed = false
  #failure: Error | undefined
  readonly #child: ChildProcessWithoutNullStreams
  readonly #maximumFrameBytes: number

  private constructor(
    child: ChildProcessWithoutNullStreams,
    maximumFrameBytes: number,
    maximumErrorBytes: number,
  ) {
    this.#child = child
    this.#maximumFrameBytes = maximumFrameBytes
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (this.#stderr.length < maximumErrorBytes) {
        this.#stderr += chunk.slice(0, maximumErrorBytes - this.#stderr.length)
      }
    })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => this.receive(line))
    child.once('error', (error) => this.fail(error))
    child.once('exit', (code, signal) => {
      if (!this.#disposed || this.#pending.size) {
        this.fail(
          new Error(
            `Native analysis process exited code=${String(code)} signal=${String(signal)}${this.#stderr ? `: ${this.#stderr}` : ''}`,
          ),
        )
      }
    })
  }

  static async open(
    child: ChildProcessWithoutNullStreams,
    maximumFrameBytes: number,
    maximumErrorBytes: number,
    signal?: AbortSignal,
  ): Promise<ProcessNativeAnalysisSession> {
    const session = new ProcessNativeAnalysisSession(child, maximumFrameBytes, maximumErrorBytes)
    if (signal) {
      if (signal.aborted) {
        child.kill('SIGTERM')
        signal.throwIfAborted()
      }
      signal.addEventListener('abort', () => void session.abort(signal.reason), { once: true })
    }
    return session
  }

  request(
    request: NativeAnalysisRequest,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<NativeAnalysisResponse> {
    this.assertOpen()
    validateRequest(request)
    if (this.#pending.has(request.id)) throw new Error(`Duplicate native request id ${request.id}.`)
    options.signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const entry: {
        resolve(value: NativeAnalysisResponse): void
        reject(error: Error): void
        removeAbort?(): void
      } = { resolve, reject }
      if (options.signal) {
        const abort = () => void this.abort(options.signal!.reason)
        options.signal.addEventListener('abort', abort, { once: true })
        entry.removeAbort = () => options.signal!.removeEventListener('abort', abort)
      }
      this.#pending.set(request.id, entry)
      const frame = `${JSON.stringify(request)}\n`
      if (Buffer.byteLength(frame) > this.#maximumFrameBytes) {
        this.#pending.delete(request.id)
        entry.removeAbort?.()
        reject(new Error('Native analysis request exceeds the configured frame limit.'))
        return
      }
      this.#child.stdin.write(frame, (error) => {
        if (error) this.fail(error)
      })
    })
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const exit = new Promise<void>((resolve) => {
      if (this.#child.exitCode !== null || this.#child.signalCode !== null) resolve()
      else this.#child.once('exit', () => resolve())
    })
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.stdin.end(`${JSON.stringify({ id: 0, kind: 'dispose' })}\n`)
      const force = setTimeout(() => this.#child.kill('SIGTERM'), 1_000)
      force.unref()
      await exit
      clearTimeout(force)
    }
    this.rejectPending(new Error('Native analysis session was disposed.'))
  }

  private receive(line: string): void {
    if (Buffer.byteLength(line) > this.#maximumFrameBytes) {
      this.fail(new Error('Native analysis response exceeds the configured frame limit.'))
      return
    }
    let response: NativeAnalysisResponse
    try {
      response = validateResponse(JSON.parse(line))
    } catch (error) {
      this.fail(new Error('Native analysis returned an invalid protocol frame.', { cause: error }))
      return
    }
    const pending = this.#pending.get(response.id)
    if (!pending) {
      this.fail(new Error(`Native analysis returned unexpected response id ${response.id}.`))
      return
    }
    this.#pending.delete(response.id)
    pending.removeAbort?.()
    pending.resolve(response)
  }

  private async abort(reason: unknown): Promise<void> {
    if (this.#disposed) return
    const error = reason instanceof Error ? reason : new Error('Native analysis request aborted.')
    this.#failure = error
    this.#disposed = true
    this.rejectPending(error)
    this.#child.kill('SIGTERM')
  }

  private fail(error: Error): void {
    if (!this.#failure) this.#failure = error
    this.#disposed = true
    this.rejectPending(this.#failure)
    if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill('SIGTERM')
  }

  private rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.removeAbort?.()
      pending.reject(error)
    }
    this.#pending.clear()
  }

  private assertOpen(): void {
    if (this.#failure) throw this.#failure
    if (this.#disposed) throw new Error('Native analysis session is disposed.')
  }
}

function validateProject(project: NativeProjectDescriptor): void {
  if (!isAbsolute(project.root)) throw new TypeError('Native project root must be absolute.')
  portablePath(project.config)
  if (project.capabilities.some((capability) => !capability.trim())) {
    throw new TypeError('Native capabilities must be non-empty.')
  }
  const ids = new Set<string>()
  for (const module of project.modules ?? []) {
    if (!module.id || !module.name || ids.has(module.id)) {
      throw new TypeError('Native module boundaries require unique non-empty identities and names.')
    }
    ids.add(module.id)
    portableModuleRoot(module.root)
    for (const path of [module.project, module.entrypoint, ...module.facades, ...module.aliases, ...module.internals]) {
      portablePath(path)
    }
  }
}

function portableModuleRoot(path: string): void {
  // `.` is the only portable spelling for a module rooted at its project root.
  // Every other value retains the ordinary non-escaping analysis-path law.
  if (path !== '.') portablePath(path)
}

function validateRequest(request: NativeAnalysisRequest): void {
  if (!Number.isSafeInteger(request.id) || request.id < 1) {
    throw new TypeError('Native request id must be a positive integer.')
  }
  if (request.kind === 'refresh' && request.changed?.some((path) => !path || path.includes('\0'))) {
    throw new TypeError('Native changed path is invalid.')
  }
}

function validateResponse(input: unknown): NativeAnalysisResponse {
  if (!input || typeof input !== 'object') throw new TypeError('Response must be an object.')
  const value = input as Record<string, unknown>
  if (!Number.isSafeInteger(value.id) || (value.id as number) < 1) {
    throw new TypeError('Response id is invalid.')
  }
  if (value.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION) {
    throw new TypeError(`Unsupported native protocol ${String(value.protocolVersion)}.`)
  }
  if (!['transaction', 'unchanged', 'error'].includes(String(value.kind))) {
    throw new TypeError('Response kind is invalid.')
  }
  if (value.kind === 'transaction') {
    return {
      id: value.id as number,
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      kind: 'transaction',
      transaction: validateTransaction(value.transaction),
    }
  }
  if (value.kind === 'unchanged') {
    return {
      id: value.id as number,
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      kind: 'unchanged',
      generation: admitAnalysisId('generation', requiredString(value.generation, 'generation')),
    }
  }
  if (
    value.kind === 'error' &&
    (typeof value.code !== 'string' ||
      typeof value.message !== 'string' ||
      typeof value.retryable !== 'boolean')
  ) {
    throw new TypeError('Error response is invalid.')
  }
  return {
    id: value.id as number,
    protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
    kind: 'error',
    code: value.code as string,
    message: value.message as string,
    retryable: value.retryable as boolean,
  }
}

function validateTransaction(input: unknown): FactTransaction {
  const value = requiredRecord(input, 'transaction')
  const next = requiredRecord(value.next, 'transaction.next')
  const producer = requiredRecord(next.producer, 'transaction.next.producer')
  const base = optionalString(value.base, 'transaction.base')
  return {
    protocolVersion: requiredInteger(value.protocolVersion, 'transaction.protocolVersion', 1),
    ...(base ? { base: admitAnalysisId('generation', base) } : {}),
    next: {
      id: admitAnalysisId('generation', requiredString(next.id, 'transaction.next.id')),
      sequence: requiredInteger(next.sequence, 'transaction.next.sequence', 1),
      universe: admitAnalysisId(
        'project-universe',
        requiredString(next.universe, 'transaction.next.universe'),
      ),
      producer: {
        id: admitAnalysisId(
          'producer',
          requiredString(producer.id, 'transaction.next.producer.id'),
        ),
        name: requiredString(producer.name, 'transaction.next.producer.name'),
        version: requiredString(producer.version, 'transaction.next.producer.version'),
        protocolVersion: requiredInteger(
          producer.protocolVersion,
          'transaction.next.producer.protocolVersion',
          1,
        ),
      },
      sourceManifest: admitAnalysisId(
        'source-manifest',
        requiredString(next.sourceManifest, 'transaction.next.sourceManifest'),
      ),
      capabilities: stringArray(next.capabilities, 'transaction.next.capabilities'),
    },
    manifest: requiredArray(value.manifest, 'transaction.manifest').map((entry, index) =>
      validateReference(entry, `transaction.manifest[${index}]`),
    ),
    upserts: requiredArray(value.upserts, 'transaction.upserts').map((entry, index) =>
      validateShard(entry, `transaction.upserts[${index}]`),
    ),
    deletes: stringArray(value.deletes, 'transaction.deletes').map((key) =>
      admitAnalysisId('fact-shard-key', key),
    ),
  }
}

function validateReference(input: unknown, path: string): FactShardReference {
  const value = requiredRecord(input, path)
  return {
    key: admitAnalysisId('fact-shard-key', requiredString(value.key, `${path}.key`)),
    digest: admitAnalysisId(
      'fact-shard-digest',
      requiredString(value.digest, `${path}.digest`),
    ),
    namespace: requiredString(value.namespace, `${path}.namespace`),
    schemaVersion: requiredInteger(value.schemaVersion, `${path}.schemaVersion`, 1),
    facts: requiredInteger(value.facts, `${path}.facts`, 0),
  }
}

function validateShard(input: unknown, path: string): FactShard {
  const value = requiredRecord(input, path)
  return {
    key: admitAnalysisId('fact-shard-key', requiredString(value.key, `${path}.key`)),
    digest: admitAnalysisId(
      'fact-shard-digest',
      requiredString(value.digest, `${path}.digest`),
    ),
    namespace: requiredString(value.namespace, `${path}.namespace`),
    schemaVersion: requiredInteger(value.schemaVersion, `${path}.schemaVersion`, 1),
    completion: validateCompleteness(value.completion, `${path}.completion`),
    facts: requiredArray(value.facts, `${path}.facts`).map((fact, index) =>
      validateFact(fact, `${path}.facts[${index}]`),
    ),
  }
}

function validateFact(input: unknown, path: string): Fact {
  const value = requiredRecord(input, path)
  const provenance = requiredRecord(value.provenance, `${path}.provenance`)
  return {
    id: admitAnalysisId('fact', requiredString(value.id, `${path}.id`)),
    generation: admitAnalysisId(
      'generation',
      requiredString(value.generation, `${path}.generation`),
    ),
    namespace: requiredString(value.namespace, `${path}.namespace`),
    schemaVersion: requiredInteger(value.schemaVersion, `${path}.schemaVersion`, 1),
    kind: requiredString(value.kind, `${path}.kind`),
    subject: requiredString(value.subject, `${path}.subject`),
    completeness: validateCompleteness(value.completeness, `${path}.completeness`),
    provenance: {
      pass: admitAnalysisId(
        'pass',
        requiredString(provenance.pass, `${path}.provenance.pass`),
      ),
      passVersion: requiredString(
        provenance.passVersion,
        `${path}.provenance.passVersion`,
      ),
      evidence: requiredArray(provenance.evidence, `${path}.provenance.evidence`).map(
        (span, index) => validateSpan(span, `${path}.provenance.evidence[${index}]`),
      ),
      inputs: stringArray(provenance.inputs, `${path}.provenance.inputs`).map((id) =>
        admitAnalysisId('fact', id),
      ),
    },
    payload: value.payload,
  }
}

function validateSpan(input: unknown, path: string): SourceSpan {
  const value = requiredRecord(input, path)
  return {
    source: admitAnalysisId('source', requiredString(value.source, `${path}.source`)),
    revision: admitAnalysisId(
      'source-revision',
      requiredString(value.revision, `${path}.revision`),
    ),
    start: requiredInteger(value.start, `${path}.start`, 0),
    end: requiredInteger(value.end, `${path}.end`, 1),
  }
}

function validateCompleteness(input: unknown, path: string): Completeness {
  const value = requiredRecord(input, path)
  if (value.kind === 'complete') return { kind: 'complete' }
  if (value.kind === 'partial') {
    return {
      kind: 'partial',
      reasons: requiredArray(value.reasons, `${path}.reasons`).map((reason, index) => {
        const item = requiredRecord(reason, `${path}.reasons[${index}]`)
        return {
          code: requiredString(item.code, `${path}.reasons[${index}].code`),
          message: requiredString(item.message, `${path}.reasons[${index}].message`),
          effective: validateLimits(
            item.effective,
            `${path}.reasons[${index}].effective`,
          ),
        }
      }),
    }
  }
  if (value.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      reasons: requiredArray(value.reasons, `${path}.reasons`).map((reason, index) => {
        const item = requiredRecord(reason, `${path}.reasons[${index}]`)
        const attributableTo = optionalString(
          item.attributableTo,
          `${path}.reasons[${index}].attributableTo`,
        )
        if (typeof item.retryable !== 'boolean') {
          throw new TypeError(`${path}.reasons[${index}].retryable must be boolean.`)
        }
        return {
          code: requiredString(item.code, `${path}.reasons[${index}].code`),
          message: requiredString(item.message, `${path}.reasons[${index}].message`),
          ...(attributableTo
            ? { attributableTo: admitAnalysisId('pass', attributableTo) }
            : {}),
          retryable: item.retryable,
        }
      }),
    }
  }
  throw new TypeError(`${path}.kind is invalid.`)
}

function requiredRecord(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${path} must be an object.`)
  }
  return input as Record<string, unknown>
}

function requiredArray(input: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(input)) throw new TypeError(`${path} must be an array.`)
  return input
}

function requiredString(input: unknown, path: string): string {
  if (typeof input !== 'string' || !input) throw new TypeError(`${path} must be a non-empty string.`)
  return input
}

function optionalString(input: unknown, path: string): string | undefined {
  return input === undefined ? undefined : requiredString(input, path)
}

function stringArray(input: unknown, path: string): readonly string[] {
  return requiredArray(input, path).map((value, index) =>
    requiredString(value, `${path}[${index}]`),
  )
}

function requiredInteger(input: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum) {
    throw new TypeError(`${path} must be a safe integer of at least ${minimum}.`)
  }
  return input as number
}

function validateLimits(
  input: unknown,
  path: string,
): Readonly<Record<string, number | string | boolean>> {
  const value = requiredRecord(input, path)
  for (const [name, entry] of Object.entries(value)) {
    if (
      !name ||
      (typeof entry !== 'string' && typeof entry !== 'boolean' && typeof entry !== 'number') ||
      (typeof entry === 'number' && !Number.isFinite(entry))
    ) {
      throw new TypeError(`${path}.${name} must be a finite scalar.`)
    }
  }
  return value as Readonly<Record<string, number | string | boolean>>
}

function validateLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1_024) {
    throw new RangeError(`${name} must be an integer of at least 1024 bytes.`)
  }
}
