import { execFile } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { AnalysisTelemetryEvent } from '../analysis/index.ts'
import { createNodeTypeSpecApplicationService } from '../application/node/index.ts'
import { defaultTypeSpecCacheDirectory } from '../cache/file-store.ts'
import { runCliCommand } from '../cli/checkpoint.ts'
import { parseCommand } from '../cli/parse.ts'
import type { CliOutput } from '../cli/report.ts'
import type { CliServices } from '../cli/run.ts'
import { fixture, type Fixture } from './fixture.ts'

const execute = promisify(execFile)
const fixtures: Fixture[] = []
const previousCache = process.env.ASTRALE_TYPESPEC_CACHE_DIR
const previousSemanticPack = process.env.ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR
const previousCi = process.env.CI

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((current) => current.remove()))
  restoreEnvironment('ASTRALE_TYPESPEC_CACHE_DIR', previousCache)
  restoreEnvironment('ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR', previousSemanticPack)
  restoreEnvironment('CI', previousCi)
})

describe('CLI acceleration receipts', () => {
  /** @evidence CLI-SEMANTIC-PACK-CATALOG-PROJECTION */
  it('atomically publishes exact and catalog shards and falls back without transcript drift', async () => {
    const repository = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/cli-acceleration', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    const cache = await fixture({})
    fixtures.push(repository, cache)
    await git(repository.root, ['init', '--quiet'])
    await git(repository.root, ['add', '--all'])
    await git(repository.root, [
      '-c',
      'user.name=Codegraph Fixture',
      '-c',
      'user.email=codegraph@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ])
    process.env.ASTRALE_TYPESPEC_CACHE_DIR = cache.root
    process.env.CI = 'false'

    let applications = 0
    const telemetry: AnalysisTelemetryEvent[] = []
    const services = testServices(() => {
      applications += 1
    }, telemetry)
    const command = parseCommand(['check', repository.root, '--quiet'])
    const firstOutput = recordingOutput()
    const first = await runCliCommand(command, services, firstOutput.output)

    expect(first.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'source-proof', outcome: 'admitted' }),
        expect.objectContaining({ operation: 'semantic-pack-read', outcome: 'miss' }),
        expect.objectContaining({ operation: 'workspace-result-read', outcome: 'miss' }),
        expect.objectContaining({ operation: 'workspace-result-publish', outcome: 'published' }),
        expect.objectContaining({ operation: 'semantic-pack-publish', outcome: 'published' }),
      ]),
    )
    expect(applications).toBe(1)

    const replayOutput = recordingOutput()
    const replayed = await runCliCommand(command, services, replayOutput.output)
    expect(replayed.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'semantic-pack-read', outcome: 'hit' }),
      ]),
    )
    expect(applications).toBe(1)
    expect(replayOutput.transcript).toEqual(firstOutput.transcript)

    const selectedCommand = parseCommand([
      'check',
      repository.root,
      '--select',
      'module',
      '--quiet',
      '--no-cache',
    ])
    const selectedCanonicalOutput = recordingOutput()
    await runCliCommand(selectedCommand, services, selectedCanonicalOutput.output)
    expect(applications).toBe(2)

    const portableCache = await fixture({})
    fixtures.push(portableCache)
    const semanticDirectory = join(cache.root, 'semantic-packs/checks')
    const semanticFilesBefore = (await readdir(semanticDirectory, { recursive: true })).sort()
    process.env.ASTRALE_TYPESPEC_CACHE_DIR = portableCache.root
    process.env.ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR = semanticDirectory
    process.env.CI = 'true'
    const selectedPortableOutput = recordingOutput()
    const selectedPortable = await runCliCommand(
      selectedCommand,
      services,
      selectedPortableOutput.output,
    )
    expect(selectedPortable.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'semantic-pack-read',
          outcome: 'hit',
          code: 'catalog-admitted',
        }),
      ]),
    )
    expect(applications).toBe(2)
    expect(selectedPortableOutput.transcript).toEqual(selectedCanonicalOutput.transcript)
    expect((await readdir(semanticDirectory, { recursive: true })).sort()).toEqual(
      semanticFilesBefore,
    )

    const packManifests = semanticFilesBefore.filter((path) =>
      /(?:^|\/)manifests\/semantic-pack-[a-f0-9]{64}\.json$/u.test(path),
    )
    expect(packManifests).toHaveLength(1)
    const packManifestPath = packManifests[0]!
    const packManifest = JSON.parse(
      await readFile(join(semanticDirectory, packManifestPath), 'utf8'),
    ) as {
      readonly payload: { readonly application?: { readonly scope: string; readonly manifestSha256: string } }
      readonly artifacts: readonly { readonly key: string; readonly digest: string }[]
    }
    expect(packManifest.payload.application).toEqual({
      scope: expect.stringMatching(/^application-[0-9a-f]{32}$/u),
      manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(packManifest.artifacts.map(({ key }) => key).sort()).toEqual([
      'cli/check-catalog.json.br',
      'cli/check-result.json.br',
    ])
    const catalogArtifact = packManifest.artifacts.find(
      ({ key }) => key === 'cli/check-catalog.json.br',
    )!
    const blobDirectory = join(
      dirname(join(semanticDirectory, packManifestPath)),
      '..',
      'blobs',
      'sha256',
    )
    const catalogBlob = join(blobDirectory, catalogArtifact.digest)
    const catalogBytes = await readFile(catalogBlob)
    await writeFile(catalogBlob, 'corrupt', 'utf8')
    const fallbackTelemetryStart = telemetry.length
    const selectedFallbackOutput = recordingOutput()
    const selectedFallback = await runCliCommand(
      selectedCommand,
      services,
      selectedFallbackOutput.output,
    )
    expect(selectedFallback.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'semantic-pack-read',
          outcome: 'miss',
          code: 'artifact-corrupt',
        }),
      ]),
    )
    expect(applications).toBe(3)
    expect(selectedFallbackOutput.transcript).toEqual(selectedCanonicalOutput.transcript)
    const fallbackTelemetry = telemetry.slice(fallbackTelemetryStart)
    expect(fallbackTelemetry).toContainEqual(expect.objectContaining({
      phase: 'application.checkpoint',
      metrics: expect.objectContaining({ status: 'completed', outcome: 'corpus-hit' }),
    }))
    expect(fallbackTelemetry).not.toContainEqual(expect.objectContaining({
      phase: 'application.compile',
      metrics: expect.objectContaining({ status: 'completed' }),
    }))

    const exactWithCorruptCatalogOutput = recordingOutput()
    const exactWithCorruptCatalog = await runCliCommand(
      command,
      services,
      exactWithCorruptCatalogOutput.output,
    )
    expect(exactWithCorruptCatalog.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'semantic-pack-read', outcome: 'hit' }),
      ]),
    )
    expect(applications).toBe(3)
    expect(exactWithCorruptCatalogOutput.transcript).toEqual(firstOutput.transcript)

    await writeFile(catalogBlob, catalogBytes)
    const resultArtifact = packManifest.artifacts.find(
      ({ key }) => key === 'cli/check-result.json.br',
    )!
    await writeFile(join(blobDirectory, resultArtifact.digest), 'corrupt', 'utf8')
    const selectedWithCorruptResultOutput = recordingOutput()
    const selectedWithCorruptResult = await runCliCommand(
      selectedCommand,
      services,
      selectedWithCorruptResultOutput.output,
    )
    expect(selectedWithCorruptResult.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'semantic-pack-read',
          outcome: 'hit',
          code: 'catalog-admitted',
        }),
      ]),
    )
    expect(applications).toBe(3)
    expect(selectedWithCorruptResultOutput.transcript).toEqual(selectedCanonicalOutput.transcript)

    process.env.ASTRALE_TYPESPEC_CACHE_DIR = cache.root
    delete process.env.ASTRALE_TYPESPEC_SEMANTIC_PACK_DIR
    process.env.CI = 'false'

    const fallbackOutput = recordingOutput()
    const fallback = await runCliCommand(command, services, fallbackOutput.output)
    expect(fallback.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'semantic-pack-read', outcome: 'miss' }),
        expect.objectContaining({ operation: 'workspace-result-read', outcome: 'hit' }),
      ]),
    )
    expect(applications).toBe(3)
    expect(fallbackOutput.transcript).toEqual(firstOutput.transcript)
  })

  /** @evidence CLI-SEMANTIC-PACK-PUBLICATION-FAILURE */
  it('reports semantic pack publication failure without changing canonical output', async () => {
    const repository = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/cli-pack-failure', type: 'module' }),
      'module/.spec/api.d.ts': 'export interface Value { readonly id: string }\n',
    })
    const cache = await fixture({ 'semantic-packs': 'blocks the semantic pack directory\n' })
    fixtures.push(repository, cache)
    await git(repository.root, ['init', '--quiet'])
    await git(repository.root, ['add', '--all'])
    await git(repository.root, [
      '-c',
      'user.name=Codegraph Fixture',
      '-c',
      'user.email=codegraph@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ])
    process.env.ASTRALE_TYPESPEC_CACHE_DIR = cache.root
    process.env.CI = 'false'

    let applications = 0
    const services = testServices(() => {
      applications += 1
    })
    const canonicalOutput = recordingOutput()
    const canonical = await runCliCommand(
      parseCommand(['check', repository.root, '--quiet', '--no-cache']),
      services,
      canonicalOutput.output,
    )
    const acceleratedOutput = recordingOutput()
    const accelerated = await runCliCommand(
      parseCommand(['check', repository.root, '--quiet']),
      services,
      acceleratedOutput.output,
    )

    expect(accelerated.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'semantic-pack-read',
          outcome: 'miss',
          code: 'manifest-unreadable',
        }),
        expect.objectContaining({
          operation: 'semantic-pack-publish',
          outcome: 'failed',
          code: 'publication-failed',
          error: expect.objectContaining({ name: expect.any(String), message: expect.any(String) }),
        }),
      ]),
    )
    expect(applications).toBe(2)
    expect(accelerated.exitCode).toBe(canonical.exitCode)
    expect(acceleratedOutput.transcript).toEqual(canonicalOutput.transcript)
  })
})

function testServices(
  onApplication: () => void,
  telemetry: AnalysisTelemetryEvent[] = [],
): CliServices {
  return {
    version: async () => 'fixture',
    initializeModule: async () => {
      throw new Error('unexpected init')
    },
    async createApplication(root, cache, portableCheckpoint) {
      onApplication()
      return createNodeTypeSpecApplicationService({
        root,
        cacheDirectory: defaultTypeSpecCacheDirectory(),
        persistence: cache ? 'advisory' : 'memory',
        ...(portableCheckpoint ? { portableCheckpoint } : {}),
        telemetry: (event) => telemetry.push(event),
      })
    },
    startDev: async () => {
      throw new Error('unexpected dev')
    },
    changedSpecificationScope: async () => ({ kind: 'none', files: [], base: 'HEAD' }),
    planEvidenceTests: async () => {
      throw new Error('unexpected evidence plan')
    },
    executeEvidenceTests: async () => {
      throw new Error('unexpected evidence execution')
    },
  }
}

function recordingOutput(): {
  readonly output: CliOutput
  readonly transcript: Array<readonly ['stdout' | 'stderr', string]>
} {
  const transcript: Array<readonly ['stdout' | 'stderr', string]> = []
  return {
    output: {
      out: (message) => transcript.push(['stdout', message]),
      error: (message) => transcript.push(['stderr', message]),
    },
    transcript,
  }
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await execute('git', ['-C', root, ...args])
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
