import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createCheckPerformanceReceipt,
  checkPerformanceViolations,
  deriveCheckPerformanceCounters,
  sha256,
  verifyCheckPerformanceReceipt,
  type CheckPerformanceReceiptBody,
} from '../qualification/v2/performance/model.ts'
import {
  assertConstitutedCheckRequest,
  CHECK_PERFORMANCE_CONSTITUTION,
  constitutedCheckArgv,
  type CheckPerformanceWorkload,
} from '../qualification/v2/performance/constitution.ts'
import { fixture, type Fixture } from './fixture.ts'

const execute = promisify(execFile)
const fixtures: Fixture[] = []
const requests = CHECK_PERFORMANCE_CONSTITUTION.check.workloads.map(({ id }) => id)
type Request = CheckPerformanceWorkload['id']

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
})

describe('check performance series qualification', () => {
  it('rejects a wrong corpus revision or shape-equivalent request before execution', () => {
    expect(() => assertConstitutedCheckRequest(
      '0'.repeat(40),
      'C1',
      constitutedCheckArgv('/kernel', CHECK_PERFORMANCE_CONSTITUTION.check.workloads[1]),
    )).toThrow('corpus revision is outside')
    expect(() => assertConstitutedCheckRequest(
      CHECK_PERFORMANCE_CONSTITUTION.corpus.revision,
      'C1',
      constitutedCheckArgv('/kernel', {
        ...CHECK_PERFORMANCE_CONSTITUTION.check.workloads[1],
        selectors: ['core/auth/claims'],
      }),
    )).toThrow('request is outside')

    const valid = receipt('optimized', 'leaf', 0)
    const { receiptSha256: _digest, ...body } = valid
    const forgedMemoryBound = createCheckPerformanceReceipt({
      ...body,
      resources: { ...body.resources, maximumProcessTreeResidentUpperBoundMiB: 1 },
    })
    expect(() => verifyCheckPerformanceReceipt(forgedMemoryBound)).toThrow(
      'process-tree memory bound is invalid',
    )

    const c3 = receipt('canonical', 'leaf', 0)
    const { receiptSha256: _c3Digest, ...c3Body } = c3
    const cacheWritingC3 = createCheckPerformanceReceipt({
      ...c3Body,
      finish: { ...c3Body.finish, localCache: PACK_DIRECTORY },
    })
    expect(checkPerformanceViolations(cacheWritingC3)).toContain('C3 wrote its local cache')
  })

  /** @evidence CHECK-PERFORMANCE-SERIES-ANTI-GAMING */
  it('admits the complete workload and rejects weakened coverage or reused process evidence', async () => {
    const root = await fixture({})
    fixtures.push(root)
    const canonicalDirectory = join(root.root, 'canonical')
    const receiptDirectory = join(root.root, 'receipts')
    await mkdir(canonicalDirectory)
    await mkdir(receiptDirectory)
    for (const request of requests) {
      await writeFile(
        join(canonicalDirectory, `${request}.json`),
        `${JSON.stringify(receipt('canonical', request, 0), null, 2)}\n`,
      )
    }
    for (let index = 0; index < 100; index += 1) {
      await writeFile(
        join(receiptDirectory, `${String(index).padStart(3, '0')}.json`),
        `${JSON.stringify(receipt('optimized', requests[index % requests.length]!, index), null, 2)}\n`,
      )
    }
    const output = join(root.root, 'verification.json')
    await execute(process.execPath, [
      'qualification/v2/performance/verify-series.ts',
      '--receipts',
      receiptDirectory,
      '--canonical',
      canonicalDirectory,
      '--output',
      output,
    ])
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({
      status: 'qualified',
      samples: 100,
      runnerInstances: 2,
      requestShapes: 4,
      processEvidence: 100,
      workloads: [
        'dependency-heavy',
        'diagnostic',
        'leaf',
        'multi-select',
        'valid',
        'whole',
      ],
    })

    const dependencyCanonical = receipt('canonical', 'dependency-heavy', 0)
    const { receiptSha256: _digest, ...dependencyBody } = dependencyCanonical
    const weakenedTelemetry = dependencyBody.work.telemetry.map((event) => ({
      ...event,
      metrics: {
        ...event.metrics,
        specificationOwners: 4,
        declarationSessions: 4,
        declarationPrograms: 4,
        moduleSessions: 4,
        modulePrograms: 4,
      },
    }))
    const weakened = createCheckPerformanceReceipt({
      ...dependencyBody,
      work: {
        telemetry: weakenedTelemetry,
        counters: deriveCheckPerformanceCounters(weakenedTelemetry, undefined),
      },
    })
    const dependencyPath = join(canonicalDirectory, 'dependency-heavy.json')
    await writeFile(dependencyPath, `${JSON.stringify(weakened, null, 2)}\n`)
    await expect(execute(process.execPath, [
      'qualification/v2/performance/verify-series.ts',
      '--receipts',
      receiptDirectory,
      '--canonical',
      canonicalDirectory,
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('dependency-heavy canonical owner count'),
    })
    await writeFile(
      dependencyPath,
      `${JSON.stringify(dependencyCanonical, null, 2)}\n`,
    )

    const leafCanonical = receipt('canonical', 'leaf', 0)
    const { receiptSha256: _leafDigest, ...leafBody } = leafCanonical
    const relabeledLeaf = createCheckPerformanceReceipt({
      ...leafBody,
      request: {
        argv: leafBody.request.argv.map((value) =>
          value === 'core/auth/trust' ? 'core/auth/claims' : value,
        ),
      },
    })
    const leafPath = join(canonicalDirectory, 'leaf.json')
    await writeFile(leafPath, `${JSON.stringify(relabeledLeaf, null, 2)}\n`)
    await expect(execute(process.execPath, [
      'qualification/v2/performance/verify-series.ts',
      '--receipts',
      receiptDirectory,
      '--canonical',
      canonicalDirectory,
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('outside the ratified constitution'),
    })
    await writeFile(leafPath, `${JSON.stringify(leafCanonical, null, 2)}\n`)

    const firstOptimized = receipt('optimized', requests[0], 0)
    const { receiptSha256: _counterDigest, ...counterBody } = firstOptimized
    const omittedWork = createCheckPerformanceReceipt({
      ...counterBody,
      result: {
        ...counterBody.result,
        acceleration: {
          ...counterBody.result.acceleration!,
          events: counterBody.result.acceleration!.events.map((event) => ({
            ...event,
            work: { bytesRead: 0, bytesDecoded: 0, loadedShards: 0 },
          })),
        },
      },
      work: {
        ...counterBody.work,
        counters: {
          ...counterBody.work.counters!,
          bytesRead: 0,
          bytesDecoded: 0,
          loadedShards: 0,
        },
      },
    })
    const firstPath = join(receiptDirectory, '000.json')
    await writeFile(firstPath, `${JSON.stringify(omittedWork, null, 2)}\n`)
    await expect(execute(process.execPath, [
      'qualification/v2/performance/verify-series.ts',
      '--receipts',
      receiptDirectory,
      '--canonical',
      canonicalDirectory,
    ])).rejects.toMatchObject({
      stdout: expect.stringContaining('did not count its admitted shard bytes'),
    })
    await writeFile(firstPath, `${JSON.stringify(firstOptimized, null, 2)}\n`)

    await writeFile(
      join(receiptDirectory, '099.json'),
      `${JSON.stringify(receipt('optimized', requests[3], 99, {
        instance: 'runner-a',
        processId: 10_098,
        startedAt: startedAt(98),
      }), null, 2)}\n`,
    )
    await expect(execute(process.execPath, [
      'qualification/v2/performance/verify-series.ts',
      '--receipts',
      receiptDirectory,
      '--canonical',
      canonicalDirectory,
    ])).rejects.toMatchObject({ stderr: expect.stringContaining('reuses process evidence') })
  })
})

function receipt(
  mode: 'canonical' | 'optimized',
  request: Request,
  index: number,
  processEvidence: {
    readonly instance: string
    readonly processId: number
    readonly startedAt: string
  } = {
    instance: index % 2 ? 'runner-b' : 'runner-a',
    processId: 10_000 + index,
    startedAt: startedAt(index),
  },
) {
  const workload = CHECK_PERFORMANCE_CONSTITUTION.check.workloads.find(({ id }) => id === request)!
  const exitCode = workload.expectedExitCode
  const stdout = `${request}: ${exitCode ? 'diagnostic' : 'pass'}\n`
  const acceleration = mode === 'optimized'
    ? {
        format: 'astrale.codegraph.cli-acceleration-receipt' as const,
        version: 1 as const,
        events: [{
          operation: 'semantic-pack-read' as const,
          outcome: 'hit' as const,
          code: 'catalog-admitted',
          durationMs: 1,
          work: { bytesRead: 100, bytesDecoded: 200, loadedShards: 1 },
        }],
      }
    : undefined
  const telemetry = mode === 'canonical'
    ? [
        {
          format: 'astrale.codegraph.analysis-telemetry' as const,
          version: 1 as const,
          component: 'analysis' as const,
          phase: 'qualification.canonical-inventory',
          durationNs: 1,
          metrics: {
            status: 'completed',
            filesTraversed: 10,
            bytesTraversed: 100,
            bytesRead: 100,
            bytesHashed: 100,
          },
        },
        {
          format: 'astrale.codegraph.analysis-telemetry' as const,
          version: 1 as const,
          component: 'analysis' as const,
          phase: 'qualification.canonical-slow',
          durationNs: 1,
          metrics: {
            status: 'completed',
            specificationOwners: canonicalOwners(request),
            declarationSessions: canonicalOwners(request),
            declarationPrograms: canonicalOwners(request),
            moduleSessions: canonicalOwners(request),
            modulePrograms: canonicalOwners(request),
          },
        },
      ]
    : []
  const common: CheckPerformanceReceiptBody = {
    format: 'astrale.codegraph.check-performance-receipt',
    version: 3,
    class: mode === 'canonical' ? 'C3' : 'C1',
    mode,
    request: {
      argv: requestArgv(
        request,
        mode === 'canonical' ? '/oracle' : `/checkout-${processEvidence.instance}`,
      ),
    },
    runner: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      codegraphRevision: 'candidate-revision',
      harnessSha256: 'harness-sha256',
      processId: processEvidence.processId,
      startedAt: processEvidence.startedAt,
      instance: processEvidence.instance,
      hardware: {
        cpuModel: 'qualified-runner',
        logicalCpus: 4,
        availableParallelism: 4,
        totalMemoryBytes: 8 * 1_024 * 1_024 * 1_024,
      },
    },
    ...(mode === 'optimized' ? { series: { runId: 'series-fixture', sampleIndex: index } } : {}),
    subject: {
      producerFingerprint: 'producer',
      sourceProof: SOURCE_PROOF,
      repositoryRevision: CHECK_PERFORMANCE_CONSTITUTION.corpus.revision,
      constitutionSha256: CHECK_PERFORMANCE_CONSTITUTION.sha256,
    },
    start: {
      ci: mode === 'optimized',
      localCache: EMPTY_DIRECTORY,
      ...(mode === 'optimized' ? { semanticPack: PACK_DIRECTORY } : {}),
    },
    result: {
      exitCode,
      stdout,
      stderr: '',
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(''),
      check: {
        repository: 'repository:fixture',
        inventory: 'inventory:fixture',
        snapshot: `snapshot:${request}`,
      },
      ...(acceleration ? { acceleration } : {}),
    },
    work: {
      telemetry,
      counters: deriveCheckPerformanceCounters(telemetry, acceleration),
    },
    resources: {
      wallMilliseconds: mode === 'optimized' ? 1_000 + index : 10_000,
      userCpuMilliseconds: 100,
      systemCpuMilliseconds: 10,
      maximumRssMiB: 128,
      maximumNativeResidentMiB: 0,
      maximumWorkerResidentUpperBoundMiB: 0,
      maximumProcessTreeResidentUpperBoundMiB: 128,
    },
    finish: {
      localCache: EMPTY_DIRECTORY,
      ...(mode === 'optimized' ? { semanticPack: PACK_DIRECTORY } : {}),
    },
  }
  return createCheckPerformanceReceipt(common)
}

function requestArgv(request: Request, root: string): readonly string[] {
  const workload = CHECK_PERFORMANCE_CONSTITUTION.check.workloads.find(({ id }) => id === request)!
  return constitutedCheckArgv(root, workload)
}

function canonicalOwners(request: Request): number {
  switch (request) {
    case 'whole': return 361
    case 'leaf': return 8
    case 'dependency-heavy': return 169
    case 'multi-select': return 3
  }
}

function startedAt(index: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
}

const EMPTY_DIRECTORY = { exists: false, files: 0, bytes: 0 } as const
const PACK_DIRECTORY = { exists: true, files: 3, bytes: 4_096 } as const
const SOURCE_PROOF = {
  ok: true,
  proof: {
    format: 'astrale.codegraph.source-proof',
    version: 1,
    id: 'source-proof:fixture',
    repositoryFormat: '0',
    objectFormat: 'sha1',
    headTree: 'a'.repeat(40),
    topologyDigest: 'b'.repeat(64),
    scope: { version: 'application-source-scope/1', exclude: [], ignored: 'reject-semantic' },
    overlay: [],
    changedPaths: [],
  },
} as const
