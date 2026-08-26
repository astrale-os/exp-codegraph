import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import type { TypeSpecApplicationRefreshOptions } from '../../../application/index.ts'
import type { CliCommand } from '../../../cli/parse.ts'
import type { CliOutput } from '../../../cli/report.ts'

const execute = promisify(execFile)
const root = resolve(requiredArgument('--root'))
const packageRoot = resolve(requiredArgument('--package-root'))
const restartEvidenceFile = resolve(requiredArgument('--restart-evidence'))
const outputFile = resolve(requiredArgument('--output'))
const cacheDirectory = await mkdtemp(join(tmpdir(), 'codegraph-selected-oracle-'))

interface RestartEvidence {
  readonly subject: {
    readonly root: string
    readonly rootHead?: string
    readonly rootStatusSha256?: string
    readonly cliPackageProducerFingerprint: string
  }
  readonly scenarios: readonly {
    readonly id: string
    readonly select: readonly string[]
    readonly prime: { readonly outputSha256: string }
  }[]
}

interface OracleResult {
  readonly id: string
  readonly select: readonly string[]
  readonly elapsedMs: number
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly outputSha256: string
  readonly expectedOutputSha256: string
  readonly snapshot: string
  readonly selection: string
}

try {
  const restartBytes = await readFile(restartEvidenceFile)
  const restart = JSON.parse(restartBytes.toString('utf8')) as RestartEvidence
  assert.equal(resolve(restart.subject.root), root, 'Restart evidence belongs to another root.')
  const git = await gitSubject(root)
  assert.equal(git.head, restart.subject.rootHead, 'Kernel HEAD changed after restart evidence.')
  assert.equal(
    sha256(git.status),
    restart.subject.rootStatusSha256,
    'Kernel worktree changed after restart evidence.',
  )

  const nodeModule = await import(
    pathToFileURL(join(packageRoot, 'dist/application/node/index.js')).href
  )
  const runModule = await import(pathToFileURL(join(packageRoot, 'dist/cli/run.js')).href)
  const conformance = await import(pathToFileURL(join(packageRoot, 'dist/conformance/index.js')).href)
  const producer = await nodeModule.codegraphProducerFingerprint(packageRoot)
  assert.equal(
    producer,
    restart.subject.cliPackageProducerFingerprint,
    'Installed Codegraph producer changed after restart evidence.',
  )

  const service = await nodeModule.createNodeTypeSpecApplicationService({
    root,
    cacheDirectory,
    persistence: 'memory',
  })
  try {
    const refreshBase = {
      qualify: true,
      compilerAnalysis: false,
      requestedProfiles: [
        conformance.SPECIFICATION_VALIDITY_PROFILE_ID,
        conformance.MODULE_LAYOUT_PROFILE_ID,
        conformance.MODULE_SCHEMA_PROFILE_ID,
        conformance.MODULE_TEST_EVIDENCE_PROFILE_ID,
      ],
      exclude: [],
      includeDependents: false,
      requireCompleteLayout: true,
      requireExactLayout: false,
    } satisfies TypeSpecApplicationRefreshOptions
    const results: OracleResult[] = []
    for (const scenario of restart.scenarios) {
      const started = process.hrtime.bigint()
      const refreshed = await service.refresh({
        ...refreshBase,
        select: scenario.select,
        focused: scenario.select.length > 0,
      })
      const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n)
      const command = {
        name: 'check',
        root,
        exclude: [],
        select: scenario.select,
        requireCompleteLayout: true,
        requireExactLayout: false,
        format: 'text',
        quiet: true,
        cache: false,
      } satisfies Extract<CliCommand, { readonly name: 'check' }>
      let stdout = ''
      let stderr = ''
      const output: CliOutput = {
        out: (message) => {
          stdout += `${message}\n`
        },
        error: (message) => {
          stderr += `${message}\n`
        },
      }
      const result = runModule.reportCheckResult(output, command, refreshed.snapshot)
      const outputSha256 = sha256(
        JSON.stringify({ exitCode: result.exitCode, signal: null, stdout, stderr }),
      )
      assert.equal(
        outputSha256,
        scenario.prime.outputSha256,
        `${scenario.id} projected CLI output differs from its canonical application oracle.`,
      )
      results.push({
        id: scenario.id,
        select: scenario.select,
        elapsedMs,
        exitCode: result.exitCode,
        stdout,
        stderr,
        outputSha256,
        expectedOutputSha256: scenario.prime.outputSha256,
        snapshot: refreshed.snapshot.id,
        selection: refreshed.snapshot.selection.kind,
      })
    }
    const unsigned = {
      format: 'astrale.codegraph.cli-selected-canonical-oracle' as const,
      version: 1 as const,
      status: 'qualified' as const,
      method: {
        applicationPersistence: 'memory' as const,
        persistentResultAdmission: false as const,
        retainedApplicationCorpus: true as const,
        canonicalApplicationRefresh: true as const,
        byteExactCliOutputComparison: true as const,
      },
      subject: {
        root,
        rootHead: git.head,
        rootStatusSha256: sha256(git.status),
        packageRoot,
        producerFingerprint: producer,
        restartEvidenceFile,
        restartEvidenceSha256: sha256(restartBytes),
      },
      results,
    }
    const evidence = {
      ...unsigned,
      evidenceSha256: sha256(JSON.stringify(unsigned)),
    }
    await writeFile(outputFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  } finally {
    await service.dispose()
  }
} finally {
  await rm(cacheDirectory, { recursive: true, force: true })
}

async function gitSubject(directory: string): Promise<{ readonly head: string; readonly status: string }> {
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execute('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }),
    execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  ])
  return { head: head.trim(), status }
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.`)
  return value
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
