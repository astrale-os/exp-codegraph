import { execFile } from 'node:child_process'
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DevOptions, RunningDevServer } from '../server/index.ts'
import { artifactCacheRoot } from '../distribution/materialize.ts'
import { buildViewerArchive } from '../scripts/viewer/archive.mjs'

import { fixture, type Fixture } from './fixture.ts'

const run = promisify(execFile)
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const temporary: string[] = []
const fixtures: Fixture[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(fixtures.splice(0).map((item) => item.remove()))
  await Promise.all(
    temporary.splice(0).map(async (path) => {
      await chmod(join(path, 'consumer/node_modules/@astrale-os/codegraph'), 0o755).catch(
        () => undefined,
      )
      await rm(path, { recursive: true, force: true })
    }),
  )
})

describe('packed release artifact', () => {
  it('lets ordinary NodeNext consumers emit declarations without compiling package TypeScript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codegraph-typed-consumer-'))
    temporary.push(root)
    const consumer = join(root, 'consumer')
    const installed = join(consumer, 'node_modules/@astrale-os/codegraph')
    await stagePublishedFiles(installed)
    await linkDependencies(consumer)
    await mkdir(join(consumer, 'node_modules/@types'), { recursive: true })
    await symlink(await realpath(join(packageRoot, 'node_modules/@types/node')), join(consumer, 'node_modules/@types/node'))
    await writeFile(join(consumer, 'package.json'), '{"type":"module"}')
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
        declaration: true, outDir: 'output', types: ['node'], skipLibCheck: false,
      },
      include: ['consumer.ts'],
    }))
    await writeFile(join(consumer, 'consumer.ts'), [
      "import { createMemoryAnalysisStore, runAnalysisPolicies } from '@astrale-os/codegraph/analysis'",
      "import { createTypeScriptAnalysisService, createBoundedValueEvaluator } from '@astrale-os/codegraph/analysis/typescript'",
      "import { createSQLiteAnalysisStore } from '@astrale-os/codegraph/analysis/sqlite'",
      ...['', '/authoring', '/analysis/native', '/conformance', '/repository', '/schema', '/specification', '/workspace'].map((subpath, index) => `import * as surface${index} from '@astrale-os/codegraph${subpath}'`),
      'export const surfaces = { surface0, surface1, surface2, surface3, surface4, surface5, surface6, surface7 }',
      'export const api = { createMemoryAnalysisStore, runAnalysisPolicies, createTypeScriptAnalysisService, createBoundedValueEvaluator, createSQLiteAnalysisStore }',
    ].join('\n'))
    const compiler = join(packageRoot, 'node_modules/.bin/tsgo')
    const result = await run(compiler, ['-p', join(consumer, 'tsconfig.json')], { cwd: consumer })
    expect(result.stderr).toBe('')
    expect(await readFile(join(consumer, 'output/consumer.d.ts'), 'utf8')).toContain('createTypeScriptAnalysisService')
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
    for (const entry of Object.values(manifest.exports) as Array<string | { types: string }>) {
      if (typeof entry === 'string') continue
      expect(entry.types).toMatch(/^\.\/dist\/.*\.d\.ts$/)
      expect(await isFile(join(installed, entry.types))).toBe(true)
    }
  })

  it('keeps standalone qualification authoritative in the package scripts and CI', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      name: string
      bin: Record<string, string>
      scripts: Record<string, string>
    }
    const workflow = await readFile(join(packageRoot, '.github/workflows/ci.yml'), 'utf8')

    expect(manifest.name).toBe('@astrale-os/codegraph')
    expect(manifest.bin).toEqual({ cg: './dist/cli.js' })
    expect(manifest.scripts.check).toBe('node scripts/check.ts')
    expect(await readFile(join(packageRoot, 'scripts/check.ts'), 'utf8')).toContain(
      'check-v1-removal.ts',
    )
    expect(manifest.scripts.typecheck).toContain('qualification/v2/extension/tsconfig.json')
    expect(workflow).toContain('run: pnpm typecheck\n')
    expect(workflow).toContain('run: pnpm check\n')
    expect(workflow).toContain('run: pnpm test\n')
  })

  it('publishes exactly the ratified headless V2 surface', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(Object.keys(manifest.exports)).toEqual([
      '.',
      './authoring',
      './analysis',
      './analysis/typescript',
      './analysis/sqlite',
      './conformance',
      './repository',
      './schema',
      './specification',
      './workspace',
      './package.json',
      './analysis/native',
    ])
  })

  it('keeps compilers and native source out of ordinary production installs', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      files: string[]
      optionalDependencies?: Record<string, string>
    }
    expect(manifest.dependencies).not.toHaveProperty('ttsc')
    expect(manifest.devDependencies.ttsc).toBe('0.25.0')
    expect(manifest.files).toContain('!dist/**/*.map')
    expect(manifest.optionalDependencies).toBeUndefined()
    expect(manifest.files).toContain('native-release.json')
    expect(manifest.files).toContain('viewer-release.json')
    expect(manifest.files).toContain('!dist/viewer/**')

    const root = await mkdtemp(join(tmpdir(), 'codegraph-production-files-'))
    temporary.push(root)
    const installed = join(root, 'consumer/node_modules/@astrale-os/codegraph')
    await stagePublishedFiles(installed)
    await expect(stat(join(installed, 'analysis/typescript/native'))).rejects.toThrow()
    await expect(stat(join(installed, 'analysis/typescript/ttsc'))).rejects.toThrow()
    await expect(stat(join(installed, 'dist/viewer'))).rejects.toThrow()
  })

  it('contains no compiler outputs orphaned by a source move or deletion', async () => {
    const dist = join(packageRoot, 'dist')
    const stale: string[] = []
    for (const output of await filesUnder(dist)) {
      if (output.endsWith('.js.map')) {
        if (!(await isFile(output.slice(0, -4)))) stale.push(relative(dist, output))
        continue
      }
      if (!output.endsWith('.js') || relative(dist, output).startsWith('viewer/')) continue
      const source = join(packageRoot, relative(dist, output).slice(0, -3))
      const backed = await Promise.all(
        ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'].map((extension) =>
          isFile(`${source}${extension}`),
        ),
      )
      if (!backed.some(Boolean)) stale.push(relative(dist, output))
    }
    expect(stale).toEqual([])
  })

  it('runs the CLI and viewer from exactly the declared files with a read-only package root', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'astrale-spec-package-'))
    temporary.push(temporaryRoot)
    const consumer = join(temporaryRoot, 'consumer')
    const installed = join(consumer, 'node_modules/@astrale-os/codegraph')
    const viewer = await stagePublishedFiles(installed)
    await linkDependencies(consumer)

    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/package-consumer', type: 'module' }),
      'alpha/.spec/api.d.ts': 'export interface Alpha {}\n',
      'alpha/.spec/laws/alpha.ts':
        "import { defineLaw } from '@astrale-os/codegraph/authoring'\nexport const ALPHA_LAW = defineLaw({ id: 'ALPHA-LAW', statement: 'Alpha remains alpha.' })\n",
      // Project lookalikes cannot select the package's source/HMR runtime.
      'viewer/index.html': '<html>project viewer</html>',
      'scripts/build-viewer.mjs': 'throw new Error("must not run")',
    })
    fixtures.push(current)

    const cachePath = join(artifactCacheRoot('viewer'), `viewer-${viewer.header.sha256}.tar`)
    const hadCachedViewer = await isFile(cachePath)
    const noNetwork = join(temporaryRoot, 'no-network.mjs')
    await writeFile(noNetwork, "globalThis.fetch = () => { throw new Error('Headless import attempted a download.') }\n")

    await chmod(installed, 0o555)
    try {
      const cli = join(installed, 'dist/cli.js')
      const version = await run(process.execPath, ['--import', noNetwork, cli, '--version'])
      const packageVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
        .version as string
      expect(version).toMatchObject({ stdout: `${packageVersion}\n`, stderr: '' })
      const result = await run(process.execPath, [cli, 'check', current.root], {
        env: { ...process.env, CI: 'true' },
      })
      expect(result).toMatchObject({ stderr: '' })
      expect(result.stdout).toContain('Checked 1 specification: 0 diagnostics.\n')
      const authoring = await run(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          "import {defineState, transition} from '@astrale-os/codegraph/authoring'; const state = defineState({transitions:{ready:{start:'running'},running:{}}}); process.stdout.write(transition(state, 'ready', 'start'))",
        ],
        { cwd: consumer },
      )
      expect(authoring.stdout).toBe('running')
      const api = await run(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          "globalThis.fetch=()=>{throw new Error('Import attempted a download.')}; const [tooling,analysis,typescript,sqlite,repository,schema,specification,conformance] = await Promise.all([import('@astrale-os/codegraph'),import('@astrale-os/codegraph/analysis'),import('@astrale-os/codegraph/analysis/typescript'),import('@astrale-os/codegraph/analysis/sqlite'),import('@astrale-os/codegraph/repository'),import('@astrale-os/codegraph/schema'),import('@astrale-os/codegraph/specification'),import('@astrale-os/codegraph/conformance')]); process.stdout.write(String([tooling.createTypeSpecApplicationService,analysis.createMemoryAnalysisStore,typescript.createTypeScriptAnalysisService,sqlite.createSQLiteAnalysisStore,repository.inventoryRepository,schema.validateSchemaFile,specification.compileSpecificationSnapshot,conformance.qualifySpecification].every(value => typeof value === 'function')))",
        ],
        { cwd: consumer },
      )
      expect(api.stdout).toBe('true')
      const obsolete = await run(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          "const names=['compiler','catalog','verification','editing','server']; const failed=[]; for (const name of names) { try { await import('@astrale-os/codegraph/'+name) } catch { failed.push(name) } } process.stdout.write(failed.join(','))",
        ],
        { cwd: consumer },
      )
      expect(obsolete.stdout).toBe('compiler,catalog,verification,editing,server')

      const assetURL = `https://github.com/astrale-os/exp-codegraph/releases/download/codegraph-v${viewer.header.packageVersion}-${viewer.header.sourceRevision}/${viewer.header.asset}`
      const download = vi.fn(async (input: string | URL | Request) => {
        expect(String(input)).toBe(assetURL)
        const response = new Response(viewer.gzip)
        Object.defineProperty(response, 'url', { value: assetURL })
        return response
      })
      vi.stubGlobal('fetch', download)
      const devUrl = `${pathToFileURL(join(installed, 'dist/server/index.js')).href}?test=${Date.now()}`
      const { startDev } = (await import(devUrl)) as {
        startDev(options: DevOptions): Promise<RunningDevServer>
      }
      expect(download).not.toHaveBeenCalled()
      const running = await startDev({ root: current.root, port: 0, cache: false })
      expect(download).toHaveBeenCalledTimes(hadCachedViewer ? 0 : 1)
      vi.unstubAllGlobals()
      try {
        expect(running.mode).toBe('embedded')
        const page = await fetch(running.url)
        expect(page.status).toBe(200)
        await page.text()
        await expect(stat(join(installed, 'dist/viewer'))).rejects.toThrow()

        const live = await running.catalog()
        expect(live.index.specs[0]).toMatchObject({
          title: 'alpha',
          source: 'alpha/.spec/api.d.ts',
        })
      } finally {
        await running.close()
      }
    } finally {
      vi.unstubAllGlobals()
      if (!hadCachedViewer) await rm(cachePath, { force: true })
      await chmod(installed, 0o755)
    }
  }, 30_000)
})

async function stagePublishedFiles(target: string) {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    files: string[]
    version: string
  }
  await mkdir(target, { recursive: true })
  await cp(join(packageRoot, 'package.json'), join(target, 'package.json'))

  for (const entry of manifest.files.filter((value) => !value.startsWith('!'))) {
    // This unit fixture supplies a controlled release header after staging. Real
    // archived headers/assets are admitted separately by the installed-release gate.
    if (entry === 'viewer-release.json') continue
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1)
      const matches = (await readdir(packageRoot)).filter((file) => file.endsWith(suffix))
      await Promise.all(matches.map((file) => cp(join(packageRoot, file), join(target, file))))
    } else {
      await cp(join(packageRoot, entry), join(target, entry), { recursive: true })
    }
  }
  for (const entry of manifest.files.filter((value) => value.startsWith('!'))) {
    const excluded = entry.slice(1).replace(/\/\*\*$/u, '')
    await rm(join(target, excluded), { recursive: true, force: true })
  }
  const bundle = await buildViewerArchive(join(packageRoot, 'dist/viewer'))
  const sourceRevision = 'a'.repeat(40)
  const header = { format: 'codegraph.viewer-release.v1', packageVersion: manifest.version, sourceRevision,
    asset: `viewer-${sourceRevision}.tar.gz`, ...bundle.descriptor }
  const native = JSON.parse(await readFile(join(target, 'native-release.json'), 'utf8'))
  await writeFile(join(target, 'native-release.json'), JSON.stringify({ ...native, packageVersion: manifest.version, sourceRevision }))
  await writeFile(join(target, 'viewer-release.json'), JSON.stringify(header))
  return { header, gzip: bundle.gzip }
}

async function linkDependencies(consumer: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  for (const dependency of Object.keys(manifest.dependencies)) {
    const target = join(consumer, 'node_modules', dependency)
    await mkdir(dirname(target), { recursive: true })
    await symlink(await realpath(join(packageRoot, 'node_modules', dependency)), target)
  }
}

async function filesUnder(directory: string): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...(await filesUnder(path)))
    else if (entry.isFile()) output.push(path)
  }
  return output.sort()
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
