import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const targets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
const nativePackages = targets.map((target) => [target, `@astrale-os/codegraph-native-${target}`] as const)
const manifest = async (path: string) => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const workflow = async (name: string) => parse(await readFile(resolve(root, '.github/workflows', name), 'utf8'))

describe('qualified npm distribution policy', () => {
  it('keeps exactly six public npm packages aligned to the root version', async () => {
    const owner = await manifest('package.json')
    expect(Object.keys(owner.optionalDependencies).sort()).toEqual(nativePackages.map(([, name]) => name).sort())
    for (const [target, name] of nativePackages) {
      expect(owner.optionalDependencies[name]).toBe('workspace:*')
      expect(await manifest(`native-packages/${target}/package.json`)).toMatchObject({
        name, version: owner.version, private: false,
        publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
        repository: { url: 'git+https://github.com/astrale-os/exp-codegraph.git' },
      })
    }
    expect(owner).toMatchObject({
      name: '@astrale-os/codegraph', private: false,
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    })
  })

  it('publishes only a manually selected successful main qualification with no token fallback', async () => {
    const publish = await workflow('publish.yml')
    expect(Object.keys(publish.on)).toEqual(['workflow_dispatch'])
    expect(Object.keys(publish.on.workflow_dispatch.inputs).sort()).toEqual(['expected-sha', 'qualification-run-id'])
    expect(publish.jobs.publish.if).toBe("github.ref == 'refs/heads/main'")
    expect(publish.jobs.publish.permissions).toEqual({ contents: 'read', actions: 'read', 'id-token': 'write' })
    const steps = publish.jobs.publish.steps
    expect(steps[0].with.ref).toBe('${{ inputs.expected-sha }}')
    const admission = steps.findIndex((step: { id?: string }) => step.id === 'packages')
    const publisher = steps.findIndex((step: { uses?: string }) => step.uses?.includes('/publish/packages@'))
    expect(admission).toBeGreaterThan(0)
    expect(publisher).toBeGreaterThan(admission)
    expect(steps[admission].run).toContain('--qualification-run')
    expect(steps[admission].run).toContain('--npm-preflight')
    expect(steps[publisher]).toMatchObject({
      uses: 'astrale-os/config/.github/actions/publish/packages@8e2e2abd0320be0c2f64033916519ab3b66c7dd7',
      with: {
        dirs: [...targets.map((target) => `native-packages/${target}`), '.'].join(' '),
        'mirror-public-packages': 'false',
        'install-command': 'true',
        'tarballs-json': '${{ steps.packages.outputs.tarballs-json }}',
      },
    })
    expect(steps[publisher].with['build-command']).toContain('admit-packages.mjs')
    expect(steps[publisher].with['npm-token']).toBeUndefined()
    expect(steps[publisher].with['github-token']).toBeUndefined()
    expect(steps.at(-2).run).toContain('--npm-published')
    expect(steps.at(-1).run).toContain('--npm-version')
    const source = await readFile(resolve(root, '.github/workflows/publish.yml'), 'utf8')
    expect(source).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|npm publish|pnpm publish/u)
  })

  it('keeps native qualification read-only and independent from publication', async () => {
    expect((await readdir(resolve(root, '.github/workflows'))).sort()).toEqual(['ci.yml', 'native-release.yml', 'publish.yml'])
    const native = await workflow('native-release.yml')
    expect(native.permissions).toEqual({ contents: 'read' })
    expect(native.jobs.publish).toBeUndefined()
    expect(native.jobs.build.strategy.matrix.include.map((entry: { target: string }) => entry.target).sort())
      .toEqual([...targets].sort())
    expect(native.jobs['packed-consumer'].needs).toBe('assemble')
    expect(JSON.stringify(native)).not.toMatch(/id-token|workflow run publish|\/publish\//u)
  })
})
