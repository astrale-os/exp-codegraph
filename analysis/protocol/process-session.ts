import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { promisify } from 'node:util'

import type {
  Completeness,
  Fact,
  FactShard,
  FactShardReference,
  SourceSpan,
} from '../facts/index.ts'
import { validateFactShard } from '../facts/index.ts'
import type { FactTransaction } from '../generation/index.ts'
import { admitAnalysisId, portablePath } from '../identity/index.ts'
import type { AnalysisTelemetryEvent, AnalysisTelemetrySink } from '../profiling/index.ts'
import { dispatchAnalysisTelemetry } from '../profiling/dispatch.ts'
import {
  admitFactPayloadCodecs,
  admittedFactShardPayloadBytes,
  createFactWithPhysicalPayload,
  createFactWithSemanticPayload,
  physicalPayloadForTransport,
  type FactPayloadCodec,
  type FactPayloadCodecMap,
} from '../facts/representation/index.ts'
import type {
  NativeAnalysisRequest,
  NativeAnalysisResponse,
  NativeAnalysisSession,
  NativeAnalysisSessionFactory,
  NativeFactDelta,
  NativeProjectDescriptor,
} from './model.ts'
import { NATIVE_ANALYSIS_PROTOCOL_VERSION } from './model.ts'

export interface ProcessNativeAnalysisSessionFactoryOptions {
  readonly command: string
  readonly arguments?: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly maximumFrameBytes?: number
  readonly transactionChunkFrameBytes?: number
  readonly maximumTransactionBytes?: number
  /** Maximum encoded physical bytes assembled before semantic decoding. */
  readonly maximumPhysicalTransactionBytes?: number
  readonly maximumErrorBytes?: number
  /** Optional application-adapter watchdog for the native process resident set. */
  readonly maximumResidentBytes?: number
  /** Low-level adapter seam used to qualify resource monitoring without OS-specific test access. */
  readonly sampleResidentBytes?: (pid: number) => Promise<number>
  /** Opt-in diagnostic attribution received over a dedicated process descriptor. */
  readonly telemetry?: AnalysisTelemetrySink
  /** Explicit physical payload capabilities negotiated with the native producer. */
  readonly payloadCodecs?: readonly FactPayloadCodec[]
}

export class NativeAnalysisProcessResourceError extends Error {
  readonly name = 'NativeAnalysisProcessResourceError'
  readonly code: 'NATIVE_ANALYSIS_RESOURCE_MONITOR_FAILED' | 'NATIVE_ANALYSIS_RESIDENT_LIMIT'

  constructor(
    code: 'NATIVE_ANALYSIS_RESOURCE_MONITOR_FAILED' | 'NATIVE_ANALYSIS_RESIDENT_LIMIT',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.code = code
  }
}

const executeFile = promisify(execFile)

export const DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS = Object.freeze({
  maximumFrameBytes: 64 * 1_024 * 1_024,
  transactionChunkFrameBytes: 8 * 1_024 * 1_024,
  // The richest frozen Kernel project retains 268,454,479 semantic payload
  // bytes. Keep a finite measured ceiling with modest headroom; ordinary
  // demand-driven requests remain far below it.
  maximumTransactionBytes: 384 * 1_024 * 1_024,
  maximumPhysicalTransactionBytes: 512 * 1_024 * 1_024,
  maximumErrorBytes: 1 * 1_024 * 1_024,
})

interface TransactionAssembly {
  readonly payloadKind: 'transaction' | 'delta'
  readonly bytes: number
  readonly chunks: number
  readonly sha256: string
  readonly parts: Uint8Array[]
  nextSequence: number
  receivedBytes: number
}

interface PendingRequest {
  resolve(value: NativeAnalysisResponse): void
  reject(error: Error): void
  removeAbort?(): void
  assembly?: TransactionAssembly
  startedNs?: bigint
}

type NativeAnalysisWireFrame =
  | NativeAnalysisResponse
  | {
      readonly id: number
      readonly protocolVersion: number
      readonly kind: 'transaction-start'
      readonly payloadKind: 'transaction' | 'delta'
      readonly encoding: 'base64-json'
      readonly bytes: number
      readonly chunks: number
      readonly sha256: string
    }
  | {
      readonly id: number
      readonly protocolVersion: number
      readonly kind: 'transaction-chunk'
      readonly sequence: number
      readonly data: string
    }
  | {
      readonly id: number
      readonly protocolVersion: number
      readonly kind: 'transaction-end'
      readonly payloadKind: 'transaction' | 'delta'
      readonly bytes: number
      readonly chunks: number
      readonly sha256: string
    }

export function createProcessNativeAnalysisSessionFactory(
  options: ProcessNativeAnalysisSessionFactoryOptions,
): NativeAnalysisSessionFactory {
  if (!options.command) throw new TypeError('Native analysis command is required.')
  const maximumFrameBytes =
    options.maximumFrameBytes ?? DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS.maximumFrameBytes
  const transactionChunkFrameBytes =
    options.transactionChunkFrameBytes ??
    Math.min(
      DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS.transactionChunkFrameBytes,
      maximumFrameBytes,
    )
  const maximumTransactionBytes =
    options.maximumTransactionBytes ??
    DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS.maximumTransactionBytes
  const maximumPhysicalTransactionBytes =
    options.maximumPhysicalTransactionBytes ??
    DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS.maximumPhysicalTransactionBytes
  const maximumErrorBytes =
    options.maximumErrorBytes ?? DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS.maximumErrorBytes
  const maximumResidentBytes = options.maximumResidentBytes
  validateLimit(maximumFrameBytes, 'maximumFrameBytes')
  validateLimit(transactionChunkFrameBytes, 'transactionChunkFrameBytes')
  if (transactionChunkFrameBytes > maximumFrameBytes) {
    throw new RangeError('transactionChunkFrameBytes must not exceed maximumFrameBytes.')
  }
  validateLimit(maximumTransactionBytes, 'maximumTransactionBytes')
  validateLimit(maximumPhysicalTransactionBytes, 'maximumPhysicalTransactionBytes')
  validateLimit(maximumErrorBytes, 'maximumErrorBytes')
  if (maximumResidentBytes !== undefined) {
    validateLimit(maximumResidentBytes, 'maximumResidentBytes')
    if (process.platform === 'win32') {
      throw new TypeError('Native resident-memory monitoring is unavailable on win32.')
    }
  }
  const payloadCodecs = admitFactPayloadCodecs(options.payloadCodecs)
  return {
    async open(project, openOptions = {}) {
      openOptions.signal?.throwIfAborted()
      validateProject(project)
      const telemetry = options.telemetry
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
          ...(payloadCodecs.size
            ? [
                '--payload-codecs-json',
                JSON.stringify([...payloadCodecs.keys()].sort()),
              ]
            : []),
          '--maximum-frame-bytes',
          String(maximumFrameBytes),
          '--transaction-chunk-frame-bytes',
          String(transactionChunkFrameBytes),
          '--maximum-transaction-bytes',
          String(maximumTransactionBytes),
          '--maximum-physical-transaction-bytes',
          String(maximumPhysicalTransactionBytes),
          ...(telemetry ? ['--telemetry-fd', '3'] : []),
        ],
        {
          cwd: project.root,
          env: { ...process.env, ...options.environment },
          stdio: telemetry ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
        },
      )
      if (telemetry) {
        const channel = (child.stdio as unknown as readonly (Readable | null)[])[3]
        if (channel) {
          const lines = createInterface({ input: channel, crlfDelay: Infinity })
          lines.on('line', (line) => receiveTelemetry(line, telemetry))
        }
      }
      return await ProcessNativeAnalysisSession.open(
        child,
        maximumFrameBytes,
        maximumTransactionBytes,
        maximumPhysicalTransactionBytes,
        maximumErrorBytes,
        maximumResidentBytes,
        options.sampleResidentBytes ?? sampleProcessResidentBytes,
        telemetry,
        payloadCodecs,
        openOptions.signal,
      )
    },
  }
}

class ProcessNativeAnalysisSession implements NativeAnalysisSession {
  readonly #pending = new Map<number, PendingRequest>()
  #stderr = ''
  #disposed = false
  #failure: Error | undefined
  readonly #child: ChildProcessWithoutNullStreams
  readonly #maximumFrameBytes: number
  readonly #maximumTransactionBytes: number
  readonly #maximumPhysicalTransactionBytes: number
  readonly #telemetry: AnalysisTelemetrySink | undefined
  readonly #payloadCodecs: FactPayloadCodecMap
  readonly #maximumResidentBytes: number | undefined
  readonly #sampleResidentBytes: (pid: number) => Promise<number>
  #residentMonitor: NodeJS.Timeout | undefined
  #residentSamplePending = false
  #peakResidentBytes = 0

  private constructor(
    child: ChildProcessWithoutNullStreams,
    maximumFrameBytes: number,
    maximumTransactionBytes: number,
    maximumPhysicalTransactionBytes: number,
    maximumErrorBytes: number,
    maximumResidentBytes: number | undefined,
    sampleResidentBytes: (pid: number) => Promise<number>,
    telemetry: AnalysisTelemetrySink | undefined,
    payloadCodecs: FactPayloadCodecMap,
  ) {
    this.#child = child
    this.#maximumFrameBytes = maximumFrameBytes
    this.#maximumTransactionBytes = maximumTransactionBytes
    this.#maximumPhysicalTransactionBytes = maximumPhysicalTransactionBytes
    this.#maximumResidentBytes = maximumResidentBytes
    this.#sampleResidentBytes = sampleResidentBytes
    this.#telemetry = telemetry
    this.#payloadCodecs = payloadCodecs
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (this.#stderr.length < maximumErrorBytes) {
        this.#stderr += chunk.slice(0, maximumErrorBytes - this.#stderr.length)
      }
    })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => {
      const started = telemetry ? process.hrtime.bigint() : 0n
      this.receive(line)
      if (telemetry) {
        dispatchAnalysisTelemetry(telemetry, {
          component: 'transport',
          phase: 'frame.receive',
          durationNs: Number(process.hrtime.bigint() - started),
          metrics: { wireBytes: Buffer.byteLength(line) + 1 },
        })
      }
    })
    child.once('error', (error) => this.fail(error))
    child.once('exit', (code, signal) => {
      this.stopResidentMonitor()
      if (!this.#disposed || this.#pending.size) {
        this.fail(
          new Error(
            `Native analysis process exited code=${String(code)} signal=${String(signal)}${this.#stderr ? `: ${this.#stderr}` : ''}`,
          ),
        )
      }
    })
    this.startResidentMonitor()
  }

  static async open(
    child: ChildProcessWithoutNullStreams,
    maximumFrameBytes: number,
    maximumTransactionBytes: number,
    maximumPhysicalTransactionBytes: number,
    maximumErrorBytes: number,
    maximumResidentBytes: number | undefined,
    sampleResidentBytes: (pid: number) => Promise<number>,
    telemetry: AnalysisTelemetrySink | undefined,
    payloadCodecs: FactPayloadCodecMap,
    signal?: AbortSignal,
  ): Promise<ProcessNativeAnalysisSession> {
    const session = new ProcessNativeAnalysisSession(
      child,
      maximumFrameBytes,
      maximumTransactionBytes,
      maximumPhysicalTransactionBytes,
      maximumErrorBytes,
      maximumResidentBytes,
      sampleResidentBytes,
      telemetry,
      payloadCodecs,
    )
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
    const started = this.#telemetry ? process.hrtime.bigint() : 0n
    return new Promise((resolve, reject) => {
      const entry: PendingRequest = {
        resolve,
        reject,
        ...(this.#telemetry ? { startedNs: started } : {}),
      }
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
        else if (this.#telemetry) {
          dispatchAnalysisTelemetry(this.#telemetry, {
            component: 'transport',
            phase: 'request.write',
            request: request.id,
            durationNs: Number(process.hrtime.bigint() - started),
            metrics: { wireBytes: Buffer.byteLength(frame) },
          })
        }
      })
    })
  }

  async acknowledge(
    acknowledgement: {
      readonly id: number
      readonly generation: import('../identity/index.ts').AnalysisGenerationId
      readonly sequence: number
    },
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    const response = await this.request(
      { ...acknowledgement, kind: 'acknowledge' },
      options,
    )
    if (response.kind !== 'acknowledged' || response.generation !== acknowledgement.generation) {
      throw new Error('Native analysis did not acknowledge the committed generation.')
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.stopResidentMonitor()
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
    let frame: NativeAnalysisWireFrame
    try {
      frame = validateWireFrame(
        JSON.parse(line),
        this.#payloadCodecs,
        this.#maximumTransactionBytes,
      )
    } catch (error) {
      this.fail(new Error('Native analysis returned an invalid protocol frame.', { cause: error }))
      return
    }
    const pending = this.#pending.get(frame.id)
    if (!pending) {
      this.fail(new Error(`Native analysis returned unexpected response id ${frame.id}.`))
      return
    }
    try {
      if (frame.kind === 'transaction-start') {
        this.startTransaction(pending, frame)
        return
      }
      if (frame.kind === 'transaction-chunk') {
        this.appendTransaction(pending, frame)
        return
      }
      if (frame.kind === 'transaction-end') {
        this.finishTransaction(pending, frame)
        return
      }
      if (pending.assembly) {
        throw new TypeError('A streamed transaction was interrupted by a terminal response.')
      }
      if (
        (frame.kind === 'transaction' || frame.kind === 'delta') &&
        encodedPhysicalPayloadBytes(
          frame.kind === 'transaction' ? frame.transaction : frame.delta,
        ) > this.#maximumPhysicalTransactionBytes
      ) {
        throw new RangeError('Native analysis transaction exceeds the configured transaction limit.')
      }
      this.resolve(frame.id, pending, frame)
    } catch (error) {
      this.fail(new Error('Native analysis returned an invalid protocol frame.', { cause: error }))
    }
  }

  private startTransaction(
    pending: PendingRequest,
    frame: Extract<NativeAnalysisWireFrame, { readonly kind: 'transaction-start' }>,
  ): void {
    if (pending.assembly) throw new TypeError('A transaction stream is already active.')
    if (frame.bytes > this.#maximumPhysicalTransactionBytes) {
      throw new RangeError('Native analysis transaction exceeds the configured transaction limit.')
    }
    if (frame.chunks > frame.bytes) {
      throw new TypeError('Transaction chunk count exceeds its announced byte length.')
    }
    pending.assembly = {
      payloadKind: frame.payloadKind,
      bytes: frame.bytes,
      chunks: frame.chunks,
      sha256: frame.sha256,
      parts: [],
      nextSequence: 0,
      receivedBytes: 0,
    }
  }

  private appendTransaction(
    pending: PendingRequest,
    frame: Extract<NativeAnalysisWireFrame, { readonly kind: 'transaction-chunk' }>,
  ): void {
    const assembly = pending.assembly
    if (!assembly) throw new TypeError('A transaction chunk arrived before its start frame.')
    if (assembly.nextSequence >= assembly.chunks) {
      throw new TypeError('Transaction stream contains more chunks than announced.')
    }
    if (frame.sequence !== assembly.nextSequence) {
      throw new TypeError(
        `Transaction chunk order is invalid: expected ${assembly.nextSequence}, received ${frame.sequence}.`,
      )
    }
    const part = decodeBase64(frame.data)
    if (part.byteLength < 1) throw new TypeError('A transaction chunk must not be empty.')
    if (assembly.receivedBytes + part.byteLength > assembly.bytes) {
      throw new TypeError('Transaction chunks exceed the announced byte length.')
    }
    assembly.parts.push(part)
    assembly.receivedBytes += part.byteLength
    assembly.nextSequence++
  }

  private finishTransaction(
    pending: PendingRequest,
    frame: Extract<NativeAnalysisWireFrame, { readonly kind: 'transaction-end' }>,
  ): void {
    const assembly = pending.assembly
    if (!assembly) throw new TypeError('A transaction end arrived before its start frame.')
    if (
      frame.bytes !== assembly.bytes ||
      frame.chunks !== assembly.chunks ||
      frame.sha256 !== assembly.sha256 ||
      frame.payloadKind !== assembly.payloadKind
    ) {
      throw new TypeError('Transaction end metadata does not match its start frame.')
    }
    if (assembly.nextSequence !== assembly.chunks) {
      throw new TypeError(
        `Transaction stream is incomplete: expected ${assembly.chunks} chunks, received ${assembly.nextSequence}.`,
      )
    }
    if (assembly.receivedBytes !== assembly.bytes) {
      throw new TypeError(
        `Transaction stream byte length is invalid: expected ${assembly.bytes}, received ${assembly.receivedBytes}.`,
      )
    }
    const serialized = Buffer.concat(assembly.parts, assembly.bytes)
    const digest = createHash('sha256').update(serialized).digest('hex')
    if (digest !== assembly.sha256) throw new TypeError('Transaction stream digest is invalid.')
    let payload: FactTransaction | NativeFactDelta
    try {
      const parsed: unknown = JSON.parse(serialized.toString('utf8'))
      payload = assembly.payloadKind === 'transaction'
        ? validateTransaction(parsed, this.#payloadCodecs, this.#maximumTransactionBytes)
        : validateDelta(parsed, this.#payloadCodecs, this.#maximumTransactionBytes)
    } catch (error) {
      throw new TypeError('Transaction stream does not contain a valid transaction.', {
        cause: error,
      })
    }
    this.resolve(
      frame.id,
      pending,
      assembly.payloadKind === 'transaction'
        ? {
            id: frame.id,
            protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
            kind: 'transaction',
            transaction: payload as FactTransaction,
          }
        : {
            id: frame.id,
            protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
            kind: 'delta',
            delta: payload as NativeFactDelta,
          },
    )
  }

  private resolve(id: number, pending: PendingRequest, response: NativeAnalysisResponse): void {
    this.#pending.delete(id)
    pending.removeAbort?.()
    if (this.#telemetry && pending.startedNs !== undefined) {
      dispatchAnalysisTelemetry(this.#telemetry, {
        component: 'transport',
        phase: 'request.roundtrip',
        request: id,
        durationNs: Number(process.hrtime.bigint() - pending.startedNs),
        metrics: {
          responseKind: response.kind,
          ...(pending.assembly
            ? {
                transactionBytes: pending.assembly.bytes,
                transactionChunks: pending.assembly.chunks,
              }
            : {}),
        },
      })
    }
    pending.resolve(response)
  }

  private async abort(reason: unknown): Promise<void> {
    if (this.#disposed) return
    const error = reason instanceof Error ? reason : new Error('Native analysis request aborted.')
    this.#failure = error
    this.#disposed = true
    this.stopResidentMonitor()
    this.rejectPending(error)
    this.#child.kill('SIGTERM')
  }

  private fail(error: Error): void {
    if (!this.#failure) this.#failure = error
    this.#disposed = true
    this.stopResidentMonitor()
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

  private startResidentMonitor(): void {
    if (this.#maximumResidentBytes === undefined) return
    this.sampleResidentMemory()
    this.#residentMonitor = setInterval(() => this.sampleResidentMemory(), 100)
    this.#residentMonitor.unref()
  }

  private stopResidentMonitor(): void {
    if (this.#residentMonitor) clearInterval(this.#residentMonitor)
    this.#residentMonitor = undefined
  }

  private sampleResidentMemory(): void {
    if (
      this.#maximumResidentBytes === undefined ||
      this.#residentSamplePending ||
      this.#child.pid === undefined ||
      this.#child.exitCode !== null ||
      this.#child.signalCode !== null
    ) {
      return
    }
    this.#residentSamplePending = true
    Promise.resolve()
      .then(() => this.#sampleResidentBytes(this.#child.pid!))
      .then((residentBytes) => {
        this.#residentSamplePending = false
        if (this.#disposed || this.#child.exitCode !== null || this.#child.signalCode !== null) {
          return
        }
        if (!Number.isSafeInteger(residentBytes) || residentBytes < 1) {
          this.fail(
            new NativeAnalysisProcessResourceError(
              'NATIVE_ANALYSIS_RESOURCE_MONITOR_FAILED',
              'Native analysis resident-memory monitor returned invalid evidence.',
            ),
          )
          return
        }
        if (residentBytes > this.#peakResidentBytes) {
          this.#peakResidentBytes = residentBytes
          if (this.#telemetry) {
            dispatchAnalysisTelemetry(this.#telemetry, {
              component: 'transport',
              phase: 'process.resources',
              durationNs: 0,
              metrics: {
                residentBytes,
                peakResidentBytes: residentBytes,
                maximumResidentBytes: this.#maximumResidentBytes!,
              },
            })
          }
        }
        if (residentBytes > this.#maximumResidentBytes!) {
          this.fail(
            new NativeAnalysisProcessResourceError(
              'NATIVE_ANALYSIS_RESIDENT_LIMIT',
              `Native analysis resident memory exceeded the configured limit: bytes=${residentBytes} limit=${this.#maximumResidentBytes}.`,
            ),
          )
        }
      })
      .catch((error: unknown) => {
        this.#residentSamplePending = false
        if (this.#disposed || this.#child.exitCode !== null || this.#child.signalCode !== null) {
          return
        }
        this.fail(
          new NativeAnalysisProcessResourceError(
            'NATIVE_ANALYSIS_RESOURCE_MONITOR_FAILED',
            `Native analysis resident-memory monitor failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        )
      })
  }
}

async function sampleProcessResidentBytes(pid: number): Promise<number> {
  const { stdout } = await executeFile('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf8',
  })
  return Number.parseInt(stdout.trim(), 10) * 1_024
}

function encodedPhysicalPayloadBytes(value: FactTransaction | NativeFactDelta): number {
  const upserts = value.upserts.map((shard) => ({
    key: shard.key,
    digest: shard.digest,
    namespace: shard.namespace,
    schemaVersion: shard.schemaVersion,
    completion: shard.completion,
    facts: shard.facts.map((fact) => {
      const physicalPayload = physicalPayloadForTransport(fact)
      return {
        id: fact.id,
        generation: fact.generation,
        namespace: fact.namespace,
        schemaVersion: fact.schemaVersion,
        kind: fact.kind,
        subject: fact.subject,
        completeness: fact.completeness,
        provenance: fact.provenance,
        ...(physicalPayload ? { physicalPayload } : { payload: fact.payload }),
      }
    }),
    ...(shard.capabilities ? { capabilities: shard.capabilities } : {}),
  }))
  const encoded = 'manifest' in value
    ? { ...value, upserts }
    : {
        protocolVersion: value.protocolVersion,
        base: value.base,
        next: value.next,
        upserts,
        deletes: value.deletes,
      }
  return Buffer.byteLength(JSON.stringify(encoded))
}

function receiveTelemetry(line: string, sink: AnalysisTelemetrySink): void {
  try {
    const input: unknown = JSON.parse(line)
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const value = input as Partial<AnalysisTelemetryEvent>
    if (
      value.format !== 'astrale.codegraph.analysis-telemetry' ||
      value.version !== 1 ||
      value.component !== 'native' ||
      typeof value.phase !== 'string' ||
      !value.phase
    ) return
    try {
      sink(value as AnalysisTelemetryEvent)
    } catch {
      // Telemetry observers are diagnostic-only.
    }
  } catch {
    // A malformed diagnostic stream never invalidates the semantic protocol stream.
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
  if (
    request.kind === 'refresh'
    && ((request.base === undefined) !== (request.baseSequence === undefined)
      || (request.baseSequence !== undefined
        && (!Number.isSafeInteger(request.baseSequence) || request.baseSequence < 1)))
  ) {
    throw new TypeError('Native refresh base and positive baseSequence must occur together.')
  }
  if (
    request.kind === 'acknowledge'
    && (!Number.isSafeInteger(request.sequence) || request.sequence < 1)
  ) {
    throw new TypeError('Native acknowledgement sequence is invalid.')
  }
}

function validateWireFrame(
  input: unknown,
  payloadCodecs: FactPayloadCodecMap,
  maximumSemanticPayloadBytes: number,
): NativeAnalysisWireFrame {
  if (!input || typeof input !== 'object') throw new TypeError('Response must be an object.')
  const value = input as Record<string, unknown>
  if (!Number.isSafeInteger(value.id) || (value.id as number) < 1) {
    throw new TypeError('Response id is invalid.')
  }
  if (value.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION) {
    throw new TypeError(`Unsupported native protocol ${String(value.protocolVersion)}.`)
  }
  if (
    ![
      'transaction',
      'delta',
      'transaction-start',
      'transaction-chunk',
      'transaction-end',
      'unchanged',
      'acknowledged',
      'error',
    ].includes(String(value.kind))
  ) {
    throw new TypeError('Response kind is invalid.')
  }
  if (value.kind === 'transaction-start') {
    if (value.encoding !== 'base64-json') throw new TypeError('Transaction encoding is invalid.')
    return {
      id: value.id as number,
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      kind: 'transaction-start',
      payloadKind: requiredPayloadKind(value.payloadKind),
      encoding: 'base64-json',
      bytes: requiredInteger(value.bytes, 'bytes', 1),
      chunks: requiredInteger(value.chunks, 'chunks', 1),
      sha256: requiredDigest(value.sha256, 'sha256'),
    }
  }
  if (value.kind === 'transaction-chunk') {
    return {
      id: value.id as number,
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      kind: 'transaction-chunk',
      sequence: requiredInteger(value.sequence, 'sequence', 0),
      data: requiredString(value.data, 'data'),
    }
  }
  if (value.kind === 'transaction-end') {
    return {
      id: value.id as number,
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      kind: 'transaction-end',
      payloadKind: requiredPayloadKind(value.payloadKind),
      bytes: requiredInteger(value.bytes, 'bytes', 1),
      chunks: requiredInteger(value.chunks, 'chunks', 1),
      sha256: requiredDigest(value.sha256, 'sha256'),
    }
  }
  if (value.kind === 'transaction') {
    return {
      id: value.id as number,
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      kind: 'transaction',
      transaction: validateTransaction(
        value.transaction,
        payloadCodecs,
        maximumSemanticPayloadBytes,
      ),
    }
  }
  if (value.kind === 'delta') {
    return {
      id: value.id as number,
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      kind: 'delta',
      delta: validateDelta(value.delta, payloadCodecs, maximumSemanticPayloadBytes),
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
  if (value.kind === 'acknowledged') {
    return {
      id: value.id as number,
      protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
      kind: 'acknowledged',
      generation: admitAnalysisId(
        'generation',
        requiredString(value.generation, 'generation'),
      ),
    }
  }
  if (
    value.kind === 'error' &&
    (typeof value.code !== 'string' ||
      typeof value.message !== 'string' ||
      (value.retryable !== undefined && typeof value.retryable !== 'boolean'))
  ) {
    throw new TypeError('Error response is invalid.')
  }
  return {
    id: value.id as number,
    protocolVersion: NATIVE_ANALYSIS_PROTOCOL_VERSION,
    kind: 'error',
    code: value.code as string,
    message: value.message as string,
    // Early protocol-v1 producers omitted the false value from their JSON
    // envelope. Absence is therefore the canonical backwards-compatible false.
    retryable: value.retryable === true,
  }
}

function requiredDigest(input: unknown, path: string): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/u.test(input)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`)
  }
  return input
}

function requiredPayloadKind(input: unknown): 'transaction' | 'delta' {
  // Protocol-v1 transaction streams predate the explicit payload discriminator.
  if (input === undefined) return 'transaction'
  if (input !== 'transaction' && input !== 'delta') {
    throw new TypeError('Transaction payload kind is invalid.')
  }
  return input
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0) {
    throw new TypeError('Transaction chunk data is not canonical base64.')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new TypeError('Transaction chunk data is not canonical base64.')
  }
  return decoded
}

function validateTransaction(
  input: unknown,
  payloadCodecs: FactPayloadCodecMap,
  maximumSemanticPayloadBytes: number,
): FactTransaction {
  const value = requiredRecord(input, 'transaction')
  const next = requiredRecord(value.next, 'transaction.next')
  const producer = requiredRecord(next.producer, 'transaction.next.producer')
  const base = optionalString(value.base, 'transaction.base')
  const transaction: FactTransaction = {
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
      validateShard(entry, `transaction.upserts[${index}]`, payloadCodecs),
    ),
    deletes: stringArray(value.deletes, 'transaction.deletes').map((key) =>
      admitAnalysisId('fact-shard-key', key),
    ),
  }
  admitWireShards(transaction.upserts, maximumSemanticPayloadBytes)
  return transaction
}

function validateDelta(
  input: unknown,
  payloadCodecs: FactPayloadCodecMap,
  maximumSemanticPayloadBytes: number,
): NativeFactDelta {
  const value = requiredRecord(input, 'delta')
  const parsed = validateTransaction(
    { ...value, manifest: [] },
    payloadCodecs,
    maximumSemanticPayloadBytes,
  )
  if (!parsed.base) throw new TypeError('delta.base is required.')
  return {
    protocolVersion: parsed.protocolVersion,
    base: parsed.base,
    next: parsed.next,
    upserts: parsed.upserts,
    deletes: parsed.deletes,
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

function validateShard(
  input: unknown,
  path: string,
  payloadCodecs: FactPayloadCodecMap,
): FactShard {
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
      validateFact(fact, `${path}.facts[${index}]`, payloadCodecs),
    ),
  }
}

function validateFact(
  input: unknown,
  path: string,
  payloadCodecs: FactPayloadCodecMap,
): Fact {
  const value = requiredRecord(input, path)
  const provenance = requiredRecord(value.provenance, `${path}.provenance`)
  const hasPayload = Object.hasOwn(value, 'payload')
  const hasPhysicalPayload = Object.hasOwn(value, 'physicalPayload')
  if (hasPayload === hasPhysicalPayload) {
    throw new TypeError(`${path} must contain exactly one semantic or physical payload.`)
  }
  const fields: Omit<Fact, 'payload'> = {
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
  }
  return hasPhysicalPayload
    ? createFactWithPhysicalPayload(
        fields,
        value.physicalPayload,
        payloadCodecs,
        `${path}.physicalPayload`,
      )
    : createFactWithSemanticPayload(fields, value.payload)
}

function admitWireShards(shards: readonly FactShard[], maximumSemanticPayloadBytes: number): void {
  let semanticPayloadBytes = 0
  for (const shard of shards) {
    const diagnostics = validateFactShard(shard)
    if (diagnostics.length) {
      throw new TypeError(`Native shard ${shard.key} is invalid: ${diagnostics.join(', ')}`)
    }
    semanticPayloadBytes += admittedFactShardPayloadBytes(shard) ?? 0
    if (semanticPayloadBytes > maximumSemanticPayloadBytes) {
      throw new RangeError(
        'Native analysis transaction exceeds the configured decoded semantic payload limit.',
      )
    }
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
