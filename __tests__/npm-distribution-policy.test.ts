import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { NATIVE_TARGETS } from '../scripts/native/shared.mjs'

const root = resolve(import.meta.dirname, '..')
const targets = Object.keys(NATIVE_TARGETS)
const manifest = async (path: string) => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const workflow = async (name: string) => parse(await readFile(resolve(root, '.github/workflows', name), 'utf8'))

describe('qualified npm distribution policy', () => {
  it('emits distribution JavaScript without references to excluded source maps', async () => {
    const build = await manifest('tsconfig.build.json')
    expect(build.compilerOptions.sourceMap).toBe(false)
    expect(build.compilerOptions.declarationMap).toBe(false)
    const owner = await manifest('package.json')
    expect(owner.files).toEqual(['dist', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'native-release.json', 'native-artifacts', '!dist/**/*.map'])
    for (const dependency of ['vite', 'mermaid', 'katex', 'preact']) {
      expect(owner.dependencies[dependency]).toBeUndefined()
      expect(owner.devDependencies[dependency]).toBeDefined()
    }
    for (const dependency of ['@codemirror/lang-javascript', '@codemirror/lang-yaml', '@lezer/highlight', 'chokidar']) {
      expect(owner.dependencies[dependency]).toBeDefined()
    }
  })

  it('delivers every native target inside exactly one public npm package', async () => {
    const owner = await manifest('package.json')
    expect(owner).toMatchObject({
      name: '@astrale-os/codegraph', private: false, preferUnplugged: true,
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
      repository: { url: 'git+https://github.com/astrale-os/exp-codegraph.git' },
    })
    expect(owner.optionalDependencies).toBeUndefined()
    expect(owner.files).toContain('native-artifacts')
    // Encoded payloads are not executable. Materialization restores admitted modes.
    expect(owner.publishConfig.executableFiles).toEqual([])
    // The checked-in historical manifest retains genuine released bytes. The
    // assembly/admission gates require the complete current matrix before pack.
    const released = Object.keys((await manifest('native-release.json')).artifacts).sort()
    expect((await readdir(resolve(root, 'native-artifacts'))).sort()).toEqual(released)
    for (const target of released) expect(targets).toContain(target)
    expect(parse(await readFile(resolve(root, 'pnpm-workspace.yaml'), 'utf8')).packages).toBeUndefined()
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
        dirs: '.',
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
    expect(steps.at(-1).run).toContain('--require-oxlint')
    const source = await readFile(resolve(root, '.github/workflows/publish.yml'), 'utf8')
    expect(source).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|npm publish|pnpm publish/u)
  })

  it('keeps native qualification read-only and independent from publication', async () => {
    expect((await readdir(resolve(root, '.github/workflows'))).sort()).toEqual(['ci.yml', 'native-release.yml', 'publish.yml'])
    const native = await workflow('native-release.yml')
    expect(native.permissions).toEqual({ contents: 'read' })
    expect(native.jobs.publish).toBeUndefined()
    for (const trigger of ['push', 'pull_request']) {
      expect(native.on[trigger].paths).toContain('LICENSE')
      expect(native.on[trigger].paths).toContain('THIRD_PARTY_NOTICES.md')
      for (const path of ['server/**', 'viewer/**', 'viewer-host/**', 'scripts/build-viewer.mjs', '__tests__/embedded-viewer.test.ts', '__tests__/native-materialization.test.ts']) {
        expect(native.on[trigger].paths).toContain(path)
      }
    }
    expect(native.jobs.build.strategy.matrix.include.map((entry: { target: string }) => entry.target).sort())
      .toEqual([...targets].sort())
    expect(native.jobs['packed-consumer'].needs).toBe('assemble')
    const rust = native.jobs.build.steps.find((step: { run?: string }) => step.run?.includes('build-oxlint.mjs --prepare-toolchain'))
    expect(rust?.if).toBe('matrix.oxlint')
    for (const entry of native.jobs.build.strategy.matrix.include) {
      expect(entry.oxlint).toBe(NATIVE_TARGETS[entry.target]!.oxlint)
    }
    // Upload must pass through the builder whose worker delivery includes
    // mandatory source-owner tests; preparing Rust alone is not qualification.
    const builder = native.jobs.build.steps.findIndex((step: { run?: string }) => step.run?.includes('pnpm native:build'))
    const upload = native.jobs.build.steps.findIndex((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact@'))
    expect(builder).toBeGreaterThan(0)
    expect(native.jobs.build.steps[builder].if).toBeUndefined()
    expect(upload).toBeGreaterThan(builder)
    const owned = native.jobs.build.steps.find((step: { run?: string }) => step.run?.includes('--owned-artifact'))
    expect(owned).toBeDefined()
    expect(owned?.if).toBe('matrix.oxlint')
    expect(native.jobs['packed-consumer'].strategy.matrix.include.map((entry: { target: string }) => entry.target).sort())
      .toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'linux-x64', 'linux-x64', 'linux-x64', 'win32-x64'])
    const pack = native.jobs.assemble.steps.find((step: { name?: string }) => step.name === 'Pack GitHub consumer artifact')
    expect(pack?.run).toContain('pnpm pack --pack-destination release')
    expect(pack?.run).not.toContain('native-packages')
    const consumer = native.jobs['packed-consumer'].steps.find((step: { run?: string }) => step.run?.includes('qualification/v2/release/packed-consumer.mjs'))
    expect(consumer?.run).toContain('--require-oxlint')
    expect(JSON.stringify(native)).not.toMatch(/id-token|workflow run publish|\/publish\//u)
  })
})
