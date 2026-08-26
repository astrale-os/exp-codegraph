import { access, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '..')
const repositoryUrl = 'git+https://github.com/astrale-os/exp-codegraph.git'
const configSetup =
  'astrale-os/config/.github/actions/setup@9bffee57d53b603b556bb545145fdde10f20a4c5'
const nativePackages = [
  ['darwin-arm64', '@astrale-os/codegraph-native-darwin-arm64'],
  ['darwin-x64', '@astrale-os/codegraph-native-darwin-x64'],
  ['linux-arm64', '@astrale-os/codegraph-native-linux-arm64'],
  ['linux-x64', '@astrale-os/codegraph-native-linux-x64'],
] as const

describe('GitHub-only artifact policy', () => {
  it('keeps the root and four native packing units private and version-aligned', async () => {
    const root = await manifest('package.json')
    expect(root).toMatchObject({
      name: '@astrale-os/codegraph',
      private: true,
      repository: { url: repositoryUrl },
    })
    expect(root).not.toHaveProperty('publishConfig')

    const optionalDependencies = root.optionalDependencies as Record<string, string>
    expect(Object.keys(optionalDependencies).sort()).toEqual(
      nativePackages.map(([, name]) => name).sort(),
    )

    for (const [target, name] of nativePackages) {
      expect(optionalDependencies[name]).toBe('workspace:*')
      const native = await manifest(`native-packages/${target}/package.json`)
      expect(native).toMatchObject({
        name,
        private: true,
        version: root.version,
        repository: { url: repositoryUrl },
      })
      expect(native).not.toHaveProperty('publishConfig')
    }
  })

  it('allows qualification and GitHub artifact upload but no registry publication', async () => {
    const workflowDirectory = resolve(repositoryRoot, '.github/workflows')
    const workflowNames = (await readdir(workflowDirectory)).filter((name) => name.endsWith('.yml'))
    expect(workflowNames.sort()).toEqual(['ci.yml', 'native-release.yml'])

    const workflows = await Promise.all(
      workflowNames.map(async (name) => [name, await readFile(resolve(workflowDirectory, name), 'utf8')] as const),
    )
    for (const [name, workflow] of workflows) {
      expect(workflow, name).toContain('contents: read')
      expect(workflow.match(/astrale-os\/config\/.github\/actions\/setup@[a-f0-9]{40}/gu)).not.toBeNull()
      expect(new Set(workflow.match(/astrale-os\/config\/.github\/actions\/setup@[a-f0-9]{40}/gu))).toEqual(
        new Set([configSetup]),
      )
      expect(workflow, name).not.toMatch(/\b(?:npm|pnpm)\s+publish\b/u)
      expect(workflow, name).not.toMatch(/(?:id-token|packages):\s*write/u)
      expect(workflow, name).not.toMatch(/(?:NPM_TOKEN|NODE_AUTH_TOKEN|release-please|npmjs)/iu)
      expect(workflow, name).not.toContain('/publish/')
    }

    const native = workflows.find(([name]) => name === 'native-release.yml')?.[1]
    expect(native).toContain('actions/upload-artifact@')
    expect(native).toContain('name: codegraph-release')
    expect(native).toContain('npm pack ./native-packages/$target')
    expect(native).toContain('packed-consumer.mjs --release-directory release')
    expect(native).not.toContain('package-set.json')

    const consumer = await readFile(
      resolve(repositoryRoot, 'qualification/v2/release/packed-consumer.mjs'),
      'utf8',
    )
    expect(consumer).toContain('const archives = [rootArchive, ...nativeArchives]')
    expect(consumer).toContain('assertPackedConsumerLock(lock, consumer, releaseDirectory, archives)')
  })

  it('contains no npm release or Trusted Publisher control plane', async () => {
    for (const path of [
      '.github/workflows/publish.yml',
      '.github/workflows/release.yml',
      '.release-please-config.json',
      '.release-please-manifest.json',
      'scripts/release/assert-npm-bootstrap.mjs',
      'scripts/release/assert-policy.mjs',
      'scripts/release/npmjs-closure.mjs',
      'scripts/release/package-set.mjs',
      'scripts/release/packages.mjs',
      'scripts/release/policy-guards.mjs',
      'scripts/release/print-bootstrap-commands.mjs',
    ]) {
      await expect(access(resolve(repositoryRoot, path))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})

async function manifest(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8')) as Record<string, unknown>
}
