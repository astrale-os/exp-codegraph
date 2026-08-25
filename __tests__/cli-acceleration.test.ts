import { execFile } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { AnalysisTelemetryEvent } from '../analysis/index.ts'
import type { TypeSpecApplicationSnapshot } from '../application/index.ts'
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
  it('isolates text and JSON result identities and replays each exact format', async () => {
    const repository = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/cli-format-identity', type: 'module' }),
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
    const services = testServices(() => {
      applications += 1
    })
    const text = parseCommand(['check', repository.root])
    const json = parseCommand(['check', repository.root, '--format', 'json'])

    const initialText = recordingOutput()
    await runCliCommand(text, services, initialText.output)
    expect(applications).toBe(1)

    const initialJson = recordingOutput()
    const jsonResult = await runCliCommand(json, services, initialJson.output)
    expect(applications).toBe(2)
    expect(jsonResult.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'semantic-pack-read',
          outcome: 'miss',
          code: 'request-mismatch',
        }),
      ]),
    )
    expect(initialJson.transcript).toHaveLength(1)
    expect(initialJson.transcript[0]?.[0]).toBe('stdout')
    expect(() => JSON.parse(initialJson.transcript[0]![1])).not.toThrow()

    const replayedJson = recordingOutput()
    const replayedJsonResult = await runCliCommand(json, services, replayedJson.output)
    expect(applications).toBe(2)
    expect(replayedJsonResult.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'semantic-pack-read',
          outcome: 'hit',
          code: 'admitted',
        }),
      ]),
    )
    expect(replayedJson.transcript).toEqual(initialJson.transcript)

    const replayedText = recordingOutput()
    const replayedTextResult = await runCliCommand(text, services, replayedText.output)
    expect(applications).toBe(2)
    expect(replayedTextResult.acceleration?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'workspace-result-read', outcome: 'hit' }),
      ]),
    )
    expect(replayedText.transcript).toEqual(initialText.transcript)
  })

  /** @evidence CLI-SEMANTIC-PACK-REQUEST-IDENTITY */
  it('uses the exact application checkpoint when a catalog cannot reproduce request identity', async () => {
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
    const snapshots: TypeSpecApplicationSnapshot[] = []
    const services = testServices(
      () => {
        applications += 1
      },
      telemetry,
      (snapshot) => snapshots.push(snapshot),
    )
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
    const selectedCanonical = await runCliCommand(
      selectedCommand,
      services,
      selectedCanonicalOutput.output,
    )
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
          outcome: 'miss',
          code: 'request-mismatch',
        }),
      ]),
    )
    expect(applications).toBe(3)
    expect(selectedPortableOutput.transcript).toEqual(selectedCanonicalOutput.transcript)
    expect(selectedPortable.check?.snapshot).toBe(selectedCanonical.check?.snapshot)
    expect(snapshots[2]?.id).toBe(snapshots[1]?.id)
    expect((await readdir(semanticDirectory, { recursive: true })).sort()).toEqual(
      semanticFilesBefore,
    )
    expect(await readdir(portableCache.root, { recursive: true })).toEqual([])

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
          code: 'request-mismatch',
        }),
      ]),
    )
    expect(applications).toBe(4)
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
    expect(applications).toBe(4)
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
          outcome: 'miss',
          code: 'request-mismatch',
        }),
      ]),
    )
    expect(applications).toBe(5)
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
    expect(applications).toBe(5)
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
  onSnapshot?: (snapshot: TypeSpecApplicationSnapshot) => void,
): CliServices {
  return {
    version: async () => 'fixture',
    initializeModule: async () => {
      throw new Error('unexpected init')
    },
    async createApplication(root, cache, portableCheckpoint) {
      onApplication()
      const application = await createNodeTypeSpecApplicationService({
        root,
        cacheDirectory: defaultTypeSpecCacheDirectory(),
        persistence: cache ? 'advisory' : 'memory',
        ...(portableCheckpoint ? { portableCheckpoint } : {}),
        telemetry: (event) => telemetry.push(event),
      })
      return {
        async refresh(options) {
          const refreshed = await application.refresh(options)
          onSnapshot?.(refreshed.snapshot)
          return refreshed
        },
        current: () => application.current(),
        open: (snapshot) => application.open(snapshot),
        settle: () => application.settle(),
        dispose: () => application.dispose(),
      }
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
