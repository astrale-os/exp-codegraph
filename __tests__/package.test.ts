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
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import type { DevOptions, RunningDevServer } from '../server/index.ts'

import { fixture, type Fixture } from './fixture.ts'

const run = promisify(execFile)
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const temporary: string[] = []
const fixtures: Fixture[] = []

afterEach(async () => {
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

describe('published package', () => {
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
    ])
  })

  it('keeps compilers and native source out of ordinary production installs', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      optionalDependencies: Record<string, string>
    }
    expect(manifest.dependencies).not.toHaveProperty('ttsc')
    expect(manifest.devDependencies.ttsc).toBe('0.25.0')
    expect(Object.keys(manifest.optionalDependencies).sort()).toEqual([
      '@astrale-os/codegraph-native-darwin-arm64',
      '@astrale-os/codegraph-native-darwin-x64',
      '@astrale-os/codegraph-native-linux-arm64',
      '@astrale-os/codegraph-native-linux-x64',
    ])

    const root = await mkdtemp(join(tmpdir(), 'codegraph-production-files-'))
    temporary.push(root)
    const installed = join(root, 'consumer/node_modules/@astrale-os/codegraph')
    await stagePublishedFiles(installed)
    await expect(stat(join(installed, 'analysis/typescript/native'))).rejects.toThrow()
    await expect(stat(join(installed, 'analysis/typescript/ttsc'))).rejects.toThrow()
  })

  it('contains no compiler outputs orphaned by a source move or deletion', async () => {
    const dist = join(packageRoot, 'dist')
    const stale: string[] = []
    for (const output of await filesUnder(dist)) {
      if (output.endsWith('.js.map')) {
        if (!(await isFile(output.slice(0, -4)))) stale.push(relative(dist, output))
        continue
      }
      if (!output.endsWith('.js')) continue
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
    await stagePublishedFiles(installed)
    await linkDependencies(consumer)

    const current = await fixture({
      'package.json': JSON.stringify({ name: '@fixture/package-consumer', type: 'module' }),
      'alpha/.spec/api.d.ts': 'export interface Alpha {}\n',
    })
    fixtures.push(current)

    await chmod(installed, 0o555)
    try {
      const cli = join(installed, 'dist/cli.js')
      const version = await run(process.execPath, [cli, '--version'])
      expect(version).toMatchObject({ stdout: '0.1.0\n', stderr: '' })
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
          "const [tooling,analysis,typescript,sqlite,repository,schema,specification,conformance] = await Promise.all([import('@astrale-os/codegraph'),import('@astrale-os/codegraph/analysis'),import('@astrale-os/codegraph/analysis/typescript'),import('@astrale-os/codegraph/analysis/sqlite'),import('@astrale-os/codegraph/repository'),import('@astrale-os/codegraph/schema'),import('@astrale-os/codegraph/specification'),import('@astrale-os/codegraph/conformance')]); process.stdout.write(String([tooling.createTypeSpecApplicationService,analysis.createMemoryAnalysisStore,typescript.createTypeScriptAnalysisService,sqlite.createSQLiteAnalysisStore,repository.inventoryRepository,schema.validateSchemaFile,specification.compileSpecificationSnapshot,conformance.qualifySpecification].every(value => typeof value === 'function')))",
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

      const devUrl = `${pathToFileURL(join(installed, 'dist/server/index.js')).href}?test=${Date.now()}`
      const { startDev } = (await import(devUrl)) as {
        startDev(options: DevOptions): Promise<RunningDevServer>
      }
      const running = await startDev({ root: current.root, port: 0, cache: false })
      try {
        expect(running.server.config.cacheDir.startsWith(installed)).toBe(false)
        const page = await fetch(running.url)
        expect(page.status).toBe(200)
        await page.text()

        const live = await running.server.ssrLoadModule('virtual:spec-catalog-index')
        expect(live.renderers).toBeUndefined()
        expect(live.index.specs[0]).toMatchObject({
          title: 'alpha',
          source: 'alpha/.spec/api.d.ts',
        })
      } finally {
        await running.close()
      }
    } finally {
      await chmod(installed, 0o755)
    }
  }, 30_000)
})

async function stagePublishedFiles(target: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    files: string[]
  }
  await mkdir(target, { recursive: true })
  await cp(join(packageRoot, 'package.json'), join(target, 'package.json'))

  for (const entry of manifest.files.filter((value) => !value.startsWith('!'))) {
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
